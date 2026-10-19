---
author: flow-machine-draft
created_at: 2026-10-19T01:56:39.052Z
---
# 设计记录（Design Record）— 2026-10-19-shared-agent-onboarding-hint

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

只改前端 `frontend/src/components/daemon/session-panel/session-panel-page.tsx` 预会话分支，三件事：

1. **门控数据**：新增轻量查询 `["daemonMachines", "sharedAgentOnboarding"]` → `listDaemonMachines({ limit: 1 })`，`enabled: sessionId === null`（仅预会话态发起）、`staleTime: 30_000`；派生 `noOwnNoSharedMachine`（`data != null && total === 0 && (shared_to_me?.length ?? 0) === 0`——data 未就绪/失败恒 false，fail-open）。
2. **默认选中**：复用组件内既有 `useActiveSharedAgents()`（740 行，徽标同源）取第一个 `runtime_online` 的共享智能体；`preProfileTouchedRef`（useRef）守卫——用户经 `onProvisionalSwitch` 档案分支手动操作后置 true；effect 仅在「预会话态 + 未手动触档 + 门控成立 + 当前值不同」时 `setPreProfileId(firstOnlineSharedAgent.agent_profile_id)`。
3. **提示条**：预会话渲染区 SessionConfigBar 上方渲染 `data-testid="pre-session-shared-agent-hint"` 的 info 条，条件 `noOwnNoSharedMachine && firstOnlineSharedAgent && preProfileId === firstOnlineSharedAgent.agent_profile_id`（用户手动改选后自然消失，不依赖 ref）。

选此方案而非复用 `machines` prop 的原因：该 prop 是门户融合候选（自有+共享），无 loading 语义（加载中空数组会误判为「无机器」），且各 SessionPanel 挂载方传参不一；独立轻查询（limit=1）语义自洽、请求成本可忽略，不动 props 链与共享组件。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无后端/API/类型契约变化（不触发 gen:types 义务）。
- 前端组件内部行为变化：`SessionPanelPage` 预会话态新增一次门控 GET /api/daemon/machines?limit=1 与默认选中 effect。
- 新增 DOM 锚点：`data-testid="pre-session-shared-agent-hint"`（预会话引导提示条，仅门控成立且选中共享智能体时存在）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：门控查询与 activeSharedAgents 两路独立到达；effect 依赖完整（data 就绪 + 在线条目存在）才触发，任一未就绪/失败均为不选中（fail-open），乱序安全。activeSharedAgents 失败既有降级 []，不新增处理。
2. 并发写：仅写本组件 React state（preProfileId）与实例 ref，无持久化、无跨组件共享写；重复触发幂等（preProfileId 同值短路）。
3. 切换/生命周期：预会话→真会话（sessionId 变化）effect 早退不再干预；门户切会话走 key 重挂载先例，touchedRef 随实例重建——预会话重挂载后重新评估默认选中（用户尚未发首句，重选无副作用）。
4. 作用域：两路数据均按当前登录用户过滤（后端 owner 口径），无跨工作区/跨用户串台；独立 queryKey 不与门户 `useDaemonMachines` 缓存互写。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把「机器数据加载中」误判为「无机器」而错误默认选中——以 `data != null` 守卫消除（loading/error 均 undefined → 门控 false）。

试过放弃的方案：①复用 `machines` prop 判定——无 loading 语义有误判窗口，且依赖门户传参形态，放弃；②把引导提示塞进 SessionConfigBar 内部——该组件是会话内配置面（真会话/预会话共用），预会话引导属页面语义，改共享组件还会扩大既有测试面，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 门控查询 + 默认选中 effect + 手动守卫 + 引导提示条 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx | 追加「预会话共享智能体引导」describe：默认选中/手动守卫/提示文案/fail-open 分支 |
