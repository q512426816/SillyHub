---
id: task-03
title: service upsert INSERT 加 id + 回退逻辑适配
goal: upsert_progress 新主键下正确写入（INSERT 带 id，冲突回退撞复合唯一）
implementation: |
  1. upsert_progress INSERT 分支（PlatformChangeProgressORM 构造）加 id=uuid.uuid4()
  2. _find_row 复合键（workspace_id, change_name）不变
  3. IntegrityError 回退逻辑（rollback→重查→UPDATE）适配新主键（撞复合唯一而非 change_name PK）
acceptance:
  - upsert INSERT 带 id（显式 uuid4）
  - 同 workspace 并发双发冲突回退正确（UPDATE 而非 500）
  - 跨 workspace 同名 upsert 各占一行（不撞主键）
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
constraints:
  - 零 API 变更（端点/schema/body 不变）
  - 回退逻辑语义不变（D-005）
depends_on: [task-02]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
provides:
  - contract: upsert_id
    fields: [id]
    desc: upsert_progress INSERT 带 id，回退适配复合唯一
expects_from:
  - contract: migration_id_pk
    provider: task-02
    fields: [id_pk]
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py
---
# Task-03 — service upsert INSERT 加 id + 回退逻辑适配

service 层适配任务（plan.md Wave 3，依赖 task-02 migration 落地新主键）。task-01 将 `id` 加为 `PlatformChangeProgressORM` 主键（`default=uuid.uuid4`，会免补），design.md §6 / R-02 要求 `upsert_progress` INSERT 分支显式带 `id=uuid.uuid4()`（虽 model default 会填，显式更清晰）；`_find_row` 复合键与 IntegrityError 回退逻辑语义不变（D-005），仅冲突对象从 change_name PK 变为 `(workspace_id, change_name)` 复合唯一。

## 1. `upsert_progress` INSERT 分支加 `id=uuid.uuid4()`

当前 `_apply`（service.py:115-124）INSERT 分支构造 `PlatformChangeProgressORM(...)` 未带 `id`：

```python
self._session.add(
    PlatformChangeProgressORM(
        workspace_id=workspace_id,
        change_name=name,
        latest_progress=body,
        last_pushed_at=pushed_at,
        last_pusher=user,
    )
)
await self._session.commit()
```

改为在构造中加 `id=uuid.uuid4()`（`uuid` 已 import，service.py:21）。task-01 已给 model 列加 `default=uuid.uuid4`，此处显式传入语义更清晰、不依赖 default 兜底（R-02）。

## 2. `_find_row` 复合键不变

`_find_row`（service.py:51-61）已按 `(workspace_id, change_name)` 复合键取行，`workspace_id=None` 用 `is_(None)`。新主键下**无需改动**——读写路径仍按复合键语义工作（跨 workspace 同名各占一行后互不遮蔽）。

## 3. IntegrityError 回退逻辑适配（语义不变）

当前回退（service.py:126-134）：

```python
except IntegrityError:
    await self._session.rollback()
    existing = await self._find_row(workspace_id, name)
    if existing is None:
        raise
    self._assign(existing, body, pushed_at, user)
    await self._session.commit()
```

**逻辑不变**（D-005）：catch `IntegrityError` → rollback → 按复合键重查 → 命中则 UPDATE（`_assign` + commit）、未命中则重抛。新主键下冲突来源从「第二个 commit 撞 change_name PK」变为「撞 `(workspace_id, change_name)` 复合唯一约束」（task-01 保留的 `uq_platform_change_progress_workspace_change`），代码路径一致——只要删掉 `change_name` 单主键，原「跨 workspace 同名撞 PK」场景不再抛错（各占一行），「同 workspace 并发双发」场景照旧走回退 UPDATE。**本文件不改回退逻辑**，适配仅验证语义仍然成立。

## 依据

- plan.md task-03 描述（Wave 3）：service.py `upsert_progress` INSERT 分支加 `id=uuid.uuid4()`；`_find_row` 复合键 + IntegrityError 回退逻辑适配（撞复合唯一而非 change_name PK）。
- design.md §6 文件变更清单：`upsert_progress` INSERT 分支加 `id=uuid.uuid4()`（当前漏 id 会 NOT NULL 报错）；`_find_row` 复合键不变；IntegrityError 回退逻辑不变（撞复合唯一而非 PK）。
- design.md 决策 D-005@v1：service INSERT 加 id，回退逻辑不变。
- 现有代码 service.py:51-61（`_find_row` 复合键）、115-134（INSERT + IntegrityError 回退）。
