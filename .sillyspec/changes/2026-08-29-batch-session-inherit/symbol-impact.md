---
author: qinyi
created_at: 2026-08-29 21:30:51
---

# 符号影响面报告（Symbol Impact）— worker 会话中断重派继承

> 逐 task 签名级结论；无签名级变更也显式声明。

| task | 签名级变更 | 受影响调用点 | 范围内处置 |
|---|---|---|---|
| task-01 | SuspendBatchResult 数据类加 workers 字段（内部消费，router 响应 DTO 不动零破坏）；新常量 DAEMON_INTERRUPTED_ERROR_CODE | router.py:1667 仅读两键天然兼容；test_session_suspend.py:363 断言锁响应体 | 新增/扩展测试 |
| task-02 | **prepare_interactive_dispatch 加可选形参 resume_session_id**（缺省 None 向后兼容）；新模块 worker_redispatch.py 导出 redispatch_worker_session | 既有调用方不传新参零影响 | 新增测试 |
| task-03 | 无签名变更；build_claim_payload interactive 分支补白名单键 | claim payload dict 加可选键；daemon 旧版忽略 | 扩展现有测试 |
| task-04 | **CreateSessionInput 加 resume?: string 可选字段**（types.ts:352）；daemon.ts create 调用传归一化值 | SessionManager.create 消费（spec.resume→driver 既有链 :1588-1629——input.resume→_buildDriverOptions 透传归 task-05） | 新增测试 |
| task-05 | 无签名变更；create 内部透传+降级分支+RESUME_DAMAGE_PATTERNS 常量 | create 调用方不变（缺省零影响） | 新增测试 |
| task-06 | 无签名级变更 | — | 测试文件 |

**汇总**：签名级变更三处（task-01 SuspendBatchResult 字段/task-02 可选形参/task-04 可选字段）全部追加式零破坏，调用点同变更闭环或天然兼容。
