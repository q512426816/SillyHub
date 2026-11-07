---
author: flow-machine-draft
created_at: 2026-11-07T13:34:32.067Z
---
# 设计记录（Design Record）— 2026-11-07-orphan-pending-dialog-cure

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

一个病（孤儿 pending 提问）三个入口，三修同源：

- **写侧补挂（FR-01）**：run 终态化 ⇒ 其挂起提问必然无人消费 ⇒ 作废。四个终态化挂点各加一行 `cancel_pending_dialogs_for_run(db, run_id)`（既有 helper，幂等、不自带 commit）：① close_interactive_run 主路径（daemon 上报 result 的唯一收口，覆盖 completed/failed/killed——挂点放 `_close_flip_session` 之后、`svc._session.commit()` 之前，随收口事务提交）；②③④ backend 主动 kill 三写点（lease_service._mark_agent_run_killed_if_pending / session_lifecycle._end_session_for_delete / control.py end_session 收口），各自在 kill 写入后、同事务 commit 前补挂。生产 11 条孤儿中 failed 8 条、completed 1 条走①、killed 4 条中存量走②③④，全覆盖。
- **读侧对齐（FR-02）**：session_crud.py 列表 pending_dialog_kind 注入的 subquery 加 `join(AgentRun).where(AgentRun.status.in_(ACTIVE_RUN_STATUSES))`，过滤在窗口函数取「每会话最新一条」之前生效——与详情读侧 list_pending_dialogs 的 ql-20260815-003 兜底完全同口径，列表问号与详情待答卡从此共享同一个「还算数」判定。
- **daemon 看门狗豁免（FR-03）**：PendingEntry 增 `dialogKind` 字段（register 时存入），PermissionResolver 增公开方法 `hasPendingDialogs()`（存在 dialogKind 非空且未 settle 的注册项）；fireTurnActivityWatchdog 在既有双守卫（status=running 且 currentRunId 未变）之后加豁免分支：命中则 console.warn 一条 + `refreshTurnActivityWatchdog` 续防（同窗口重新布防）+ return。选续防式而非 disarm：每个窗口到期自查「还有没有 dialog 在等」，dialog settle 后引擎若挂死（无后续活动续防），下一窗口照常判死——豁免不会变成永久盲区，且不动 dialog settle 路径的状态机（单点改动）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- backend 内部行为变化：close_interactive_run / cancel_lease（_mark_agent_run_killed_if_pending）/ end_session / _end_session_for_delete 四处收口新增副作用（挂起 pending 提问行置 cancelled）；对外 HTTP 契约零变化（响应体不变）。
- `GET /api/daemon/sessions` 响应字段 `pending_dialog_kind` 语义收窄：仅活跃 run 的 pending 行点亮（schema/类型不变，取值口径变化；前端零改动——问号语义由后端口径修复）。
- daemon `PermissionResolver` 新增公开方法 `hasPendingDialogs(): boolean`（daemon 内部 API，不进 wire 协议）；私有结构 `PendingEntry` 增字段 `dialogKind?: string`。wire 协议零变化。
- 依据文档：`backend/app/modules/daemon/model.py` SessionDialogRequest 生命周期注释（pending → answered/cancelled，本变更补齐 cancelled 写入方的缺口）；`sillyhub-daemon/src/interactive/permission-resolver.ts` dialog 不设兜底语义；`backend/app/modules/daemon/permission_service.py` cancel_pending_dialogs_for_run helper 与 list_pending_dialogs 读侧兜底。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：成立。迟到 result 二次上报走 already_terminal no-op 分支不经新挂点——首次终态化时已清理；用户先答题（行翻 answered）后 run 才收口的顺序下，cancel 的 UPDATE 限定 status='pending'，不覆盖 answered；daemon 先上报、答题迟到同理（行已 cancelled，respond 路径对非 pending 行幂等拒绝，既有语义）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：close_interactive_run 持 AgentRun FOR UPDATE 行锁后写终态，cancel 同事务串行；cancel_lease 与 daemon 迟到 close 并发时 killed 先 commit、close 走 no-op（清理由 kill 路径完成）；cancel UPDATE 与用户答题 UPDATE 各自 WHERE 限定现状，竞争下最终态二选一、无脏混合。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全。会话 fork/重开不触及旧 run 的 dialog 行（run_id 绑定）；daemon 重启后 resolver 重建、_pending 为空，hasPendingDialogs()=false，看门狗恢复常规语义——daemon 重启造成的孤儿 dialog 由 backend 侧 FR-01（启动清理/恢复路径既有挂点 + 本变更收口挂点）与 FR-02（读侧不点亮）双兜底。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不会。cancel 与注入均按 run_id/session_id 精确限定；hasPendingDialogs() 是 session 级 resolver 实例内部查询，无跨会话状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：豁免分支形成永久盲区（dialog settle 后引擎挂死无人再杀）——续防式设计已消除：每窗口到期复查，settle 后无活动即正常判死；测试绑定「dialog settle 后豁免解除照常判死」用例钉死该行为。
- 试过但放弃的方案 A（dialog 挂起时 disarm 看门狗、settle 时 re-arm）：需要在 dialog settle 的所有路径（answer/deny/abort/abortAll）挂钩 re-arm，两处状态机耦合、漏一处即永久盲区；续防式单点改动 + 自查，更稳。
- 试过但放弃的方案 B（daemon 上报 result 时顺带清理 dialog——daemon 主动声明）：daemon 与 backend 双写同一 DB 行，时序竞争复杂且 daemon 需直连业务库语义；清理归 backend 单一写方（与既有 cancel_pending_dialogs_for_run 调用方一致）。
- FR-02 口径变化对存量数据的影响：纯显示口径收窄，历史孤儿行（生产已止血作废 11 条）即使存在也不再点亮问号，无数据迁移需求。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | close_interactive_run 主流程收口事务内挂 cancel_pending_dialogs_for_run（FR-01 主路径） |
| 修改 | backend/app/modules/daemon/lease_service.py | _mark_agent_run_killed_if_pending kill 写入后同事务补挂（FR-01 kill 路径） |
| 修改 | backend/app/modules/daemon/session/service/session_lifecycle.py | _end_session_for_delete 批量 kill 后同事务补挂（FR-01 kill 路径） |
| 修改 | backend/app/modules/daemon/session/service/control.py | end_session 收口 run killed 后同事务补挂（FR-01 kill 路径） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 列表 pending_dialog_kind 注入 subquery 加 run 活性 join（FR-02） |
| 新增 | backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py | FR-01 回归测试（上报失败/完成/主动 kill/不覆盖 answered/无 dialog 零副作用五场景） |
| 修改 | backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py | FR-02 回归用例（孤儿不注入/死活并存取活跃最新） |
| 修改 | sillyhub-daemon/src/interactive/permission-resolver.ts | PendingEntry.dialogKind + hasPendingDialogs()（FR-03 地基） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | fireTurnActivityWatchdog 挂起 dialog 豁免续防分支（FR-03） |
| 修改 | sillyhub-daemon/tests/interactive/turn-activity-watchdog.test.ts | FR-03 回归用例（豁免续防/settle 后恢复判死） |
