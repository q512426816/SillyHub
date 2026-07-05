---
id: task-04
title: Backend API端点 + Agent边界守卫
priority: P0
estimated_hours: 2
depends_on:
  - task-01
  - task-03
blocks:
  - task-05
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change_writer/router.py
---

# task-04: Backend API 端点 + Agent 边界守卫

## 背景

本任务在 task-01（`StageEnum` + `TRANSITIONS` 字典 + DB 字段）和 task-03（`ChangeService` 三个核心方法 + DTO 定义）的基础上，完成 HTTP 路由层接入，并添加 Agent 执行边界守卫。

需要完成两件事：

1. **`change/router.py`** — 新增 3 个 REST 端点，将 HTTP 请求映射到 task-03 中实现的 `transition()`、`submit_feedback()`、`check_archive_gate()` 方法
2. **`change_writer/router.py`** — 在 `execute_change()` 端点中增加 stage 前置守卫，确保 Agent 仅能在 `ready_for_dev` 阶段触发执行，否则返回 `409 Conflict`

## 修改文件

| 操作 | 文件路径 |
|------|----------|
| 修改 | `backend/app/modules/change/router.py` — 追加 3 个新端点：`POST /{change_id}/transition`、`POST /{change_id}/feedback`、`GET /{change_id}/archive-gate` |
| 修改 | `backend/app/modules/change_writer/router.py` — 在 `execute_change()` 函数中增加 stage 前置守卫 |

## 实现要求

### 1. change/router.py — 新增 import

在文件顶部 `from app.modules.change.schema import (` 的导入块中追加 task-03 定义的 DTO：

```python
from app.modules.change.schema import (
    ApprovalRead,
    ApproveRequest,
    # ... 现有导入 ...
    RejectRequest,
    # ── 新增 (task-04) ──
    ArchiveGateResponse,
    FeedbackRequest,
    TransitionRequest,
)
```

### 2. change/router.py — POST /{change_id}/transition

在文件末尾追加新的路由区域：

```python
# ── Workflow (task-04) ────────────────────────────────────────────────────


@router.post(
    "/changes/{change_id}/transition",
    response_model=ChangeRead,
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeRead:
    """执行状态流转。调用 ChangeService.transition()。"""
    service = ChangeService(session)
    change = await service.transition(
        workspace_id,
        change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
    )
    return await service.enrich_with_workspace_ids(change)
```

**关键点**：

- 权限使用 `Permission.CHANGE_CREATE`（与现有 `approve`/`reject`/`update_progress` 一致）
- `_get_user_role()` 是辅助函数，从 `User` 对象提取角色字符串（见下方 §3）
- 响应使用 `ChangeRead`（与 `get_change` 端点一致的富响应）
- `transition()` 内部已包含角色权限校验和合法流转校验，router 层不做重复校验

### 3. change/router.py — _get_user_role() 辅助函数

在路由定义之前（`SessionDep` 定义之后）添加：

```python
def _get_user_role(user: User) -> str:
    """从 User 对象提取角色字符串用于流转权限检查。

    当前简化实现：根据 user 的角色/权限映射为以下值之一：
    - "business_user" — 默认角色
    - "reviewer" — 具有 CHANGE_CREATE 权限的用户
    - "agent" — API Key / 系统调用
    - "system" — 内部系统调用

    TODO: 后续对接正式的 RBAC 系统，替换此简化逻辑。
    """
    # 简化实现：如果用户具有 admin/reviewer 标记则返回 reviewer
    # 否则返回 business_user
    if getattr(user, "is_superuser", False):
        return "reviewer"
    return "business_user"
```

> **说明**：`_get_user_role` 是过渡性简化实现。当前系统暂无完整 RBAC，此函数确保 workflow 流转可以工作。后续正式 RBAC 接入时替换。

### 4. change/router.py — POST /{change_id}/feedback

```python
@router.post(
    "/changes/{change_id}/feedback",
    response_model=ChangeRead,
)
async def submit_feedback(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: FeedbackRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeRead:
    """提交反馈并触发返工流转。调用 ChangeService.submit_feedback()。"""
    service = ChangeService(session)
    change = await service.submit_feedback(
        workspace_id,
        change_id,
        category=body.category,
        text=body.text,
        user_id=_user.id,
        target_stage=body.target_stage,
    )
    return await service.enrich_with_workspace_ids(change)
```

**关键点**：

- 使用 `Permission.CHANGE_CREATE` 权限（反馈提交与变更操作权限一致）
- `user_id` 从认证用户中自动提取，不允许前端伪造
- Pydantic DTO `FeedbackRequest` 的 `category` 已有正则约束 `^[A-D]$`，router 层无需再做校验

### 5. change/router.py — GET /{change_id}/archive-gate

```python
@router.get(
    "/changes/{change_id}/archive-gate",
    response_model=ArchiveGateResponse,
)
async def check_archive_gate(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ArchiveGateResponse:
    """归档门禁检查。调用 ChangeService.check_archive_gate()。"""
    service = ChangeService(session)
    return await service.check_archive_gate(workspace_id, change_id)
```

**关键点**：

- 使用 `Permission.CHANGE_READ` 权限（查询操作，比写入权限更低）
- 纯查询操作，不修改任何状态
- 返回 `ArchiveGateResponse` DTO，前端根据 `can_archive` 和 `checks` 列表渲染 UI

### 6. change_writer/router.py — execute_change() stage 守卫

在现有 `execute_change()` 函数中，**在查询 change 记录之后、执行协调器之前**插入 stage 检查：

```python
@router.post(
    "/changes/{change_key}/execute",
    response_model=dict,
)
async def execute_change(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    user: CurrentUser,
) -> dict:
    """Trigger change execution — create a SillySpec AgentRun and dispatch in background."""
    from pathlib import Path

    from sqlalchemy import select
    from sqlmodel import col

    from app.core.errors import AppError, WorkspaceNotFound
    from app.modules.agent.coordinator import ExecutionCoordinatorService
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.service import _rewrite_path

    # Look up the change record
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # ── Stage guard (task-04) ──────────────────────────────────────────────
    current_stage = getattr(change, "current_stage", None) or "draft"
    if current_stage != "ready_for_dev":
        raise AppError(
            f"Change '{change_key}' 当前阶段为 '{current_stage}'，"
            f"仅当阶段为 'ready_for_dev' 时可执行。"
            f"请先完成设计评审并流转至 ready_for_dev。",
            http_status=409,
        )
    # ── End stage guard ────────────────────────────────────────────────────

    # Resolve repo directory from workspace
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFound("Workspace not found.")
    repo_dir = Path(_rewrite_path(workspace.root_path))

    # ... 后续代码不变 ...
```

**关键点**：

- 使用 `http_status=409`（Conflict），语义明确：当前状态不允许此操作
- 错误消息包含当前阶段名称和期望阶段，帮助调用方理解问题
- `current_stage` 为 `None` 时视为 `draft`，守卫生效阻止未进入工作流的 change 被执行
- 守卫位置在 change 查询之后、workspace 查询之前，尽早失败

## 接口定义

### 端点汇总

| 方法 | 路径 | 请求体 | 响应 | 权限 | 说明 |
|------|------|--------|------|------|------|
| `POST` | `/workspaces/{workspace_id}/changes/{change_id}/transition` | `TransitionRequest` | `ChangeRead` | `CHANGE_CREATE` | 状态流转 |
| `POST` | `/workspaces/{workspace_id}/changes/{change_id}/feedback` | `FeedbackRequest` | `ChangeRead` | `CHANGE_CREATE` | 提交反馈 |
| `GET` | `/workspaces/{workspace_id}/changes/{change_id}/archive-gate` | — | `ArchiveGateResponse` | `CHANGE_READ` | 归档门禁 |
| `POST` | `/workspaces/{workspace_id}/changes/{change_key}/execute` | — | `dict` | 登录即可 | 增加 stage 守卫（已有端点） |

### 请求/响应模型

`TransitionRequest`、`FeedbackRequest`、`ArchiveGateResponse`、`ArchiveCheckItem` 均由 task-03 在 `schema.py` 中定义，本任务直接 import 使用。

**TransitionRequest**:
```json
{
  "target_stage": "clarifying",
  "reason": "需求已明确，开始澄清"
}
```

**FeedbackRequest**:
```json
{
  "category": "A",
  "text": "实现与设计方案不符，按钮颜色错误",
  "target_stage": null
}
```

**ArchiveGateResponse**:
```json
{
  "can_archive": false,
  "checks": [
    {"name": "no_unresolved_feedback", "passed": true, "detail": ""},
    {"name": "ac_confirmed", "passed": false, "detail": "验收标准尚未确认"},
    {"name": "tech_verification_passed", "passed": true, "detail": ""},
    {"name": "business_review_passed", "passed": true, "detail": ""},
    {"name": "feedback_categorized", "passed": true, "detail": ""},
    {"name": "documents_complete", "passed": true, "detail": ""}
  ]
}
```

## 边界处理

1. **transition 端点 — service 层抛出 InvalidTransition / PermissionDenied**：这些异常由 `ChangeService.transition()` 抛出。Router 层需确保它们被 FastAPI 的异常处理器正确转换为 HTTP 响应（通常是 400 Bad Request 或 403 Forbidden）。如果 `InvalidTransition` / `PermissionDenied` 继承自 `AppError`，则已有全局异常处理器会处理。如果使用 `ValueError`（task-03 降级方案），FastAPI 会返回 500，需在 router 层 catch 并转换为适当 HTTP 错误。

2. **transition 端点 — user_role 提取失败**：`_get_user_role()` 需处理 `User` 对象缺少角色信息的情况。降级返回 `"business_user"`（最小权限角色），确保不会因角色提取失败而获得过高权限。

3. **feedback 端点 — Pydantic 校验失败**：`FeedbackRequest.category` 的正则约束 `^[A-D]$` 会由 FastAPI 自动返回 `422 Unprocessable Entity`，router 层不需要手动处理。`text` 的 `min_length=1, max_length=2000` 同理。

4. **archive-gate 端点 — change 不存在**：`check_archive_gate()` 内部调用 `self.get()`，不存在时会抛出 `ChangeNotFound`，已有全局异常处理器转换为 404。

5. **execute_change 守卫 — current_stage 字段不存在**：旧数据可能没有 `current_stage` 列（迁移前）。`getattr(change, "current_stage", None)` 安全降级为 `None`，守卫代码进一步降级为 `"draft"`，返回 409 阻止执行。这保证了未迁移数据不会被误执行。

6. **execute_change 守卫 — 409 与 404 的优先级**：change 查询在守卫之前，如果 change 不存在先返回 404，再由守卫返回 409。语义正确：资源不存在 vs 资源状态冲突。

7. **路由冲突检查**：新增的 `/{change_id}/transition`、`/{change_id}/feedback`、`/{change_id}/archive-gate` 路径不与现有路由冲突。现有路由使用 `{change_key}` (str) 而非 `{change_id}` (UUID)，且路径前缀不同（`/changes/{change_id}/` vs `/changes/{change_key}/`）。但需注意 `GET /changes/{change_id}` 已存在，新路由在其子路径下，FastAPI 路由匹配无歧义。

8. **archive-gate 端点命名**：URL 使用连字符 `archive-gate`（RESTful 惯例），Python 函数名使用下划线 `check_archive_gate`（PEP 8）。两端一致。

9. **service 方法签名匹配**：router 调用参数需与 task-03 定义的 `ChangeService` 方法签名完全一致。特别注意 `transition()` 需要 `user_role: str` 参数，`submit_feedback()` 需要 `user_id: uuid.UUID` 参数。

## 非目标（本任务不做的事）

- **不修改** `backend/app/modules/change/service.py` — 业务逻辑层由 task-03 完成
- **不修改** `backend/app/modules/change/schema.py` — DTO 定义由 task-03 完成
- **不修改** `backend/app/modules/change/model.py` — 数据模型由 task-01 完成
- **不实现** 完整的 RBAC 角色系统 — `_get_user_role()` 是过渡简化实现
- **不修改** `change_writer/service.py` — `create_change` 的 `draft → clarifying` 自动流转不在本任务范围
- **不修改** `change_writer/schema.py` — 无 schema 变更
- **不新增** 独立的异常类 — 复用现有 `AppError`（409 场景）和 task-03 定义的异常
- **不实现** websocket/SSE 推送 — 流转状态变更通知由后续迭代补充
- **不处理** 乐观并发控制 — version 字段冲突检测由后续 task 补充

## TDD 步骤

### 测试文件位置

`backend/tests/modules/change/test_workflow_router.py`（router 层测试）
`backend/tests/modules/change/test_change_writer_guard.py`（change_writer 守卫测试）

### Step 1 — 写测试（先红后绿）

```python
# === test_workflow_router.py ===

async def test_transition_endpoint_success():
    """POST /{change_id}/transition — 合法流转返回 ChangeRead"""

async def test_transition_endpoint_invalid_stage():
    """POST /{change_id}/transition — 非法流转返回 400/422"""

async def test_transition_endpoint_permission_denied():
    """POST /{change_id}/transition — 角色不足返回 403"""

async def test_transition_endpoint_with_reason():
    """POST /{change_id}/transition — reason 字段正确传递"""

async def test_transition_endpoint_change_not_found():
    """POST /{change_id}/transition — change 不存在返回 404"""

async def test_feedback_endpoint_success():
    """POST /{change_id}/feedback — 类别 A 反馈成功"""

async def test_feedback_endpoint_invalid_category():
    """POST /{change_id}/feedback — category='X' 返回 422"""

async def test_feedback_endpoint_empty_text():
    """POST /{change_id}/feedback — text 为空返回 422"""

async def test_feedback_endpoint_text_too_long():
    """POST /{change_id}/feedback — text 超过 2000 返回 422"""

async def test_feedback_endpoint_wrong_stage():
    """POST /{change_id}/feedback — 非 technical_verification/business_review 阶段返回错误"""

async def test_archive_gate_endpoint_all_pass():
    """GET /{change_id}/archive-gate — 全部通过，can_archive=True"""

async def test_archive_gate_endpoint_partial_fail():
    """GET /{change_id}/archive-gate — 部分检查失败，can_archive=False"""

async def test_archive_gate_endpoint_not_found():
    """GET /{change_id}/archive-gate — change 不存在返回 404"""


# === test_change_writer_guard.py ===

async def test_execute_change_ready_for_dev():
    """POST /{change_key}/execute — stage=ready_for_dev，正常执行"""

async def test_execute_change_draft_blocked():
    """POST /{change_key}/execute — stage=draft，返回 409"""

async def test_execute_change_in_dev_blocked():
    """POST /{change_key}/execute — stage=in_dev，返回 409"""

async def test_execute_change_accepted_blocked():
    """POST /{change_key}/execute — stage=accepted，返回 409"""

async def test_execute_change_archived_blocked():
    """POST /{change_key}/execute — stage=archived，返回 409"""

async def test_execute_change_no_stage_field():
    """POST /{change_key}/execute — current_stage=None，视为 draft，返回 409"""

async def test_execute_change_not_found():
    """POST /{change_key}/execute — change 不存在，返回 404（先于 409）"""

async def test_execute_change_409_message_contains_stage():
    """409 错误消息包含当前阶段和期望阶段信息"""
```

### Step 2 — 确认失败

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/tests/modules/change/test_workflow_router.py \
    backend/tests/modules/change/test_change_writer_guard.py -v
# 预期：全部 FAILED / ERROR（端点尚未实现）
```

### Step 3 — 写代码

1. 在 `change/router.py` 中：
   - 追加 import：`ArchiveGateResponse`、`FeedbackRequest`、`TransitionRequest`
   - 添加 `_get_user_role()` 辅助函数
   - 追加 3 个新端点函数
2. 在 `change_writer/router.py` 中：
   - 在 `execute_change()` 的 change 查询之后插入 stage 守卫代码块

### Step 4 — 确认通过

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/tests/modules/change/test_workflow_router.py \
    backend/tests/modules/change/test_change_writer_guard.py -v
# 预期：全部 PASSED
```

### Step 5 — 回归测试

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/ -v
# 预期：无新增失败
```

### 测试辅助函数

```python
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.fixture
def mock_change_service():
    """Mock ChangeService 用于 router 测试。"""
    with patch("app.modules.change.router.ChangeService") as MockClass:
        instance = MagicMock()
        MockClass.return_value = instance
        # 默认返回值
        instance.transition = AsyncMock(return_value=_make_change_read())
        instance.submit_feedback = AsyncMock(return_value=_make_change_read())
        instance.check_archive_gate = AsyncMock(return_value=_make_archive_response())
        instance.enrich_with_workspace_ids = AsyncMock(return_value=_make_change_read())
        yield instance


def _make_change_read(
    *,
    current_stage: str = "clarifying",
    change_id: uuid.UUID | None = None,
) -> dict:
    """构造 ChangeRead 风格的 dict 用于 mock 返回。"""
    return {
        "id": change_id or uuid.uuid4(),
        "workspace_id": uuid.uuid4(),
        "workspace_ids": [],
        "change_key": "test-change-001",
        "title": "测试变更",
        "status": "active",
        "location": "local",
        "path": ".sillyspec/changes/local/test-change-001",
        "affected_components": [],
        "change_type": "quick",
        "owner_id": None,
        "current_stage": current_stage,
        "stages": {},
        "approval_status": None,
        "approved_by": None,
        "approved_at": None,
        "rejection_reason": None,
        "created_at": "2026-05-31T00:00:00Z",
        "updated_at": "2026-05-31T00:00:00Z",
        "archived_at": None,
    }


def _make_archive_response(
    can_archive: bool = True,
    failed: list[str] | None = None,
) -> dict:
    """构造 ArchiveGateResponse 风格的 dict。"""
    checks = [
        {"name": n, "passed": n not in (failed or []), "detail": ""}
        for n in [
            "no_unresolved_feedback",
            "ac_confirmed",
            "tech_verification_passed",
            "business_review_passed",
            "feedback_categorized",
            "documents_complete",
        ]
    ]
    if failed:
        for c in checks:
            if c["name"] in failed:
                c["passed"] = False
                c["detail"] = f"{c['name']} 未通过"
    return {"can_archive": can_archive, "checks": checks}
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `change/router.py` import 包含 `TransitionRequest` | import 块包含 `ArchiveGateResponse`, `FeedbackRequest`, `TransitionRequest` |
| AC-02 | `POST /{change_id}/transition` 端点存在 | FastAPI 自动文档（`/docs`）中可见该端点，方法为 POST，响应模型为 `ChangeRead` |
| AC-03 | `POST /{change_id}/feedback` 端点存在 | 自动文档中可见，响应模型为 `ChangeRead` |
| AC-04 | `GET /{change_id}/archive-gate` 端点存在 | 自动文档中可见，响应模型为 `ArchiveGateResponse` |
| AC-05 | transition 端点调用 `service.transition()` | 请求参数正确传递：`target_stage`, `user_role`, `reason` |
| AC-06 | feedback 端点调用 `service.submit_feedback()` | 请求参数正确传递：`category`, `text`, `user_id`, `target_stage` |
| AC-07 | archive-gate 端点调用 `service.check_archive_gate()` | 请求参数正确传递：`workspace_id`, `change_id` |
| AC-08 | feedback 端点 category 校验 | `category="X"` 返回 HTTP 422，FastAPI Pydantic 自动校验 |
| AC-09 | feedback 端点 text 校验 | 空字符串返回 422，超长字符串（>2000）返回 422 |
| AC-10 | archive-gate 端点使用 `CHANGE_READ` 权限 | 无该权限的用户被拒绝访问 |
| AC-11 | transition/feedback 端点使用 `CHANGE_CREATE` 权限 | 无该权限的用户被拒绝访问 |
| AC-12 | `_get_user_role()` 辅助函数存在 | 返回 `"business_user"` 或 `"reviewer"` 字符串 |
| AC-13 | `execute_change()` 守卫 — `ready_for_dev` 通过 | `current_stage == "ready_for_dev"` 时正常执行，返回 `{ok: True, run_id: ...}` |
| AC-14 | `execute_change()` 守卫 — 非 `ready_for_dev` 拒绝 | `current_stage` 为其他任意值时返回 HTTP 409 |
| AC-15 | `execute_change()` 守卫 — `None` 降级 | `current_stage=None` 降级为 `"draft"`，返回 409 |
| AC-16 | `execute_change()` 守卫 — 404 优先于 409 | change 不存在时返回 404 而非 409 |
| AC-17 | 409 错误消息包含上下文 | 错误消息包含当前阶段名称和 "ready_for_dev" 期望值 |
| AC-18 | 新路由不与现有路由冲突 | 所有现有端点测试通过，无路径匹配歧义 |
| AC-19 | 现有 `change/router.py` 端点不受影响 | `list_changes`, `get_change`, `update_progress`, `approve_change`, `reject_change`, `sync_documents` 行为不变 |
| AC-20 | 现有 `change_writer/router.py` 端点不受影响 | `create_change`, `generate_document`, `batch_generate_documents` 行为不变 |
| AC-21 | 全量回归无失败 | `pytest backend/ -v` 全套通过，无新增失败/错误 |
