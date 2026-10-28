---
author: flow-machine-draft
created_at: 2026-10-28T23:13:04.592Z
---
# 设计记录（Design Record）— 2026-10-29-floating-scope-loadmore-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因：`frontend/src/components/floating/floating-session-host.tsx:578` 以内联对象传 `scope`（`lockedRuntime ? { kind: "runtime", runtimeId: lockedRuntime.id } : undefined`），宿主每次重渲染产生新引用；`b9949cdbf` 在 `session-list-panel.tsx` 新增的附加段清理 effect 以 `[scope, isArchivedView, assocFilter]` 为依赖（React `useEffect` 用 `Object.is` 引用比较），宿主重渲染即误判「口径变化」→ `setExtraItems([])` 清附加段 + `extraOffsetRef` 游标归 null——锁定 runtime 悬浮面板点「加载更多会话」拉回的条目随宿主重渲染消失、计数回跳、再点从首屏 offset 重复拉取。

修法（根修在消费组件，对所有调用方免疫）：`session-list-panel.tsx` 新增模块级纯函数 `sessionScopeStableKey(scope)`——按判别联合四个分支（workspace/change/runtime/quicklog）拼 `kind` + 全部标识字段（workspaceId/changeId/runtimeId/qlId）的标量串；清理 effect 的依赖把 `scope` 对象换成该稳定键。同值新引用 → 键相等 → effect 不触发（附加段/游标保留）；口径真实变化（kind 或任一标识字段变）→ 键变 → 照旧清空复位。不动 floating-session-host（消费端单点修只保一个入口，且组件自身对引用不稳定免疫后该传参模式无害——react-query queryKey 走结构化哈希本就不受引用影响，全仓唯一落坑点就是这个 effect）；不动 `listParamsBase` 的 useMemo 依赖（scope 引用不稳定时它内容不变地重建，无行为影响，最小改动面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出纯函数 `sessionScopeStableKey(scope: SessionListScope | undefined | null): string | null`（`session-list-panel.tsx`，与 `visibleGroupSessionsWithExtra`/`GROUP_LOAD_MORE_STEP` 同款导出供测试先例）：null/undefined 入参返回 null，四个分支各自拼 `${kind}:${workspaceId|""}|${changeId|""}|${runtimeId|""}|${qlId|""}` 形态标量键。仅组件内部与测试消费，**无**端点/命令/文件格式变化。
- 行为变化（对外可见）：同值新引用 scope 重渲染不再清附加段/复位游标；scope 口径真实变化行为不变（照旧清空+复位）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。本修复不触及请求时序；续拉响应迟到与 rerender 交错的既有语义不变（附加段 append 按 id 去重、in-flight 守卫防双拉）。稳定键是纯派生值，无时序假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   单组件 state 无跨执行体共享；effect 清空与新键计算都在渲染/提交相位内，React 自身保证一致性。多实例（门户 + 悬浮宿主同屏）各持独立 extraItems/游标，互不可见，无冲突。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   scope 口径切换（键变）→ 附加段清 + 游标 null；切回原口径（键回到旧值）→ 附加段从零续拉（接受：附加段是组件 state 非缓存，与既有 FR-05 语义一致，非本变更引入）。卸载后 state 随组件销毁，无泄漏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。稳定键含全部标识字段且 kind 前缀区分分支——同 kind 不同 id（ws-1→ws-2）键必不同（清空语义保留），跨 kind（workspace→runtime）必不同；change/quicklog 分支含 workspaceId 字段，同 id 不同工作区不串台。纯函数无环境依赖，Windows/Linux/macOS 无关。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：稳定键漏拼某个标识字段——某分支字段未进键，则该字段变化不触发清空（旧口径附加段泄漏进新视图）。对策：键构造与类型判别联合同文件同居（类型加字段时函数在同文件可被 tsc 联合收窄错误立即暴露）+ 纯函数四分支键唯一性用例钉死。放弃的方案：①floating-session-host 侧 `useMemo` 包 scope——只修一个调用入口，未来新调用方内联传参复发；且 `lockedRuntime` 若引用不稳定 useMemo 依赖仍需二次防御，不如消费端标量化根本。②effect 依赖改 `scope?.kind` 仅判 kind——同 kind 不同 id 切换漏清（FR-02 场景），不可行。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 新增导出 `sessionScopeStableKey` 纯函数；清理 effect 依赖 `scope` → 稳定键 |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 新增 FR-01/FR-02 组件级用例 + 稳定键纯函数用例 |
