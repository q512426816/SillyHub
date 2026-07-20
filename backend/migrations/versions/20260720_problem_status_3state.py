"""ppm_problem_list.status 简化为 3 态中文 (problem-list-align-task-plan, D-001)。

Revision ID: 20260720_problem_status_3state
Revises: 20260720_plan_task_desc
Create Date: 2026-07-20

变更 2026-07-20-problem-list-align-task-plan / task-06。对齐任务计划 PlanTask.status
的中文 3 态 (新建 / 进行中 / 已完成)，删问题清单历史 7 态审批流
(已保存/审核中/处置中/已关闭/已作废/待验证/变更中)。

数据映射 (decisions.md D-001)：
- '1' 已保存 / '2' 审核中 / '5' 已作废 / '6' 待验证 / '7' 变更中(防御) → '新建'
- '3' 处置中(执行中) → '进行中'
- '4' 已关闭(已完成) → '已完成'

PG varchar(n) 按字符计长，'进行中' 3 字符 ≤ varchar(8)，UPDATE 在旧列宽下即可成功；
随后 ALTER 列宽 8→30 与 model ``String(30)`` 对齐 (batch 兼容 SQLite)。

problem_change 表 status (1/2/3) 不动 (D-005 deprecated 保留)。项目未上线
(CLAUDE.md 规则 11 允许重置)，downgrade 把 3 态回写为旧数字兜底。

author: qinyi
created_at: 2026-07-20 13:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260720_problem_status_3state"
down_revision = "20260720_plan_task_desc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """旧 1-7 状态 → 3 态中文 + 列宽 8→30。"""
    op.execute(
        "UPDATE ppm_problem_list SET status = CASE status "
        "WHEN '1' THEN '新建' "
        "WHEN '2' THEN '新建' "
        "WHEN '3' THEN '进行中' "
        "WHEN '4' THEN '已完成' "
        "WHEN '5' THEN '新建' "
        "WHEN '6' THEN '新建' "
        "WHEN '7' THEN '新建' "
        "ELSE status END"
    )
    with op.batch_alter_table("ppm_problem_list", schema=None) as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=8),
            type_=sa.String(length=30),
            existing_nullable=False,
        )


def downgrade() -> None:
    """3 态中文 → 旧数字 (新建→1 / 进行中→3 / 已完成→4) + 列宽 30→8。"""
    op.execute(
        "UPDATE ppm_problem_list SET status = CASE status "
        "WHEN '新建' THEN '1' "
        "WHEN '进行中' THEN '3' "
        "WHEN '已完成' THEN '4' "
        "ELSE status END"
    )
    with op.batch_alter_table("ppm_problem_list", schema=None) as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=30),
            type_=sa.String(length=8),
            existing_nullable=False,
        )
