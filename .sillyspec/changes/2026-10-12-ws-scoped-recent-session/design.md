---
author: flow-machine-draft
created_at: 2026-10-12T07:27:53.013Z
---
# 设计记录（Design Record）— 2026-10-12-ws-scoped-recent-session

## 做法概述

`sessions-portal.tsx` 的空门户快捷动作「继续最近会话」派生 `recentSession` 时消费的是 `useDaemonMachines` 旁路的全局最近 100 条未归档会话，未按页面 scope 过滤——A 工作区会话页会显示并继续 B 工作区的最近会话（点击后 `selectedWorkspaceId` 快照与 📁 文件树跟随串档）。

修复取纯前端过滤方案（探索阶段方案 B）：在 `recentSession` 的 useMemo 内，scope 携带 workspaceId 的三种入口（workspace/change/quicklog——三者左侧列表同为工作区树，语义一致）先按 `s.workspace_id === scope.workspaceId` 过滤再排序取最近；无 scope 的全局门户不过滤，行为不变。选择过滤而非砍入口：数据已带 `workspace_id`（门户选中快照本就在消费），一行过滤零新请求，保留快捷续聊功能。放弃「工作区入口直接隐藏按钮」方案：丢功能且治标不治本；放弃「后端按工作区查询最近会话」方案：旁路数据已在手，新端点属过度设计。

runtime scope（悬浮窗锁定机器场景）不经空门户该入口（唯一消费方 floating-session-host 恒 runtime 锁定态），本变更不为其加过滤分支，保持判别联合中最小改动。

## 接口契约

对外可见签名与行为变化：无。`SessionsPortal` props、`resolveDefaultMachineId` 导出签名、URL ?session= 协议均不变；变化仅限组件内部 `recentSession` 派生逻辑（scope 入口下按钮候选集收窄为本工作区会话）。后端零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：成立。sessions 来自 react-query 缓存（15s 轮询 + SSE invalidate 去抖刷新），`recentSession` 在 useMemo 中对快照数组同步过滤+排序，无跨帧时序假设；`last_active_at` 并列时排序结果与现状一致（同 key 稳定序）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：不适用：纯前端派生计算，无共享可变状态、无服务端写。过滤在 useMemo 内完成，react-query 缓存本身由其单写者模型保证一致性。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全。scope 是 prop，切换入口时 useMemo 依赖 [sessions, scope] 重算，旧工作区最近会话不残留；按钮点击后的选中/快照/URL 写入链路（setSelectedWorkspaceId / syncSessionParam）不变，且快照源与过滤源同为 scope.workspaceId，天然同源不串档。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：本变更正是修作用域串台：scope 入口按 workspace_id 过滤后按钮恒为本工作区会话；全局门户不过滤是设计意图（全局视角）。已知可接受降级：本工作区会话未进全局前 100 条时按钮静默不渲染（少显示而非错显示，FR-03 契约）。`resolveDefaultMachineId` 故意保持全局 sessions（用户机器偏好语义，FR-04）。

## 风险与死路

最大风险：过滤依赖 `AgentSessionRead.workspace_id` 字段可靠性——后端该字段自 2026-08-22 起即为列表稳定字段（深链选中快照同源消费，sessions-portal.tsx:1072），风险低；测试以跨工作区固件直接锁定。次要风险：三入口共分支若未来新增 scope 种类（如 runtime 空门户化）需显式决策过滤维度，本变更注释已留判别说明。

试过但放弃的方案：① 工作区入口直接取消「继续最近会话」——丢功能，本工作区有历史会话时快捷续聊路径消失；② 后端新增按工作区查最近会话端点——旁路数据已在手，属过度设计；③ 顺带把 resolveDefaultMachineId 也按 scope 过滤——机器是用户偏好非工作区内容，在 A 工作区默认选用户最近用过的机器是合理语义，改动反成回归。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | recentSession useMemo：scope 携带 workspaceId 的三入口先按 workspace_id 过滤再排序；无 scope 不过滤 |
| 修改 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 新增两用例：三 scope 入口跨工作区取本工作区最近（点击直达选中）；本工作区无会话不渲染按钮 |
