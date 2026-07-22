---
id: task-03
title: File 模型+migration
title_zh: File 元数据模型 + alembic 建 file 表迁移
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: []
decision_ids: [D-004, D-008]
allowed_paths:
  - backend/app/modules/file/model.py
  - backend/migrations/versions/202607221500_create_file.py
goal: >
  建 File 元数据模型（继承 BaseModel，含 owner_type/owner_id/uploaded_by 等）+ alembic migration 建 file 表。
implementation:
  - file/model.py 定义 File（继承 BaseModel/SQLModel，审计钩子自动记录）
  - 字段：id(UUID)、owner_type(str64)、owner_id(UUID|None)、original_name(str255)、stored_key(str255)、mime_type(str128)、size(int)、uploaded_by(UUID)、created_at、deleted_at(软删)
  - 新建 migration（revision 唯一，down 指向当前真实 head），create_table file + 索引（uploaded_by、owner_type/owner_id）
  - 不碰 PPM 各表 file_urls 字段定义（语义变更但结构不变）
acceptance:
  - File 模型字段齐全，owner_id 允许空（先上传后绑定，D-008）
  - alembic heads 单一，migration 链不断裂
  - upgrade 建表成功，downgrade 可回滚
verify:
  - cd backend && uv run alembic heads
  - cd backend && uv run alembic upgrade head
constraints:
  - migration 避免多 head（参照 migration-chain-fragmentation-pattern），down 接真实 head
  - owner_id 允许空以支持新建场景（D-008），不强制 PPM create 回填
  - 本任务不加业务测试（测试在 task-06）
---
