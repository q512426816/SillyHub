---
author: qinyi
created_at: 2026-07-09 11:30:00
change: 2026-07-09-ask-user-question-approval
---

# 需求规格（Requirements）

## 功能需求（FR）

### FR-1 AskUserQuestion 审批中心可见
scan/stage 自动执行 + 普通交互式对话两类会话触发 AskUserQuestion 时，`/approvals` 审批中心 SessionPermissionPanel 均显示卡片。

### FR-2 结构化问答渲染
卡片按 `dialog_kind` 渲染：有 `dialog_kind`（AskUserQuestion）→ `AskUserDialogCard`（header/question/options/description/手动输入，提交 `dialog_result.answers`）；无 → `PermissionApprovalCard`（allow/deny）。复用既有组件零改动。

### FR-3 覆盖两类会话
聚合范围从 scan 扩到 workspace 下所有 active interactive session（scan + chat）。

### FR-4 来源上下文 + 跳转（D-002）
每张卡含来源上下文条：工作区名 · 场景（scan/对话/stage）· 会话 ID（链接跳转 `/runtimes?session=<id>`）· 运行 ID（链接）· 时间 · 上下文一句话（run_summary，空则占位「会话进行中」）。卡片头加「查看会话」跳转。

### FR-5 实时 + 刷新不丢
SSE 实时推增量（新 AskUserQuestion <2s 弹）+ `GET /workspaces/{id}/dialogs` 数据库兜底（初始加载 + 约 10s 刷新，dialog 永久等待刷新后仍可见）。SSE 与查询按 `request_id` 幂等合并；SSE 路来源字段缺省时前端补 workspace_name（已知 workspaceId）+ session_type/run_summary 占位「加载中」，查询回填。

### FR-6 后端只读查询端点
`GET /api/workspaces/{id}/dialogs`（挂 agent router，workspace 成员权限 `require_permission(TASK_READ)`），三表 JOIN（`SessionDialogRequest → AgentRun → AgentRunWorkspace`）聚合 pending，返回 `WorkspaceDialogRead`（含来源字段 workspace_name/session_type/run_summary）。
- **session_type**（D-003）：`stage`（AgentRun.change_id 非空）/ `scan`（config.mode==scan 且 change_id 空）/ `chat`（config.mode!=scan）
- **run_summary**（D-003）：scan/stage 取 `lease.metadata.prompt`，对话取首条 user `AgentRunLog.content`；空→null（前端占位「会话进行中」）

## 非功能需求（NFR）
- **NFR-1 性能**：workspace 级查询 pending 量小（dialog 罕见），三表 JOIN + run_summary 取 log 首条（`LIMIT 1 ORDER BY created_at`）；`list_workspace_active_sessions` 加 limit（top 50）+ 前端 SSE 连接数硬上限
- **NFR-2 兼容**：纯增量，无 schema 迁移、无 daemon 改动、无数据迁移；回退=前端 filter 改回 scan + 移除端点
- **NFR-3 测试**：backend 端点（权限/JOIN/跨 session/上下文）+ frontend（渲染分流/聚合去重/上下文条/跳转）全绿；既有行为零回归
- **NFR-4 中文 UI**（CLAUDE.md 规则 11），占位文案中文

## 约束
- 遵循 D-001（不修 PERMISSION_REQUEST 链路）/ D-002（来源上下文+跳转）/ D-003（run_summary/session_type 规则）
- 复用 `AskUserDialogCard`/`PermissionApprovalCard`（零改动）/ `SessionDialogRequest` 模型 / `list_workspace_active_sessions` JOIN 模式
- TDD（CLAUDE.md 执行顺序：文档→读代码→写测试→写实现→跑测试→验收→更新文档）
- 三端 Windows/Linux/macOS 兼容
