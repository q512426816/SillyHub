"""task-08 — daemon-client workspace scan dispatch tests (FR-06 / D-003@v1).

daemon-client workspace 的 root_path 在客户端机器上，backend 读不到。
create 跳过本地 scan/copytree；scan-generate 派 scan lease 给绑定 daemon。

Change 2026-07-03-daemon-entity-binding task-10/11 补遗：daemon-client create
改走 daemon_id 维度（守护进程实体）。WorkspaceCreate.daemon_id 必填（与
daemon_runtime_id 至少一个非空，daemon_id 优先），create 成员绑定行
workspace_member_runtimes{workspace_id,user_id,daemon_id,root_path,path_source}。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.service import get_my_binding
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


# ---------------------------------------------------------------------------
# daemon-entity-binding 补遗（task-10/11）：daemon-client create 走 daemon_id 维度
# ---------------------------------------------------------------------------


def test_workspace_create_daemon_id_replaces_runtime_id_for_daemon_client() -> None:
    """WorkspaceCreate.path_source='daemon-client' 必填 daemon_id（不再要求 daemon_runtime_id）。

    单传 daemon_id 应通过；同时传 daemon_runtime_id（legacy fallback）也通过；
    daemon-client 且两者都缺时 ValidationError。
    """
    # 只传 daemon_id（新链路）：合法
    payload = WorkspaceCreate(
        name="x",
        root_path="/x",
        path_source="daemon-client",
        daemon_id=uuid.uuid4(),
    )
    assert payload.daemon_id is not None
    assert payload.daemon_runtime_id is None

    # server-local 无需任何 daemon 字段：合法
    WorkspaceCreate(name="y", root_path="/y")

    # daemon-client 且 daemon_id 与 daemon_runtime_id 都缺：非法
    with pytest.raises(ValidationError):
        WorkspaceCreate(name="z", root_path="/z", path_source="daemon-client")


async def test_create_daemon_client_writes_member_binding_for_daemon_id(db_session) -> None:
    """daemon-client create 用 daemon_id 维度，落 workspace + 一条 WorkspaceMemberRuntime 行。

    覆盖 task-10/11 补遗：创建对话框选 daemon 后，service.create 必须建一条
    成员绑定行（workspace_id+created_by+daemon_id+root_path+path_source='daemon-client'），
    让后续派发/扫描经 member binding 走（D-004 / FR）。
    """
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"creator-{user_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Creator",
            status="active",
        )
    )
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="host-1",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    await db_session.flush()

    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(
            name="Daemon Project",
            root_path="/remote/daemon/proj",
            path_source="daemon-client",
            daemon_id=daemon.id,
        ),
        created_by=user_id,
    )

    # workspace 行落库；daemon_runtime_id 留空（global fallback 字段废弃）
    assert ws.path_source == "daemon-client"
    assert ws.status == "active"

    # 成员绑定行已建：daemon_id / root_path / path_source 写入；init_synced_* 未触发（None）
    binding = await get_my_binding(db_session, ws.id, user_id)
    assert binding is not None
    assert binding.daemon_id == daemon.id
    assert binding.root_path == "/remote/daemon/proj"
    assert binding.path_source == "daemon-client"
    assert binding.init_synced_at is None
    assert binding.init_synced_spec_version is None


async def test_create_daemon_client_without_daemon_id_skips_member_binding(
    db_session,
) -> None:
    """仅传 daemon_runtime_id（legacy，无 daemon_id）的 daemon-client create：不建 member binding。

    老链路（task-08 scan-generate 等内部）仍只传 daemon_runtime_id；为不引入回归，
    service.create 在 daemon_id 缺失时不写 member binding（仅落 workspace + 空 spec）。
    """
    service = WorkspaceService(db_session)
    ws = await service.create(
        WorkspaceCreate(
            name="Legacy Daemon",
            root_path="/remote/legacy",
            path_source="daemon-client",
            daemon_runtime_id=uuid.uuid4(),
        ),
        created_by=None,
    )
    assert ws.path_source == "daemon-client"
    assert ws.daemon_runtime_id is not None


async def test_create_daemon_client_slug_conflict_raises_slug_duplicate(db_session) -> None:
    """daemon-client create 撞同名 slug → WorkspaceSlugDuplicate(409) 而非裸 IntegrityError(500)。

    回归守护：service.create 的 daemon-client 分支 flush 必须包 try/except IntegrityError
    翻译（与 server-local 分支 _translate_integrity_error 一致）。否则用户在 UI 用
    daemon-client 模式建一个跟现有 active workspace 同 slug 的工作区，会收到 500
    （撞 ux_workspaces_slug_active partial unique index）。
    """
    from app.core.errors import WorkspaceSlugDuplicate

    service = WorkspaceService(db_session)
    # 第一个 daemon-client workspace：占用 slug=dup-name
    first = await service.create(
        WorkspaceCreate(
            name="Dup Name",
            root_path="/remote/first",
            path_source="daemon-client",
            daemon_runtime_id=uuid.uuid4(),
        ),
        created_by=None,
    )
    assert first.slug == "dup-name"

    # 第二个 daemon-client workspace：同名 slug、不同 root_path（避开 _find_active_by_root_path 复用）
    # 修复前：flush 抛裸 IntegrityError → router 上浮变 500
    # 修复后：_translate_integrity_error → WorkspaceSlugDuplicate（HTTP 409）
    with pytest.raises(WorkspaceSlugDuplicate):
        await service.create(
            WorkspaceCreate(
                name="Dup Name",
                root_path="/remote/second",
                path_source="daemon-client",
                daemon_runtime_id=uuid.uuid4(),
            ),
            created_by=None,
        )


async def test_create_daemon_client_rejects_daemon_owned_by_other_user(db_session) -> None:
    """daemon_id 归属校验：daemon 属他人 → create 拒绝（防跨用户劫持）。

    与 upsert_my_binding 的 daemon_not_owned 一致（D-004 / FR）；service.create
    走相同守护，daemon 不属于 created_by 时抛 AppError(code=daemon_not_owned)。
    """
    from app.core.errors import AppError
    from app.modules.auth.model import User

    owner_id = uuid.uuid4()
    other_id = uuid.uuid4()
    db_session.add(
        User(
            id=owner_id,
            email=f"owner-{owner_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Owner",
            status="active",
        )
    )
    db_session.add(
        User(
            id=other_id,
            email=f"other-{other_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Other",
            status="active",
        )
    )
    # daemon 属 other_user
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=other_id,
        hostname="host-other",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    await db_session.flush()

    service = WorkspaceService(db_session)
    with pytest.raises(AppError) as exc_info:
        await service.create(
            WorkspaceCreate(
                name="Hijack",
                root_path="/remote/hijack",
                path_source="daemon-client",
                daemon_id=daemon.id,
            ),
            created_by=owner_id,
        )
    assert exc_info.value.code == "daemon_not_owned"


# ---------------------------------------------------------------------------
# ql-20260705-003：scan-generate 接 daemon_id（daemon-entity-binding 遗漏补齐）
# ---------------------------------------------------------------------------


def test_scan_generate_request_accepts_daemon_id_without_runtime_id() -> None:
    """ScanGenerateRequest.path_source='daemon-client' 接受单传 daemon_id（新链路）。

    daemon-entity-binding 后 daemon_id 是稳定绑定键，daemon_runtime_id 降级 legacy。
    单传 daemon_id 合法；同时传 daemon_runtime_id（legacy）也合法；两者都缺非法；
    server-local 无需任何 daemon 字段。
    """
    from app.modules.workspace.schema import ScanGenerateRequest

    # 只传 daemon_id（新链路）：合法
    payload = ScanGenerateRequest(
        root_path="/x",
        path_source="daemon-client",
        daemon_id=uuid.uuid4(),
    )
    assert payload.daemon_id is not None
    assert payload.daemon_runtime_id is None

    # 只传 daemon_runtime_id（legacy fallback）：合法
    ScanGenerateRequest(
        root_path="/x",
        path_source="daemon-client",
        daemon_runtime_id=uuid.uuid4(),
    )

    # server-local 无需 daemon 字段：合法
    ScanGenerateRequest(root_path="/x")

    # daemon-client 且 daemon_id 与 daemon_runtime_id 都缺：非法
    with pytest.raises(ValidationError):
        ScanGenerateRequest(root_path="/x", path_source="daemon-client")


async def test_scan_generate_daemon_client_with_daemon_id_writes_member_binding(
    db_session,
) -> None:
    """scan-generate 用 daemon_id 维度，落 pending workspace + 成员绑定行。

    覆盖 ql-20260705-003：daemon-entity-binding 后 scan-generate 新建 workspace 时，
    必须复用 upsert_my_binding 建成员绑定行，使 start_scan_dispatch 经
    MemberBindingResolver 解析到 daemon（与 create 流程对齐）。
    """
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"scan-{user_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Scanner",
            status="active",
        )
    )
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="host-scan",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    await db_session.flush()

    service = WorkspaceService(db_session)
    agent_service = AsyncMock()
    agent_run = AsyncMock()
    agent_run.id = uuid.uuid4()
    agent_service.start_scan_dispatch = AsyncMock(return_value=agent_run)

    ws_id, run_id = await service.scan_generate_daemon_client(
        root_path="/remote/scan/proj",
        user_id=user_id,
        agent_service=agent_service,
        daemon_id=daemon.id,
    )

    # 派了 scan
    agent_service.start_scan_dispatch.assert_awaited_once()
    assert run_id == agent_run.id

    # workspace pending + 成员绑定行带 daemon_id（dispatch 经此解析 daemon）
    ws = await service.get(ws_id)
    assert ws.path_source == "daemon-client"
    assert ws.status == "pending"
    binding = await get_my_binding(db_session, ws_id, user_id)
    assert binding is not None
    assert binding.daemon_id == daemon.id
    assert binding.root_path == "/remote/scan/proj"
    assert binding.path_source == "daemon-client"


async def test_scan_generate_daemon_client_rejects_daemon_owned_by_other_user(
    db_session,
) -> None:
    """scan-generate daemon_id 归属校验：daemon 属他人 → 拒绝（防跨用户劫持）。

    与 create 流程的 _guard_daemon_owned_by_user 守护一致；拒绝时不派 scan。
    """
    from app.core.errors import AppError
    from app.modules.auth.model import User

    owner_id = uuid.uuid4()
    other_id = uuid.uuid4()
    db_session.add(
        User(
            id=owner_id,
            email=f"owner-{owner_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Owner",
            status="active",
        )
    )
    db_session.add(
        User(
            id=other_id,
            email=f"other-{other_id.hex[:8]}@example.com",
            password_hash="x",
            display_name="Other",
            status="active",
        )
    )
    # daemon 属 other_user
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=other_id,
        hostname="host-other",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    await db_session.flush()

    service = WorkspaceService(db_session)
    agent_service = AsyncMock()

    with pytest.raises(AppError) as exc_info:
        await service.scan_generate_daemon_client(
            root_path="/remote/hijack",
            user_id=owner_id,
            agent_service=agent_service,
            daemon_id=daemon.id,
        )
    assert exc_info.value.code == "daemon_not_owned"
    agent_service.start_scan_dispatch.assert_not_awaited()
