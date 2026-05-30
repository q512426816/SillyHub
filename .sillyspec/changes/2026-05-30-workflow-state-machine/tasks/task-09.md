---
id: task-09
title: "Audit hook 单元测试"
priority: P0
estimated_hours: 1.5
depends_on: [task-07, task-08]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/workflow/tests/test_audit_hooks.py
---

# task-09: Audit hook 单元测试

## 修改文件（必填）
- `backend/app/modules/workflow/tests/test_audit_hooks.py` — 新建

## 实现要求

### 背景

task-07 将在 `backend/app/core/audit_hooks.py` 中创建 SQLAlchemy event hook，通过 `after_insert` / `after_update` / `after_delete` 事件自动捕获模型变更并写入 `AuditLog`。本任务为该模块编写完整的单元测试。

### audit_hooks.py 预期行为（来自 design.md AD-1）

1. **after_insert**: 当任意非 AuditLog 模型实例被 insert 时，自动创建 AuditLog 记录：
   - `action` = `"{table_name}.insert"`
   - `resource_type` = `"{table_name}"`
   - `resource_id` = 实例的 `id`
   - `details_json` = JSON `{"fields": {字段名: 值, ...}}`
   - `actor_id` 和 `workspace_id` 从 `session.info["audit_context"]` 获取

2. **after_update**: 当任意非 AuditLog 模型实例被 update 时，自动创建 AuditLog 记录：
   - `action` = `"{table_name}.update"`
   - `details_json` = JSON `{"changed_fields": [...], "from": {...}, "to": {...}}`
   - 仅记录实际变更的字段

3. **after_delete**: 当任意非 AuditLog 模型实例被 delete 时，自动创建 AuditLog 记录：
   - `action` = `"{table_name}.delete"`

4. **递归保护**: AuditLog 自身的 insert/update/delete 不触发 hook，避免无限循环。

5. **无 context 静默跳过**: 如果 `session.info` 中没有 `audit_context`，hook 不写入 AuditLog，也不报错。

6. **context 传递**: `session.info["audit_context"]` 结构为 `{"actor_id": uuid.UUID, "workspace_id": uuid.UUID}`。

### 测试文件要求

- 创建 `backend/app/modules/workflow/tests/test_audit_hooks.py`
- 覆盖上述所有行为
- 使用 `db_session` fixture（来自 `backend/conftest.py`）
- 每个测试函数独立，不依赖执行顺序
- 使用 `Change` 模型作为测试载体（它在 workflow 模块中已有，结构简单）

## 接口定义

### 使用的 fixtures

全部复用 `backend/conftest.py`，不需要新建 fixture：

- `db_session: AsyncSession` — 内存 SQLite 的异步 session
- `db_engine` — 内存 SQLite 引擎（确保 schema 已创建）

### 辅助函数

```python
async def _make_change(session: AsyncSession, **overrides) -> Change:
    """创建并持久化一个 Change 实例，用于触发 after_insert hook。"""
    ws_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    defaults = dict(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test Change",
        status="draft",
        location="change",
        path=".sillyspec/changes/test",
    )
    defaults.update(overrides)
    change = Change(**defaults)
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _get_audit_logs(session: AsyncSession, **filters) -> list[AuditLog]:
    """查询 AuditLog 记录，支持按 resource_type / action 过滤。"""
    stmt = select(AuditLog).order_by(col(AuditLog.timestamp))
    for key, value in filters.items():
        stmt = stmt.where(col(getattr(AuditLog, key)) == value)
    result = await session.execute(stmt)
    return list(result.scalars().all())


def _set_audit_context(session: AsyncSession, actor_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
    """向 session.info 注入 audit_context。"""
    session.info["audit_context"] = {
        "actor_id": actor_id,
        "workspace_id": workspace_id,
    }


def _clear_audit_context(session: AsyncSession) -> None:
    """清除 session.info 中的 audit_context。"""
    session.info.pop("audit_context", None)
```

### 测试函数签名和伪代码

#### TC-01: `test_after_insert_creates_audit_log`

```python
async def test_after_insert_creates_audit_log(db_session: AsyncSession) -> None:
    """after_insert hook 应在 AuditLog 中创建记录。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 创建 Change 实例（触发 after_insert）
    change = await _make_change(db_session)

    # 3. 查询 AuditLog
    logs = await _get_audit_logs(db_session, resource_type="change", action="change.insert")
    assert len(logs) == 1
    log = logs[0]

    # 4. 断言字段
    assert log.resource_id == change.id
    assert log.actor_id == actor_id
    assert log.workspace_id == workspace_id
    assert log.details_json is not None
    details = json.loads(log.details_json)
    assert "fields" in details
    assert details["fields"]["status"] == "draft"
    assert log.timestamp is not None
```

#### TC-02: `test_after_update_creates_audit_log`

```python
async def test_after_update_creates_audit_log(db_session: AsyncSession) -> None:
    """after_update hook 应记录变更字段。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 创建 Change（这会触发 after_insert，先忽略该记录）
    change = await _make_change(db_session)

    # 3. 更新 Change.status
    change.status = "proposed"
    session.add(change)
    await session.commit()
    await session.refresh(change)

    # 4. 查询 update 类型的 AuditLog
    logs = await _get_audit_logs(db_session, action="change.update")
    assert len(logs) >= 1
    log = logs[-1]  # 取最后一条（如果有 insert 之后的多次 update）

    # 5. 断言变更字段
    assert log.resource_type == "change"
    assert log.resource_id == change.id
    assert log.actor_id == actor_id
    details = json.loads(log.details_json)
    assert "changed_fields" in details
    assert "status" in details["changed_fields"]
    assert details["from"]["status"] == "draft"
    assert details["to"]["status"] == "proposed"
```

#### TC-03: `test_after_delete_creates_audit_log`

```python
async def test_after_delete_creates_audit_log(db_session: AsyncSession) -> None:
    """after_delete hook 应记录删除操作。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 创建 Change
    change = await _make_change(db_session)

    # 3. 删除 Change
    await db_session.delete(change)
    await db_session.commit()

    # 4. 查询 delete 类型的 AuditLog
    logs = await _get_audit_logs(db_session, action="change.delete")
    assert len(logs) >= 1
    log = logs[-1]

    # 5. 断言
    assert log.resource_type == "change"
    assert log.resource_id == change.id
    assert log.actor_id == actor_id
    details = json.loads(log.details_json)
    # details 中应包含被删除记录的标识信息
    assert details is not None
```

#### TC-04: `test_audit_log_does_not_trigger_hook`

```python
async def test_audit_log_does_not_trigger_hook(db_session: AsyncSession) -> None:
    """AuditLog 自身的写入不应触发新的 hook（递归保护）。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 创建一个 Change（触发 after_insert → 产生一条 AuditLog）
    change = await _make_change(db_session)

    # 3. 查询所有 AuditLog
    all_logs = await _get_audit_logs(db_session)

    # 4. 断言：只有一条 change.insert 记录，没有 audit_logs.insert 记录
    change_logs = [l for l in all_logs if l.resource_type == "change"]
    audit_self_logs = [l for l in all_logs if l.resource_type == "audit_logs"]
    assert len(change_logs) >= 1
    assert len(audit_self_logs) == 0  # 递归保护：AuditLog 不触发 hook
```

#### TC-05: `test_no_audit_context_silent_skip`

```python
async def test_no_audit_context_silent_skip(db_session: AsyncSession) -> None:
    """没有 audit_context 时，hook 应静默跳过，不报错也不写入 AuditLog。"""
    # 1. 确保 session.info 中没有 audit_context
    _clear_audit_context(db_session)

    # 2. 创建 Change
    change = await _make_change(db_session)

    # 3. 查询 AuditLog
    all_logs = await _get_audit_logs(db_session)
    assert len(all_logs) == 0  # 没有 audit_context → 不写审计日志

    # 4. 确认没有抛出异常（Change 正常创建）
    assert change.id is not None
```

#### TC-06: `test_actor_id_and_workspace_id_recorded`

```python
async def test_actor_id_and_workspace_id_recorded(db_session: AsyncSession) -> None:
    """audit_context 中的 actor_id 和 workspace_id 应正确传递到 AuditLog。"""
    # 1. 准备两个不同的 actor
    actor_a = uuid.uuid4()
    actor_b = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

    # 2. actor_a 创建 change
    _set_audit_context(db_session, actor_a, workspace_id)
    change = await _make_change(db_session)
    change_id_a = change.id

    # 3. 清空 context，切换到 actor_b，更新同一个 change
    _set_audit_context(db_session, actor_b, workspace_id)
    change.status = "proposed"
    db_session.add(change)
    await db_session.commit()

    # 4. 查询所有 audit logs
    all_logs = await _get_audit_logs(db_session)
    insert_logs = [l for l in all_logs if l.action == "change.insert"]
    update_logs = [l for l in all_logs if l.action == "change.update"]

    # 5. 断言 actor
    assert len(insert_logs) >= 1
    assert insert_logs[0].actor_id == actor_a
    assert len(update_logs) >= 1
    assert update_logs[0].actor_id == actor_b

    # 6. 断言 workspace_id
    for log in all_logs:
        assert log.workspace_id == workspace_id
```

#### TC-07: `test_no_update_log_when_field_unchanged`

```python
async def test_no_update_log_when_field_unchanged(db_session: AsyncSession) -> None:
    """字段值未变时，commit 不应产生 after_update 审计记录。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 创建 Change
    change = await _make_change(db_session, title="Original Title")

    # 3. 记录当前 update 日志数量
    update_count_before = len(await _get_audit_logs(db_session, action="change.update"))

    # 4. 设置相同值并 commit（不应触发 after_update）
    change.title = "Original Title"
    db_session.add(change)
    await db_session.commit()

    # 5. 断言没有新的 update 审计记录
    update_count_after = len(await _get_audit_logs(db_session, action="change.update"))
    assert update_count_after == update_count_before
```

#### TC-08: `test_multiple_inserts_in_same_session`

```python
async def test_multiple_inserts_in_same_session(db_session: AsyncSession) -> None:
    """同一 session 中插入多个实例，每个都应产生独立的审计记录。"""
    # 1. 注入 audit_context
    actor_id = uuid.uuid4()
    workspace_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    _set_audit_context(db_session, actor_id, workspace_id)

    # 2. 连续创建 3 个 Change
    changes = []
    for i in range(3):
        change = await _make_change(db_session, change_key=f"test-{i}")
        changes.append(change)

    # 3. 查询所有 insert 审计记录
    logs = await _get_audit_logs(db_session, action="change.insert")
    assert len(logs) == 3

    # 4. 验证每个 change 都有对应记录
    logged_ids = {log.resource_id for log in logs}
    expected_ids = {c.id for c in changes}
    assert logged_ids == expected_ids
```

### 文件头部 import

```python
"""Unit tests for audit_hooks — SQLAlchemy event hook audit logging."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.model import Change
from app.modules.workflow.model import AuditLog
```

## 边界处理（至少 5 条）

1. **SQLite 兼容性**: 测试使用内存 SQLite（`sqlite+aiosqlite:///:memory:`）。SQLAlchemy event hook 在 SQLite 上与 Postgres 行为一致，但需确保测试中 `db_session` fixture 的 session 配置（`expire_on_commit=False`, `autoflush=False`）与生产一致。如果 hook 依赖 `session.flush()` 行为，需在测试中显式调用 `await session.commit()` 或 `await session.flush()`。

2. **递归保护**: AuditLog 写入不能触发新的 hook。测试 TC-04 明确验证：在触发 after_insert 后，查询 `resource_type == "audit_logs"` 的记录应为 0。如果 hook 实现中通过检查 `instance.__tablename__ == "audit_logs"` 来跳过，测试覆盖此路径。

3. **audit_context 注入方式**: 在测试中通过 `session.info["audit_context"] = {...}` 直接注入。这与生产代码中 `get_session` 注入方式一致（`session.info` 是 SQLAlchemy `Session` 的标准字典属性）。需注意：`db_session` fixture 每个测试函数独立创建，不会跨测试泄漏 context。

4. **多实例写入顺序**: TC-08 测试同一 session 中多次 insert。需验证 hook 在每次 insert 后都正确执行，且 AuditLog 记录的 `timestamp` 和 `resource_id` 各不相同。如果 event hook 在批量 `session.add()` + 单次 `commit()` 场景下行为不同，也需覆盖。

5. **字段值未变更**: TC-07 测试将字段设为相同值后 commit。SQLAlchemy 的 `after_update` 只在属性被标记为 dirty 时触发。如果 ORM 层面认为值未变（`get_history` 返回空），则 `after_update` 不应触发。测试需覆盖此场景，防止无意义的审计记录。

6. **测试清理**: `db_session` fixture 每个测试函数独立，测试结束自动 dispose。AuditLog 和 Change 记录随 session 关闭而清除。无需手动清理。但如果测试中需要在同一函数内多次验证 AuditLog 数量，需注意 `await session.commit()` 后 AuditLog 可能还在 session identity map 中，查询前应 `await session.expire_all()` 或使用新查询。

7. **details_json 解析**: 所有涉及 `details_json` 的断言都应使用 `json.loads()` 解析后再验证，不应直接做字符串比较。`details_json` 的具体结构由 task-07 定义，本测试按照 design.md 中的格式验证。

## 非目标
- 不测试 bulk insert 场景（`session.execute(insert(...))` 不触发 ORM event）
- 不测试性能（大量审计记录的查询性能）
- 不测试跨事务场景（session 关闭后重新打开）
- 不测试 `after_update` 在 `session.execute(update(...))` 时的行为（Core level update 不触发 ORM event）
- 不实现 `audit_hooks.py`（由 task-07 负责）

## 参考
- 现有测试模式：`backend/app/modules/workflow/tests/test_spec_guardian.py` — 同样使用 `db_session` fixture + 辅助函数模式
- 现有测试模式：`backend/app/modules/workflow/tests/test_fsm.py` — 纯单元测试，不依赖 DB
- conftest.py fixtures：`db_engine`, `db_session`, `client`, `auth_admin_token`
- design.md 审计日志格式：AD-1 决策 + AuditLog 自动记录格式表
- AuditLog 模型：`backend/app/modules/workflow/model.py`
- Change 模型：`backend/app/modules/change/model.py`

## TDD 步骤

1. **编写所有测试**: 创建 `test_audit_hooks.py`，编写 TC-01 到 TC-08 全部测试函数
2. **确认测试失败**: 由于 `audit_hooks.py` 尚未实现（task-07），预期所有测试的行为如下：
   - TC-01/02/03: `AuditLog` 表中无记录 → `assert len(logs) == ...` 失败
   - TC-04: 无记录 → `assert len(change_logs) >= 1` 失败
   - TC-05: 无记录 → `assert len(all_logs) == 0` **可能意外通过**（因为 hook 未注册，确实不会写入）
   - TC-06/07/08: 依赖 TC-01 的行为
   - 使用 `pytest` 运行确认 collect 成功
3. **（task-07 实现后）确认测试通过**: `audit_hooks.py` 实现并注册 event 后，全部测试应通过
4. **修复测试环境问题**: 如果 SQLite 与 event hook 存在兼容性问题（如 `after_update` 触发条件），调整测试断言

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `pytest --collect-only backend/app/modules/workflow/tests/test_audit_hooks.py` | 显示 `8 collected` |
| AC-02 | `test_after_insert_creates_audit_log` 运行 | AuditLog 记录的 `action == "change.insert"`，`resource_id` 匹配，`details_json.fields` 包含 `status: "draft"` |
| AC-03 | `test_after_update_creates_audit_log` 运行 | AuditLog 记录的 `changed_fields` 包含 `"status"`，`from.status == "draft"`，`to.status == "proposed"` |
| AC-04 | `test_after_delete_creates_audit_log` 运行 | AuditLog 记录的 `action == "change.delete"`，`resource_id` 匹配被删除 Change 的 id |
| AC-05 | `test_audit_log_does_not_trigger_hook` 运行 | `resource_type == "audit_logs"` 的 AuditLog 记录数为 0 |
| AC-06 | `test_no_audit_context_silent_skip` 运行 | AuditLog 总数为 0，Change 正常创建不报错 |
| AC-07 | `test_actor_id_and_workspace_id_recorded` 运行 | insert 日志的 `actor_id == actor_a`，update 日志的 `actor_id == actor_b`，所有日志 `workspace_id` 正确 |
| AC-08 | `test_no_update_log_when_field_unchanged` 运行 | update 审计记录数未增加 |
| AC-09 | `test_multiple_inserts_in_same_session` 运行 | 恰好 3 条 insert 记录，`resource_id` 集合匹配 |
| AC-10 | `pytest backend/` 全量运行 | 540+ 测试通过（新增 8 个测试后应为 548+） |
