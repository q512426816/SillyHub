---
author: qinyi
created_at: 2026-08-29 21:26:40
---

# 符号影响面报告（Symbol Impact）— worker 会话中断重派继承

| task | 签名级变更 | 受影响调用点 | 范围内处置 |
|---|---|---|---|
| task-01 | 无签名级变更；SuspendBatchResult 数据类加 workers 字段（内部消费，router 响应 DTO 不动）；新常量 DAEMON_INTERRUPTED_ERROR_CODE | router.py:1667 仅读两键（suspended/runs_failed）天然兼容；test_session_suspend.py:363 断言锁响应体 | 新增/扩展测试 |
| task-02 | 无既有签名变更；新模块 worker_redispatch.py（redispatch_worker_session 函数）；**placement.py prepare_interactive_dispatch 加可选形参 resume_session_id**（缺省 None 向后兼容） | prepare_interactive_dispatch 调用方（mcp_tools/_dispatch_worker_core 等）不传新参零影响 | 新增测试 |
| task-03 | 无签名变更；build_claim_payload interactive 分支补一个白名单键透传 | claim payload dict 加可选键；daemon 旧版忽略（归一化缺省不传） | 扩展现有测试 |
| task-04 | **CreateSessionInput 加 resume?: string 可选字段**（types.ts:352）；daemon.ts create 调用传归一化值 | CreateSessionInput 消费方=SessionManager.create（spec.resume→driver 既有链 :1588-1629——session-manager 当前未透传 create input.resume 进 _buildDriverOptions :1429-1438，该透传归 task-05） | 新增测试 |
| task-05 | 无签名变更；SessionManager.create 内部把 input.resume 透传 _buildDriverOptions+损伤降级分支 | create 调用方不变（resume 缺省走原路径零影响）；RESUME_DAMAGE_PATTERNS 新常量 | 新增测试 |
| task-06 | 无签名级变更 | — | 测试文件 |

**汇总**：签名级变更三处（task-02 prepare_interactive_dispatch 可选形参、task-04 CreateSessionInput 可选字段、task-01 SuspendBatchResult 内部字段）——全部追加式可选零破坏；受影响调用点均在同变更内闭环或天然兼容。
