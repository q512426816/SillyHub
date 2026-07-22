"""ppm_plan_task task_description 历史回填 (从关联明细同步).

Revision ID: 20260722_backfill_task_desc
Revises: 20260721_ps_plan_add_created_by
Create Date: 2026-07-22

建任务 (PlanTask) 时把明细 ``task_description`` 带到 ``ppm_plan_task.task_description``
是 2026-07-20 (ql-20260720-007, commit a7fc4be1) 才加的逻辑。在此之前建的
600+ 老任务 ``task_description`` 全为 NULL,但其关联明细
``ppm_ps_plan_node_detail.task_description`` 有值,导致看板任务详情
「任务描述」显示「暂无描述」。

本迁移把「关联明细 + 明细有描述 + 任务自身 task_description 为空」的行,
从明细回填。

- 纯 UPDATE,不改表结构;
- 仅回填 ``task_description IS NULL`` 的行,重复 apply 安全(幂等);
- 不动 ``updated_at`` (纯数据修复,保留任务原始更新时间);
- downgrade 不可逆 (清空会丢失用户已编辑值),留空。

author: WhaleFall
created_at: 2026-07-22 00:00:00
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260722_backfill_task_desc"
down_revision = "20260721_ps_plan_add_created_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE ppm_plan_task AS t
        SET task_description = d.task_description
        FROM ppm_ps_plan_node_detail AS d
        WHERE t.ps_plan_node_detail_id = d.id
          AND d.task_description IS NOT NULL
          AND d.task_description <> ''
          AND t.task_description IS NULL
        """
    )


def downgrade() -> None:
    # 数据回填不可逆:不清空已回填/用户已编辑的描述。
    pass
