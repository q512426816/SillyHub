---
id: task-07
title: "新建 core/audit_hooks.py — SQLAlchemy event hook"
priority: P0
estimated_hours: 2
depends_on: [task-02]
blocks: [task-08, task-09]
allowed_paths:
  - backend/app/core/audit_hooks.py
---

# task-07: 新建 core/audit_hooks.py — SQLAlchemy event hook

## 修改文件（必填）

| 操作 | 文件路径 |
|------|----------|
| 新建 | `backend/app/core/audit_hooks.py` |

不修改任何现有文件。`db.py` 的修改由 task-08 负责。

## 实现要求

1. 创建 `backend/app/core/audit_hooks.py`，包含完整的审计日志自动捕获逻辑
2. 使用 SQLAlchemy `after_insert` / `after_update` / `after_delete` 事件自动捕获所有 BaseModel 子类（`table=True`）的数据变更
3. 通过 `session.info["audit_context"]` 获取上下文（`actor_id`, `workspace_id`）
4. 排除 `AuditLog` 自身（递归保护），通过 `__tablename__` 判断
5. 自动将变更记录写入 `AuditLog` 表（同事务内）
6. `after_update` 需要对比 `inspect(obj).attrs` 检测实际变更字段，只记录真正变更的字段

## 接口定义（代码类任务必填）

### AuditContext 数据结构

```python
# 通过 session.info["audit_context"] 传入
# 这是一个普通 dict，不需要额外的 dataclass
{
    "actor_id": uuid.UUID,       # 必填：当前操作用户 ID
    "workspace_id": uuid.UUID,   # 可选：当前工作区 ID
}
```

### 模块公开函数

```python
def register_audit_hooks(engine: AsyncEngine) -> None:
    """注册 SQLAlchemy event hook 到指定 engine。

    在应用启动时调用一次，例如在 main.py 的 lifespan 中：
        from app.core.audit_hooks import register_audit_hooks
        register_audit_hooks(engine)

    Args:
        engine: AsyncEngine 实例，通常来自 get_engine()
    """
```

### 内部 helper 函数

```python
def _get_audit_context(session: AsyncSession) -> dict | None:
    """从 session.info 中获取 audit_context。

    Returns:
        dict with "actor_id" and optional "workspace_id", or None
    """

def _should_audit(mapper: Mapper, instance: object) -> bool:
    """判断是否需要审计此对象。

    排除条件：
    - instance 不是 BaseModel 子类
    - instance.__tablename__ == "audit_logs"（递归保护）
    - mapper.mapped_table 是 abstract

    Returns:
        True if should audit
    """

def _build_action(table_name: str, event_type: str) -> str:
    """构建 action 字符串。

    例: _build_action("changes", "insert") -> "change.insert"
        注意: 表名是复数，action 中用单数（去掉尾部 s）
        特殊: "audit_logs" -> "audit_log"（但已被排除）

    Returns:
        "{singular_table_name}.{event_type}"
    """

def _get_resource_id(instance: object) -> uuid.UUID:
    """从 instance 中获取主键 ID。

    所有 BaseModel table=True 的模型都有 id 字段（uuid.UUID）。

    Returns:
        instance.id
    """

def _serialize_value(val: Any) -> Any:
    """将字段值序列化为 JSON 安全格式。

    处理: uuid -> str, datetime -> ISO 8601 str, 其他保持原样
    """
```

### Hook 函数签名

```python
async def _after_insert(mapper: Mapper, connection: AsyncConnection, target: BaseModel) -> None:
    """after_insert 事件处理器。

    控制流：
    1. if not _should_audit(mapper, target): return
    2. 从 connection.get_session() 或 session.info 获取 audit_context
       注意：SQLAlchemy async event 中使用 connection，不是 session
       需要通过 connection.info 获取 audit_context（session.info 会在 sync 事件中传递）
    3. if audit_context is None: return（静默跳过系统操作）
    4. 构建 AuditLog 记录：
       - action = _build_action(table_name, "insert")
       - resource_type = singular table name
       - resource_id = _get_resource_id(target)
       - details_json = JSON.dumps({"fields": {field: _serialize_value(val) for field, val in 当前值}})
       - workspace_id = audit_context.get("workspace_id")
       - actor_id = audit_context["actor_id"]
    5. 通过 connection.execute(insert(AuditLog.__table__, values)) 写入
       注意：使用 Core insert，不是 ORM add，避免触发新的 flush/event
    """

async def _after_update(mapper: Mapper, connection: AsyncConnection, target: BaseModel) -> None:
    """after_update 事件处理器。

    控制流：
    1. if not _should_audit(mapper, target): return
    2. 获取 audit_context，if None: return
    3. 检测实际变更字段（关键步骤）：
       from sqlalchemy import inspect
       state = inspect(target)
       changed_fields = {}
       for attr in state.attrs:
           history = attr.load_history()
           # history.added / history.deleted / history.unchanged
           if history.has_changes():
               changed_fields[attr.key] = {
                   "from": _serialize_value(history.deleted[0] if history.deleted else None),
                   "to": _serialize_value(history.added[0] if history.added else None),
               }
       if not changed_fields: return  # 无实际变更，不记录
    4. 构建 AuditLog 记录：
       - action = _build_action(table_name, "update")
       - resource_type = singular table name
       - resource_id = _get_resource_id(target)
       - details_json = JSON.dumps({"changed_fields": changed_fields})
       - workspace_id / actor_id 从 audit_context 获取
    5. 通过 connection.execute(insert(...)) 写入
    """

async def _after_delete(mapper: Mapper, connection: AsyncConnection, target: BaseModel) -> None:
    """after_delete 事件处理器。

    控制流：
    1. if not _should_audit(mapper, target): return
    2. 获取 audit_context，if None: return
    3. 构建 AuditLog 记录：
       - action = _build_action(table_name, "delete")
       - resource_type = singular table name
       - resource_id = _get_resource_id(target)
       - details_json = JSON.dumps({"deleted": True})
       - workspace_id / actor_id 从 audit_context 获取
    4. 通过 connection.execute(insert(...)) 写入
    """
```

### register_audit_hooks 完整伪代码

```python
def register_audit_hooks(engine: AsyncEngine) -> None:
    from sqlalchemy import event
    from app.models.base import BaseModel

    # 使用 listen 而非 @event.listens_for，因为我们需要在运行时动态注册
    # SQLAlchemy 的 Mapper 事件是针对 mapper 的，不是 engine
    # 正确做法：监听 Mapper 事件，对所有 BaseModel 子类的 mapper 生效

    # 方案：使用 SQLAlchemy 的 MapperEvent.dispatch
    # 在 mapper_configured 事件中为每个 BaseModel 子类注册 hook
    # 或使用 session_event 方式

    # 推荐方案：使用 SQLAlchemy 的 Mapper 级别事件
    from sqlalchemy.orm import Session

    # 为 after_insert / after_update / after_delete 注册全局 listener
    # 这些 listener 会匹配所有映射类
    @event.listens_for(Session, "after_flush")
    def _audit_after_flush(session, flush_context):
        """在 flush 后检查所有新/脏/删除对象。"""
        for instance in session.new:
            _process_instance(session, instance, "insert")
        for instance in session.dirty:
            if session.is_modified(instance):
                _process_instance(session, instance, "update")
        for instance in session.deleted:
            _process_instance(session, instance, "delete")

    # 注意：上述方案适用于同步 Session
    # 对于 AsyncSession，需要使用 after_flush_postexec 或 connection 级别事件
    # 本项目使用 AsyncSession，因此实际实现需要调整
```

### 最终推荐方案（AsyncSession 兼容）

```python
"""
由于本项目使用 AsyncSession，推荐使用 Mapper 级别的 after_insert/after_update/after_delete 事件。
这些事件在 flush 过程中触发，接收 connection 参数，可以直接在同一个事务中插入 AuditLog。

但注意：Mapper 级别的 after_insert/after_update/after_delete 在 async 模式下是同步调用的。
SQLAlchemy async 模式会在 sync wrapper 中调用这些 hook。
因此 hook 函数必须是同步函数，使用 connection.execute()（同步 Core API）。

关键点：
1. hook 函数必须是同步函数（不是 async def）
2. 使用 connection.execute() 的同步版本（不在 async session 中）
3. 在 flush 事务内，所以可以直接写入 AuditLog
"""

def register_audit_hooks(engine: AsyncEngine) -> None:
    """注册审计 hook。

    实现策略：
    1. 遍历 BaseModel 的所有子类（table=True）
    2. 为每个子类的 mapper 注册 after_insert/after_update/after_delete
    3. 使用 SQLAlchemy event.listen() 注册

    注意：需要在所有 model import 完成后调用（即 mappers 配置完成后）
    可以在 mapper_configured 事件中延迟注册，或在应用启动时显式调用。
    """
```

### 最简实现方案

```python
"""
最终方案：使用 connection 级别的 after_insert / after_update / after_delete 事件。

SQLAlchemy 的 Mapper 事件在 sync context 中执行，即使在 async session 中也是如此。
这意味着 hook 函数使用 def 而不是 async def，使用同步 connection API。

注册方式：
    from sqlalchemy import event
    for mapper_class in BaseModel.__subclasses__():
        if hasattr(mapper_class, '__tablename__'):
            event.listen(mapper_class, 'after_insert', _after_insert_hook)
            event.listen(mapper_class, 'after_update', _after_update_hook)
            event.listen(mapper_class, 'after_delete', _after_delete_hook)

问题：__subclasses__() 只返回直接子类，不会递归。
解决：使用递归函数收集所有后代类。

替代方案（更简单，推荐）：
    使用 @event.listens_for(BaseModel, 'after_insert', propagate=True)
    但 SQLModel/SQLAlchemy 的 propagate 对继承的支持有限。

最稳妥方案：
    在 register_audit_hooks 中，使用 SQLModel.metadata.tables 遍历所有表，
    找到对应的 mapper，然后注册事件。
    或者更简单：使用 after_flush PostCommit hook。

推荐最终方案：
    使用 Session.after_flush 事件（同步 hook）。
    在 after_flush 中遍历 session.new / session.dirty / session.deleted，
    对每个 instance 判断是否需要审计。
"""
```

### 确定实现方案（搬砖工按此实现）

```python
"""
最终确定方案：使用 Mapper 级别的 after_insert / after_update / after_delete。

理由：
- 本项目使用 SQLModel，Mapper 事件是标准的 SQLAlchemy 事件
- after_flush 方案需要处理 session.new/dirty/deleted 的生命周期
- Mapper 级别事件更精确，只在真正 flush 成功后触发
- 同步函数 + connection 参数，在 async 环境中可安全使用

实现步骤：
1. 定义同步 hook 函数（def，不是 async def）
2. 在 register_audit_hooks 中，遍历所有需要审计的表
3. 使用 event.listen() 注册
"""
```

## 完整实现骨架（搬砖工照着做）

```python
"""backend/app/core/audit_hooks.py

SQLAlchemy event hooks for automatic audit logging.
Captures all BaseModel(table=True) mutations and writes to AuditLog.

Design reference: .sillyspec/changes/2026-05-30-workflow-state-machine/design.md AD-1
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncEngine


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_EXCLUDED_TABLES: frozenset[str] = frozenset({"audit_logs"})
"""Tables that should NOT trigger audit hooks (recursion protection)."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _should_audit(instance: object) -> bool:
    """Return True if this instance should be audited.

    Excludes:
    - Non-BaseModel instances (unlikely but defensive)
    - AuditLog itself (recursion protection)
    - Instances without __tablename__ (schema-only models)
    """
    # Check __tablename__ exists and is not excluded
    table_name = getattr(instance, "__tablename__", None)
    if table_name is None:
        return False
    if table_name in _EXCLUDED_TABLES:
        return False
    return True


def _singularize(table_name: str) -> str:
    """Convert plural table name to singular for action/resource_type.

    Simple heuristic: remove trailing 's' if present.
    Examples: changes -> change, users -> user, audit_logs -> audit_log
    """
    if table_name.endswith("ses"):
        return table_name[:-2]  # addresses -> address (approximate)
    if table_name.endswith("s"):
        return table_name[:-1]
    return table_name


def _serialize_value(val: Any) -> Any:
    """Serialize a field value to JSON-safe format."""
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _get_resource_id(instance: object) -> uuid.UUID:
    """Get the primary key ID from an instance."""
    return instance.id


def _get_audit_context(connection_or_session: Any) -> dict | None:
    """Extract audit_context from connection.info or session.info.

    In SQLAlchemy Mapper events, the second argument is a Connection.
    Connection.info is a dict that persists for the lifecycle of the connection.
    When using AsyncSession, session.info is propagated to connection.info
    during a flush.
    """
    info = getattr(connection_or_session, "info", None)
    if info is None:
        return None
    return info.get("audit_context")


def _collect_all_fields(instance: object) -> dict[str, Any]:
    """Collect all column field values from an instance as a dict."""
    mapper = inspect(instance.__class__)
    result = {}
    for col in mapper.columns:
        key = col.key
        if hasattr(instance, key):
            result[key] = _serialize_value(getattr(instance, key))
    return result


def _collect_changed_fields(instance: object) -> dict[str, dict[str, Any]]:
    """Collect only changed fields with old/new values.

    Returns:
        {"field_name": {"from": old_val, "to": new_val}, ...}
        Empty dict if no actual changes.
    """
    state = inspect(instance)
    changed = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        history = state.get_history(key, passive=True)
        # history is a History tuple: (added, unchanged, deleted)
        if history.added or history.deleted:
            # has changes
            old_val = history.deleted[0] if history.deleted else None
            new_val = history.added[0] if history.added else None
            if old_val != new_val:  # extra safety: skip no-op changes
                changed[key] = {
                    "from": _serialize_value(old_val),
                    "to": _serialize_value(new_val),
                }
    return changed


def _write_audit_log(
    connection: Any,
    *,
    actor_id: uuid.UUID | None,
    workspace_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    details_json: str | None,
) -> None:
    """Insert an AuditLog record using Core SQL (avoids triggering new ORM events).

    This uses connection.execute(table.insert(), values) which is a Core-level
    operation and does NOT trigger Mapper events (no recursion risk from here,
    but we still exclude audit_logs in _should_audit for belt-and-suspenders).
    """
    from app.modules.workflow.model import AuditLog

    now = datetime.now(timezone.utc)
    log_id = uuid.uuid4()

    connection.execute(
        AuditLog.__table__.insert(),
        {
            "id": log_id,
            "workspace_id": workspace_id,
            "actor_id": actor_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details_json": details_json,
            "timestamp": now,
        },
    )


# ---------------------------------------------------------------------------
# Hook functions (synchronous — SQLAlchemy Mapper events are sync even in async mode)
# ---------------------------------------------------------------------------

def _after_insert_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_insert event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection)
    if ctx is None:
        return

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.insert"

    fields = _collect_all_fields(target)
    details_json = json.dumps({"fields": fields}, default=str, ensure_ascii=False)

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


def _after_update_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_update event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection)
    if ctx is None:
        return

    changed_fields = _collect_changed_fields(target)
    if not changed_fields:
        return  # No actual field changes

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.update"

    details_json = json.dumps({"changed_fields": changed_fields}, default=str, ensure_ascii=False)

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


def _after_delete_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_delete event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection)
    if ctx is None:
        return

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.delete"

    details_json = json.dumps({"deleted": True}, default=str, ensure_ascii=False)

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def register_audit_hooks(engine: AsyncEngine) -> None:
    """Register SQLAlchemy audit event hooks for all BaseModel table models.

    Must be called AFTER all models have been imported and mappers configured.
    Typical call site: app/main.py lifespan, after engine creation.

    Usage:
        from app.core.audit_hooks import register_audit_hooks
        from app.core.db import get_engine

        engine = get_engine()
        register_audit_hooks(engine)

    Implementation notes:
    - Iterates all tables in BaseModel.metadata
    - For each table, finds the corresponding mapper class
    - Registers after_insert / after_update / after_delete listeners
    - Excludes tables in _EXCLUDED_TABLES (e.g., audit_logs)
    """
    from app.models.base import BaseModel

    registered: list[str] = []

    # Collect all mapper classes that inherit from BaseModel and have __tablename__
    def _collect_subclasses(cls: type) -> list[type]:
        """Recursively collect all subclasses."""
        result = []
        for sub in cls.__subclasses__():
            result.append(sub)
            result.extend(_collect_subclasses(sub))
        return result

    all_subclasses = _collect_subclasses(BaseModel)

    for cls in all_subclasses:
        table_name = getattr(cls, "__tablename__", None)
        if table_name is None:
            continue  # Schema-only model, skip
        if table_name in _EXCLUDED_TABLES:
            continue  # Recursion protection

        # Register Mapper-level events
        event.listen(cls, "after_insert", _after_insert_hook)
        event.listen(cls, "after_update", _after_update_hook)
        event.listen(cls, "after_delete", _after_delete_hook)

        registered.append(table_name)

    # Log registration (optional, helps debugging)
    import logging
    logger = logging.getLogger("audit_hooks")
    logger.info("Audit hooks registered for %d tables: %s", len(registered), registered)
```

## 边界处理（必填，至少 5 条）

1. **AuditLog 自身不触发 hook（递归保护）**
   - 通过 `_EXCLUDED_TABLES = frozenset({"audit_logs"})` 排除
   - `_should_audit()` 检查 `__tablename__` 是否在排除集合中
   - 额外保险：`_write_audit_log()` 使用 Core `connection.execute(table.insert(), ...)` 而不是 ORM `session.add()`，Core 操作不触发 Mapper 事件

2. **session.info / connection.info 中无 audit_context 时不记录**
   - `_get_audit_context()` 返回 None 时，hook 直接 return
   - 这是系统操作（如 migration、后台任务）的默认行为
   - 不抛异常、不打印 warning

3. **after_update 中检测实际变更字段**
   - 使用 `inspect(target).get_history(key, passive=True)` 检查每个字段
   - 只有 `history.added` 或 `history.deleted` 非空时才认为有变更
   - 额外比较 `old_val != new_val` 防止无意义变更
   - 如果 `changed_fields` 为空 dict，直接 return，不写 AuditLog

4. **批量操作（bulk insert/update/delete）不触发事件**
   - SQLAlchemy 的 `session.execute(insert(...))` Core 操作不触发 Mapper 事件
   - 这是 SQLAlchemy 的限制，不是 bug
   - 需要使用批量操作的业务代码需手动调用 `_write_audit_log()` 或接受无审计日志
   - 在代码注释中明确说明此限制

5. **多线程/并发 session 的隔离性**
   - 每个 AsyncSession 有独立的 `session.info` 字典
   - `connection.info` 在 flush 期间绑定到对应 session
   - 不同请求的 audit_context 自然隔离
   - 无全局可变状态（除了 _registered 标志，但只写一次）

6. **BaseModel 子类中纯 Schema 模型的处理**
   - 很多 BaseModel 子类没有 `table=True`，是纯 Pydantic schema
   - 这些类没有 `__tablename__` 属性
   - `register_audit_hooks` 中检查 `getattr(cls, "__tablename__", None)`，无此属性的跳过
   - 不会为 Schema-only 模型注册 hook

7. **`_singularize()` 对不规则复数的处理**
   - 简单实现只处理尾部 `s` 的移除
   - 对 `addresses` -> `address` 做了特殊处理（`ses` 结尾去 `es`）
   - 对 `audit_logs` -> `audit_log` 正确处理
   - 不需要完美的英文复数转单数，action/resource_type 字段主要用于可读性

## 非目标

- **不修改 `db.py`** — 那是 task-08 的职责（在 get_session 中注入 audit_context）
- **不写测试** — 那是 task-09 的职责
- **不处理 bulk insert/update/delete** — SQLAlchemy Core 操作不触发 Mapper 事件，这是已知限制
- **不处理异步 hook 错误重试** — hook 在 flush 事务内，失败则整个事务回滚
- **不处理 Alembic migration** — AuditLog 表已存在，无 schema 变更
- **不处理多 engine 场景** — 当前项目只有一个 engine

## 参考

- **design.md AD-1**: SQLAlchemy Event Hook 决策 — 选择 after_insert/update/delete 而非 Service 层装饰器
- **AuditLog 模型**: `backend/app/modules/workflow/model.py` 第 48-84 行
  - 表名: `audit_logs`
  - 字段: id(UUID PK), workspace_id(UUID FK nullable), actor_id(UUID FK nullable), action(str 100), resource_type(str 50), resource_id(UUID), details_json(Text nullable), timestamp(DateTime tz)
  - 索引: ix_audit_workspace_ts(workspace_id, timestamp), ix_audit_resource(resource_type, resource_id)
- **BaseModel**: `backend/app/models/base.py` — 纯 SQLModel 子类，无额外字段
- **get_session**: `backend/app/core/db.py` — AsyncSession，expire_on_commit=False，autoflush=False
- **所有 table=True 模型**（共 30 个，hook 会覆盖除 audit_logs 外的 29 个）:
  - auth: User, Session, Role, RolePermission, UserWorkspaceRole
  - workspace: Workspace, WorkspaceRelation, ChangeWorkspace, TaskWorkspace, AgentRunWorkspace
  - change: Change, ChangeDocument
  - task: Task
  - workflow: ChangeReview (AuditLog 排除)
  - agent: AgentRun, AgentRunLog
  - release: Release, ReleaseApproval
  - settings: PlatformSetting
  - git_gateway: GitOperationLog
  - git_identity: GitIdentity
  - tool_gateway: ToolOperationLog
  - incident: Incident, Postmortem
  - scan_docs: ScanDocument
  - spec_workspace: SpecWorkspace
  - spec_profile: SpecProfileManifest, SpecConflict
  - worktree: WorktreeLease

## TDD 步骤

虽然本 task 不写测试（task-09 负责），但需确认可测试性：

1. **可测试性设计**: 所有 helper 函数（`_should_audit`, `_serialize_value`, `_singularize`, `_collect_changed_fields` 等）都是纯函数或简单查询函数，可以独立单元测试
2. **先写 audit_hooks.py 骨架**: 按上述完整实现骨架创建文件
3. **确认 import 路径正确**: `from app.core.audit_hooks import register_audit_hooks` 可正常 import
4. **确认不破坏现有 import**: 本文件是新建，不修改任何现有文件，不会破坏现有 import
5. **task-09 测试策略**: task-09 将使用以下方式测试：
   - 创建 AsyncSession + 内存 SQLite
   - 手动设置 `session.info["audit_context"]`
   - 执行 CRUD 操作，验证 AuditLog 记录
   - 验证递归保护（AuditLog 写入不触发新 hook）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `from app.core.audit_hooks import register_audit_hooks` | 无 ImportError |
| AC-02 | `_should_audit(AuditLog instance)` 返回 False | AuditLog 不触发 hook |
| AC-03 | 有 `audit_context` 时，insert 一个 Change，检查 AuditLog 表 | AuditLog 中有一条 `change.insert` 记录，包含正确 fields |
| AC-04 | 无 `audit_context` 时，insert 一个 Change，检查 AuditLog 表 | 无新 AuditLog 记录，不报错 |
| AC-05 | `after_insert` hook 触发 | AuditLog 记录的 `resource_type` 和 `resource_id` 正确 |
| AC-06 | `after_update` hook 只记录变更字段 | `details_json` 中 `changed_fields` 只包含实际变更的字段（非空） |
| AC-07 | `after_delete` hook 触发 | AuditLog 记录 `*.delete` action，`details_json` 含 `{"deleted": true}` |
| AC-08 | 运行 `pytest backend/` | 现有 540+ 测试全部通过（新文件不影响现有测试） |
| AC-09 | `register_audit_hooks(engine)` 可被调用多次而不重复注册 | 幂等性：第二次调用不重复注册 hook（可用 `event.contains()` 检查） |
| AC-10 | `connection.info` 与 `session.info` 的 audit_context 传递 | 在 async session flush 中，connection.info 能正确获取 audit_context |
