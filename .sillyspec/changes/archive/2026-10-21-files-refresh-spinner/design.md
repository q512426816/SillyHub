---
author: flow-machine-draft
created_at: 2026-10-21T03:18:30.955Z
---
# 设计记录（Design Record）— 2026-10-21-files-refresh-spinner

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：改动全部落在 `frontend/src/components/change-file-tree.tsx` 的 `ChangeFileTree`：新增私有 `syncing` 布尔态，`refreshTree(sync=true)` 进入时置 true、`finally` 置 false；「刷新」按钮加 `RefreshCw` 图标，syncing 时 `animate-spin` + `disabled`。选这个方案因为该组件已自持刷新链路的全部状态（`syncWarning` 回执、error 重试），loading 反馈就近放同一函数内零新增取数；且仓库已有同型成熟模式（`session-list-layout.tsx` 的 RefreshCw+animate-spin、`runtime-card.tsx` 的 actioning 转圈），不引入新依赖。用户原话即方案定调：「按钮改为转圈就行」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无对外签名/端点/格式变化。组件内部新增私有 state `syncing`；`refreshTree(sync?: boolean)` 签名不变；`ChangeFileTree` props 不变，所有消费方（变更详情页文件面板、会话悬浮弹窗、移动端）经同一组件自动获得该反馈。「刷新」按钮在显式同步进行中渲染为禁用+转圈，属用户可见行为变化，即本变更目的本身。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。显式同步与纯读轮询可并发在飞——转圈态仅由 `sync=true` 调用置位，纯读路径不碰该 flag；迟到的旧 sync 响应 `finally` 收敛自己启动的那一轮，乱序安全。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：`syncing` 是组件私有布尔 UI 态，无共享数据写。按钮禁用拦住重复点击；错误横幅重试与按钮共享同一 flag。两个显式刷新极端并发时（按钮点击后、横幅仍在时点重试）先返回者的 `finally` 会让转圈提前收敛——仅反馈时机提前，不影响数据正确性，接受。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。sync 响应晚于组件卸载返回时 `setState` 在 React 18 下无副作用（不再告警）；`refreshTree` 已有 try/catch 收敛错误面，finally 保证 flag 必复位。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。`syncing` 为组件实例私有 state，多工作区/多面板实例（详情页、会话悬浮、移动端各自挂载）互不串台；本变更不跨仓。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是双入口（按钮+错误重试）并发时转圈提前消失的反馈时机问题——影响仅视觉反馈、不涉数据，触发条件苛刻（错误态下双击两入口），接受不改计数器（复杂度不值）。放弃方案：① 给全局 `Button` 组件加通用 loading prop——影响全部消费面，远超本诉求；② 新增独立 POST 同步端点+按钮联动——已被 2026-10-13-change-files-refresh-sync D-007@v1 否决（GET 纯读语义 + 用户诉求是刷新动作本身带同步），不复潮。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/change-file-tree.tsx | 新增 syncing 态；刷新按钮加 RefreshCw 转圈+禁用 |
| 修改 | frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx | 增转圈行为两用例（FR-01/FR-02 测试绑定） |
