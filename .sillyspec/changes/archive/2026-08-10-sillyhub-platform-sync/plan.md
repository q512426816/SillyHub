---
plan_level: full
author: qinyi
created_at: 2026-08-10 23:45:00
---

# 实现计划（Plan）— SillyHub 后端 SillySpec 进度同步层

> 来源：design.md（6 Phase）+ tasks.md（9 task）。实现细节进 `tasks/task-NN.md`。线性依赖链 W1→W6，**单仓主目录实现**（不用 worktree，规避 [[sillyspec-worktree-execute-total-loss]] 全丢坑）。

## Wave 1 — 数据地基（无依赖）
- [x] task-01: `PlatformChangeProgressORM` model + `__init__.py`（覆盖：FR-03, D-003@v1）
- [x] task-02: alembic 迁移建 `platform_change_progress` 表（覆盖：FR-03, D-003@v1）

## Wave 2 — 鉴权依赖（W1 后）
- [x] task-03: `require_platform_sync` 依赖 Bearer=APIKey/JWT（覆盖：FR-02, D-002@v1）

## Wave 3 — 业务 + schema（W1 后，与 W2 并列）
- [x] task-04: `PlatformSyncService` upsert_progress §4.2 冲突算法 + list/get（覆盖：FR-04/06/08, D-004/006/008@v1）
- [x] task-05: `schema.py` ConflictResponse/ChangeListItem/裸 dict（覆盖：FR-05/07, D-005/007@v1）

## Wave 4 — 端点 + 挂载（W2+W3 后）
- [x] task-06: `router.py` 3 端点 + `main.py` 挂载（覆盖：FR-01, D-001@v1）

## Wave 5 — 测试（W4 后）
- [x] task-07: tests 覆盖契约 §13 校验清单 8 项（覆盖：FR-04/05/06/07, NFR-01/02）

## Wave 6 — 收尾（W5 后）
- [x] task-08: local.yaml modules 补 platform_sync test 配置（覆盖：R-02）
- [x] task-09: gen:types 同步 openapi + 模块文档（覆盖：NFR-04, CLAUDE.md 规则 20）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | PlatformChangeProgressORM model | W1 | P0 | — | FR-03, D-003 |
| task-02 | alembic 迁移 | W1 | P0 | task-01 | FR-03, D-003 |
| task-03 | require_platform_sync 鉴权 | W2 | P0 | — | FR-02, D-002 |
| task-04 | PlatformSyncService 冲突算法 | W3 | P0 | task-01 | FR-04/06/08, D-004/006/008 |
| task-05 | schema.py | W3 | P0 | — | FR-05/07, D-005/007 |
| task-06 | router 3端点 + main挂载 | W4 | P0 | task-03/04/05 | FR-01, D-001 |
| task-07 | tests §13清单 | W5 | P0 | task-06 | FR-04/05/06/07, NFR-01/02 |
| task-08 | local.yaml modules | W6 | P1 | — | R-02 |
| task-09 | gen:types + 文档 | W6 | P1 | task-06 | NFR-04 |

## 关键路径

`task-01 → task-02 → task-04 → task-06 → task-07 → task-09`

（最长串行链。无 spike 不确定点——鉴权/路由/字典序/数据模型均经 Design Grill 源码核实 pass。）

## 依赖关系图

```
W1(task-01→task-02) → W3(task-04) ──┐
W2(task-03) ─────────────────────── ┼→ W4(task-06) → W5(task-07) → W6(task-09)
W3(task-05) ─────────────────────── ┘
task-08（local.yaml modules）独立，W6 任意时点
```

## 验收

- 契约 §13 校验清单 8 项全过（task-07 逐条测，见 design §10.1）
- 现有 `/api/workspaces/{wid}/changes/*` 路由零回归
- ruff format + ruff check + mypy 全过
- alembic upgrade/downgrade 对称可逆
- gen:types 同步 `backend/openapi.json`
- 不碰派发层（契约 D-004）
