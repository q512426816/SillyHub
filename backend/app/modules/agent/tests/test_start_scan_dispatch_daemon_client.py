"""start_scan_dispatch must not stat daemon-client root_path on the backend."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentService
from app.modules.workspace.model import Workspace


@pytest.mark.asyncio
async def test_start_scan_dispatch_skips_root_path_check_for_daemon_client(
    db_session: AsyncSession,
) -> None:
    workspace = Workspace(
        id=uuid.uuid4(),
        name="Client",
        slug=f"client-{uuid.uuid4().hex[:8]}",
        root_path=r"C:\Users\qinyi\IdeaProjects\happy",
        status="pending",
        path_source="daemon-client",
        daemon_runtime_id=uuid.uuid4(),
    )
    db_session.add(workspace)
    await db_session.commit()

    service = AgentService(db_session)

    with (
        patch.object(service, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=AsyncMock(return_value=uuid.uuid4()),
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch(
            "app.modules.agent.context_builder.build_scan_bundle",
            new=AsyncMock(),
        ),
    ):
        run = await service.start_scan_dispatch(
            workspace_id=workspace.id,
            user_id=uuid.uuid4(),
            root_path=workspace.root_path,
            spec_root="/data/spec-workspaces/demo",
        )

    assert run.status == "pending"
