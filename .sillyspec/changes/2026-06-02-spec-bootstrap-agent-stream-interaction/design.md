---
author: qinyi
created_at: 2026-06-02T09:49:00
---

# Design

## 架构决策

### 决策 1: `/spec-bootstrap` 异步返回 AgentRun

`POST /workspaces/{workspace_id}/spec-bootstrap` 只负责创建 run、写审计开始事件、启动后台任务并立即返回。这样前端能第一时间拿到 `agent_run_id` 并连接已有 Agent SSE stream，避免同步等待造成页面空白。

### 决策 2: 恢复 AgentSpecBundle + ClaudeCodeAdapter 边界

bootstrap 是平台托管 spec root 的初始化任务，仍应沿用 validated path：

```
platform-managed spec root -> AgentSpecBundle -> ClaudeCodeAdapter -> AgentRunLog/SSE -> SpecValidator
```

`SpecBootstrapService` 不直接执行 CLI，而是构造 bootstrap 专用 `AgentSpecBundle`：

- `task_key="spec-bootstrap"`
- `task_title="Bootstrap spec workspace"`
- `proposal` / `task_markdown` 包含 init、scan、验证步骤
- `allowed_paths=[spec_root, code_root]`
- `available_tools=["sillyspec"]`
- `platform_metadata={"bootstrap": True, "workspace_id": ...}`

### 决策 3: 验证由后端收尾负责

Agent prompt 要求自查，但最终状态必须由后端 `SpecValidator.validate(spec_root)` 决定。这样可以避免 Claude CLI exit code 或自然语言输出和平台状态不一致。

### 决策 4: 最小交互先落在 AgentRunLog/SSE

本轮不实现完整进程级暂停恢复。用户确认/指导作为 bootstrap run 的结构化日志事件记录，并通过 SSE 推送到 Workspace 详情页和 Agent 控制台。后续可以把同一接口升级为真正的 resumable interactive session。

## 文件变更清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `backend/app/modules/spec_workspace/bootstrap.py` | 修改 | 从直接 CLI 改为异步 AgentRun + ClaudeCodeAdapter 后台执行 + 验证收尾 |
| `backend/app/modules/spec_workspace/router.py` | 修改 | `/spec-bootstrap` 响应语义改为立即返回 run 信息 |
| `backend/app/modules/spec_workspace/tests/test_bootstrap.py` | 修改 | 覆盖异步创建、adapter 调用、验证收尾、失败冲突 |
| `backend/app/modules/agent/router.py` | 修改 | 增加 bootstrap/user-input 指导接口或复用 agent run 输入接口 |
| `backend/app/modules/agent/service.py` | 修改 | 支持向 AgentRunLog 写入用户指导事件并通过 Redis/SSE 推送 |
| `frontend/src/lib/spec-workspaces.ts` | 修改 | BootstrapResult 改为 run/stream 返回 |
| `frontend/src/lib/agent.ts` | 修改 | 增加用户指导提交 API 类型 |
| `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 修改 | Bootstrap 后内联连接 SSE、展示日志、用户输入入口 |
| `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | 修改 | Agent 控制台展示 bootstrap run 的待确认输入入口 |
| `.sillyspec/docs/backend/modules/spec_workspace.md` | 修改 | 记录 bootstrap Agent 执行链路 |
| `.sillyspec/docs/backend/modules/agent.md` | 修改 | 记录 bootstrap 用户指导事件和 SSE 行为 |
| `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` | 修改 | 记录 bootstrap stream/API 交互 |
| `.sillyspec/docs/frontend/scan/PROJECT.md` | 修改 | 更新 Workspace 初始化流程 |

## 数据模型

本轮不新增表，复用现有模型：

- `AgentRun`：记录 bootstrap run 生命周期，`agent_type="claude_code"`，`status` 为 `pending/running/completed/failed/killed`。
- `AgentRunLog`：记录 stdout/stderr/tool_call/user_input/pending_input 等通道内容。
- `AgentRunWorkspace`：关联 run 和 workspace。
- `SpecWorkspace`：记录 `spec_root`、`sync_status`、`last_synced_at`。
- `SpecConflict`：记录 bootstrap 命令或验证失败。
- `AuditLog`：记录 `spec_bootstrap.start` / `spec_bootstrap.complete`。

新增约定通道（不改 schema enum，当前 channel 为字符串）：

- `pending_input`：Agent 需要用户确认或指导。
- `user_input`：用户提交的指导文本。

## API 设计

### POST `/api/workspaces/{workspace_id}/spec-bootstrap`

响应：

```json
{
  "agent_run_id": "uuid",
  "stream_url": "/api/workspaces/{workspace_id}/agent/runs/{run_id}/stream",
  "status": "pending",
  "spec_root": "C:/...",
  "message": "Bootstrap agent run started."
}
```

### POST `/api/workspaces/{workspace_id}/agent/runs/{run_id}/input`

请求：

```json
{
  "content": "Use sensible defaults and continue scan."
}
```

响应：

```json
{
  "run_id": "uuid",
  "accepted": true
}
```

该接口必须校验 run 属于 workspace，且用户具备 `WORKSPACE_WRITE`。

## 后台执行流程

```
SpecBootstrapService.bootstrap()
  -> load SpecWorkspace + Workspace
  -> mkdir spec_root
  -> create AuditLog(start)
  -> create AgentRun(status=pending, agent_type=claude_code)
  -> create AgentRunWorkspace
  -> asyncio.create_task(_execute_bootstrap_agent_run(...))
  -> return agent_run_id + stream_url

_execute_bootstrap_agent_run()
  -> status=running
  -> build AgentSpecBundle
  -> ClaudeCodeAdapter.run_with_bundle(..., on_log=callback)
  -> write stderr if any
  -> SpecValidator.validate(spec_root)
  -> update run status + output + exit_code
  -> update SpecWorkspace sync_status
  -> create SpecConflict for validation/command failures
  -> AuditLog(complete)
```

## 前端交互

Workspace 详情页：

1. 点击 Bootstrap。
2. 调 `/spec-bootstrap`。
3. 保存 `activeBootstrapRunId`。
4. 立即调用 `streamAgentRunLogs(workspaceId, runId)`。
5. 展示日志、tool_call、pending_input。
6. 用户输入指导后 POST `/agent/runs/{run_id}/input`。

Agent 控制台：

- 继续展示所有 run。
- 对 `pending_input` 或 tool_call pending 状态显示输入面板。
- 输入提交走同一个 `/input` 接口。

## 兼容策略

- 保留现有 `/agent/runs/{id}/stream` 语义。
- 保留 AgentRunLog 历史回放和 Redis Pub/Sub 实时流。
- 旧前端若只关心 `agent_run_id` 和 `status`，仍能工作；不再依赖 `stdout/stderr` 同步返回。
- 失败时通过 `AgentRun.status=failed` 和 stderr 日志暴露，不抛掉后台异常。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Claude CLI 中途需要真实交互 | 本轮只支持用户指导事件，不能暂停进程 stdin | prompt 中禁止卡住等待，要求记录问题后继续或失败；后续升级 resumable session |
| 后台任务异常未写状态 | run 卡在 running | 外层 try/except/finally 保证 failed 和 stderr 日志 |
| SSE 连接晚于日志产生 | 页面缺日志 | 依赖已修复的 DB replay + Redis follow |
| 直接 `git add .sillyspec/` 混入无关文件 | 暂存污染 | 本变更只暂存 `.sillyspec/changes/default/*` |

## 自审

- 是否恢复 ClaudeCodeAdapter：是。
- 是否恢复 scan：是，prompt 明确 `sillyspec run scan --dir <spec_root>`。
- 是否保证消息流：是，接口立即返回 run id，前端用 Agent SSE。
- 是否支持用户交互入口：是，Workspace 详情页 + Agent 控制台双入口。
- 是否避免过度设计：是，本轮不新增表，不做完整暂停/恢复协议。
