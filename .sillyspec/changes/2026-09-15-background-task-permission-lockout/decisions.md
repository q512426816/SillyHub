---
author: qinyi
created_at: '2026-09-15 16:00:00'
---

# 决策记录（Decisions）

## D-001@v1: 修复方案——锚点 + 协议标记（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 后台任务权限锁死修复的放行机制设计？（A 锚点+协议标记 / B 时间窗宽限 / C 后台续轮伪 run）
- answer: A。daemon `onResult` 在会话的后台任务注册表非空时保留 currentRunId 作后台锚点（任务全部终态注销时清）；写通道守卫 `writeChannelGuardDeny` 新增「status=active + currentRunId 在 + 注册表有存活任务」放行条件；权限请求协议加 `background_task` 标记，backend `handle_permission_request` 据此放宽 active-turn 校验为「按 run_id 直查 + 会话归属校验」
- normalized_requirement: 修复覆盖四项核实缺陷——①守卫感知后台任务注册表（放行）②后端受理放宽（标记协议）③校验失败丢弃时立即推 PERMISSION_RESPONSE deny（复用 ws_hub.send_permission_response，不再静默吞）④`_cleanup_stale_runs_impl` 补 error_code/error_detail；附带 daemon 用量上报在后台任务存活时加 [USAGE_NOTE] 标注日志行
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户对话实答「A」（2026-09-15 16:00，三方案对比后选定）；生产实证＝线上会话 6e213eb3（94.5min/1030 次重试/~$46 记账错位、02:18 问答卡静默丢失 permission_request_run_mismatch current_run_id=null）
- rationale: 任务注册表是「后台任务存活」的权威信号（task_notification 注销兜底），无需猜时间窗；与既有 stale-flip 宽限（withinStaleFlipGrace）同一设计哲学——不封锁可能仍活着的写通道
- 故障面: 注册表泄漏（task_notification 永不到达）会让锚点 currentRunId 永不清 → 守卫放行窗口变长；缓解＝锚点仅在 status=active 时有效，下一次 inject 正常切新 run，写策略/人审链路仍全程生效，放行的只是「通道存在性」而非权限本身
- 退役判据: SDK 未来提供 per-task 权限上下文（canUseTool 带 task 归属）时，锚点机制可退役为直连 task→run 权限路由
