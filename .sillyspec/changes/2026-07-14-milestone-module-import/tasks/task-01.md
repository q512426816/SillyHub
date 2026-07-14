---
id: task-01
title: 后端 PlanNodeModule 加 plan_type 字段 + alembic migration + schema 同步加字段
title_zh: 后端模块表新增计划类型字段
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05, task-06]
requirement_ids: [FR-002]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/model.py
  - backend/app/modules/ppm/plan/schema.py
  - backend/migrations/versions/
provides:
  - contract: PlanNodeModule.plan_type
    fields: [plan_type]

goal: >
  给模块表 PlanNodeModule 增加 plan_type（正常计划/临时计划）字段并同步 schema 与 migration，为后续导入功能区分两类计划提供存储基础。
context: |
  - design.md §8 字段变更：plan_type str|None default "正常计划"，String(32) nullable，业务层约束取值（非 DB 枚举）
  - design.md §6 文件清单：model.py 修改 / migrations 新增 / schema.py 修改（Base/Create/Update/Resp 同步加字段）
  - 现状：model.py PlanNodeModule（L113-146）字段序列 plan_node_id → module_name → plan_workload → plan_begin_time → plan_complete_time → duty_user_id → created_at → updated_at，无 plan_type
  - 现状：schema.py PlanNodeModuleBase（L97-104）已含 duty_user_id；Create 继承 Base；Update（L111-116）独立平铺；Resp 继承 Base
  - alembic 风格：文件名 YYYYMMDD_<slug>.py，revision ≤32 字符，down_revision 指向最新（当前 head=20260714_user_emp_no），upgrade 用 op.add_column，nullable=True，旧数据留 NULL
implementation: |
  - model.py：在 PlanNodeModule 类 duty_user_id 之后、created_at 之前新增 plan_type: str | None = Field(default="正常计划", sa_column=Column(String(32), nullable=True, default="正常计划"))，附注释「计划类型（正常计划/临时计划），业务层校验，非 DB 枚举」
  - schema.py：PlanNodeModuleBase 加 plan_type: str | None = None（紧随 duty_user_id）；Update 同步加 plan_type: str | None = None；Create/Resp 经继承自动获得
  - 生成迁移文件 backend/migrations/versions/20260714_add_plan_type_to_plan_node_module.py：revision=20260714_plan_node_module_plan_type，down_revision=20260714_user_emp_no，upgrade() 用 op.add_column("ppm_plan_node_module", sa.Column("plan_type", sa.String(32), nullable=True))，downgrade() op.drop_column
  - 既有 create_module / create_detail / CRUD 不动（字段 nullable，不传即 None）
acceptance: |
  - PlanNodeModule ORM 含 plan_type 字段，String(32) nullable default "正常计划"
  - PlanNodeModuleBase / PlanNodeModuleUpdate 含 plan_type；Create / Resp 经继承含 plan_type
  - alembic upgrade head 成功，ppm_plan_node_module 表新增 plan_type 列（nullable，无 NOT NULL，旧数据 NULL）
  - 既有模块查询 / 创建 / 更新流程不受影响（字段 nullable，缺省兼容）
verify: |
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/ -q
  - cd backend && .venv/Scripts/python.exe -m alembic upgrade head
  - cd backend && .venv/Scripts/python.exe -m alembic downgrade -1 && .venv/Scripts/python.exe -m alembic upgrade head（验证 down/up 双向）
constraints: |
  - 只加字段，不涉及导入逻辑（导入在 task-03+）
  - 不改其他表结构（仅 ppm_plan_node_module 加一列）
  - plan_type 不加 DB 枚举约束（业务层校验，design.md §8）
  - 不改 ModuleFormDrawer 表单 UI（列表展示为主，design.md §9 可选增强）
---
