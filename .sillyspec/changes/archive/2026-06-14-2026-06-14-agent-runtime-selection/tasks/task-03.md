---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-03
title: 三入口 provider 解析（显式 > workspace.default_agent > None）并透传 dispatch_to_daemon
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: [task-05, task-06, task-07, task-13]
allowed_paths:
  - backend/app/modules/agent/service.py
---

# task-03: 三入口 provider 解析（显式 > workspace.default_agent > None）并透传 dispatch_to_daemon

## 上下文
本变更的核心。`AgentService` 的三个分发入口 `start_run`(L154) / `start_stage_dispatch`(L530) / `start_scan_dispatch`(L786) 当前都不传 provider，导致多 provider 环境下 runtime 随机选中。三个方法**都已 `self._session.get(Workspace, workspace_id)`**（现用于读 repo_url/default_branch），加 provider 解析无障碍。本任务让"显式 provider > workspace.default_agent > None"的优先级在 service 内部统一落地（FR-02），并把解析下沉到内部（自动调度链路无需改调用方即生效，闭合 R-03）。

## 修改文件（必填）
- `backend/app/modules/agent/service.py` — 三入口方法

## 实现要求
1. **`start_run`**（L154）：签名增 `provider: str | None = None`（放在 `preferred_backend` 之后）。在调用 `dispatch_to_daemon` 前（现 L286-291）：
   ```python
   workspace = await self._session.get(Workspace, workspace_id)  # 已有
   resolved_provider = provider or (workspace.default_agent if workspace else None)
   lease_id_daemon = await placement.dispatch_to_daemon(
       run.id, user_id, repo_url=repo_url, branch=branch,
       provider=resolved_provider,  # 新增透传
   )
   ```
2. **`start_stage_dispatch`**（L530）：签名增 `provider: str | None = None`。同理在 dispatch_to_daemon 前（现 L666-674）解析 `provider or workspace.default_agent` 并透传。**自动调度链路（auto_dispatch_next_step → dispatch → start_stage_dispatch）不传 provider**，因此内部读 workspace.default_agent 自动生效（FR-04）。
3. **`start_scan_dispatch`**（L786）：签名增 `provider: str | None = None`。同理在 dispatch_to_daemon 前（现 L884-891）解析并透传。
4. 三个入口用同一个解析表达式 `provider or (workspace.default_agent if workspace else None)`，不要在三处写不同逻辑。

## 接口定义（代码类任务必填）
```python
# 三入口签名（provider 新增，关键字参数，默认 None）
async def start_run(
    self, workspace_id, user_id, *, task_id, lease_id,
    agent_type="claude_code", idempotency_key=None,
    preferred_backend=None, provider=None,   # 新增
) -> AgentRun: ...

async def start_stage_dispatch(
    self, *, workspace_id, change_id, user_id, stage,
    prompt_template, requires_worktree, read_only=True,
    provider=None,   # 新增
) -> AgentRun: ...

async def start_scan_dispatch(
    self, *, workspace_id, user_id, root_path, spec_root,
    provider=None,   # 新增
) -> AgentRun: ...

# 统一解析（三处一致）
workspace = await self._session.get(Workspace, workspace_id)
resolved_provider = provider or (workspace.default_agent if workspace else None)
await placement.dispatch_to_daemon(run.id, user_id, ..., provider=resolved_provider)
```

## 边界处理（必填）
- **优先级**：`provider or workspace.default_agent or None` —— 显式 provider 非空优先（FR-02），否则 default_agent，否则 None。
- **显式空串**：`provider=""` 视为 falsy，回退到 default_agent（与 None 同处理，避免空串误传）。
- **workspace 不存在**：`workspace` 为 None 时 resolved=None（维持现状），不抛错。
- **default_agent=NULL（旧 workspace）**：resolved=None → `dispatch_to_daemon(provider=None)` → `_get_online_runtime` 走 ORDER BY last_heartbeat（成功标准 1，行为不变）。
- **agent_type 与 provider 解耦**：`agent_type="claude_code"` 是执行风格，不动（design 非目标）。只 provider 影响路由。
- **自动调度链路**：调用方（dispatch.py）不传 provider，内部兜底 default_agent，无需改 dispatch.py 入参（R-03 闭合）。

## 非目标（本任务不做的事）
- 不改 placement.py（task-02 负责）。
- 不改 router/schema（task-05/06/07 负责 API 入口）。
- 不改 agent_type 语义。
- 不改 dispatch.py 自动调度入参。

## 参考
- 现有三入口：service.py:154 / 530 / 786（均已 `get(Workspace)` 读 repo_url/default_branch）。
- `dispatch_to_daemon`（placement.py）已支持 `provider` 参数 + lease.metadata 写入（L189-190）。

## TDD 步骤
1. 写测试：`backend/app/modules/agent/tests/test_service_provider.py`
   - case 1：workspace.default_agent="claude"，start_run(provider=None) → 断言 dispatch_to_daemon 收到 provider="claude"（mock placement）。
   - case 2：default_agent="claude"，start_run(provider="codex") → dispatch_to_daemon 收到 "codex"（显式>默认）。
   - case 3：default_agent=None，provider=None → dispatch_to_daemon 收到 None。
   - case 4：start_stage_dispatch 同优先级（覆盖自动调度路径）。
2. 确认失败（无 provider 解析时 dispatch_to_daemon 收到 None）。
3. 改三入口。
4. `cd backend && uv run pytest -q app/modules/agent/tests/test_service_provider.py` 通过。
5. 回归既有 agent service 测试。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | default_agent="claude", start_run() | dispatch_to_daemon provider="claude" |
| AC-02 | default_agent="claude", start_run(provider="codex") | dispatch_to_daemon provider="codex" |
| AC-03 | default_agent=None, start_run() | dispatch_to_daemon provider=None |
| AC-04 | start_stage_dispatch 同优先级 | 显式>默认>None |
| AC-05 | start_scan_dispatch 同优先级 | 显式>默认>None |
| AC-06 | 既有 agent service 测试无回归 | 全绿 |
