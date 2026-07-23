---
id: task-01
title: "users 表加 employee_no（alembic migration down=20260713_fix_session_zombie + User ORM + UserRead schema）（覆盖：FR-02, D-002@v1）"
title_zh: 用户表新增工号字段
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: []
blocks: [task-03, task-09, task-12]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/migrations/versions/20260714_add_user_employee_no.py
  - backend/app/modules/auth/model.py
  - backend/app/modules/auth/schema.py
provides:
  - contract: UserRead
    fields: [employee_no]
expects_from: []
goal: >
  给 users 表加 employee_no 列，使 MeResponse 能返回当前登录人工号。
implementation:
  - "新建 backend/migrations/versions/20260714_add_user_employee_no.py：revision='20260714_user_emp_no'（≤32字符），down_revision='20260713_fix_session_zombie'（已核实为当前 head）；upgrade 执行 ALTER TABLE users ADD COLUMN employee_no VARCHAR(50) NULL；downgrade 执行 DROP COLUMN employee_no"
  - "backend/app/modules/auth/model.py User 表（display_name 字段 L50 之后）新增 employee_no: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))，import 已含 String/Column，无需新 import"
  - "backend/app/modules/auth/schema.py UserRead（L31-41，display_name 字段 L37 后）新增 employee_no: str | None；model_config=from_attributes=True 已开，ORM→DTO 自动映射"
acceptance:
  - "migration upgrade head → downgrade -1 → upgrade head 三步循环可逆执行无报错"
  - "UserRead 实例化含 employee_no 字段；从 ORM User 实例（employee_no=None）构造不报错"
  - "老用户 employee_no 为 null，MeResponse 返回 employee_no: null 不报错"
verify:
  - "cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head"
  - "cd backend && uv run pytest -q app/modules/auth"
constraints:
  - "employee_no nullable，不加唯一约束、不加索引（D-002@v1，避免历史脏数据触发唯一冲突）"
  - "不改 login/bootstrap/create_user 逻辑，不在本任务回填工号值"
  - "migration revision id ≤ 32 字符；down_revision 接 '20260713_fix_session_zombie'（单 head，已核实）"
  - "downgrade 必须 drop column 保证可逆"
---
