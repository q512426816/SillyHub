"""End-to-end Mission run + Artifact 回灌验证 (2026-06-19-multi-agent-orchestration).

Run INSIDE the backend container against the live stack (real GLM + online
daemon). Full loop: plan -> dispatch -> poll workers to terminal -> reap
Artifacts. Does NOT restart backend (that interrupts running workers).

  docker exec -e PYTHONPATH=/app multi-agent-platform-backend-1 \
    python /host-projects/multi-agent-platform/spikes/05-mission-e2e/run_e2e.py
"""

from __future__ import annotations

import asyncio
import sys
import time

from sqlalchemy import select

from app.core.db import get_session_factory
from app.modules.agent.control import MissionControlService
from app.modules.agent.delegation import CoordinatorPlanner, GLMConfig
from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.mission import MissionService
from app.modules.agent.model import AgentArtifact
from app.modules.auth.model import User
from app.modules.workspace.model import Workspace

# Register ALL models so SQLAlchemy metadata resolves every cross-module FK.
from app.modules.admin import model as _admin_model  # noqa: F401
from app.modules.change import model as _change_model  # noqa: F401
from app.modules.daemon import model as _daemon_model  # noqa: F401
from app.modules.git_identity import model as _git_identity_model  # noqa: F401
from app.modules.scan_docs import model as _scan_docs_model  # noqa: F401
from app.modules.spec_workspace import model as _spec_ws_model  # noqa: F401
from app.modules.task import model as _task_model  # noqa: F401
from app.modules.tool_gateway import tool_policy as _tool_policy_model  # noqa: F401
from app.modules.workflow import model as _workflow_model  # noqa: F401
from app.modules.worktree import model as _worktree_model  # noqa: F401

# Kept simple so the Worker finishes fast (we're validating the 回灌 loop,
# not analysis depth).
OBJECTIVE = "一句话回答：这个项目的后端用的是 Python 吗？"
WRITE_ROLES = frozenset({"impl"})
TERMINAL = ("completed", "failed", "killed")


async def main() -> int:
    cfg = GLMConfig.from_env()
    if cfg is None:
        print("FAIL: GLMConfig None")
        return 2
    print(f"GLM: {cfg.model}")

    sf = get_session_factory()
    async with sf() as session:
        ws = (await session.execute(select(Workspace).limit(1))).scalars().first()
        user = (await session.execute(select(User).limit(1))).scalars().first()
        if not ws or not user:
            print("FAIL: no workspace/user")
            return 2
        ws_id, user_id = ws.id, user.id

        planner = CoordinatorPlanner(cfg)
        mission, runs = await MissionService(session).start_mission(
            workspace_id=ws_id,
            objective=OBJECTIVE,
            created_by=user_id,
            planner=planner,
            budget_usd=1.0,
        )
        mission_id = mission.id
        print(f"MISSION {mission_id}: {len(runs)} workers planned")
        exec_svc = MissionExecutionService(session)
        for run in runs:
            read_only = run.role not in WRITE_ROLES
            try:
                await exec_svc.dispatch_worker(
                    run, workspace_id=ws_id, user_id=user_id, read_only=read_only
                )
                print(f"  dispatched role={run.role} read_only={read_only}")
            except Exception as exc:  # noqa: BLE001
                print(f"  DISPATCH FAILED role={run.role}: {exc}")

    print("polling workers until terminal (max 900s)...")
    deadline = time.time() + 900
    while time.time() < deadline:
        await asyncio.sleep(10)
        async with sf() as session:
            runs = await MissionControlService(session).worker_runs(mission_id)
        statuses = [(r.role, r.status) for r in runs]
        print(f"  {statuses}")
        if runs and all(r.status in TERMINAL for r in runs):
            break

    async with sf() as session:
        reaped = await MissionExecutionService(session).collect_completed_artifacts(
            mission_id
        )
        runs = await MissionControlService(session).worker_runs(mission_id)
        print(f"\nFINAL workers: {[(r.role, r.status) for r in runs]}")
        print(f"Artifacts reaped: {reaped}")
        for r in runs:
            arts = (
                (
                    await session.execute(
                        select(AgentArtifact).where(AgentArtifact.run_id == r.id)
                    )
                )
                .scalars()
                .all()
            )
            for a in arts:
                print(
                    f"  artifact run={r.role} kind={a.kind} content={a.content_ref[:180]!r}"
                )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
