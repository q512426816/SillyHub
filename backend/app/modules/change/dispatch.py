"""Stage-Driven Agent Dispatch.

Automatic agent dispatch after change workflow transitions.
Each stage that supports agent automation has a ``StageAgentConfig``
defining how the agent should be invoked.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentRun

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Stage agent configuration
# ---------------------------------------------------------------------------


@dataclass
class StageAgentConfig:
    """Configuration for automatic agent dispatch at a given stage."""

    enabled: bool = True
    prompt_template: str = ""  # filename under prompts/ directory (e.g. "clarifying.md")
    phase: str = ""  # human-readable phase label
    requires_worktree: bool = False  # True = needs a worktree lease for writes
    description: str = ""
    read_only: bool = True  # True = agent should only read/analyse, not write code


STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    "propose": StageAgentConfig(
        enabled=True,
        prompt_template="clarifying.md",
        phase="Proposal / Clarification",
        requires_worktree=False,
        read_only=True,
        description="Review change proposal and identify ambiguities; produce clarifying questions.",
    ),
    "plan": StageAgentConfig(
        enabled=True,
        prompt_template="plan_tasks.md",
        phase="Task Planning",
        requires_worktree=False,
        read_only=True,
        description="Break down the change into concrete implementation tasks.",
    ),
    "execute": StageAgentConfig(
        enabled=True,
        prompt_template="execute_task.md",
        phase="Task Execution",
        requires_worktree=True,
        read_only=False,
        description="Implement the assigned task within the change worktree.",
    ),
    "verify": StageAgentConfig(
        enabled=True,
        prompt_template="verify.md",
        phase="Technical Verification",
        requires_worktree=True,
        read_only=False,
        description="Run verification checks against the implementation in the worktree.",
    ),
    "brainstorm": StageAgentConfig(
        enabled=True,
        prompt_template="design_review.md",
        phase="Brainstorm / Design Review",
        requires_worktree=False,
        read_only=True,
        description="Analyze change design docs for completeness, consistency, and risk.",
    ),
    "scan": StageAgentConfig(
        enabled=True,
        prompt_template="review.md",
        phase="Scan / Review",
        requires_worktree=False,
        read_only=True,
        description="Summarize the change for review, highlighting risks and impact.",
    ),
}


# ---------------------------------------------------------------------------
# AgentDispatchService
# ---------------------------------------------------------------------------


def get_config_for_stage(stage: str) -> StageAgentConfig | None:
    """Return the ``StageAgentConfig`` for *stage*, or ``None`` if not configured."""
    return STAGE_AGENT_CONFIG.get(stage)


async def has_active_run(session: AsyncSession, change_id: uuid.UUID) -> bool:
    """Return ``True`` if there is a pending/running AgentRun for this change."""
    stmt = select(AgentRun).where(
        col(AgentRun.change_id) == change_id,
        col(AgentRun.status).in_(["pending", "running"]),
    )
    row = (await session.execute(stmt)).scalars().first()
    return row is not None


async def dispatch(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    target_stage: str,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Dispatch an agent for the given stage transition.

    Returns a dict with dispatch result info (empty dict if no dispatch was triggered).
    Failures are logged but never propagated — dispatch is best-effort.
    """
    config = get_config_for_stage(target_stage)
    if config is None or not config.enabled:
        return {"dispatched": False, "reason": f"no_config_for_stage:{target_stage}"}

    # Check for concurrent runs
    if await has_active_run(session, change_id):
        return {
            "dispatched": False,
            "reason": "active_run_exists",
            "stage": target_stage,
        }

    # Record last_dispatch in change stages JSON (loaded fresh to avoid stale data)
    from app.modules.change.model import Change

    change = await session.get(Change, change_id)
    if change is None:
        return {"dispatched": False, "reason": "change_not_found"}

    stages = change.stages or {}
    stages["last_dispatch"] = {
        "stage": target_stage,
        "user_id": str(user_id),
        "at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "prompt_template": config.prompt_template,
            "requires_worktree": config.requires_worktree,
            "read_only": config.read_only,
        },
    }
    change.stages = stages
    session.add(change)
    await session.commit()

    # Defer to AgentService.start_stage_dispatch
    try:
        from app.modules.agent.service import AgentService

        agent_service = AgentService(session)
        run = await agent_service.start_stage_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            user_id=user_id,
            stage=target_stage,
            prompt_template=config.prompt_template,
            requires_worktree=config.requires_worktree,
            read_only=config.read_only,
        )
        return {
            "dispatched": True,
            "agent_run_id": str(run.id),
            "stage": target_stage,
            "phase": config.phase,
        }
    except Exception as exc:
        log.warning(
            "stage_dispatch_failed",
            stage=target_stage,
            change_id=str(change_id),
            error=str(exc),
        )
        return {
            "dispatched": False,
            "reason": "dispatch_error",
            "error": str(exc),
            "stage": target_stage,
        }


# ---------------------------------------------------------------------------
# Prompt template loader
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt_template(template_name: str, context: dict[str, Any] | None = None) -> str:
    """Load and render a prompt template.

    The template is a simple markdown file. ``{{variable}}`` placeholders
    are replaced with values from *context*.
    """
    path = _PROMPTS_DIR / template_name
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        log.warning("prompt_template_not_found", template_name=template_name)
        return ""

    if context:
        for key, value in context.items():
            text = text.replace(f"{{{{{key}}}}}", str(value))

    return text
