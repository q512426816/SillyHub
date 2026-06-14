---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-06
title: stage 手动 dispatch 入口支持 provider（含新增 request schema）
priority: P0
estimated_hours: 2
depends_on: [task-03]
blocks: [task-12, task-13]
allowed_paths:
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/router.py
  - backend/app/modules/change/schema.py
---

# task-06: stage 手动 dispatch 入口支持 provider（含新增 request schema）

## 上下文
stage 手动重跑入口 `POST /workspaces/{id}/changes/{change_id}/dispatch`（router.py `manual_dispatch` L544）当前**无 request body schema**（裸端点直接调 `dispatch()`）。需新增轻量 request schema 接收显式 provider（FR-06）。依赖 task-03（`start_stage_dispatch` 已有 provider 参数）。前端 stage dispatch UI（task-12）依赖本契约。自动调度链路（`auto_dispatch_next_step`）不传 provider，由 `start_stage_dispatch` 内部读 default_agent 兜底（FR-04 / R-03）。

## 修改文件（必填）
- `backend/app/modules/change/dispatch.py` — `dispatch()`（L494）增 provider 形参
- `backend/app/modules/change/router.py` — `manual_dispatch`（L544）新增 request schema + 透传
- `backend/app/modules/change/schema.py` — 新增 `ManualDispatchRequest`

## 实现要求
1. **`dispatch()`**（dispatch.py L494）：增可选 `provider: str | None = None`，透传给 `start_stage_dispatch(..., provider=provider)`（现 L547-555）。
2. **`dispatch_next_step()`**（dispatch.py L644）：保持不传 provider（自动调度用 default_agent 兜底）；若签名需要兼容，可不加 provider 或加默认 None。
3. **schema.py**：新增：
   ```python
   class ManualDispatchRequest(BaseModel):
       provider: str | None = Field(default=None, max_length=64)
   ```
4. **`manual_dispatch`**（router.py L544）：把裸端点改为接收 `payload: ManualDispatchRequest = Body(default_factory=ManualDispatchRequest)`（保持可选，空 body 也可），透传 `dispatch(..., provider=payload.provider)`。

## 接口定义（代码类任务必填）
```python
# dispatch.py
async def dispatch(
    session, workspace_id, change_id, target_stage, user_id,
    *, provider: str | None = None,   # 新增
) -> dict[str, Any]:
    ...
    run = await agent_service.start_stage_dispatch(
        workspace_id=workspace_id, change_id=change_id, user_id=user_id,
        stage=target_stage, prompt_template=config.prompt_template,
        requires_worktree=config.requires_worktree, read_only=config.read_only,
        provider=provider,   # 新增透传
    )

# schema.py
class ManualDispatchRequest(BaseModel):
    provider: str | None = Field(default=None, max_length=64)

# router.py
@router.post("/.../dispatch", ...)
async def manual_dispatch(..., payload: ManualDispatchRequest = Body(default=ManualDispatchRequest)):
    ...
    dispatch_result = await dispatch(
        session=session, workspace_id=workspace_id, change_id=change_id,
        target_stage=current_stage, user_id=_user.id,
        provider=payload.provider,   # 新增
    )
```

## 边界处理（必填）
- **手动 dispatch 传 provider**：透传 dispatch → start_stage_dispatch（显式覆盖 default_agent，FR-06）。
- **手动 dispatch 不传 / 空 body**：provider=None → start_stage_dispatch 内部读 default_agent 兜底。
- **空 body 兼容**：`Body(default=ManualDispatchRequest)` 保证不传 body 时也能工作（向后兼容现有前端不传 body 的调用）。
- **自动调度链路**：`dispatch_next_step` / `auto_dispatch_next_step` 不传 provider（默认 None）→ 走 default_agent（FR-04，R-03 闭合）。
- **不破坏既有 dispatch 行为**：provider 可选，现有调用方（不传 provider）行为不变。

## 非目标（本任务不做的事）
- 不改自动调度入参（auto_dispatch_next_step）。
- 不改 start_stage_dispatch 内部（task-03）。
- 不改 stage 配置（StageAgentConfig）。
- 不做 provider 白名单。

## 参考
- `dispatch()`（dispatch.py L494-586）、`manual_dispatch`（router.py L544+）。
- `SillySpecStageDispatchService.dispatch_next_step`（dispatch.py L644）自动调度路径。

## TDD 步骤
1. 写测试：`backend/app/modules/change/tests/test_dispatch_provider.py`
   - 手动 dispatch body `{"provider":"codex"}` → 断言 dispatch（mock start_stage_dispatch）收到 provider="codex"。
   - 手动 dispatch 空 body → provider=None（走 default_agent）。
   - dispatch() 直接调用传 provider → start_stage_dispatch 收到 provider。
2. 确认失败。
3. 改 dispatch + router + schema。
4. `cd backend && uv run pytest -q app/modules/change/tests/test_dispatch_provider.py` 通过。
5. 回归既有 change dispatch / transition 测试。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 手动 dispatch body {"provider":"codex"} | start_stage_dispatch 收到 "codex" |
| AC-02 | 手动 dispatch 空 body | start_stage_dispatch 收到 None（内部兜底 default_agent） |
| AC-03 | dispatch() 传 provider | 透传到 start_stage_dispatch |
| AC-04 | 自动调度链路不传 provider | 走 default_agent（FR-04） |
| AC-05 | 既有 change dispatch/transition 测试无回归 | 全绿 |
| AC-06 | 空 body 请求不报 422（向后兼容） | Body(default=...) 生效 |
