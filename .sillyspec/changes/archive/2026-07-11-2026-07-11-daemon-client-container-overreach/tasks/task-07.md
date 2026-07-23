---
id: task-07
title: 补 archive stage status 投影（complete_stage("archive") 收尾写 change.status/location/archived_at/path）
title_zh: 补 archive stage status 投影
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: [task-01]
blocks: [task-11]
requirement_ids: [FR-1.4]
decision_ids: [D-004@v2, D-007@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/dispatch.py
  - backend/tests/modules/change/test_archive_status_projection.py
---

# task-07 — 补 archive stage status 投影（★本变更唯一新代码）

## 目标

删除 `archive_change` 端点（task-01）后，`change.status="archived"` 唯一写入点消失。在 archive stage 收尾把 sillyspec 已归档态投影到 `Change`，保证前端"已归档"筛选（`changes/page.tsx:42,111`）不失真（R-01 P0）。

## 实现要点

投影挂载点二选一（择优实现，另一处不动）：

- **首选**：`service.py:1424-1425` 的 `_resolve_stage_completion` archive 分支返回 `("archived", None)`。在 `complete_stage`（`:1430-1478`）收尾，当 `new_stage == "archived"` 时补投影写入：
  - `change.status = "archived"`
  - `change.location = "archive"`
  - `change.archived_at = datetime.now(UTC)`
  - `change.path` 经 `_resolve_change_dir`（`:74-95`，spec_root 优先）读 sillyspec.db 同步到 archive 后新相对路径；若新路径解析失败则保留旧 `change.path`（warn 不阻塞）
- **备选**：`dispatch.py:1632 _sync_stage_status_daemon_client` 已在 `:1755 db_current_stage` 读到 sillyspec.db；在 `:1802` 检测 `db_current_stage == "archived"` 时补同样投影。若首选点 e2e 触发不到（complete_stage 未被 daemon-client 归档链路调用），落此点。

字段已存在（`model.py:123 status` / `:126 location` / `:127 path` / `:145 archived_at`），无 schema 改动。

新增单测 `test_archive_status_projection.py`：构造 `current_stage="archive"` 的 change，调 `complete_stage(ws, cid, "archive")`，断言四字段写入正确；断言未到 archive stage 的变更四字段不变（零回归）。

## 验收标准

- archive stage 完成后 `change.status == "archived"` / `location == "archive"` / `archived_at` 非空 / `path` 指向 archive 新位置
- 非归档态变更的 `status/location/archived_at` 不被改写
- 前端"已归档"筛选能正确列出归档变更（AC-3）

## verify

```
cd backend && uv run pytest -q --no-cov tests/modules/change/test_archive_status_projection.py tests/modules/change/test_dispatch.py tests/modules/change/test_auto_dispatch.py
```

## 约束

- 不改 stage 状态机（`_resolve_stage_completion` 返回值不变）
- 不动其他 stage（brainstorm/plan/execute/verify）的投影
- 复用 `_resolve_change_dir`，不新写路径解析逻辑
- 不引入 Alembic 迁移
