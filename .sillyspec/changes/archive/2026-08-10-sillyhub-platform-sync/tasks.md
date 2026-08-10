---
author: qinyi
created_at: 2026-08-10 23:22:56
---

# 任务清单（Tasks）

> 任务细节在 plan 阶段展开为 `tasks/task-NN.md`（frontmatter: id/title/priority/depends_on/blocks/requirement_ids/decision_ids/allowed_paths/goal/implementation/acceptance/verify/constraints）。Wave 串行（依赖链），逐 task 实现。文件名/类名来自 design.md §6 文件变更清单。

## Wave 1 — 数据地基（P1，其余 Wave 依赖）
- task-01: 新增 `platform_change_progress` 表 + ORM（`platform_sync/model.py`，字段见 design §8.1）
- task-02: alembic 迁移建表（`migrations/versions/20260810150000_create_platform_change_progress.py`，down_revision=`202608091100`）

## Wave 2 — 鉴权依赖（P2）
- task-03: `require_platform_sync` 依赖（`platform_sync/auth.py`，Bearer=shk_live_ APIKey 优先/JWT 回退，不做 workspace 权限检查）

## Wave 3 — 业务 + schema（P3，冲突算法核心）
- task-04: `PlatformSyncService`（`platform_sync/service.py`：upsert_progress 实现 §4.2 字典序冲突检测 + list_lightweight + get_progress）
- task-05: `platform_sync/schema.py`（ConflictResponse / ChangeListItem / 裸六表 dict 透传）

## Wave 4 — 端点 + 挂载（P4）
- task-06: `platform_sync/router.py` 三端点（POST 读 3 header / GET 列表 / GET 单 change）+ `main.py` 挂载 prefix=/api

## Wave 5 — 测试（P5，覆盖契约 §13）
- task-07: `platform_sync/tests/`（conftest + test_router：契约 §13 校验清单 8 项 + §4.2 冲突算法 + §7 字典序 + §8 零回归 + §5/§6 响应形态）

## Wave 6 — 收尾（P6）
- task-08: `.sillyspec/local.yaml` 补 platform_sync 的 modules test 配置（R-02）
- task-09: `pnpm gen:types` 同步 `backend/openapi.json` + 模块文档同步
