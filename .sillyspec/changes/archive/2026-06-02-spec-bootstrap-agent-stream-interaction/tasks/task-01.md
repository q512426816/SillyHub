---
id: task-01
title: 重构 spec bootstrap 为异步 AgentRun 启动
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-02, task-03, task-04, task-06]
allowed_paths:
  - backend/app/modules/spec_workspace/bootstrap.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/schema.py
  - backend/app/modules/spec_workspace/tests/test_bootstrap.py
author: qinyi
created_at: 2026-06-02
---

# task-01: 重构 spec bootstrap 为异步 AgentRun 启动

## 修改文件

- `backend/app/modules/spec_workspace/bootstrap.py` — 将 `SpecBootstrapService.bootstrap()` 从同步 CLI 执行改为创建 `AgentRun`、写 start audit、建立 `AgentRunWorkspace` 关联并立即返回 run/stream 契约。
- `backend/app/modules/spec_workspace/router.py` — 更新 `/spec-bootstrap` 的 docstring 和 `response_model`，暴露异步启动语义。
- `backend/app/modules/spec_workspace/schema.py` — 新增 bootstrap 启动响应 DTO，避免 router 继续使用裸 `dict`。
- `backend/app/modules/spec_workspace/tests/test_bootstrap.py` — 替换同步 CLI/验证断言，覆盖立即返回、run 创建、workspace 关联、start audit 和不再调用直接 CLI。

## 实现要求

1. `SpecBootstrapService.bootstrap(workspace_id, user_id)` 必须只完成启动阶段：加载 `SpecWorkspace` + `Workspace`、创建 `spec_root` 目录、写 `spec_bootstrap.start` 审计、创建 `AgentRun`、创建 `AgentRunWorkspace`、返回启动响应。
2. `AgentRun` 字段约定：
   - `agent_type="claude_code"`
   - `status="pending"`
   - `task_id=None`
   - `lease_id=None`
   - `spec_strategy=spec_ws.strategy`
   - `profile_version=spec_ws.profile_version`
   - 不写 `started_at`、`finished_at`、`exit_code`、`output_redacted`
3. 返回前必须先提交并刷新 `AgentRun`，确保前端拿到 `agent_run_id` 后可以立即调用现有 `/agent/runs/{run_id}/stream`。
4. 响应中必须包含 `agent_run_id`、`stream_url`、`status`、`spec_root`、`message`；不得再包含 `stdout`、`stderr`、`command`、`agent_exit_code`、`validation_passed`、`errors`、`warnings`、`sync_status`。
5. `/spec-bootstrap` 仍然要求 `WORKSPACE_WRITE` 权限，router 不新增额外权限逻辑。
6. 本任务必须移除 `bootstrap()` 内对 `_run_sillyspec_init()`、`asyncio.create_subprocess_exec()`、`SpecValidator.validate()` 和 `SpecConflict` 创建的同步调用路径。
7. 可以保留或新增后台执行的私有调度入口名称，但本任务不实现 ClaudeCodeAdapter 执行体；执行体、`AgentSpecBundle` 构造、验证收尾和完成审计属于 task-02。
8. 若新增调度入口，测试必须 monkeypatch 掉真实 background task，避免单测产生未等待的协程或污染事件循环。
9. 不新增数据库表、字段、Alembic migration；复用现有 `AgentRun`、`AgentRunWorkspace`、`AuditLog`。
10. 保持缺失 workspace/spec workspace 的异常行为：仍抛 `SpecWorkspaceNotFound`，不要吞掉或改成空响应。

## 接口定义

### Backend DTO

在 `backend/app/modules/spec_workspace/schema.py` 新增：

```python
class SpecBootstrapRunStartResponse(BaseModel):
    agent_run_id: uuid.UUID
    stream_url: str
    status: Literal["pending"]
    spec_root: str
    message: str
```

### Service 返回

```python
async def bootstrap(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    ...
    return {
        "agent_run_id": run.id,
        "stream_url": f"/api/workspaces/{workspace_id}/agent/runs/{run.id}/stream",
        "status": "pending",
        "spec_root": str(spec_root),
        "message": "Bootstrap agent run started.",
    }
```

如果实现时选择让 DTO 接收 `uuid.UUID`，router 由 Pydantic 负责 JSON 序列化；测试断言 HTTP 响应时按字符串比较。

### HTTP 响应示例

```json
{
  "agent_run_id": "1a9f4c51-8f7e-4f25-83fe-c7d3a81b4ce4",
  "stream_url": "/api/workspaces/3ad3a34f-b403-4d22-946a-4d4c4c4f96c8/agent/runs/1a9f4c51-8f7e-4f25-83fe-c7d3a81b4ce4/stream",
  "status": "pending",
  "spec_root": "C:/path/to/platform/spec/root",
  "message": "Bootstrap agent run started."
}
```

## 边界处理

1. **SpecWorkspace 缺失**：沿用 `_get_spec_workspace()` 的 `SpecWorkspaceNotFound`，不创建目录、不创建 run、不写 audit。
2. **Workspace 缺失**：`session.get(Workspace, workspace_id)` 返回空时继续抛 `SpecWorkspaceNotFound`，避免产生孤立 `AgentRun`。
3. **目录创建失败**：`spec_root.mkdir(parents=True, exist_ok=True)` 抛出的权限或路径异常不吞掉；此时不应创建 run。
4. **提交顺序**：先写 start audit，再创建 run 和 workspace 关联；只有 run 与关联都 commit 成功后才返回 `agent_run_id`。
5. **SSE 晚连接**：本任务只保证 run 已持久化且 `stream_url` 指向既有 Agent SSE endpoint；历史回放/实时追踪仍由 `AgentService.stream_run_logs()` 负责。
6. **重复点击 bootstrap**：本任务不新增幂等键，也不阻止同一 workspace 多次创建 bootstrap run；若需要并发去重，应另起任务设计。
7. **旧同步字段兼容**：后端响应不再提供 stdout/stderr/validation 字段；依赖这些字段的前端修复属于 task-06/task-07。
8. **后台失败处理**：本任务不负责 failed/completed 终态、stderr 日志、`SpecConflict` 或 `spec_bootstrap.complete`；这些必须由 task-02 接手。
9. **AgentRun 模型约束**：`agent_type` 长度受 `String(30)` 限制，使用现有 `"claude_code"`，不要引入 `"sillyspec_init"` 或更长新值。
10. **测试隔离**：单测不能真实调用 `sillyspec` CLI，也不能依赖 Redis/SSE；只验证 DB 状态和返回契约。

## 非目标

- 不构造 `AgentSpecBundle`
- 不调用 `ClaudeCodeAdapter.run_with_bundle()`
- 不执行 `sillyspec init` 或 `sillyspec run scan`
- 不运行 `SpecValidator.validate()`
- 不创建或更新 `SpecConflict`
- 不写 `spec_bootstrap.complete` 审计
- 不实现用户输入、pending_input、resume 或 approval 交互
- 不修改前端 `BootstrapResult` 或页面行为
- 不修改 `backend/app/modules/agent/model.py` 或新增 migration
- 不更新模块文档；文档同步属于 task-09

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md` — 决策 1 定义 `/spec-bootstrap` 立即返回 `AgentRun`，决策 2/3/4 属于后续执行与交互边界。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md` — Wave 1 中 task-01 只负责创建 run/关联/审计并立即返回。
- `backend/app/modules/spec_workspace/bootstrap.py` — 当前同步执行 `sillyspec init`、验证并返回 stdout/stderr 的旧路径。
- `backend/app/modules/spec_workspace/router.py` — 当前 `/spec-bootstrap` 使用 `response_model=dict` 并描述为直接 CLI 初始化。
- `backend/app/modules/agent/model.py` — 复用 `AgentRun.status` 和 `agent_type="claude_code"` 约定。
- `.sillyspec/docs/backend/modules/agent.md` — 现有 `/agent/runs/{id}/stream` 支持 DB 日志回放 + Redis Pub/Sub 实时追踪。
- `.sillyspec/docs/backend/modules/spec_workspace.md` — 当前文档描述的同步 bootstrap 行为，是本任务要替换的后端启动契约。

## TDD 步骤

1. 在 `backend/app/modules/spec_workspace/tests/test_bootstrap.py` 先新增或改写测试：
   - `test_bootstrap_returns_pending_run_start_contract`
   - `test_bootstrap_creates_claude_code_agent_run`
   - `test_bootstrap_creates_agent_run_workspace_link`
   - `test_bootstrap_writes_start_audit_only`
   - `test_bootstrap_does_not_call_direct_sillyspec_or_validator`
2. 先运行目标测试，确认当前实现因同步返回字段、`agent_type="sillyspec_init"`、CLI 调用或验证调用而失败：
   ```bash
   pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py -q
   ```
3. 在 `schema.py` 添加 `SpecBootstrapRunStartResponse`，在 `router.py` 改 `response_model` 和 docstring。
4. 重写 `SpecBootstrapService.bootstrap()`：保留 record loading、mkdir、start audit、run 创建、workspace 关联和返回契约，移除同步 CLI/验证/冲突收尾。
5. 如果保留 `_run_sillyspec_init()`，确保它不再被 `bootstrap()` 调用；更推荐删除旧 helper，避免后续误用。
6. 重新运行目标测试，确认新增测试通过且没有真实 CLI/SSE/Redis 依赖。
7. 最后运行最小回归：
   ```bash
   pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py backend/app/modules/agent/tests/test_m2n_agent_run.py -q
   ```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 调用 `SpecBootstrapService.bootstrap()` | 返回包含 `agent_run_id`、`stream_url`、`status`、`spec_root`、`message` 的启动响应 |
| AC-02 | 检查 bootstrap 响应字段 | 不再包含 `stdout`、`stderr`、`command`、`agent_exit_code`、`validation_passed`、`errors`、`warnings`、`sync_status` |
| AC-03 | 查询 `agent_runs` | 新 run 的 `agent_type="claude_code"` 且 `status="pending"` |
| AC-04 | 查询 `agent_run_workspaces` | 新 run 与当前 `workspace_id` 存在关联 |
| AC-05 | 查询 `audit_logs` | 存在 `action="spec_bootstrap.start"`，且 `resource_type="spec_workspace"`、`resource_id=workspace_id` |
| AC-06 | mock `_run_sillyspec_init` 或 subprocess | `/spec-bootstrap` 不调用直接 SillySpec CLI helper 或 `asyncio.create_subprocess_exec` |
| AC-07 | mock `SpecValidator.validate` | task-01 启动阶段不执行验证 |
| AC-08 | HTTP 调用 `POST /workspaces/{workspace_id}/spec-bootstrap` | `response_model=SpecBootstrapRunStartResponse` 生效，HTTP JSON 中 UUID 正确序列化为字符串 |
| AC-09 | `SpecWorkspace` 或 `Workspace` 缺失测试 | 仍抛 `SpecWorkspaceNotFound`，且没有创建孤立 `AgentRun` |
| AC-10 | 运行目标测试命令 | `pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py -q` 通过，无真实 CLI 依赖 |
| AC-11 | 运行最小回归命令 | `pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py backend/app/modules/agent/tests/test_m2n_agent_run.py -q` 通过 |
