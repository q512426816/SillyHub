"""task-08 — daemon-client workspace scan dispatch tests (FR-06 / D-003@v1).

daemon-client workspace 的 root_path 在客户端机器上，backend 读不到。
create 跳过本地 scan/copytree；scan-generate 派 scan lease 给绑定 daemon。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

from app.modules.workspace.schema import WorkspaceCreate
from app.modules.workspace.service import WorkspaceService


async def test_create_daemon_client_skips_local_scan(db_session) -> None:
    """daemon-client create 跳过本地 scan（root_path 不存在也不抛 WorkspacePathNotFound）。"""
    runtime_id = uuid.uuid4()
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(
            name="Client Project",
            root_path="/remote/client/path/that/does/not/exist",
            path_source="daemon-client",
            daemon_runtime_id=runtime_id,
        ),
        created_by=None,
    )
    assert ws.path_source == "daemon-client"
    assert ws.daemon_runtime_id == runtime_id
    assert ws.status == "active"


async def test_create_daemon_client_creates_empty_spec_workspace(db_session) -> None:
    """daemon-client create 建 platform-managed 空 SpecWorkspace 占位。"""
    from app.modules.spec_workspace.service import SpecWorkspaceService

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(
            name="Client 2",
            root_path="/remote/x",
            path_source="daemon-client",
            daemon_runtime_id=uuid.uuid4(),
        ),
        created_by=None,
    )
    spec_ws = await SpecWorkspaceService(db_session).get(ws.id)
    assert spec_ws.strategy == "platform-managed"
    assert spec_ws.spec_root  # 平台 spec_root 已生成


async def test_is_daemon_client_payload_helper() -> None:
    """_is_daemon_client_payload 按 path_source 判断。"""
    assert (
        WorkspaceService._is_daemon_client_payload(
            WorkspaceCreate(
                name="x",
                root_path="/x",
                path_source="daemon-client",
                daemon_runtime_id=uuid.uuid4(),
            )
        )
        is True
    )
    assert (
        WorkspaceService._is_daemon_client_payload(WorkspaceCreate(name="x", root_path="/x"))
        is False
    )


async def test_scan_generate_daemon_client_dispatches_scan(db_session) -> None:
    """daemon-client scan-generate 创建 pending workspace + 派 scan lease 给绑定 daemon。"""
    runtime_id = uuid.uuid4()
    user_id = uuid.uuid4()
    service = WorkspaceService(db_session)

    agent_service = AsyncMock()
    agent_run = AsyncMock()
    agent_run.id = uuid.uuid4()
    agent_service.start_scan_dispatch = AsyncMock(return_value=agent_run)

    ws_id, run_id = await service.scan_generate_daemon_client(
        root_path="/remote/client/proj",
        user_id=user_id,
        daemon_runtime_id=runtime_id,
        agent_service=agent_service,
    )

    # 派了 scan lease（强绑路由由 task-03 在 dispatch_to_daemon 内实现）
    agent_service.start_scan_dispatch.assert_awaited_once()
    call_kwargs = agent_service.start_scan_dispatch.await_args.kwargs
    assert call_kwargs["workspace_id"] == ws_id
    assert call_kwargs["root_path"] == "/remote/client/proj"
    assert call_kwargs["user_id"] == user_id
    assert run_id == agent_run.id

    # workspace 落库为 pending daemon-client
    ws = await service.get(ws_id)
    assert ws.path_source == "daemon-client"
    assert ws.daemon_runtime_id == runtime_id
    assert ws.status == "pending"
