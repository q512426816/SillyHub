# 符号影响面报告

> tasks.md 内容指纹（生成时）: 7dac03654a2f2b74——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——AgentSessionLogORM 仅新增 5 个 Mapped 列（类属性增量，不改任何方法/构造签名）；alembic 迁移为全新文件无既有调用点。
- task-02: 新增符号：AgentLogUsageIngestService.ingest_for_push(workspace_id, entries) -> int（全新类与方法，无既有调用点，消费方仅 router 新挂载点）；router.push_agent_logs 内部追加 fire_background_task 调用（端点函数签名与响应 DTO 不变）；只读复用 _resolve_agent_log_read_target（backend/app/modules/platform_sync/router.py:671-751，签名含 PlatformSyncAuthScope 参数——按 design Grill B-1 裁定自构造 scope 传入，不改其签名）。
- task-03: 无签名级变更——ChangeUsageQueryService 公开方法（get_change_usage/get_quicklog_usage/summarize_changes/summarize_quicklogs）签名与返回 DTO 字段集均不变，本地段为内部聚合逻辑增量；schema.py 仅注释更新。
- task-04: 无签名级变更——ChangeUsageCardProps 接口不变，新增组件内私有常量 LOCAL_CLI_MODEL 与渲染分支；测试文件追加用例。
