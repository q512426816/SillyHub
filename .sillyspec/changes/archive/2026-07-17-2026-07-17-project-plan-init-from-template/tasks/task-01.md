---
id: task-01
title: "model + migration — PsPlanNode + template_plan_node_id + has_module"
title_zh: "模型与迁移 — PsPlanNode 新增 template_plan_node_id 与 has_module 字段"
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05]
requirement_ids: [FR-005]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/model.py
  - backend/migrations/versions/
goal: "为 PsPlanNode 增加 template_plan_node_id(uuid|None) 与 has_module(bool default false) 两列，并用 migration ALTER ppm_ps_plan_node 落库。"
implementation: |
  1. model.py PsPlanNode（line 247-284）末尾追加两列，对齐现有列风格（UuidCoercing / Boolean sa_column）：
     - template_plan_node_id: uuid.UUID | None = Field(default=None, sa_column=Column(UuidCoercing, nullable=True)) —— 来源 PlanNode 模板，手动建为 null。
     - has_module: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))。
  2. 新增 migration backend/migrations/versions/<ts>_ps_plan_node_template_fields.py，格式参考 20260716_plan_node_has_module_detail_module_id.py：
     - revision = "<ts>_ps_plan_node_template_fields"；down_revision = 当前 alembic head（execute 用 alembic heads 确认，参考 20260716_pn_has_module）。
     - upgrade：op.add_column("ppm_ps_plan_node", Column("template_plan_node_id", UuidCoercing/sa.Uuid, nullable=True))；op.add_column("ppm_ps_plan_node", Column("has_module", sa.Boolean, nullable=False, server_default=sa.false()))。
     - downgrade：op.drop_column 反序（先 has_module 再 template_plan_node_id）。
acceptance: |
  - upgrade 后 ppm_ps_plan_node 含 template_plan_node_id（nullable）与 has_module（NOT NULL DEFAULT FALSE）两列。
  - 现有数据：has_module 落库为 false，template_plan_node_id 为 null（design §9 兼容策略；CLAUDE.md 规则 11 未上线可重置，不回填）。
  - downgrade 可逆：执行后两列被移除。
verify: |
  cd backend
  - alembic upgrade head  → 两列存在
  - alembic downgrade -1  → 两列移除
  - alembic upgrade head  → 两列恢复
  （可选）psql 确认 \d ppm_ps_plan_node 列类型与 default。
constraints: |
  - 不加 FK：template_plan_node_id nullable，对齐本表既有 duty_user_id 等无 FK 的 UuidCoercing 风格（design §5.1）。
  - has_module 为冗余字段（冗余自模板），避免 milestone-details 模块层每次反查模板（D-005@v1）。
  - 对齐现有列风格：UuidCoercing（非裸 Uuid）、Boolean server_default=sa.false()。
  - migration 不回填现有"实施阶段"里程碑 has_module（R-02 定案，plan §依赖关系；现有数据接受二级展示）。
  - 只改 model.py 与新增 migration 文件，不动 schema/service/types（属后续 task）。
