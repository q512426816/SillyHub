---
author: qinyi
created_at: 2026-09-15 23:45:36
generated_by: sillyspec-fourpiece-init
change: 2026-09-16-background-task-grace-timeout
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->

## D-001@v1: 维持 R-01 接受不修代码，文档登记观察项（方案 A）
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 2026-09-16 24h 风险审查发现 hasBackgroundTaskGrace 无时间上限（注册表条目仅终态通知/会话终态两路注销，泄漏条目使写通道放行直至会话终态）——是否给宽限加时间封顶？（A 双窗兜底 / B 仅绝对上限 / C 仅静默失活 / D 不改代码维持 R-01）
- answer: D（不改代码），文档载体方案 A。维持 2026-09-15-background-task-permission-lockout R-01 已接受的 P1 风险；本变更收窄为 known-issues.md 观察条目（四要素：暴露差/缓解链/重估触发/未来修复首选）+ 本变更 design.md 否定决策存档
- normalized_requirement: 不修改 sillyhub-daemon 任何源码与模块文档；仅在 .sillyspec/knowledge/known-issues.md 后台任务权限相关节新增一条观察项
- impacts: []（无 FR 落码——文档动作无功能需求项）
- evidence: 用户对话实答「不改代码」（2026-09-16，四选一 AskUserQuestion）+「方案A（推荐）」（文档载体三选一亲选）
- rationale: ①缓解链仍全程有效：仅放行「通道存在性」（allowed_roots/policyEngine 写策略+人审生效）、下次 inject 切新 run 即收敛、会话终态 clearBackgroundTasks 兜底、daemon 重启内存注册表丢失自然 fail-closed；②任何封顶方案都有误杀真后台任务的回归风险——原事故任务存活 94.5min，静默阈值过小直接重演权限锁死（1030 次重试/~$46 事故）；③暴露差存档备查：stale-flip 宽限有界 60min（STALE_RUN_WRITE_GRACE_MS=60*60_000，permission.ts withinStaleFlipGrace 消费）vs bg-task 宽限无界——超出先例的部分是本观察项的监控标的
- 故障面: 若未来线上实证注册表泄漏（守卫放行但无对应存活任务），无界宽限暴露面超出设计先例——观察项记录的重估触发条件命中时按「未来修复首选：双窗兜底（条目存活=静默<60min 对齐先例 且 总时长<4h 绝对上限）」重开变更
- 退役判据: SDK 提供 per-task 权限上下文（canUseTool 带 task 归属）或 task_notification 可靠送达保证时，本观察项与 R-01 一并退役
