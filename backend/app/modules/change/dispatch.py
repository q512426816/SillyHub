"""Stage-Driven Agent Dispatch.

Automatic agent dispatch after change workflow transitions.
Each stage that supports agent automation has a ``StageAgentConfig``
defining how the agent should be invoked.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.base import AgentSpecBundle
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


@dataclass
class StageSyncResult:
    """sync_stage_status 的返回值，携带同步结果和步骤状态摘要。"""

    synced: bool  # 同步是否成功
    change_id: uuid.UUID  # 变更 ID
    run_id: uuid.UUID  # 触发同步的 AgentRun ID
    current_stage: str | None = None  # sillyspec.db 中的 current_stage
    current_step: str | None = None  # 第一个 pending step 名称
    stage_completed: bool = False  # 当前 stage 全部 steps 已完成
    has_pending_step: bool = False  # 当前 stage 还有 pending step
    steps_completed: list[str] = field(default_factory=list)
    steps_pending: list[str] = field(default_factory=list)
    error: str | None = None  # synced=False 时的错误描述


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
# Auto-dispatch chain management (task-10)
# ---------------------------------------------------------------------------

_DISPATCH_CHAIN_LIMIT: int = 10


def _get_chain_count(stages: dict) -> int:
    """从 Change.stages JSON 中读取连续 auto-dispatch 计数。"""
    return stages.get("_dispatch_chain_count", 0)


def _increment_chain_count(stages: dict) -> dict:
    """递增连续 auto-dispatch 计数，返回更新后的 stages dict。"""
    stages["_dispatch_chain_count"] = _get_chain_count(stages) + 1
    return stages


def _reset_chain_count(stages: dict) -> dict:
    """重置连续 auto-dispatch 计数为 0。"""
    stages["_dispatch_chain_count"] = 0
    return stages


async def auto_dispatch_next_step(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
    sync_result: StageSyncResult,
) -> dict[str, Any]:
    """根据 sync_stage_status 的结果决定是否自动调度下一个 AgentRun。

    在 sync_stage_status 返回后调用。核心调度链路的"决策点"。

    Args:
        session: 数据库会话
        workspace_id: 工作区 ID
        change_id: 变更 ID
        user_id: 触发用户 ID（通常为上一个 AgentRun 的触发者）
        sync_result: sync_stage_status() 的返回结果

    Returns:
        dispatch 结果字典：
        - {"dispatched": True, "agent_run_id": ..., "stage": ..., "reason": "auto_dispatch"}
        - {"dispatched": False, "reason": "no_pending_step"}
        - {"dispatched": False, "reason": "stage_completed"}
        - {"dispatched": False, "reason": "sync_failed"}
        - {"dispatched": False, "reason": "chain_limit_reached"}
    """
    # 1. sync failed
    if not sync_result.synced:
        log.info(
            "auto_dispatch_skip_sync_failed",
            change_id=str(change_id),
            error=sync_result.error,
        )
        return {"dispatched": False, "reason": "sync_failed"}

    # 2. stage completed
    if sync_result.stage_completed:
        change = await session.get(Change, change_id)
        if change and change.human_gate and change.human_gate != "none":
            log.info(
                "auto_dispatch_blocked_by_gate",
                change_id=str(change_id),
                human_gate=change.human_gate,
                stage=sync_result.current_stage,
            )
            return {
                "dispatched": False,
                "reason": "human_gate_active",
                "human_gate": change.human_gate,
                "stage": sync_result.current_stage,
            }

        # verify auto-fix: if verify completed without gate (failed), try quick fix
        if change and sync_result.current_stage == "verify":
            stages = change.stages or {}
            fix_count = stages.get("_auto_fix_count", 0)
            if fix_count < 3:
                stages["_auto_fix_count"] = fix_count + 1
                change.stages = stages
                session.add(change)
                await session.commit()
                log.info(
                    "verify_auto_fix_dispatching_quick",
                    change_id=str(change_id),
                    attempt=fix_count + 1,
                )
                dispatch_result = await dispatch(
                    session=session,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    target_stage="quick",
                    user_id=user_id,
                )
                dispatch_result["reason"] = "verify_auto_fix"
                return dispatch_result
            else:
                change.human_gate = "blocked"
                stages = change.stages or {}
                stages["_auto_fix_count"] = fix_count
                change.stages = stages
                session.add(change)
                await session.commit()
                log.warning(
                    "verify_auto_fix_limit_reached",
                    change_id=str(change_id),
                    attempts=fix_count,
                )
                return {
                    "dispatched": False,
                    "reason": "verify_auto_fix_limit",
                    "stage": "verify",
                    "human_gate": "blocked",
                }

        log.info(
            "auto_dispatch_skip_stage_completed",
            change_id=str(change_id),
            stage=sync_result.current_stage,
        )
        return {"dispatched": False, "reason": "stage_completed"}

    # 3. no pending step
    if not sync_result.has_pending_step:
        log.info(
            "auto_dispatch_skip_no_pending",
            change_id=str(change_id),
            stage=sync_result.current_stage,
        )
        return {"dispatched": False, "reason": "no_pending_step"}

    # 4. Check chain limit
    change = await session.get(Change, change_id)
    if change is None:
        return {"dispatched": False, "reason": "change_not_found"}

    stages = change.stages or {}
    chain_count = _get_chain_count(stages)
    if chain_count >= _DISPATCH_CHAIN_LIMIT:
        log.warning(
            "dispatch_chain_limit_reached",
            change_id=str(change_id),
            chain_count=chain_count,
            limit=_DISPATCH_CHAIN_LIMIT,
        )
        return {"dispatched": False, "reason": "chain_limit_reached"}

    # 5. Increment chain count and dispatch
    stages = _increment_chain_count(stages)
    change.stages = stages
    session.add(change)
    await session.commit()

    dispatch_result = await dispatch(
        session=session,
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=sync_result.current_stage,
        user_id=user_id,
    )

    if dispatch_result.get("dispatched"):
        dispatch_result["reason"] = "auto_dispatch"
    else:
        # Reset chain count on dispatch failure
        stages = _reset_chain_count(stages)
        change.stages = stages
        session.add(change)
        await session.commit()

    return dispatch_result


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
        "at": datetime.now(UTC).isoformat(),
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
            task_id=None,  # stage-level dispatch, no task association
            lease_id=None,  # determined by AgentService based on config
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
            spec_strategy="sillyspec",
        )
        session.add(run)

        # Step 6: Create M:N workspace association
        session.add(
            AgentRunWorkspace(
                agent_run_id=run.id,
                workspace_id=workspace_id,
            )
        )
        await session.commit()
        await session.refresh(run)

        # Step 7: Record last_dispatch in change.stages JSON
        stages = change.stages or {}
        stages["last_dispatch"] = {
            "stage": target_stage,
            "user_id": str(user_id),
            "at": datetime.now(UTC).isoformat(),
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
    ) -> AgentSpecBundle:
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

    # ------------------------------------------------------------------
    # Stage status sync (task-09)
    # ------------------------------------------------------------------

    async def sync_stage_status(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> StageSyncResult:
        """AgentRun 完成后从 sillyspec.db 同步阶段/步骤状态到 Hub。

        读取 sillyspec.db 的 changes + stages + steps 表，投影到
        Change.current_stage 和 Change.stages JSON。

        Args:
            session: SQLAlchemy async session。
            change_id: 目标变更的 UUID。
            run_id: 刚完成的 AgentRun 的 UUID（用于审计追踪）。

        Returns:
            StageSyncResult 包含同步状态和步骤信息。
            synced=True 表示同步成功。
            synced=False 表示跳过（db 不存在、读取失败等），不中断主流程。

        Raises:
            ChangeNotFound: 当 change_id 在 Hub DB 中不存在时。
        """
        from app.core.errors import ChangeNotFound

        # Step 1: Load Change
        change = await session.get(Change, change_id)
        if change is None:
            raise ChangeNotFound(f"Change '{change_id}' not found.")

        # Step 2: Resolve sillyspec.db path
        db_path = await self._resolve_db_path(session, change)
        if db_path is None or not db_path.is_file():
            log.warning(
                "sync_stage_status.db_not_found",
                change_id=str(change_id),
                db_path=str(db_path) if db_path else None,
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error="sillyspec.db not found",
            )

        # Step 3: Read sillyspec.db
        conn: sqlite3.Connection | None = None
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
        except sqlite3.Error as exc:
            log.info(
                "sync_stage_status.db_connect_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_connect_failed: {exc}",
            )

        try:
            # Step 3a: Find change record by change_key
            row = conn.execute(
                "SELECT current_stage, status FROM changes WHERE name = ?",
                (change.change_key,),
            ).fetchone()

            if row is None:
                log.warning(
                    "sync_stage_status.change_not_in_db",
                    change_key=change.change_key,
                    change_id=str(change_id),
                )
                conn.close()
                return StageSyncResult(
                    synced=False,
                    change_id=change_id,
                    run_id=run_id,
                    error="change_key not found in sillyspec.db",
                )

            db_current_stage = row["current_stage"]

            # Step 3b: Find the current stage record
            stage_row = conn.execute(
                "SELECT id, status, completed_at FROM stages "
                "WHERE change_id = (SELECT id FROM changes WHERE name = ?) "
                "AND stage = ?",
                (change.change_key, db_current_stage),
            ).fetchone()

            stage_completed = False
            steps_completed: list[str] = []
            steps_pending: list[str] = []
            current_step: str | None = None

            if stage_row is not None:
                stage_completed = stage_row["status"] == "completed"

                # Step 3c: Find all steps for this stage
                step_rows = conn.execute(
                    "SELECT name, status FROM steps WHERE stage_id = ? ORDER BY ordering",
                    (stage_row["id"],),
                ).fetchall()

                for step in step_rows:
                    if step["status"] == "completed":
                        steps_completed.append(step["name"])
                    else:
                        steps_pending.append(step["name"])

                # Step 3d: Determine current_step (first non-completed)
                has_pending = len(steps_pending) > 0
                if has_pending:
                    current_step = steps_pending[0]
            else:
                # Stage record doesn't exist yet
                has_pending = True
                current_step = None

        except sqlite3.Error as exc:
            log.info(
                "sync_stage_status.db_read_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            if conn:
                conn.close()
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_read_failed: {exc}",
            )
        finally:
            if conn:
                conn.close()

        # Step 4: Sync current_stage to Change record
        if change.current_stage != db_current_stage:
            log.info(
                "sync_stage_status.stage_updated",
                change_id=str(change_id),
                old=change.current_stage,
                new=db_current_stage,
            )
            change.current_stage = db_current_stage

        # Step 5: Sync step status to Change.stages JSON
        stages_json = change.stages or {}
        stage_key = db_current_stage
        stages_json[stage_key] = {
            "status": "completed" if stage_completed else "in_progress",
            "steps": {
                "completed": steps_completed,
                "pending": steps_pending,
            },
            "current_step": current_step,
            "synced_at": datetime.now(UTC).isoformat(),
            "synced_from_run": str(run_id),
        }
        change.stages = stages_json
        change.updated_at = datetime.now(UTC)
        session.add(change)
        await session.commit()

        # Step 6: Build and return StageSyncResult
        return StageSyncResult(
            synced=True,
            change_id=change_id,
            run_id=run_id,
            current_stage=db_current_stage,
            current_step=current_step,
            stage_completed=stage_completed,
            has_pending_step=len(steps_pending) > 0,
            steps_completed=steps_completed,
            steps_pending=steps_pending,
        )

    async def _resolve_db_path(
        self,
        session: AsyncSession,
        change: Change,
    ) -> Path | None:
        """解析 sillyspec.db 文件路径。

        优先使用 SpecWorkspace.spec_root，fallback 到 workspace.root_path。
        返回 None 表示无法确定路径。
        """
        from app.core.spec_paths import SpecPathResolver

        try:
            from app.modules.spec_workspace.model import SpecWorkspace

            stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == change.workspace_id)
            spec_ws = (await session.execute(stmt)).scalars().first()

            if spec_ws and spec_ws.strategy != "repo-native":
                resolver_root = spec_ws.spec_root
                return SpecPathResolver(resolver_root).db_path()
        except Exception:
            pass

        # Fallback: use workspace root_path
        from app.modules.workspace.model import Workspace

        ws_stmt = select(Workspace).where(Workspace.id == change.workspace_id)
        workspace = (await session.execute(ws_stmt)).scalars().first()
        if not workspace or not workspace.root_path:
            return None

        return SpecPathResolver(workspace.root_path).db_path()


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
