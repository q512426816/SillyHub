# 符号影响面报告

> tasks.md 内容指纹（生成时）: e81fa890d050fe8e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名变更：`recordAgentLogInvocation` 增可选参 `context`（{hubSessionId, changeKey, quickId}，缺省安全）；payload/留底 entry 增可选字段（纯增量，旧消费端 ignore）。受影响调用点：run/command.js 唯一调用处（同任务内改，块后移）。均在任务范围内。
- task-02: 签名变更：`buildSpawnEnv` 增可选入参 `agentSessionId`（缺省不注入）。受影响调用点：daemon.ts create 路径 + session-manager.ts restore/_reloadSession 两处（均同任务内改）。既有 env 合并语义零变化（新键独立层注入）。均在任务范围内。
- task-03: 新增符号 + 加列（无既有签名变更）：AgentSession 增 origin/aggregation_key/title 列（ORM 可选字段，既有构造零破坏）；AgentSessionLogORM 增 agent_session_id 可空列；迁移纯新增 revision（接当前单头）。conftest fixture 无签名变化。均在任务范围内。
- task-04: 签名变更：`upsert_agent_log_entries` 增可选参 user_id/hub_session_id（缺省安全）；`list_agent_logs` 增 filter_session_id（默认 None）。新增 schema 字段全可选。受影响调用点：router 两端点（同任务内改）+ test_agent_log_push.py（同任务）。均在任务范围内。
- task-05: 签名变更：无既有方法签名改动——`_inject_into_session` 前置插分支（内部逻辑）；新增私有方法 `_activate_tool_report_session` 与新端点函数；AgentSessionRead 增可选 origin 字段（DTO 纯增量，前端 gen:types 消费在 task-06/07）。均在任务范围内。
- task-06: 生成物变更：api-types.ts/openapi.json 随 task-04/05 schema 生成；无手写签名。
- task-07: 接口变更：`listAgentLogs` 入参 workspaceId→sessionId（唯一调用方 agent-log-card 同任务改）；`queryKeys.agentLogs` 键入参同步（调用方同任务）；AgentLogCard props {workspaceId}→{sessionId}（唯一挂载点 session-panel 同任务改）；新增 AgentLogSessionBody（新组件无既有调用点）。均在任务范围内。
- task-08: 无签名级变更（回归/部署/实证/runtime-evidence 留档，零代码签名改动）。
