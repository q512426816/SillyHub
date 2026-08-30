---
id: task-06
title: "新增 archive-confirm API（schema + router + service）"
priority: P0
estimated_hours: 1
depends_on: [task-05]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/router.py
  - backend/app/modules/change/service.py
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# task-06: 新增 archive-confirm API（schema + router + service）

## 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/modules/change/schema.py` | 新增 `ArchiveConfirmRequest` DTO |
| `backend/app/modules/change/router.py` | 新增 `POST /changes/{change_id}/archive-confirm` 路由 |
| `backend/app/modules/change/service.py` | 新增 `archive_confirm()` 方法 |

## 实现要求

### 1. schema.py — 新增 ArchiveConfirmRequest

在 `HumanTestRequest` 之后、`ReviewResponse` 之前添加：

```python
class ArchiveConfirmRequest(BaseModel):
    comment: str | None = None
```

- 无 decision 字段（archive-confirm 只有一个动作：确认归档）
- comment 可选，用于记录归档备注

### 2. service.py — 新增 archive_confirm 方法

在 `ChangeService` 类的 Review Gate methods 区域末尾添加 `archive_confirm` 方法。

**方法签名**：

```python
async def archive_confirm(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    comment: str | None,
    user_id: uuid.UUID,
) -> dict:
```

**前置校验**（guard）：
- `change.current_stage == "archive"`
- `change.human_gate == "need_archive_confirm"`
- 不满足时抛出 `InvalidTransition`，details 包含 current_stage 和 human_gate

**执行逻辑**：

1. 加载 change 对象，执行前置校验
2. 将 `change.human_gate` 设为 `HumanGate.NONE`
3. 记录到 `stages["review_history"]`（列表），追加条目：
   ```python
   {
       "decision": "archive_confirmed",
       "comment": comment,
       "user_id": str(user_id),
       "submitted_at": datetime.now(UTC).isoformat(),
       "from_stage": "archive",
       "target_action": "dispatch_archive",
   }
   ```
4. 同时更新 `stages["last_review"]` 为上述同一条目（与其他 review 方法保持一致）
5. `self._session.add(change)` + `await self._session.commit()`
6. best-effort dispatch archive Agent：调用 `transition_with_dispatch` 的 dispatch 模式，即用独立 session 调用 `dispatch(session, workspace_id, change_id, target_stage="archive", user_id=user_id)`
7. 返回 `{"change": change, "agent_dispatch": dispatch_result}`

**dispatch 方式**：参照 `transition_with_dispatch` 中的 best-effort dispatch 模式（使用 `get_session_factory()` 创建独立 session，try-except 包裹），因为 change 已 commit，直接调用 `dispatch` 即可。

### 3. router.py — 新增路由

在 `human_test` 路由之后、Agent dispatch endpoints 注释之前添加：

```python
@router.post(
    "/changes/{change_id}/archive-confirm",
    response_model=ReviewResponse,
)
async def archive_confirm(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ArchiveConfirmRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.archive_confirm(
        workspace_id,
        change_id,
        body.comment,
        _user.id,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(change=enriched.model_dump(), agent_dispatch=agent_dispatch)
```

**路由模式**：与 `proposal_review`、`plan_review`、`human_test` 完全一致：
- 路径参数使用 `change_id`（UUID）
- 权限要求 `Permission.CHANGE_CREATE`
- 响应类型复用 `ReviewResponse`
- enrich + 构建 `TransitionDispatchResponse` 的模式与其他 review 路由相同

**import 更新**：在 router.py 顶部的 import 块中添加 `ArchiveConfirmRequest`。

## 接口定义

### POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm

| 项目 | 值 |
|------|------|
| Method | POST |
| Path | `/api/workspaces/{workspace_id}/changes/{change_id}/archive-confirm` |
| Auth | require_permission(Permission.CHANGE_CREATE) |
| Request Body | `ArchiveConfirmRequest(comment: str \| None)` |
| Response 200 | `ReviewResponse(change: dict, agent_dispatch: TransitionDispatchResponse \| None)` |
| Response 409 | InvalidTransition — 前置条件不满足 |
| Response 404 | ChangeNotFound |

**前置条件**：`current_stage == "archive" && human_gate == "need_archive_confirm"`

**成功后状态**：
- `human_gate` → `none`
- `stages.review_history` 追加 archive_confirmed 条目
- best-effort dispatch archive Agent

## 边界处理

1. **stage 不为 archive**：抛出 `InvalidTransition("当前状态不允许 archive confirm")`，details 包含实际 stage 值
2. **human_gate 不为 need_archive_confirm**：抛出 `InvalidTransition("当前状态不允许 archive confirm")`，details 包含实际 human_gate 值（可能为 none / blocked / 其他 gate）
3. **change 不存在**：`self.get()` 内部抛出 `ChangeNotFound`，无需额外处理
4. **dispatch 失败**：best-effort，用 try-except 包裹，失败时 log.warning 并返回 `{"dispatched": False, "reason": "dispatch_exception", "error": str(exc)}`，不阻断 archive_confirm 主流程
5. **并发冲突**：两个用户同时调用 archive-confirm，第二次因 human_gate 已被第一次改为 none，guard 校验失败抛 InvalidTransition，天然幂等安全
6. **comment 为 None**：合法，review_history 中 comment 字段记为 None

## 非目标

- 不修改 `resolve_human_gate` 逻辑（task-01 负责）
- 不修改 `human_test` 的 pass 分支（task-05 负责）
- 不修改 `transition()` 或 `TRANSITIONS` 字典
- 不创建新的数据库表或列
- 不实现前端 archive-confirm 按钮（task-07 负责）
- 不修改 archive Agent 的 dispatch 配置

## 参考

- design.md AD-05: 新增 archive-confirm API
- design.md API 设计节: POST /api/workspaces/{ws_id}/changes/{id}/archive-confirm
- `service.py` `proposal_review()` 方法（行 880-927）— guard 模式 + review_history 模式
- `service.py` `transition_with_dispatch()` 方法（行 412-467）— best-effort dispatch 模式
- `router.py` `human_test()` 路由（行 409-437）— review 路由结构模板
- `schema.py` `ProposalReviewRequest`（行 248-250）— review request DTO 模板
- `schema.py` `ReviewResponse`（行 263-265）— 复用的响应 DTO

## TDD 步骤

1. **写测试：guard 校验失败** — change 在非 archive 阶段或 human_gate 非 need_archive_confirm 时调用 archive_confirm，断言抛 InvalidTransition
2. **写测试：成功确认 + review_history 记录** — change 在 archive + need_archive_confirm 状态，调用 archive_confirm，断言 human_gate 变为 none，stages.review_history 包含 `{decision: "archive_confirmed", from_stage: "archive", target_action: "dispatch_archive"}`
3. **写测试：comment 可选** — 不传 comment，断言 review_history 中 comment 为 None
4. **写测试：dispatch 失败不阻断** — mock dispatch 抛异常，断言方法仍正常返回，agent_dispatch.dispatched == False
5. **写实现**：schema.py 添加 ArchiveConfirmRequest
6. **写实现**：service.py 添加 archive_confirm 方法
7. **写实现**：router.py 添加路由 + 更新 import
8. **跑测试**：`pytest backend/app/modules/change/tests/ -x -v`

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | `ArchiveConfirmRequest` 已在 schema.py 中定义，comment 字段类型为 `str \| None = None` | 代码检查 |
| 2 | `POST /changes/{change_id}/archive-confirm` 路由已注册，响应类型为 `ReviewResponse` | 启动服务无报错 + OpenAPI schema 检查 |
| 3 | `service.archive_confirm()` 在 `archive + need_archive_confirm` 状态下正常执行 | pytest |
| 4 | 执行后 `human_gate` 变为 `none` | pytest 断言 |
| 5 | 执行后 `stages.review_history` 追加 `{decision: "archive_confirmed", from_stage: "archive", target_action: "dispatch_archive", user_id, submitted_at}` | pytest 断言 |
| 6 | 非 archive 阶段调用抛 `InvalidTransition` | pytest |
| 7 | human_gate 非 need_archive_confirm 调用抛 `InvalidTransition` | pytest |
| 8 | dispatch 失败时方法仍返回成功，不抛异常 | pytest (mock) |
| 9 | ruff / mypy 检查通过 | `ruff check` + `mypy` |
