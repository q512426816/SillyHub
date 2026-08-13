---
id: task-05
title: __init__ docstring + 模块文档更新
goal: 文档与新主键语义一致
implementation: |
  1. __init__.py docstring：change_name 全局唯一 PK → id 主键 + (workspace_id, change_name) 复合唯一
  2. .sillyspec/docs/backend/modules/platform_sync.md：主键描述更新 + 变更索引加 2026-08-13-fix-platform-progress-pk
acceptance:
  - __init__.py docstring 不再说 change_name 全局唯一 PK
  - 模块文档主键描述正确 + 变更索引
verify:
  - 无测试（纯文档）
constraints:
  - 不改业务逻辑
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/platform_sync/__init__.py
  - .sillyspec/docs/backend/modules/platform_sync.md
provides:
  - contract: docs_synced
    desc: 模块文档与新主键语义一致
expects_from:
  - contract: platform_change_progress_id_pk
    provider: task-01
    fields: [id]
related_tests: []
---
# Task-05 — `__init__` docstring + 模块文档更新

纯文档同步任务（plan.md Wave 4，与 task-04 可并行）。将 `platform_change_progress` 表主键语义从「change_name 全局唯一 PK」更新为「id UUID 主键 + `(workspace_id, change_name)` 复合唯一」，与 design.md §5 方案 A（D-001）和 task-01 model 改动后的目标态一致。

## 1. `backend/app/modules/platform_sync/__init__.py`

当前 docstring 第 5 行：

```
聚合存储 ``platform_change_progress`` 表（change_name 全局唯一 PK）。
```

改为（对齐 design.md §6 / §8）：

```
聚合存储 ``platform_change_progress`` 表（id 主键 + (workspace_id, change_name) 复合唯一）。
```

docstring 其余内容（3 端点 / base_ts 冲突检测 / 与派发层正交契约 D-004）保持不变。

## 2. `.sillyspec/docs/backend/modules/platform_sync.md`

- 主键描述更新：凡表述「change_name 单主键 / 全局唯一」之处（如注意事项「workspace_id nullable + 复合唯一约束（非复合 PK）」等段落），更新为 id UUID 主键 + `(workspace_id, change_name)` 复合唯一；`(workspace_id, change_name)` 复合键 upsert / join 语义不变。
- 变更索引加本 change：`2026-08-13-fix-platform-progress-pk`（人工备注 MANUAL_NOTES 区），注明 id 主键替代 change_name、migration 回填 id、零 API 变更（D-004）。

## 依据

- plan.md task-05 描述（Wave 4）。
- design.md §6 文件变更清单：`__init__.py` docstring「change_name 全局唯一 PK」→「id 主键 + (workspace_id, change_name) 复合唯一」；`platform_sync.md` 更新主键描述 + 变更索引加本 change。
