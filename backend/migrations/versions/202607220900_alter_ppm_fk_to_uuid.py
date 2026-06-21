"""alter ppm 跨表 FK varchar → uuid

修复阻塞 bug:ppm 子域(plan/problem)的跨表 FK 字段在 ETL 时按源语义保留为
``character varying``,但目标表主键是 ``uuid``。PG ``JOIN (varchar = uuid)``
报 ``operator does not exist: character varying = uuid`` → 里程碑/模块/明细
等页面查不到数据。

本迁移把这些跨表 FK 字段统一 ALTER 为 ``uuid`` 类型。对残留的源系统 Long ID
(ETL 历史脏数据,如 project_id="54"、plan_node_id="45" 等)用
``CASE WHEN ... ~ uuid 正则 THEN ::uuid ELSE NULL END`` 丢弃为 NULL —— 这些
残留本就无法 JOIN 到 uuid 主键表(源 ID 未迁移),转 NULL 更语义正确。

保留为 varchar 的字段(本迁移不动):
- ``ppm_project_member.role_id`` / ``depart_id``  — ppm 项目角色/部门字符串
  (D-004@v1,值如 "80154"/"2",非 UUID)
- ``ppm_problem_change_process_log.business_id`` /
  ``ppm_problem_change_process_task.business_id`` — 源变更 ID (值如 "17"/"18")
- 所有 ``*_attach_group_id`` (ppm_plan_task / ppm_task_execute /
  ppm_ps_plan_node_detail) — 附件组字符串约定,非 UUID FK

NOT NULL + 有源 Long 残留的字段(``ppm_ps_project_plan.project_id`` /
``ppm_plan_node_module.plan_node_id``):upgrade 时先 DROP NOT NULL 再 ALTER
(残留值会变 NULL),downgrade 时恢复 NOT NULL。

设计依据:design.md §8 + task 描述(跨表 FK 类型对齐)。

Revision ID: 202607220900
Revises: 202607210900
Create Date: 2026-07-22 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607220900"
down_revision: str | None = "202607210900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# UUID 正则 (PG ~ 操作符)。CASE 表达式:UUID 格式 → ::uuid,否则 → NULL。
# 作用是把源 Long ID 残留 / 逗号列表等脏值安全降级为 NULL,而不是让 ALTER 失败。
_UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def _alter_to_uuid(table: str, column: str) -> None:
    """把 <table>.<column> 从 varchar ALTER 为 uuid。

    用 CASE WHEN 把非 UUID 残留值降级为 NULL,避免 ALTER 失败。
    """
    using = f"CASE WHEN {column} ~ '{_UUID_RE}' THEN {column}::uuid ELSE NULL END"
    op.alter_column(
        table,
        column,
        type_=sa.Uuid(as_uuid=True),
        postgresql_using=using,
    )


# ───────────────────────────────────────────────────────────────────────────
# 待 ALTER 字段清单
# ───────────────────────────────────────────────────────────────────────────
# (table, column, drop_not_null_before?)
# drop_not_null_before=True:字段是 NOT NULL 且数据有源 Long 残留,需先 DROP
#   NOT NULL 再 ALTER(残留值变 NULL),否则 ALTER 会违反 NOT NULL 约束。
# 按本项目"数据可清空"规则(CLAUDE.md §7),孤儿残留数据可降级为 NULL。
_FIELDS: list[tuple[str, str, bool]] = [
    # --- plan 子域 ---
    ("ppm_plan_node_detail", "plan_node_id", False),  # NOT NULL, 0 残留
    ("ppm_plan_node_module", "plan_node_id", True),  # NOT NULL, 78 源残留
    ("ppm_plan_node_module", "duty_user_id", False),  # nullable
    # --- ps 计划簇 (阻塞 bug 核心) ---
    ("ppm_ps_plan_node", "ps_project_plan_id", False),  # NOT NULL, 0 残留 ★核心
    ("ppm_ps_plan_node", "duty_user_id", False),  # nullable
    ("ppm_ps_plan_node_detail", "plan_node_id", True),  # NOT NULL, 17 源残留 ★
    ("ppm_ps_plan_node_detail", "module_id", False),  # nullable, 272 残留
    ("ppm_ps_plan_node_detail", "execute_user_id", False),  # nullable
    ("ppm_ps_plan_node_detail", "approve_user_id", False),  # nullable
    ("ppm_ps_plan_node_detail", "audit_user_id", False),  # nullable
    ("ppm_ps_project_plan", "project_id", True),  # NOT NULL, 18 源残留
    ("ppm_ps_project_plan", "project_manager_id", False),  # nullable, 15 残留
    # --- problem 子域 ---
    ("ppm_problem_list", "project_id", False),  # NOT NULL, 0 残留
    ("ppm_problem_list", "module_id", False),  # nullable
    ("ppm_problem_list", "duty_user_id", False),  # nullable
    ("ppm_problem_list", "audit_user_id", False),  # nullable
    ("ppm_problem_change", "project_id", False),  # nullable
    ("ppm_problem_change", "resource_id", False),  # NOT NULL, 0 残留
    ("ppm_problem_change", "duty_user_id", False),  # nullable
    ("ppm_problem_change", "audit_user_id", False),  # nullable
    # --- process 流程表 (business_id 关联单据,handle/next_user_id 关联用户) ---
    # 注:ppm_problem_change_process_log/task.business_id 排除 ——
    # 其值是源变更 Long ID("17"/"18" 等),非 UUID,保留 varchar。
    ("ppm_problem_list_process_log", "business_id", False),  # NOT NULL, 0 残留
    ("ppm_problem_list_process_log", "handle_user_id", False),  # nullable
    ("ppm_problem_list_process_log", "next_user_id", False),  # nullable
    ("ppm_problem_list_process_task", "business_id", False),  # NOT NULL, 0 残留
    ("ppm_problem_change_process_log", "handle_user_id", False),  # nullable
    ("ppm_problem_change_process_log", "next_user_id", False),  # nullable, 27 残留(逗号列表)
    ("ppm_ps_plan_node_detail_process", "business_id", False),  # NOT NULL, 0
    ("ppm_ps_plan_node_detail_process", "handle_user_id", False),  # nullable
    ("ppm_ps_plan_node_detail_process", "next_user_id", False),  # nullable
]


def upgrade() -> None:
    # 先 DROP NOT NULL(对有源残留的 NOT NULL 字段),再统一 ALTER TYPE
    for table, column, drop_nn in _FIELDS:
        if drop_nn:
            op.alter_column(table, column, nullable=True)
    for table, column, _drop_nn in _FIELDS:
        _alter_to_uuid(table, column)
    # 注意:不恢复 NOT NULL —— 残留值已变 NULL,且新数据(运行时生成的 UUID)
    # 仍可正常写入。downgrade 时恢复原 NOT NULL 语义。


def downgrade() -> None:
    # 反序:varchar 回滚(UUID → text 安全,无残留问题)
    # original NOT NULL 的字段在回滚后恢复(仅在原表 schema 是 NOT NULL 时)。
    not_null_fields = {
        ("ppm_plan_node_detail", "plan_node_id"),
        ("ppm_plan_node_module", "plan_node_id"),
        ("ppm_ps_plan_node", "ps_project_plan_id"),
        ("ppm_ps_plan_node_detail", "plan_node_id"),
        ("ppm_ps_project_plan", "project_id"),
        ("ppm_problem_list", "project_id"),
        ("ppm_problem_change", "resource_id"),
        ("ppm_problem_list_process_log", "business_id"),
        ("ppm_problem_list_process_task", "business_id"),
        ("ppm_ps_plan_node_detail_process", "business_id"),
    }
    for table, column, _drop_nn in _FIELDS:
        nullable = (table, column) not in not_null_fields
        op.alter_column(
            table,
            column,
            type_=sa.String(64),
            postgresql_using=f"{column}::text",
            nullable=nullable,
        )
