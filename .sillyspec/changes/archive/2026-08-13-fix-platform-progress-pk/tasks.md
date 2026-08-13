---
author: qinyi
created_at: 2026-08-13 15:52:00
---

# 任务清单（Tasks）

> change: `2026-08-13-fix-platform-progress-pk`
> 初步任务清单，plan 阶段细化 Wave/Task/依赖/验收。设计见 design.md，需求 FR-01~05，决策 D-001~005。

- task-01: model.py `PlatformChangeProgressORM` 加 id 主键（default=uuid.uuid4）+ change_name 去 primary_key
- task-02: 新增 migration（batch_alter_table 改主键 + 现有行回填 id），PG/SQLite 双验
- task-03: service.py `upsert_progress` INSERT 加 id，回退逻辑适配
- task-04: 测试（跨 workspace 重名各占一行 / NULL 行共存 / 同 workspace 并发回退 / 迁移回填）
- task-05: `__init__.py` docstring + backend 模块文档更新

依赖：task-01 → task-02（model 先行 migration 对齐）→ task-03（service 适配）→ task-04；task-05 独立。
