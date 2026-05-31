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
from app.modules.change.model import Change, StageEnum

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
    StageEnum.SCAN.value: StageAgentConfig(
        enabled=True,
        prompt_template="scan.md",
        phase="Scan",
        requires_worktree=False,
        read_only=False,
        description="Write scan documents to .sillyspec/docs/.",
    ),
    StageEnum.BRAINSTORM.value: StageAgentConfig(
        enabled=True,
        prompt_template="brainstorm.md",
        phase="Brainstorm",
        requires_worktree=True,
        read_only=False,
        description="Write question lists and decision records to change directory.",
    ),
    StageEnum.PROPOSE.value: StageAgentConfig(
        enabled=True,
        prompt_template="propose.md",
        phase="Propose",
        requires_worktree=True,
        read_only=False,
        description="Write the four-piece proposal set to change directory.",
    ),
    StageEnum.PLAN.value: StageAgentConfig(
        enabled=True,
        prompt_template="plan.md",
        phase="Plan",
        requires_worktree=True,
        read_only=False,
        description="Write plan.md and task blueprints.",
    ),
    StageEnum.EXECUTE.value: StageAgentConfig(
        enabled=True,
        prompt_template="execute.md",
        phase="Execute",
        requires_worktree=True,
        read_only=False,
        description="Implement tasks; must use worktree.",
    ),
    StageEnum.VERIFY.value: StageAgentConfig(
        enabled=True,
        prompt_template="verify.md",
        phase="Verify",
        requires_worktree=True,
        read_only=False,
        description="Write verify-result.md and run verification checks.",
    ),
    StageEnum.ARCHIVE.value: StageAgentConfig(
        enabled=True,
        prompt_template="archive.md",
        phase="Archive",
        requires_worktree=True,
        read_only=False,
        description="Write module-impact analysis and move change directory to archive.",
    ),
    StageEnum.QUICK.value: StageAgentConfig(
        enabled=True,
        prompt_template="quick.md",
        phase="Quick",
        requires_worktree=True,
        read_only=False,
        description="Write quicklog and may modify code directly.",
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
# SillySpecStageDispatchService — unified dispatch entry (task-07)
# ---------------------------------------------------------------------------


class SillySpecStageDispatchService:
    """Unified dispatch entry: create AgentRun + compose agent instructions.

    Replaces the legacy ``dispatch()`` function as the sole entry point
    for all stage-level agent dispatch.  Callers include:
    - ChangeService.transition_with_dispatch()
    - POST /changes/{id}/dispatch route
    - sync_stage_status() internal auto-dispatch
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize the dispatch service.

        Args:
            session: Async database session.
        """
        self._session = session

    async def dispatch_next_step(
        self,
        session: AsyncSession,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
        target_stage: str,
    ) -> dict[str, Any]:
        """Dispatch the next step for a change stage.

        Checks stage config -> checks active runs -> builds bundle
        -> creates AgentRun -> starts execution -> returns result.

        Args:
            session: Async database session.
            workspace_id: Workspace UUID.
            change_id: Change UUID.
            user_id: User UUID triggering the dispatch.
            target_stage: Target SillySpec stage name (e.g. "propose").

        Returns:
            Dict with dispatched, agent_run_id, stage, reason, etc.

        Raises:
            ChangeNotFound: change_id does not correspond to an existing Change.
        """
        from app.core.errors import ChangeNotFound
        from app.modules.agent.base import AgentSpecBundle
        from app.modules.workspace.model import AgentRunWorkspace

        # Step 1: Check STAGE_AGENT_CONFIG
        config = STAGE_AGENT_CONFIG.get(target_stage)
        if config is None:
            return {"dispatched": False, "reason": "stage_not_configured", "stage": target_stage}
        if not config.enabled:
            return {"dispatched": False, "reason": "stage_not_enabled", "stage": target_stage}

        # Step 2: Check Change exists
        change = await session.get(Change, change_id)
        if change is None:
            raise ChangeNotFound(f"Change '{change_id}' not found.")

        # Step 3: Check active AgentRun (prevent duplicate dispatch)
        if await has_active_run(session, change_id):
            return {"dispatched": False, "reason": "active_run_exists", "stage": target_stage}

        # Step 4: Build AgentSpecBundle
        try:
            await self._build_stage_bundle(session, change_id, target_stage, workspace_id)
        except Exception as exc:
            log.warning(
                "bundle_build_failed",
                change_id=str(change_id),
                stage=target_stage,
                error=str(exc),
            )
            return {"dispatched": False, "reason": "bundle_build_error", "stage": target_stage}

        # Step 5: Create AgentRun record
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,              # stage-level dispatch, no task association
            lease_id=None,             # determined by AgentService based on config
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
            spec_strategy="sillyspec",
        )
        session.add(run)

        # Step 6: Create M:N workspace association
        session.add(AgentRunWorkspace(
            agent_run_id=run.id,
            workspace_id=workspace_id,
        ))
        await session.commit()
        await session.refresh(run)

        # Step 7: Record last_dispatch in change.stages JSON
        stages = change.stages or {}
        stages["last_dispatch"] = {
            "stage": target_stage,
            "user_id": str(user_id),
            "at": datetime.now(timezone.utc).isoformat(),
            "run_id": str(run.id),
            "config": {
                "phase": config.phase,
                "requires_worktree": config.requires_worktree,
                "read_only": config.read_only,
            },
        }
        change.stages = stages
        session.add(change)
        await session.commit()

        # Step 8: Start Agent execution
        try:
            from app.modules.agent.service import AgentService

            agent_service = AgentService(session)
            await agent_service.start_stage_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                user_id=user_id,
                stage=target_stage,
                prompt_template=config.prompt_template,
                requires_worktree=config.requires_worktree,
                read_only=config.read_only,
            )
        except Exception as exc:
            log.warning("agent_start_failed", run_id=str(run.id), error=str(exc))
            # Mark run as failed, keep record for debugging
            run.status = "failed"
            run.output_redacted = f"Agent start failed: {exc}"
            session.add(run)
            await session.commit()
            return {"dispatched": False, "reason": "agent_start_error", "stage": target_stage}

        # Step 9: Return success
        return {
            "dispatched": True,
            "agent_run_id": str(run.id),
            "stage": target_stage,
        }

    async def _build_stage_bundle(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
        stage: str,
        workspace_id: uuid.UUID,
    ) -> "AgentSpecBundle":
        """Build a stage-level AgentSpecBundle.

        Tries ``context_builder.build_stage_bundle()`` first; if unavailable
        (e.g. task-05 not yet complete), falls back to a minimal bundle.

        Args:
            session: Async database session.
            change_id: Change UUID.
            stage: Target stage name.
            workspace_id: Workspace UUID.

        Returns:
            AgentSpecBundle with stage_dispatch=True.
        """
        from app.modules.agent.base import AgentSpecBundle

        # Try task-05 build_stage_bundle
        try:
            from app.modules.agent.context_builder import build_stage_bundle

            return await build_stage_bundle(
                session=session,
                change_id=change_id,
                stage=stage,
                workspace_id=workspace_id,
            )
        except ImportError:
            log.info("build_stage_bundle_not_available, using fallback")
        except Exception as exc:
            log.warning("build_stage_bundle_failed", error=str(exc))

        # Fallback: minimal bundle
        change = await session.get(Change, change_id)
        return AgentSpecBundle(
            change_summary=change.title if change else f"Stage dispatch: {stage}",
            task_key=f"stage:{stage}",
            task_title=f"Stage dispatch: {stage}",
            stage_dispatch=True,
            change_key=change.change_key if change else None,
            stage=stage,
            spec_root=None,
            read_only=False,
        )


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
