"""add_gate_fields_to_agent_runs

Revision ID: 7c77e09b84e1
Revises: 419d34f8e33f
Create Date: 2026-07-10 15:10:00.000000

Add two nullable columns to ``agent_runs`` to carry the objective driver
gate verification result for the P3 pilot (change
2026-07-10-p3-driver-gate-pilot, design §8 / task-04):

* ``gate_status`` (str) — pending / running / decided / failed. Written by
  task-05 (close -> pending), task-07 (cas running -> decided / failed) and
  reset by task-10 reconcile on backend restart (orphan pending/running ->
  pending).
* ``gate_result`` (JSON dict) — ``{exit_code: int, errors: list[str],
  raw_envelope: dict}`` produced by task-06 ``_read_gate_result``; model
  layer defines the container only, internal schema is enforced by the
  producer.

Both columns are ``nullable=True`` default ``None`` so pre-existing
``agent_runs`` rows stay regression-free (brownfield, design §9). task-08
falls back to the current declared state when ``gate_status`` is None on
non-verify stages; the verify stage enforces gate (task-08). dialect-agnostic
``add_column`` keeps SQLite (test) and PostgreSQL (prod, JSON -> jsonb
implicit, String(20) -> VARCHAR(20)) aligned. No index needed — task-08
looks up rows by primary key.

author: qinyi
created_at: 2026-07-10 15:10:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c77e09b84e1"
down_revision: str | None = "419d34f8e33f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("gate_status", sa.String(20), nullable=True))
    op.add_column("agent_runs", sa.Column("gate_result", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "gate_result")
    op.drop_column("agent_runs", "gate_status")
