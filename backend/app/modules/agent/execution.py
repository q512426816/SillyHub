"""Mission Worker execution + Artifact collection (Wave 3, 2026-06-19-multi-agent-orchestration).

Dispatches pending mission Worker Runs to a daemon via ``RunPlacementService``
(same lease mechanism as stage dispatch — daemon needs no change to run them),
with per-Worker tool governance (brainstorm 坑 1 / D5): read-only Workers get a
read-only tool whitelist, write Workers get an edit whitelist. This does NOT
touch the existing batch stage path's ``bypassPermissions`` (avoids the ❓1
regression) — only mission Workers get the explicit whitelist.

Artifact collection is intentionally simple in v1: a Worker's structured output
becomes one ``summary`` Artifact. Richer parsing (patch / test_result) lands
with the Finalizer in Wave 4/6.

NOTE (D-004@v2, 2026-06-28-team-mainline-integration): ``tool_config`` is passed
through to the lease but the daemon does NOT apply it — ``--allowedTools`` is a
daemon-side change not done in v1. Design Grill F1 further confirmed
``canUseTool`` human-approval is only injected for interactive sessions
(``permission_service.py``), not batch Worker leases, so write-Worker tool-level
approval is also unavailable in v1. **v1 工具治理 = 不强制**: read-only and write
Workers both run under the daemon's default policy + prompt constraints; safety
for execute write-Workers converges at the Finalizer's human-reviewed patch
apply-back (D-006@v1), not at the tool layer. The whitelist below is retained as
a forward-compatibility hint for when daemon ``--allowedTools`` support lands.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentArtifact, AgentRun
from app.modules.agent.placement import RunPlacementService
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)


def worker_tool_config(read_only: bool) -> dict[str, object]:
    """Per-Worker tool governance (brainstorm 坑 1 / D5).

    Replaces the blanket ``bypassPermissions`` for mission Workers with an
    explicit whitelist scoped to the Worker's role. Read-only Workers never get
    write tools; write Workers get edit tools under ``acceptEdits``. ``max_turns``
    bounds execution so a Worker can't run unbounded (without it read-only
    analysis Workers ran 6min+).
    """
    if read_only:
        return {
            "mode": "plan",
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 25,
        }
    return {
        "mode": "acceptEdits",
        "allowed_tools": ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
        "max_turns": 30,
    }


def render_worker_prompt(run: AgentRun) -> str:
    """Render a Worker's execution prompt from its delegation objective."""
    role = run.role or "worker"
    objective = run.objective or "(未指定目标)"
    return (
        f"你是多 Agent 团队中的一个 Worker（角色：{role}）。\n"
        f"你的目标：{objective}\n\n"
        "完成目标后，输出一份结构化摘要（发现/结论/产出文件路径/风险），"
        "供 Coordinator 收敛。不要输出与目标无关的内容。"
    )


class MissionExecutionService:
    """Dispatches mission Worker Runs to a daemon + collects their Artifacts."""

    def __init__(
        self,
        session: AsyncSession,
        placement: RunPlacementService | None = None,
    ) -> None:
        self._session = session
        self._placement = placement or RunPlacementService(session)

    async def dispatch_worker(
        self,
        run: AgentRun,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        read_only: bool,
    ) -> uuid.UUID | None:
        """Dispatch a pending mission Worker Run to a daemon.

        Returns the daemon lease id (or None if the runtime went offline).
        Raises if the Run is not pending.
        """
        if run.status != "pending":
            raise ValueError(f"dispatch_worker requires pending Run, got {run.status!r}")

        ws = await self._session.get(Workspace, workspace_id)
        repo_url = ws.repo_url if ws else None
        branch = ws.default_branch if ws else None
        # 2026-06-29：Worker lease 透传 root_path（resolve_root_path_for_daemon
        # 容器→宿主机改写），让 daemon prepareWorkspace 在项目根执行（非空 mirror）。
        root_path = (
            resolve_root_path_for_daemon(ws.root_path, ws.path_source)
            if ws and ws.root_path
            else None
        )
        # provider must be a daemon-known name ("claude"); fall back when the
        # workspace hasn't configured default_agent — otherwise daemon rejects
        # with "unsupported provider: claude_code" (it falls back to agent_type).
        provider = (ws.default_agent if ws else None) or "claude"
        model = ws.default_model if ws else None

        lease_id = await self._placement.dispatch_to_daemon(
            run.id,
            user_id,
            workspace_id=workspace_id,
            provider=provider,
            model=model,
            prompt=render_worker_prompt(run),
            repo_url=repo_url,
            branch=branch,
            stage=run.role or "mission_worker",
            read_only=read_only,
            tool_config=worker_tool_config(read_only),
            root_path=root_path,
        )
        if lease_id is not None:
            log.info(
                "mission_worker_dispatched",
                run_id=str(run.id),
                role=run.role,
                lease_id=str(lease_id),
                read_only=read_only,
            )
        return lease_id

    async def collect_artifact(
        self,
        run: AgentRun,
        output_text: str,
        *,
        kind: str = "summary",
    ) -> AgentArtifact:
        """Persist a Worker's structured output as an AgentArtifact.

        v1 stores the whole (truncated) output as one ``summary`` artifact.
        """
        artifact = AgentArtifact(
            run_id=run.id,
            kind=kind,
            content_ref=output_text[:8000],
        )
        self._session.add(artifact)
        await self._session.commit()
        await self._session.refresh(artifact)
        log.info(
            "mission_artifact_collected",
            run_id=str(run.id),
            kind=kind,
            bytes=len(output_text[:8000]),
        )
        return artifact

    async def collect_completed_artifacts(self, mission_id: uuid.UUID) -> int:
        """Lazily collect each completed Worker's output as a summary Artifact.

        Idempotent — Workers already having an Artifact are skipped. This is the
        Artifact 回灌 hook (Wave 3 gap #1): workers produce structured output on
        the daemon; their final summary lands in ``AgentRun.output_redacted`` via
        the lease-complete callback, and this method persists it as an
        ``AgentArtifact`` so the Coordinator / UI can consume it without touching
        raw logs.
        """
        stmt = select(AgentRun).where(
            col(AgentRun.mission_id) == mission_id,
            AgentRun.status == "completed",
        )
        collected = 0
        for run in (await self._session.execute(stmt)).scalars().all():
            has = (
                (
                    await self._session.execute(
                        select(AgentArtifact).where(AgentArtifact.run_id == run.id).limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if has:
                continue
            await self.collect_artifact(run, run.output_redacted or "(无产出)", kind="summary")
            collected += 1
        if collected:
            log.info("mission_artifacts_reaped", mission_id=str(mission_id), n=collected)
        return collected
