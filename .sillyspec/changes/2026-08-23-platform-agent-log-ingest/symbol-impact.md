# 符号影响面报告

> tasks.md 内容指纹（生成时）: 46dca7cfb771d795——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号（无既有签名变更）：`AgentSessionLogORM`（model.py 新表 ORM，新类无调用点）+ conftest `ensure_platform_sync_table` fixture 内部 tables 清单追加（fixture 签名不变）。alembic 迁移为纯新增 revision（`down_revision="20260822090000"` 接链，不改既有 revision 符号）。均在任务范围内。
- task-02: 新增符号（无既有签名变更）：schema 五模型（`AgentLogEntry`/`AgentLogPushRequest`/`AgentLogPushOk`/`AgentLogListItem`/`AgentLogListResponse`）、service 两方法（`upsert_agent_log_entries`/`list_agent_logs`）、router 两端点函数。既有 `require_platform_sync`/`require_platform_sync_write`/`_read_args`/`PlatformSyncService.__init__` 签名零改动（纯消费）。受影响调用点：仅新文件 test_agent_log_push.py（本任务）。均在任务范围内。
- task-03: 生成物变更：api-types.ts/openapi.json 为 OpenAPI 生成物，AgentLog* schema 与两端点 paths 随生成器进入；无手写签名变更，生成+校验均在本任务范围。
- task-04: 新增符号 + 单点接线：`agent-logs.ts`（`listAgentLogs` 新函数）、`query-keys.ts` 增 `agentLogs` 键常量（追加导出，既有键零改动）、`agent-log-card.tsx`（新组件新接口 `AgentLogCardProps{workspaceId}`）。受影响调用点：session-panel.tsx `SessionPanelPage` 单点插入渲染（本任务改，TurnTimeline/TeamTaskBlock 零改动）。均在任务范围内。
- task-05: 无签名级变更（回归/端到端实证/runtime-evidence.md 留档，零代码签名改动）。
