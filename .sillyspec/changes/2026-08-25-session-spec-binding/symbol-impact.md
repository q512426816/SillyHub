---
author: qinyi
created_at: 2026-08-25 23:12:40
change: 2026-08-25-session-spec-binding
---
# 符号影响面报告（Symbol Impact）— 会话与变更/快速修复多对多绑定

> execute「加载上下文」步产物（硬门）；plan.md 每个 task 一行结论。签名级变更 = 构造函数参数/接口/DTO/方法签名增删改。

| task | 签名级变更 | 受影响调用点 | 是否在任务范围内 |
|---|---|---|---|
| task-01 | 新增 ORM 类 `QuicklogSessionLink`（全新符号，无既有签名修改）+ 新迁移 revision | 消费方 task-02/06/07/08（import 该模型/表） | 是（新符号即本任务产物；下游消费在各消费任务卡内） |
| task-02 | 新增模块 `change/binding.py` 四个导出符号（`iter_command_segments` / `extract_spec_bindings` / `bind_session_to_change` / `bind_session_to_quicklog`）；`agent/tool_kind.py` 重构 `_is_sillyspec_command` 内部分段逻辑为公共函数（对外 bool 语义与既有导出签名不变，属行为保持重构） | task-05（run_sync 消费 extract/bind）、task-06（platform_sync 消费 bind）、task-08（session/service 消费 bind）、task-02 自含 tool_kind 既有测试锁行为 | 是 |
| task-03 | `list_change_sessions` 端点函数签名与响应 schema 不变（内部查询改 links）；新增模块内私有 helper（会话标题 window-function 提取）供 task-07 复用 | 端点消费方 ChangeSessionsCard/lib/daemon.ts listChangeSessions 零改动；helper 消费方 task-07 | 是 |
| task-04 | `GET /api/daemon/sessions` 查询参数新增 `ql_id`（API 签名可选扩展，向后兼容）；service `list_sessions` 内部 filters 列表扩展（router 调用点同任务内同步） | router.py 调用点（同任务）；前端消费归 task-09 | 是 |
| task-05 | `submit_messages` 对外签名不变（循环内新增 sillyspec 检测接线，内部调用 task-02 符号） | 无外部调用点变化；task-02 符号消费在本任务内 | 是 |
| task-06 | `upsert_agent_log_entries` 对外签名不变（hub/聚合两分支内部补绑定调用） | 无外部调用点变化 | 是 |
| task-07 | 新增端点 `GET /workspaces/{wid}/quicklog-entries/{ql_id}/sessions`（API 面新增，响应复用 `AgentSessionListItem` 不改） | 前端消费归 task-09/12 | 是 |
| task-08 | DTO `SessionCreateRequest` 新增可选字段 `quicklog_id`（向后兼容）；`create_session` service 内部扩展（change_id 双写 link + quicklog_id 落绑定） | router.py 请求解析（同任务）；前端消费归 task-09/11 | 是 |
| task-09 | `listAgentSessions` options 新增 `ql_id`、`createSession` input 新增 `quicklog_id`（可选参数向后兼容）；新增导出 `listQuicklogSessions` | 消费方 task-10/11/12（同 Wave 卡内已声明契约） | 是 |
| task-10 | 类型 `SessionListScope` 判别联合新增 `QuicklogScope`（类型级新增，既有三态分支语义不变）；新增路由页组件（全新符号） | 六处 scope 消费分支（同任务逐一补齐，X-008）；task-11 的 SessionPreContext.quickId 类型耦合已在两卡 constraints 声明 | 是 |
| task-11 | 类型 `SessionPreContext` / `FloatingPreContext` 新增可选 `quickId`（向后兼容）；`handlePreSessionSend` 请求体新增字段（组件内部） | floating-session-host.tsx 展开透传（无需改，已核实）；task-10 门户 preContext 合成（耦合已声明） | 是 |
| task-12 | 新增组件 `QuicklogSessionsCard`（全新符号）；`QuicklogDrawerProps` 不变（抽屉内部挂载） | 无既有调用点变化 | 是 |
| task-13 | 无签名级变更（纯回归验证 + 走查） | — | — |
