# 符号影响面报告

> tasks.md 内容指纹（生成时）: e14addf26cb8a20e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: events.ts `onResult` 内部逻辑改动（行为分支：注册表非空保留 currentRunId）——不改函数签名；background-tasks.ts `handleTaskNotificationEvent`/`clearBackgroundTasks` 内部加清锚点分支——不改签名。无签名级变更。
- task-02: session-manager.ts 新增**公共方法** `hasLiveBackgroundTasks(sessionId: string): boolean`（门面新增，非既有签名变更）。调用点=新增消费方 task-03/04/06（在 allowed_paths 内），grep 现有代码无既有调用点（新符号）。变更类型：新增公共方法；影响面=本变更内，范围内。
- task-03: permission.ts 新增导出 `hasBackgroundTaskGrace(mgr, state): boolean`（纯新增）；`writeChannelGuardDeny` 逻辑内加放行条件、deny message 改文案前缀——不改签名。无既有签名级变更；新符号仅本变更消费。
- task-04: permission.ts 新增 `backgroundTaskFlag(state, hasLive)`（纯新增）；`PermissionRegisterInput` 加**可选字段** `backgroundTask?: boolean`（向后兼容的 interface 字段新增，调用方不传行为不变）；resolver payload 组装加可选键。接口字段新增：既有 4 处 register 调用点全部在 task-04 allowed_paths 内补齐传参，无外部调用点（register 仅在 permission.ts 内部消费）。范围内。
- task-05: permission-resolver.ts `register` 内部 fallback timer 判定逻辑改动——不改签名。无签名级变更。
- task-06: daemon.ts run 结果上报内部加 USAGE_NOTE 日志行分支——不改签名。无签名级变更。
- task-07: protocol.py `PermissionRequestPayload` 加**可选字段** `background_task: bool | None = None`（pydantic 字段新增，序列化缺省兼容）。消费点=permission_service.handle_permission_request（task-08 allowed_paths 内）；该 payload 由 WS 反序列化消费，无其他构造点受影响。范围内。
- task-08: permission_service.py 新增私有方法 `_deny_respond(daemon_id, payload, reason)`（纯新增）；`handle_permission_request` 校验逻辑内部改动——不改签名。`send_permission_response`（ws_hub.py:377）为既有方法被调用、不改。无既有签名级变更。
- task-09: agent/service.py `_cleanup_stale_runs_impl` 内部补字段写入（error_code/error_detail 为既有列）——不改签名。无签名级变更。
- task-10: 新建测试文件 + 修订既有测试断言（不改被测代码签名）。无签名级变更。
- task-11: 新建/修订测试断言（不改被测代码签名）。无签名级变更。
