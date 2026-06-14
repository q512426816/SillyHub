---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-05
title: AgentRunCreate + create_agent_run 透传 provider
priority: P0
estimated_hours: 1
depends_on: [task-03]
blocks: [task-11, task-13]
allowed_paths:
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/router.py
---

# task-05: AgentRunCreate + create_agent_run 透传 provider

## 上下文
task 触发入口 `POST /workspaces/{id}/agent/runs` 需支持显式 provider（FR-05）。依赖 task-03（`start_run` 已有 provider 参数）。前端 task 触发面板（task-11）依赖本契约。

## 修改文件（必填）
- `backend/app/modules/agent/schema.py` — `AgentRunCreate`（L11）
- `backend/app/modules/agent/router.py` — `create_agent_run`（L224）

## 实现要求
1. **`AgentRunCreate`**（schema.py L11-18）：增 `provider: str | None = Field(default=None, max_length=64)`（放在 `preferred_backend` 之后）。
2. **`create_agent_run`**（router.py L224-250）：把 `data.provider` 透传：
   ```python
   run = await svc.start_run(
       workspace_id, user.id,
       task_id=data.task_id, lease_id=data.lease_id,
       agent_type=data.agent_type,
       idempotency_key=data.idempotency_key,
       preferred_backend=data.preferred_backend,
       provider=data.provider,   # 新增
   )
   ```

## 接口定义（代码类任务必填）
```python
class AgentRunCreate(BaseModel):
    task_id: uuid.UUID
    lease_id: uuid.UUID
    agent_type: str = Field(default="claude_code", max_length=30)
    profile_version: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=64)
    preferred_backend: str | None = Field(default=None, max_length=20)
    provider: str | None = Field(default=None, max_length=64)  # 新增
```

## 边界处理（必填）
- **不传 provider**：默认 None → start_run 走 workspace.default_agent 兜底（task-03）。
- **传 provider="codex"**：透传 start_run → 显式覆盖 default_agent（FR-05）。
- **传空串/None**：等同不传（task-03 falsy 处理）。
- **max_length**：64，与 schema 其他字段一致。
- **不校验 provider 合法性**：容忍未知 provider，placement 回退兜底（task-02 / R-06）。
- **不传 provider 不破坏既有 task 触发**：字段可选，旧前端不传时行为不变。

## 非目标（本任务不做的事）
- 不改 AgentRunResponse（provider 已在 execution-context L214 读 lease.metadata 返回）。
- 不改 start_run 内部解析（task-03）。
- 不改前端（task-11）。

## 参考
- `AgentRunCreate`（schema.py L11）、`create_agent_run`（router.py L224）。
- `get_execution_context`（router.py L214）已从 lease.metadata 读 provider 返回，无需改。

## TDD 步骤
1. 写测试：`backend/app/modules/agent/tests/test_router_provider.py`
   - POST body 含 `"provider":"codex"` → 断言 start_run（mock）收到 provider="codex"。
   - POST body 不含 provider → start_run 收到 provider=None。
2. 确认失败。
3. 加 schema 字段 + router 透传。
4. `cd backend && uv run pytest -q app/modules/agent/tests/test_router_provider.py` 通过。
5. 回归既有 agent router 测试。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST agent/runs body 含 provider | start_run 收到该 provider |
| AC-02 | POST agent/runs body 不含 provider | start_run 收到 None（由 task-03 兜底） |
| AC-03 | 既有 agent router 测试无回归 | 全绿 |
| AC-04 | AgentRunCreate 类型注解 | provider: str \| None |
