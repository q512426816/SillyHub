---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-03
title: DB 迁移 — ADD COLUMN human_gate + 旧数据映射
wave: W1
priority: P0
estimate: 1h
depends_on: [task-01]
---

# task-03: DB 迁移 — ADD COLUMN human_gate + 旧数据映射

## 目标

为 Change 表新增 human_gate 列，并将旧数据（rework_required/accepted）映射到新状态组合。

## 不在范围

- 不修改 model.py（task-01 已处理）
- 不修改业务逻辑

## 输入

- `backend/app/modules/change/model.py`（task-01 产出）
- `backend/migrations/versions/`（最近的迁移文件，了解命名风格）

## 产出

- `backend/migrations/versions/xxxx_add_change_human_gate.py`（新增）

## 实现步骤

1. 查看最近迁移文件的命名风格（`ls backend/migrations/versions/ | tail -3`）
2. 创建迁移脚本，包含：
   - `op.add_column('change', sa.Column('human_gate', sa.String(50), server_default='none', nullable=False))`
   - 旧数据映射 UPDATE：
     ```python
     op.execute("UPDATE \"change\" SET current_stage='verify', human_gate='blocked' WHERE current_stage='rework_required'")
     op.execute("UPDATE \"change\" SET current_stage='verify', human_gate='need_archive_confirm' WHERE current_stage='accepted'")
     ```
   - downgrade：`op.drop_column('change', 'human_gate')`（不回退 stage 映射，因为旧 stage 已不存在）
3. 在本地运行 `alembic upgrade head` 验证

## 验收标准

- [ ] `alembic upgrade head` 无错误
- [ ] 新 Change 记录 human_gate 默认为 'none'
- [ ] 旧 rework_required 记录映射为 verify+blocked
- [ ] 旧 accepted 记录映射为 verify+need_archive_confirm

## 风险

- 如果有大量旧记录，UPDATE 可能慢——单条 SQL 足够快，不需要批量

## DoD

- [ ] 迁移脚本完成
- [ ] upgrade/downgrade 均可执行
