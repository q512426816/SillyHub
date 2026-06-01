"""Unify workflow stages: map old stage values to new SillySpec-aligned stages.

Revision ID: 202606190900
Revises: 202606180900
"""

from __future__ import annotations

from alembic import op

revision = "202606190900"
down_revision = "202606180900"
branch_labels = None
depends_on = None

# Old stage value → new stage value
STAGE_MAP = {
    "clarifying": "propose",
    "design_review": "propose",
    "ready_for_dev": "plan",
    "in_dev": "execute",
    "technical_verification": "verify",
    "business_review": "verify",
    # old "archived" (terminal) → "accepted" (pre-archive confirmation)
    # Only map rows where current_stage = old "archived" AND status = old "archived"
}

STAGE_MAP_STATUS = {
    **STAGE_MAP,
    "archived": "accepted",
}


def upgrade() -> None:
    """Idempotent migration: map old stage/status values to new unified ones."""
    conn = op.get_bind()

    # Update changes.current_stage
    for old_val, new_val in STAGE_MAP.items():
        conn.execute(
            __import__("sqlalchemy").text(
                "UPDATE changes SET current_stage = :new WHERE current_stage = :old"
            ),
            {"old": old_val, "new": new_val},
        )

    # Update changes.status — same mapping, plus archived → accepted
    for old_val, new_val in STAGE_MAP_STATUS.items():
        conn.execute(
            __import__("sqlalchemy").text("UPDATE changes SET status = :new WHERE status = :old"),
            {"old": old_val, "new": new_val},
        )

    # Update stages JSON: rewrite rework_target references
    rework_target_map = {
        "clarifying": "propose",
        "design_review": "propose",
        "in_dev": "execute",
    }
    for old_val, new_val in rework_target_map.items():
        conn.execute(
            __import__("sqlalchemy").text(
                "UPDATE changes SET stages = REPLACE(stages::text, :old_json, :new_json)::json "
                "WHERE stages::text LIKE :pattern"
            ),
            {
                "old_json": f'"rework_target": "{old_val}"',
                "new_json": f'"rework_target": "{new_val}"',
                "pattern": f"%rework_target%{old_val}%",
            },
        )

    # Update changes.feedback_category rework targets stored in stages JSON
    # (FEEDBACK_TARGETS in service.py will be updated separately)


def downgrade() -> None:
    """Reverse mapping is not provided — this is a one-way semantic migration."""
    pass
