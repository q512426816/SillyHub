---
id: task-08
title: 删除孤立 CHANGE_ARCHIVE 权限常量（auth/permissions.py，确认无引用后）
title_zh: 删除孤立 CHANGE_ARCHIVE 权限常量
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P2
depends_on: [task-01]
blocks: []
requirement_ids: [FR-1.3]
decision_ids: [D-004@v2]
allowed_paths:
  - backend/app/modules/auth/permissions.py
---

## 目标

task-01 删除 backend archive 模块（router/service/tests + main.py 注销）后，`Permission.CHANGE_ARCHIVE`（`auth/permissions.py:72`）的唯一活路径消费者消失。本任务确认其孤立并删除常量 + 同步权限测试断言，避免 RBAC 目录里残留指向已删端点的死权限。

## 实现要点

前置 grep（已核实，本卡片编写时跑过）`CHANGE_ARCHIVE` 全仓命中：

1. `backend/app/modules/auth/permissions.py:72` — 定义本身（待删）
2. `backend/app/modules/archive/router.py:31` — `require_permission(Permission.CHANGE_ARCHIVE)` 唯一活路径消费者，task-01 删该文件后此引用消失
3. `backend/tests/modules/auth/test_permissions.py:77` — `(Permission.CHANGE_ARCHIVE, PermissionGroup.CHANGE)` group 解析参数化用例（待删该参数行）
4. `backend/migrations/versions/202605280900_create_auth_and_rbac.py:53` — seed 写字符串字面量 `"change:archive"`（**非枚举引用**，task-01 不碰 migration，本任务保留不动，见 constraints）

步骤：

1. 在 task-01 merge 后重跑 `grep CHANGE_ARCHIVE backend/` 复核命中收敛到 permissions.py:72 + test_permissions.py:77 两处（archive/router.py 应已不存在）。
2. 删 `permissions.py:72` 的 `CHANGE_ARCHIVE = "change:archive"` 行（保留 `CHANGE_APPROVE` 上方/`TASK_READ` 下方其余常量不动）。
3. 删 `test_permissions.py:77` 的 `(Permission.CHANGE_ARCHIVE, PermissionGroup.CHANGE),` 参数化行。
4. 不改 migration `202605280900_create_auth_and_rbac.py:53` 的字符串字面量（见 constraints）。

## 验收标准

- `grep -rn CHANGE_ARCHIVE backend/app backend/tests` 零命中（migration 字面量是 `"change:archive"` 字符串非枚举，不在此 grep 命中范围）。
- `grep -rn "change:archive" backend/app backend/tests` 零命中（枚举删后字面量也随之消失）。
- permissions.py 注释「Mirrors references/16-rbac.md」语义不变（不更新该 reference 文档，范围外）。

## verify

```bash
cd backend && uv run pytest -q --no-cov backend/app/modules/auth/tests/
```

预期：`test_permissions.py` 的 `test_permission_group_resolution` 参数表少一行后仍全绿；`test_every_permission_has_non_default_group` 的总数断言若有硬编码数字需核对（当前实现是遍历枚举非硬编码总数，应无需改）。

## 约束

- **不删其他权限常量**（CHANGE_CREATE/READ/UPDATE/APPROVE 等保留）。
- **不碰 migration** `202605280900_create_auth_and_rbac.py:53`：它写的是字符串字面量 `"change:archive"`（DB seed），非枚举引用；task-01 不改 migration（design §6 / plan task-01 文件清单均不含迁移），本任务对齐该边界保留不动。遗留：DB 中已 seed 的 `change:archive` 记录成孤儿字符串，不在本变更范围（无 DB schema 改动决策 D-008，design §8）。
- **若重跑 grep 发现新活路径引用**（task-01 后某处仍在 import/require CHANGE_ARCHIVE）：保留常量并在本卡片 constraints 标注引用点，不强行删。
- 仅删枚举成员 + 测试参数行，不动 `group` 解析逻辑（CHANGE 前缀分支 `permissions.py:178` 不变）。
