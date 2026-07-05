---
author: qinyi
created_at: 2026-06-01 06:58:55
---

---
id: task-14
title: 更新 change router 返回 TransitionResponse
priority: P1
estimated_hours: 2
depends_on: [task-13]
blocks: [task-16]
allowed_paths:
  - backend/app/modules/change/router.py
---

## 修改文件

- `backend/app/modules/change/router.py`

## 实现要求

根据 design.md Phase 6（line 296-332）、requirements.md FR-09（line 122-132）和 task-13 产出的 schema，更新 transition 端点的返回类型为 `TransitionResponse`。

### 当前状态分析

当前 `transition_change` 端点（router.py line 264-288）：

1. **无 `response_model` 声明**：`@router.post("/changes/{change_id}/transition")` 没有 `response_model` 参数，FastAPI 使用函数返回类型 `dict[str, Any]` 推断
2. **手动构造返回 dict**：返回 `{"change": enriched_change.model_dump(), "agent_dispatch": result["agent_dispatch"]}`
3. **`agent_dispatch` 是 raw dict**：来自 `dispatch()` 函数的返回值，结构为 `{"dispatched": bool, "agent_run_id": str, "stage": str, "reason": str, ...}`

task-13 已在 `schema.py` 新增了 `TransitionResponse` 和 `TransitionDispatchResponse`，本任务需要让 router 使用它们。

### 实现步骤

1. **更新 import**：在 router.py 的 import 块中新增 `TransitionResponse` 和 `TransitionDispatchResponse`
2. **添加 `response_model=TransitionResponse`**：在 `@router.post` 装饰器中声明
3. **构造 `TransitionDispatchResponse`**：将 `result["agent_dispatch"]` dict 转换为 `TransitionDispatchResponse` 实例
4. **构造 `TransitionResponse`**：组装 `change` dict 和 `agent_dispatch` 对象
5. **dispatch 失败时 `agent_dispatch=None`**：当 `dispatched=False` 或 dispatch 异常时，不构造 `TransitionDispatchResponse`，直接传 `None`

## 接口定义

### Import 变更

**修改前**（router.py line 15-36）：

```python
from app.modules.change.schema import (
    ApprovalRead,
    ApproveRequest,
    ArchiveGateResponse,
    ChangeDocContent,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeList,
    ChangeRead,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeSummary,
    ChangeWarning,
    DispatchResponse,
    DocumentsSyncRequest,
    DocumentsSyncResponse,
    FeedbackRequest,
    OkResponse,
    ProgressUpdate,
    RejectRequest,
    TransitionRequest,
)
```

**修改后**：

```python
from app.modules.change.schema import (
    ApprovalRead,
    ApproveRequest,
    ArchiveGateResponse,
    ChangeDocContent,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeList,
    ChangeRead,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeSummary,
    ChangeWarning,
    DispatchResponse,
    DocumentsSyncRequest,
    DocumentsSyncResponse,
    FeedbackRequest,
    OkResponse,
    ProgressUpdate,
    RejectRequest,
    TransitionDispatchResponse,
    TransitionRequest,
    TransitionResponse,
)
```

新增 2 个 import：`TransitionDispatchResponse` 和 `TransitionResponse`。

### transition_change 端点变更

**修改前**（router.py line 264-288）：

```python
@router.post(
    "/changes/{change_id}/transition",
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> dict[str, Any]:
    service = ChangeService(session)
    result = await service.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
        user_id=_user.id,
    )
    # Enrich the change data for the response
    enriched_change = await service.enrich_with_workspace_ids(result["change"])
    return {
        "change": enriched_change.model_dump(),
        "agent_dispatch": result["agent_dispatch"],
    }
```

**修改后**：

```python
@router.post(
    "/changes/{change_id}/transition",
    response_model=TransitionResponse,
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> TransitionResponse:
    service = ChangeService(session)
    result = await service.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
        user_id=_user.id,
    )
    # Enrich the change data for the response
    enriched_change = await service.enrich_with_workspace_ids(result["change"])

    # Build agent_dispatch: convert raw dict to TransitionDispatchResponse or None
    agent_dispatch: TransitionDispatchResponse | None = None
    raw_dispatch = result.get("agent_dispatch")
    if raw_dispatch and raw_dispatch.get("dispatched") is True:
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
            reason=None,
        )

    return TransitionResponse(
        change=enriched_change.model_dump(),
        agent_dispatch=agent_dispatch,
    )
```

### 变更要点说明

1. **`response_model=TransitionResponse`**：FastAPI 根据 Pydantic model 生成 OpenAPI schema，`/docs` 页面自动展示正确的 response 结构
2. **函数返回类型 `-> TransitionResponse`**：与 `response_model` 保持一致
3. **`agent_dispatch` 构造逻辑**：只取 `dispatched=True` 的情况构造 `TransitionDispatchResponse`，其他情况（dispatch 失败、未 dispatch、异常）统一为 `None`
4. **`enriched_change.model_dump()`**：保持不变，将 ChangeRead 序列化为 dict

## 边界处理

1. **dispatch 失败不阻断 transition**：`service.transition_with_dispatch()` 内部已有 try/except 包裹 dispatch 调用（service.py line 407-432），router 层只需处理返回的 raw dict。dispatch 失败时 `result["agent_dispatch"]` 为 `{"dispatched": False, "reason": "dispatch_exception", ...}`，router 将其映射为 `agent_dispatch=None`
2. **agent_dispatch=None 的序列化**：`TransitionResponse.agent_dispatch` 的类型是 `TransitionDispatchResponse | None`，Pydantic 序列化时 `None` 输出为 JSON `null`。前端需要检查 `agent_dispatch !== null` 再读取字段
3. **change dict 结构保持一致**：继续使用 `ChangeRead.model_dump()` 序列化，TransitionResponse 的 `change` 字段是 `dict[str, Any]`，不做额外转换
4. **OpenAPI schema 正确**：声明 `response_model=TransitionResponse` 后，FastAPI 自动生成包含 `change` 和 `agent_dispatch`（可为 null）的 schema，`/docs` 页面正确展示
5. **向后兼容**：旧客户端如果只读取 `change` 字段不受影响，新增的 `agent_dispatch` 字段被忽略。但旧客户端需要注意返回类型从匿名 dict 变为有固定 schema 的 dict（实际 JSON 结构不变，只是增加了 OpenAPI 约束）
6. **TransitionDispatchResponse 字段映射**：`dispatch()` 返回的 dict 中有 `phase`、`error` 等额外字段，`TransitionDispatchResponse` 不包含这些字段，Pydantic 构造时自动忽略多余字段（Pydantic v2 默认忽略 `model_config = ConfigDict(extra="ignore")`，或直接通过构造参数只传需要的字段）

## 非目标

- 不修改 `dispatch()` 函数本身（task-07 负责 `SillySpecStageDispatchService`）
- 不修改 `service.py` 的 `transition_with_dispatch()` 返回结构（当前已返回 `{"change": Change, "agent_dispatch": dict}`）
- 不修改前端代码（task-15/16 负责）
- 不修改 `schema.py`（task-13 负责 schema 定义）
- 不修改 agent-status 和 manual-dispatch 端点（它们继续使用 `DispatchResponse`）

## 参考

- `design.md` Phase 6 "API 与前端契约"（line 296-363）
- `requirements.md` FR-09 "Transition Response Model"（line 122-132）
- `task-13` 产出的 schema 定义（`TransitionDispatchResponse` + `TransitionResponse`）
- `router.py` transition 端点当前实现（line 264-288）
- `service.py` `transition_with_dispatch()` 返回值（line 382-437）
- `dispatch.py` `dispatch()` 返回值结构（line 114-192）

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/change/` 新增测试文件 `test_router_transition.py`，验证 transition 端点返回 `TransitionResponse` 结构
   - 测试 1：dispatch 成功时 `agent_dispatch` 包含 `dispatched=True` + `agent_run_id` + `stage`
   - 测试 2：dispatch 失败时 `agent_dispatch=null`
   - 测试 3：dispatch 抛异常时 `agent_dispatch=null`，transition 本身成功
   - 测试 4：response 中 `change` 字段包含完整 ChangeRead 数据
2. **确认失败**：import `TransitionResponse` 报错（task-13 未完成）或返回类型不匹配
3. **修改 router.py**：按接口定义更新 import 和 `transition_change` 函数
4. **确认通过**：所有测试通过，`/docs` 页面显示 TransitionResponse schema

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | POST /changes/{id}/transition 返回 TransitionResponse | response body 包含 `change` (dict) 和 `agent_dispatch` (object or null) |
| AC-02 | dispatch 成功时 agent_dispatch 结构正确 | `agent_dispatch.dispatched=true`，`agent_dispatch.agent_run_id` 有值，`agent_dispatch.stage` 有值 |
| AC-03 | dispatch 失败时 agent_dispatch=null | 不抛异常，transition 本身成功返回，`agent_dispatch` 为 JSON null |
| AC-04 | dispatch 抛异常时 agent_dispatch=null | service 层捕获异常后返回 `{"dispatched": false, "reason": "dispatch_exception"}`，router 映射为 `agent_dispatch=null` |
| AC-05 | 现有 transition 逻辑不变 | `Change.current_stage` 正确更新，权限验证正常，transition log 记录在 stages JSON |
| AC-06 | OpenAPI schema 正确 | /docs 页面显示 TransitionResponse 为 200 response model，包含 change 和 agent_dispatch 字段 |
| AC-07 | 其他端点不受影响 | agent-status、manual-dispatch、list_changes、get_change 等端点测试全部通过 |
