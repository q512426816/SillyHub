# 符号影响面报告

> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更（SQLModel 列新增向后兼容，无既有构造调用点需改）
- task-02: 函数签名变更：derive_status 加 keyword-only 参数（converged/has_session/session_active_turn，默认 False）——既有调用点 router.py:870、finalizer.py:578、orchestrator.py:614 不传新参行为不变（默认值兼容），无需修改、不在本卡 allowed_paths 属有意设计；新增 get_active_mission_for_session 无既有调用点
- task-03: 新增 DTO（TeamMissionTriggerRequest/TeamMissionSummary）与两端点、orchestrator.team_mission_entry 加可选预建参数（默认旧行为）——均无既有调用点需改；新消费方为 task-11/12（范围内卡片）
- task-04: 无签名级变更（_inject_into_session 内部逻辑增强，方法签名不动）
- task-05: DTO 参数值域变更：dispatch_worker 等 5 个 MCP 端点的 mission_id/workspace_id/run_id 转可选（兼容：旧调用方仍可显式传参）——消费方 daemon mcp-server.ts 在 task-10 allowed_paths 内
- task-06: DTO 值域变更：ConvergeResponse.status 取值收敛为 converged/busy/conflict/needs_manual（merged 并入 converged、failed_manual 并入 needs_manual）——消费方 daemon mcp-server.ts 工具描述（task-10 范围内）；_get_main_run/finalizer 锚点为内部实现无外部调用点
- task-07: 无签名级变更（control.py 查询条件内部收窄，对外属性/方法签名不动）
- task-08: 无签名级变更（patrol/orchestrator 内部逻辑 + core/config.py 新增 settings 字段向后兼容）
- task-09: 无对外签名级变更：cli.ts isMainAgentSession 谓词回调签名不变（判定逻辑变化）；execution.py dispatch stage 取值常量化为内部调用（role 移入 lease metadata，metadata 为 JSON 列无 schema）
- task-10: 函数签名变更：mcp-config buildDaemonMcpServerConfig 增加 env 参数——唯一调用点 cli.ts mainAgentMcpConfigProvider（cli.ts 在 task-09 allowed_paths 内，本变更跨卡但文件覆盖 ✓）；mcp-server 工具 schema 参数可选化的消费方为 agent 运行时（非代码调用点）；hub-client 已支持 extraHeaders 无签名变更
- task-11: 新增组件/无既有调用点；session-panel 内部挂载改造（组件签名自洽）
- task-12: 新增组件与 API client 函数（triggerSessionTeamMission/listSessionTeamMissions）——消费方 task-11（范围内）；turn-segment-views 渲染分支扩展不改既有签名
- task-13: 删除性变更：backend create+list 四端点与 frontend createMission/listMissions/createProjectMission/listProjectMissions client 删除——调用点已全量定位（mission-console/两页面/interactive-session-panel 等）均在 task-13 与 task-11 allowed_paths 内（interactive-session-panel.test.tsx 归 task-11）
- task-14: 再生成产物（api-types/openapi.json）+文档——类型契约变更源已在 task-03/05/06 落地，本卡仅同步
