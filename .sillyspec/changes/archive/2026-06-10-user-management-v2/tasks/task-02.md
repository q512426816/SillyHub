---
id: task-02
title: 密码重置审计标记增强（后端）
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-04]
allowed_paths:
  - backend/app/modules/settings/service.py
  - backend/app/modules/settings/schema.py
author: WhaleFall
created_at: "2026-06-10T11:45:44"
---

# task-02: 密码重置审计标记增强（后端）

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `backend/app/modules/settings/schema.py` | `ResetPasswordRequest` 新增可选字段 `force_change_on_next_login: bool = False` |
| 修改 | `backend/app/modules/settings/service.py` | `reset_password` 方法签名新增 `force_change_on_next_login` 参数，审计日志 `details_json` 包含此标记 |

> 注意：`router.py` 中调用 `svc.reset_password` 的地方也需要传参 `force_change_on_next_login=payload.force_change_on_next_login`，但 router.py 不在本任务 allowed_paths 内，由 task-04 或手动补充。本任务只需要确保 service 层和 schema 层改动完成后，**现有调用不传新参数时行为完全不变**（因为默认值 `False`）。

## 实现要求

1. **schema.py**：在 `ResetPasswordRequest` 类中新增可选字段：
   ```python
   force_change_on_next_login: bool = False
   ```

2. **service.py**：扩展 `reset_password` 方法签名，新增 `force_change_on_next_login: bool = False` 参数。将该参数的值写入审计日志的 `details_json` 中。

3. **兼容性**：新参数有默认值 `False`，现有调用方（router.py 中只传 `target_id` 和 `new_password`）无需任何改动即可正常工作。

## 接口定义（代码类任务必填）

### 1. schema.py — ResetPasswordRequest DTO 扩展

```python
# 文件: backend/app/modules/settings/schema.py
# 修改现有类 ResetPasswordRequest

class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
    force_change_on_next_login: bool = False  # 新增字段
```

### 2. service.py — reset_password 方法签名扩展

```python
# 文件: backend/app/modules/settings/service.py
# 修改现有方法 reset_password

async def reset_password(
    self,
    target_id: uuid.UUID,
    new_password: str,
    force_change_on_next_login: bool = False,  # 新增参数
) -> None:
```

### 3. service.py — reset_password 方法内部控制流伪代码

```
async def reset_password(self, target_id, new_password, force_change_on_next_login=False):
    target = await self.session.get(User, target_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(404, "User not found")

    self._set_audit_context()
    target.password_hash = password_hasher.hash(new_password)
    target.updated_at = datetime.now(UTC)
    self.session.add(target)

    await self._revoke_sessions(target_id)

    # 审计日志 — details_json 新增 force_change_on_next_login 字段
    details = {
        "reset_by": str(self.actor_id),
        "force_change_on_next_login": force_change_on_next_login,
    }
    self.session.add(
        AuditLog(
            id=uuid.uuid4(),
            workspace_id=None,
            actor_id=self.actor_id,
            action="user.password_reset",
            resource_type="user",
            resource_id=target_id,
            details_json=json.dumps(details, default=str, ensure_ascii=False),
            timestamp=datetime.now(UTC),
        )
    )

    await self.session.commit()
    log.info("user.password_reset", ...)
```

### 4. router.py 调用侧（参考，非本任务 allowed_paths）

```python
# 仅作为参考，展示调用方如何传递新参数
# 当前代码：
await svc.reset_password(uuid.UUID(user_id), payload.new_password)
# 改为：
await svc.reset_password(
    uuid.UUID(user_id),
    payload.new_password,
    force_change_on_next_login=payload.force_change_on_next_login,
)
```

## 边界处理（必填）

1. **null/空值行为**：`force_change_on_next_login` 是 `bool` 类型 Pydantic 字段，默认 `False`。前端不传该字段时 Pydantic 自动赋 `False`，不会出现 `None`。无需额外 null 校验。

2. **兼容旧行为（brownfield）**：现有调用方不传 `force_change_on_next_login` 参数，Python 函数签名默认值 `False`，行为与改动前完全一致。`details_json` 仅多了一个 `"force_change_on_next_login": false` 键值对，不影响已有审计日志解析逻辑。

3. **异常不静默吞掉**：方法内已有 `target is None or target.deleted_at is not None` 时抛 `HTTPException(404)`。`password_hasher.hash` 和 `json.dumps` 如果抛异常会自然向上传播，不做 catch。

4. **不修改传入参数**：`force_change_on_next_login` 是 bool 不可变类型，直接使用，无修改风险。`new_password` 仅用于 `password_hasher.hash()` 调用，原值不被修改。

5. **歧义/冲突场景**：`force_change_on_next_login` 仅作为审计标记写入 `details_json`，不做任何持久化或业务逻辑判断（如设计文档明确声明"不做 force_change_on_next_login 持久化"），因此不存在与其他字段的冲突。

6. **JSON 序列化安全**：`details` 字典中所有值均为 `str` 或 `bool`，`json.dumps` 不会抛类型错误。保留 `default=str, ensure_ascii=False` 与现有一致。

## 非目标（本任务不做的事）

- 不做 `force_change_on_next_login` 的数据库持久化（不加 DB 列、不加 User model 字段）
- 不做登录时强制改密检查逻辑
- 不修改 `router.py`（不在 allowed_paths 内）
- 不修改前端代码
- 不修改审计日志查询/展示逻辑
- 不修改 `_revoke_sessions` 等其他方法

## 参考

- 现有 `reset_password` 方法：`backend/app/modules/settings/service.py:232-263`
- 现有 `ResetPasswordRequest` DTO：`backend/app/modules/settings/schema.py:98-99`
- AuditLog model：`backend/app/modules/workflow/model.py:46`
- 设计文档决策 3：密码重置增强

## TDD 步骤

### Step 1: 写测试

在 `backend/tests/modules/settings/` 下新建 `test_password_reset.py`：

```python
"""Tests for password reset audit enhancement (task-02)."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.workflow.model import AuditLog


async def _create_target_user(session: AsyncSession) -> User:
    """Helper: create a normal active user for password reset tests."""
    user = User(
        id=uuid.uuid4(),
        email=f"target-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("OldPassword123!"),
        display_name="Target User",
        status="active",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _get_latest_audit_log(
    session: AsyncSession, resource_id: uuid.UUID
) -> AuditLog | None:
    stmt = (
        select(AuditLog)
        .where(AuditLog.resource_id == resource_id, AuditLog.action == "user.password_reset")
        .order_by(AuditLog.timestamp.desc())
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalars().first()


# ── Test 1: force_change_on_next_login=True 写入审计日志 ──


async def test_reset_password_force_change_true_in_audit(db_session: AsyncSession) -> None:
    """When force_change_on_next_login=True, details_json must contain it."""
    from app.modules.settings.service import UserService

    target = await _create_target_user(db_session)
    actor_id = uuid.uuid4()
    svc = UserService(db_session, actor_id=actor_id)

    await svc.reset_password(
        target.id, "NewPassword456!", force_change_on_next_login=True
    )

    log_entry = await _get_latest_audit_log(db_session, target.id)
    assert log_entry is not None
    details = json.loads(log_entry.details_json)
    assert details["force_change_on_next_login"] is True
    assert details["reset_by"] == str(actor_id)


# ── Test 2: 默认值 False 写入审计日志 ──


async def test_reset_password_force_change_default_false(db_session: AsyncSession) -> None:
    """When force_change_on_next_login is not passed, details_json has false."""
    from app.modules.settings.service import UserService

    target = await _create_target_user(db_session)
    actor_id = uuid.uuid4()
    svc = UserService(db_session, actor_id=actor_id)

    await svc.reset_password(target.id, "NewPassword456!")

    log_entry = await _get_latest_audit_log(db_session, target.id)
    assert log_entry is not None
    details = json.loads(log_entry.details_json)
    assert details["force_change_on_next_login"] is False


# ── Test 3: 显式传 False 也写入 ──


async def test_reset_password_force_change_explicit_false(db_session: AsyncSession) -> None:
    """Explicitly passing False should also be recorded."""
    from app.modules.settings.service import UserService

    target = await _create_target_user(db_session)
    actor_id = uuid.uuid4()
    svc = UserService(db_session, actor_id=actor_id)

    await svc.reset_password(
        target.id, "NewPassword456!", force_change_on_next_login=False
    )

    log_entry = await _get_latest_audit_log(db_session, target.id)
    assert log_entry is not None
    details = json.loads(log_entry.details_json)
    assert details["force_change_on_next_login"] is False


# ── Test 4: ResetPasswordRequest DTO 默认值 ──


def test_reset_password_request_dto_default() -> None:
    """ResetPasswordRequest defaults force_change_on_next_login to False."""
    from app.modules.settings.schema import ResetPasswordRequest

    req = ResetPasswordRequest(new_password="TestPass123!")
    assert req.force_change_on_next_login is False


# ── Test 5: ResetPasswordRequest DTO 显式传 True ──


def test_reset_password_request_dto_explicit_true() -> None:
    """ResetPasswordRequest accepts force_change_on_next_login=True."""
    from app.modules.settings.schema import ResetPasswordRequest

    req = ResetPasswordRequest(new_password="TestPass123!", force_change_on_next_login=True)
    assert req.force_change_on_next_login is True


# ── Test 6: 旧调用方式不受影响（向后兼容） ──


async def test_reset_password_backward_compatible(db_session: AsyncSession) -> None:
    """Calling reset_password without force_change_on_next_login still works."""
    from app.modules.settings.service import UserService

    target = await _create_target_user(db_session)
    svc = UserService(db_session, actor_id=uuid.uuid4())

    # 不传第三个参数，行为与改动前一致
    await svc.reset_password(target.id, "NewPassword456!")

    await db_session.refresh(target)
    assert password_hasher.verify("NewPassword456!", target.password_hash)
```

### Step 2: 确认失败

运行 `pytest backend/tests/modules/settings/test_password_reset.py -v`，预期：
- Test 4, 5 失败（`ResetPasswordRequest` 没有 `force_change_on_next_login` 属性）
- Test 1, 2, 3, 6 失败（`reset_password` 不接受 `force_change_on_next_login` 关键字参数）

### Step 3: 写代码

1. 修改 `schema.py`：在 `ResetPasswordRequest` 新增 `force_change_on_next_login: bool = False`
2. 修改 `service.py`：扩展 `reset_password` 签名，`details_json` 包含新字段

### Step 4: 确认通过

运行 `pytest backend/tests/modules/settings/test_password_reset.py -v`，全部 6 个测试通过。

### Step 5: 回归

运行 `pytest backend/ -v --timeout=60`，确认无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | 修改 `ResetPasswordRequest`，新增 `force_change_on_next_login: bool = False` 字段 | Pydantic model 可实例化，不传该字段时默认为 `False`，传 `True` 时为 `True` |
| AC-02 | 修改 `reset_password` 方法签名，新增 `force_change_on_next_login: bool = False` 参数 | 方法签名包含新参数且有默认值，现有调用（不传该参数）不报错 |
| AC-03 | 调用 `reset_password(..., force_change_on_next_login=True)` 后查询 AuditLog | 生成的审计日志 `details_json` 中 `"force_change_on_next_login": true` |
| AC-04 | 调用 `reset_password(target_id, new_password)` 不传新参数后查询 AuditLog | 生成的审计日志 `details_json` 中 `"force_change_on_next_login": false` |
| AC-05 | 运行 `pytest backend/tests/modules/settings/test_password_reset.py` | 全部 6 个测试通过 |
| AC-06 | 运行 `pytest backend/ -v` 全量回归 | 无新增失败测试 |
| AC-07 | `ruff check backend/app/modules/settings/service.py backend/app/modules/settings/schema.py` | 零 lint 错误 |
| AC-08 | 审计日志 `details_json` 仍包含原有 `reset_by` 字段 | `"reset_by"` 键值对不受影响 |
