"""add agent_runs.created_at for stale-pending orphan cleanup

Change: 2026-06-19-multi-agent-orchestration (Wave0 follow-up, ql-20260620-001)

``AgentRun`` previously had no creation timestamp (only ``started_at`` /
``finished_at``, both NULL while a Run is ``pending``). That made it impossible
to age-gate pending Runs, so a pending orphan (e.g. ``start_stage_dispatch``
committing a Run then raising before ``dispatch_to_daemon`` lands) could block
its change forever — ``has_active_run`` counts ``pending`` as active while
``reconcile_stale_runs`` only cleans ``running``.

Adds ``agent_runs.created_at`` (NOT NULL, server_default now()) so
``cleanup_stale_pending_runs`` can tell stale orphans apart from in-flight
pending Runs. Existing rows backfill to the migration timestamp, which is safe:
any pre-existing pending Run is by definition already orphaned.

Revision ID: 202607050900
Revises: 202607040900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607050900"
down_revision = "202607040900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default=now() lets add_column NOT NULL succeed on existing rows
    # (PostgreSQL fills DEFAULT for backfill); mirrors the daemon_task_leases.kind
    # pattern in 202607040900.
    op.add_column(
        "agent_runs",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "created_at")
