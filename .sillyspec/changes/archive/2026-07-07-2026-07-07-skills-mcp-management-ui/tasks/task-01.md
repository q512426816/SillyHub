---
author: qinyi
created_at: 2026-07-07 23:22:00
goal: 建 CustomSkill 数据模型 + Alembic migration
implementation: 新建 backend/app/modules/skills/model.py 定义 CustomSkill(id/name/description/content/created_by/created_at/updated_at)；name 唯一约束；新建 alembic migration 建表（唯一 revision id + down 接当前 head，参考 migration-chain-fragmentation-pattern）
acceptance: CustomSkill 模型可 CRUD；name unique 约束生效；alembic upgrade head 无冲突；downgrade 干净
verify: cd backend && uv run pytest tests/modules/skills -q（模型 + migration 单测）
constraints: name 合法字符 [a-z0-9-] 2-40（D-002）；禁 sillyspec- 前缀（业务层校验，非 DB 约束）；migration revision 唯一（查现有 head 接 down）
depends_on: []
covers: [FR-01, D-001, D-002, D-010]
---

# task-01: backend CustomSkill 数据模型 + Alembic migration

## 验收标准
A. `CustomSkill` model：id(pk UUID)、name(str unique ≤40 `[a-z0-9-]`)、description(str)、content(text SKILL.md body)、created_by(FK user)、created_at/updated_at(datetime tz)。
B. Alembic migration `add_custom_skills` 建表 + name unique index，revision id 唯一，down_revision 接当前 alembic head（`alembic heads` 确认单 head）。
C. `alembic upgrade head` + `alembic downgrade -1` 均干净，无链冲突。
