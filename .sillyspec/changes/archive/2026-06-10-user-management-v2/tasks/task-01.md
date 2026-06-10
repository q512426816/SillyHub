---
id: task-01
title: 单个会话撤销 + 批量撤销端点（后端）
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-04]
allowed_paths:
  - backend/app/modules/settings/service.py
  - backend/app/modules/settings/router.py
  - backend/app/modules/settings/schema.py
author: WhaleFall
created_at: 2026-06-10T11:45:44
---

# task-01: 单个会话撤销 + 批量撤销端点（后端）

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `backend/app/modules/settings/schema.py` | 新增 `RevokeAllResponse` DTO |
| 修改 | `backend/app/modules/settings/service.py` | 新增 `revoke_session` / `revoke_all_sessions` 方法 |
| 修改 | `backend/app/modules/settings/router.py` | 新增 2 个端点 |

## 实现要求

1. 在 `UserService` 中新增 `revoke_session(target_id, session_id)` 方法：查询单个 AuthSession，校验归属和状态，设置 `revoked_at`，写入审计日志，提交事务
2. 在 `UserService` 中新增 `revoke_all_sessions(target_id)` 方法：基于已有 `_revoke_sessions` 执行批量撤销，计算被撤销数量，写入审计日志，返回 `int`（被撤销数量）
3. 在 `schema.py` 新增 `RevokeAllResponse(BaseModel)` DTO，含 `revoked_count: int` 字段
4. 在 `router.py` 新增 `DELETE /api/users/{user_id}/sessions/{session_id}` 端点，返回 204
5. 在 `router.py` 新增 `POST /api/users/{user_id}/sessions/revoke-all` 端点，返回 `RevokeAllResponse`
6. 两个新端点均要求平台管理员权限（`AdminUser` 依赖）
7. 所有审计日志使用 `_set_audit_context()` 机制 + 手动 `AuditLog` 插入，模式与现有 `reset_password` 一致

## 接口定义（代码类任务必填）

### 1. schema.py — RevokeAllResponse

```python
class RevokeAllResponse(BaseModel):
    revoked_count: int
```

位置：放在 `UserSessionRead` 下方，`AuditLogRead` 上方。

### 2. service.py — UserService.revoke_session

```python
async def revoke_session(self, target_id: uuid.UUID, session_id: uuid.UUID) -> None:
    """撤销单个会话。校验 session 归属 target_id 且未撤销。"""
    # 1. 查询 session
    auth_session = await self.session.get(AuthSession, session_id)
    # 2. 校验：不存在 / 不属于目标用户 / 已撤销 → 抛 HTTPException(404)
    if auth_session is None or auth_session.user_id != target_id or auth_session.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Session not found")
    # 3. 设置审计上下文
    self._set_audit_context()
    # 4. 设置 revoked_at
    auth_session.revoked_at = datetime.now(UTC)
    self.session.add(auth_session)
    # 5. 手动插入审计日志
    self.session.add(AuditLog(
        id=uuid.uuid4(),
        workspace_id=None,
        actor_id=self.actor_id,
        action="user.session_revoke",
        resource_type="user",
        resource_id=target_id,
        details_json=json.dumps({"session_id": str(session_id)}, default=str, ensure_ascii=False),
        timestamp=datetime.now(UTC),
    ))
    # 6. 提交
    await self.session.commit()
    log.info("user.session_revoke", target_id=str(target_id), session_id=str(session_id), actor_id=str(self.actor_id))
```

需要在 service.py 顶部新增 import：
```python
from fastapi import HTTPException  # 已在方法内局部 import，改为顶部统一 import
```

### 3. service.py — UserService.revoke_all_sessions

```python
async def revoke_all_sessions(self, target_id: uuid.UUID) -> int:
    """撤销目标用户所有活跃会话，返回被撤销数量。"""
    # 1. 先统计当前活跃会话数
    count_result = await self.session.execute(
        select(func.count()).select_from(
            select(AuthSession)
            .where(AuthSession.user_id == target_id, AuthSession.revoked_at.is_(None))
            .subquery()
        )
    )
    count = count_result.scalar() or 0
    # 2. 如果没有活跃会话，直接返回 0（不写审计日志）
    if count == 0:
        return 0
    # 3. 设置审计上下文
    self._set_audit_context()
    # 4. 复用 _revoke_sessions 执行批量撤销
    await self._revoke_sessions(target_id)
    # 5. 手动插入审计日志
    self.session.add(AuditLog(
        id=uuid.uuid4(),
        workspace_id=None,
        actor_id=self.actor_id,
        action="user.sessions_revoke_all",
        resource_type="user",
        resource_id=target_id,
        details_json=json.dumps({"revoked_count": count}, default=str, ensure_ascii=False),
        timestamp=datetime.now(UTC),
    ))
    # 6. 提交
    await self.session.commit()
    log.info("user.sessions_revoke_all", target_id=str(target_id), revoked_count=count, actor_id=str(self.actor_id))
    return count
```

### 4. router.py — DELETE /api/users/{user_id}/sessions/{session_id}

```python
@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: str,
    session_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> None:
    svc = UserService(session, actor_id=_user.id)
    await svc.revoke_session(uuid.UUID(user_id), uuid.UUID(session_id))
```

位置：放在 `list_user_sessions` 端点（GET `/users/{user_id}/sessions`）下方。

**注意**：FastAPI 路由匹配顺序——此 DELETE 端点必须在 `revoke-all` POST 端点之前声明，但因为 HTTP 方法不同（DELETE vs POST），路径冲突不会发生。安全的放置位置是在 `list_user_sessions` 之后、`list_user_audit` 之前。

### 5. router.py — POST /api/users/{user_id}/sessions/revoke-all

```python
@router.post("/users/{user_id}/sessions/revoke-all", response_model=RevokeAllResponse)
async def revoke_all_user_sessions(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> RevokeAllResponse:
    svc = UserService(session, actor_id=_user.id)
    count = await svc.revoke_all_sessions(uuid.UUID(user_id))
    return RevokeAllResponse(revoked_count=count)
```

位置：放在 `revoke_user_session` 端点下方。

需要在 router.py 顶部 import 中新增：
```python
from app.modules.settings.schema import (
    ...,  # 已有的
    RevokeAllResponse,  # 新增
)
```

### 控制流伪代码

```
revoke_session:
  GET AuthSession by session_id
  IF not found OR user_id mismatch OR already revoked → 404
  SET revoked_at = now
  INSERT AuditLog(action="user.session_revoke")
  COMMIT
  RETURN None (204)

revoke_all_sessions:
  COUNT active sessions for target_id
  IF count == 0 → RETURN 0 (不写审计日志)
  CALL _revoke_sessions(target_id)
  INSERT AuditLog(action="user.sessions_revoke_all")
  COMMIT
  RETURN count
```

## 边界处理（必填）

1. **session 不存在**：`revoke_session` 中 session_id 在 DB 中查不到 → 抛 `HTTPException(404, "Session not found")`
2. **session 不属于目标用户**：session 的 `user_id` 与路径参数 `target_id` 不匹配 → 抛 `HTTPException(404, "Session not found")`，不暴露 session 是否存在的信息
3. **session 已被撤销**：`revoked_at` 不为 None → 同样抛 404，幂等语义由调用方重试处理
4. **revoke-all 时无活跃会话**：`count == 0` → 直接返回 `{ "revoked_count": 0 }`，不写审计日志，不报错
5. **非法 UUID 格式**：路径参数 `user_id` 或 `session_id` 不是合法 UUID → 由 `uuid.UUID()` 构造函数抛 `ValueError`，FastAPI 自动转为 422，不需要手动处理
6. **权限控制**：两个新端点均使用 `AdminUser` 依赖（即 `require_platform_admin`），非管理员请求直接被拦截返回 403
7. **审计日志完整性**：撤销操作必须写入 AuditLog（action、resource_type、resource_id、details_json），`revoke_all_sessions` 的 details_json 包含 `revoked_count`
8. **不修改传入参数**：`target_id` 和 `session_id` 作为 `uuid.UUID` 不可变类型传入，方法内部不对其做修改

## 非目标（本任务不做的事）

- 不实现用户自行撤销自己的会话（仅管理员操作）
- 不修改 `list_sessions` 方法的查询逻辑或返回格式
- 不修改 `_revoke_sessions` 私有方法本身
- 不涉及前端代码（前端在 task-04/task-05 处理）
- 不新增 DB 列或 migration
- 不实现 WebSocket 推送通知被撤销的客户端
- 不处理 force_change_on_next_login（那是 task-02）
- 不实现 Workspace 查询（那是 task-03）

## 参考

- 审计日志模式：参考 `service.py` 中 `reset_password` 方法（第 247-260 行），同样的 `AuditLog` 手动插入模式
- 私有方法复用：`_revoke_sessions` 已在第 42-47 行定义，接受 `user_id` 参数，批量 UPDATE `revoked_at`
- 权限依赖：`AdminUser = Annotated[User, Depends(require_platform_admin)]`，在 router.py 第 37 行已定义
- 错误处理：`HTTPException` 从 `fastapi` 导入，404 用于资源不存在；`AppError` 体系用于权限等业务错误

## TDD 步骤

### 步骤 1：写测试（RED）

新建 `backend/tests/modules/settings/test_session_revoke.py`：

```python
"""Tests for session revoke endpoints."""
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Session as AuthSession, User
from app.modules.workflow.model import AuditLog


# --- revoke_session tests ---

async def test_revoke_session_success(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """正常撤销单个会话，返回 204。"""
    # 准备：创建一个用户和一个活跃 session
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    # ... 插入测试数据 ...
    response = await client.delete(
        f"/api/users/{user_id}/sessions/{session_id}",
        headers=admin_headers,
    )
    assert response.status_code == 204
    # 验证 DB 中 revoked_at 不为 None
    # 验证审计日志存在


async def test_revoke_session_not_found(client: AsyncClient, admin_headers: dict):
    """session_id 不存在 → 404。"""
    response = await client.delete(
        f"/api/users/{uuid.uuid4()}/sessions/{uuid.uuid4()}",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_revoke_session_wrong_user(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """session 属于其他用户 → 404。"""
    # 准备：user_A 拥有 session，但路径传 user_B
    response = await client.delete(
        f"/api/users/{user_b_id}/sessions/{session_of_a_id}",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_revoke_session_already_revoked(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """session 已被撤销 → 404。"""
    response = await client.delete(
        f"/api/users/{user_id}/sessions/{already_revoked_session_id}",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_revoke_session_audit_log(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """撤销成功后产生审计日志。"""
    # ... 执行撤销 ...
    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "user.session_revoke")
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].resource_id == user_id
    assert "session_id" in logs[0].details_json


# --- revoke_all_sessions tests ---

async def test_revoke_all_sessions_success(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """正常批量撤销，返回被撤销数量。"""
    response = await client.post(
        f"/api/users/{user_id}/sessions/revoke-all",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["revoked_count"] == expected_count


async def test_revoke_all_sessions_zero(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """用户无活跃会话 → 返回 { revoked_count: 0 }。"""
    response = await client.post(
        f"/api/users/{user_id}/sessions/revoke-all",
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["revoked_count"] == 0


async def test_revoke_all_sessions_audit_log(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """批量撤销后产生审计日志。"""
    # ... 执行批量撤销 ...
    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "user.sessions_revoke_all")
    )).scalars().all()
    assert len(logs) == 1
    assert "revoked_count" in logs[0].details_json


async def test_revoke_all_sessions_no_audit_when_zero(client: AsyncClient, admin_headers: dict, db: AsyncSession):
    """无活跃会话时不写审计日志。"""
    # ... 对无会话用户执行 ...
    logs = (await db.execute(
        select(AuditLog).where(AuditLog.action == "user.sessions_revoke_all")
    )).scalars().all()
    assert len(logs) == 0


async def test_revoke_session_requires_admin(client: AsyncClient, normal_user_headers: dict):
    """非管理员 → 403。"""
    response = await client.delete(
        f"/api/users/{uuid.uuid4()}/sessions/{uuid.uuid4()}",
        headers=normal_user_headers,
    )
    assert response.status_code == 403


async def test_revoke_all_requires_admin(client: AsyncClient, normal_user_headers: dict):
    """非管理员 → 403。"""
    response = await client.post(
        f"/api/users/{uuid.uuid4()}/sessions/revoke-all",
        headers=normal_user_headers,
    )
    assert response.status_code == 403
```

### 步骤 2：确认失败

运行 `pytest backend/tests/modules/settings/test_session_revoke.py`，所有测试应失败（端点尚未实现）。

### 步骤 3：写实现

按"修改文件"顺序实现：
1. `schema.py` — 新增 `RevokeAllResponse`
2. `service.py` — 新增 `revoke_session` + `revoke_all_sessions`
3. `router.py` — 新增 2 个端点 + 更新 import

### 步骤 4：确认通过

运行 `pytest backend/tests/modules/settings/test_session_revoke.py`，所有测试通过。

### 步骤 5：回归

运行 `pytest backend/tests/`，确保现有测试不因新增代码而失败。
运行 `ruff check backend/app/modules/settings/`，确保 lint 通过。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `DELETE /api/users/{user_id}/sessions/{session_id}` 对合法活跃会话调用 | 返回 HTTP 204，DB 中该 session 的 `revoked_at` 不为 None |
| AC-02 | `DELETE /api/users/{user_id}/sessions/{session_id}` 对不存在的 session_id 调用 | 返回 HTTP 404，detail 为 "Session not found" |
| AC-03 | `DELETE /api/users/{user_id}/sessions/{session_id}` 对属于其他用户的 session 调用 | 返回 HTTP 404，不暴露 session 存在信息 |
| AC-04 | `DELETE /api/users/{user_id}/sessions/{session_id}` 对已撤销的 session 调用 | 返回 HTTP 404 |
| AC-05 | `DELETE /api/users/{user_id}/sessions/{session_id}` 成功后检查 audit_logs 表 | 存在一条 `action="user.session_revoke"` 记录，`resource_id` 为 target user_id，`details_json` 包含 `session_id` |
| AC-06 | `POST /api/users/{user_id}/sessions/revoke-all` 对有活跃会话的用户调用 | 返回 HTTP 200，`revoked_count` 等于该用户活跃会话数，DB 中所有该用户 session 的 `revoked_at` 不为 None |
| AC-07 | `POST /api/users/{user_id}/sessions/revoke-all` 对无活跃会话的用户调用 | 返回 HTTP 200，`{ "revoked_count": 0 }` |
| AC-08 | `POST /api/users/{user_id}/sessions/revoke-all` 成功后检查 audit_logs 表 | 存在一条 `action="user.sessions_revoke_all"` 记录，`details_json` 包含 `revoked_count` |
| AC-09 | `POST /api/users/{user_id}/sessions/revoke-all` 对无活跃会话用户调用后检查 audit_logs | 无 `user.sessions_revoke_all` 记录（不写审计日志） |
| AC-10 | 非管理员调用 `DELETE .../sessions/{session_id}` | 返回 HTTP 403 |
| AC-11 | 非管理员调用 `POST .../sessions/revoke-all` | 返回 HTTP 403 |
| AC-12 | 非法 UUID 格式的路径参数 | 返回 HTTP 422 |
| AC-13 | `ruff check backend/app/modules/settings/` | 零错误零警告 |
| AC-14 | `pytest backend/tests/` 全量运行 | 所有测试通过，无回归 |
| AC-15 | `RevokeAllResponse` DTO 定义在 `schema.py` 中 | 包含且仅包含 `revoked_count: int` 字段 |
| AC-16 | 新增的两个端点路由顺序不会导致 FastAPI 路径冲突 | `revoke-all` 路径不会被 `{session_id}` 路径参数捕获（通过不同 HTTP 方法区分） |
