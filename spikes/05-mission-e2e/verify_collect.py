"""Verify collect_completed_artifacts in the live DB (Wave 3 回灌 logic).

Builds a throwaway Mission with one completed + one running Worker, calls
collect_completed_artifacts twice (idempotency), and prints reaped counts +
artifact content. Confirms the 回灌 logic is correct end-to-end in Postgres.

  docker exec -e PYTHONPATH=/app multi-agent-platform-backend-1 \
    python /host-projects/multi-agent-platform/spikes/05-mission-e2e/verify_collect.py
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.core.db import get_session_factory
from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun
from app.modules.workspace.model import Workspace

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


async def main() -> int:
    sf = get_session_factory()
    async with sf() as s:
        ws = (await s.execute(select(Workspace).limit(1))).scalars().first()
        if not ws:
            print("FAIL: no workspace")
            return 2

        mission = AgentMission(
            workspace_id=ws.id, objective="verify collect (throwaway)"
        )
        s.add(mission)
        await s.commit()
        await s.refresh(mission)

        w_done = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="o1",
            output_redacted="agent 目录实现 agent 执行/编排/工具网关（模拟完成产出）。",
        )
        w_running = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="running",
            role="test",
            objective="o2",
        )
        s.add_all([w_done, w_running])
        await s.commit()
        await s.refresh(w_done)
        await s.refresh(w_running)

        exec_svc = MissionExecutionService(s)
        n1 = await exec_svc.collect_completed_artifacts(mission.id)
        n2 = await exec_svc.collect_completed_artifacts(mission.id)  # idempotent

        arts = (
            (
                await s.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == w_done.id)
                )
            )
            .scalars()
            .all()
        )
        arts_running = (
            (
                await s.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == w_running.id)
                )
            )
            .scalars()
            .all()
        )

        print(f"reaped_first={n1} (expect 1)")
        print(f"reaped_second={n2} (expect 0 — idempotent)")
        print(f"artifacts_for_completed={len(arts)} (expect 1)")
        print(f"artifacts_for_running={len(arts_running)} (expect 0 — not completed)")
        if arts:
            print(f"sample content={arts[0].content_ref[:90]!r}")
        ok = n1 == 1 and n2 == 0 and len(arts) == 1 and not arts_running
        print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
