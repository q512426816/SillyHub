---
id: task-01
title: 删除 backend archive 模块（router.py + service.py + tests/ + main.py 注销）
title_zh: 删除 backend archive 模块
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: []
blocks: [task-07, task-08]
requirement_ids: [FR-1.1]
decision_ids: [D-004@v2, D-006@v1]
allowed_paths:
  - backend/app/modules/archive/router.py
  - backend/app/modules/archive/service.py
  - backend/app/modules/archive/__init__.py
  - backend/app/modules/archive/tests/__init__.py
  - backend/app/modules/archive/tests/test_service.py
  - backend/app/main.py
  - backend/app/modules/release/tests/test_router.py
---

## 目标

删除 `backend/app/modules/archive/` 整块死代码（`archive_change` + `distill_knowledge` 两端点）并在 `main.py` 注销 router。
理由（design §1.A / D-004@v2 / D-006@v1）：server-local 时代遗留，daemon-client 下 `archive/service.py:68` 用宿主源码路径容器不可达、`shutil.move` 永不执行；前端零调用；归档正确归属已是 archive stage dispatch（daemon agent 跑 `sillyspec run archive`）。删后归档仍可用，status 投影由 task-07 补。

## 实现要点

1. 删除目录 `backend/app/modules/archive/`（含 `router.py` / `service.py` / `__init__.py` / `tests/`），整个模块移除。
2. 改 `backend/app/main.py`：
   - 删第 21 行 `from app.modules.archive.router import router as archive_router`。
   - 删第 482 行 `app.include_router(archive_router, prefix="/api")`。
3. 删 `backend/app/modules/release/tests/test_router.py` 中调用已删端点的 3 个测试（`:196 test_archive_change` / `:224 test_archive_change_not_done` / `:247 test_distill_knowledge`，到文件末尾约 `:270`），保留该文件其余 release 相关测试。
4. 删 archive 的 `__pycache__`（`rm -rf backend/app/modules/archive/__pycache__`），避免残留 import 缓存。
5. **不动**：`/archive-confirm` 端点（`change/service.py:1576`，语义=只记确认标志）、`CHANGE_ARCHIVE` 权限常量（task-08 处理）、`test_permissions.py` 断言（task-08）。

## 验收标准

- `grep -rn "from app.modules.archive\|import archive\|archive_router" backend/app` 零命中。
- `find backend/app/modules/archive -type f 2>/dev/null` 零输出（目录已删）。
- `uv run python -c "from app.main import app"` 不报错（router 注销干净，无悬空 import）。
- `cd backend && uv run pytest -q --no-cov tests/modules/release/tests/test_router.py` 通过（3 个 archive 测试已删，release 测试不挂）。
- `grep -rn "archive-confirm" backend/app/modules/change/service.py` 仍命中（`/archive-confirm` 保留未误删）。
- `CHANGE_ARCHIVE` 仍在 `permissions.py:72`（本 task 不动，task-08 删）。

## verify

```
cd backend && uv run python -c "from app.main import app; print('import ok')"
cd backend && uv run pytest -q --no-cov tests/modules/release/tests/test_router.py
cd backend && uv run pytest -q --no-cov -k "not archive" .
```

启动 + release router 测试 + 全量（排除 archive 相关，因 CHANGE_ARCHIVE 常量 task-08 才删，permissions 测试本 task 暂留）。

## 约束

- 不删 `/archive-confirm` 端点（语义已正确，保留）。
- 不改 DB schema（无 Alembic 迁移，`Change.archived_at` 等字段已存在）。
- 不动 `CHANGE_ARCHIVE` 权限常量与 `test_permissions.py` 断言（task-08 依赖本 task 后做）。
- 不补 status 投影（`change.status="archived"` 写入点迁移）——属 task-07（R-01 P0，本 task 删后到 task-07 之间存在已知缺口，分 task 推进）。
- 不动 frontend（task-02）。
