"""绑定自动并入 allowed_roots 用例（quick ql-20260831-018-dc1a 体验修）。

行为基准：owner 直绑自己的守护进程时，工作区 root_path 自动并入该 daemon
全部 runtime 的 allowed_roots（只增不减、幂等、legacy 空值先物化 instance
兜底）；共享/借用绑定不自动加（借用人不得自扩机器写边界）；相对路径防御性
跳过。走公开入口 ``upsert_my_binding`` 断言 DB 副作用与 best-effort 推送。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.workspace.member_runtimes.service import upsert_my_binding
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.asyncio


async def _make_user(db_session: AsyncSession, label: str = "auto-roots") -> uuid.UUID:
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"{label}-{user_id.hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name=label,
            status="active",
        )
    )
    await db_session.commit()
    return user_id


async def _make_workspace(db_session: AsyncSession, owner_id: uuid.UUID) -> uuid.UUID:
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name=f"AutoRoots WS {ws_id.hex[:8]}",
            slug=f"auto-roots-{ws_id.hex[:8]}",
            root_path=f"/tmp/auto-roots-{ws_id.hex[:8]}",
            status="active",
            created_by=owner_id,
        )
    )
    await db_session.commit()
    return ws_id


async def _make_daemon_runtime(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    provider: str = "claude",
    runtime_roots: list[str] | None = None,
    instance_roots: list[str] | None = None,
    online: bool = True,
    existing_daemon_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """建 daemon 实例 + 单 runtime，返回 (daemon_id, runtime_id)。

    ``runtime_roots=None`` 显式落空列表（legacy 下沉前形态）；instance 级
    ``instance_roots`` 缺省 ["~/.sillyhub"]（对齐注册默认）。给
    ``existing_daemon_id`` 则复用该 daemon 只加 runtime。
    """
    daemon_id = existing_daemon_id or uuid.uuid4()
    if not existing_daemon_id:
        db_session.add(
            DaemonInstance(
                id=daemon_id,
                user_id=user_id,
                hostname=f"host-{daemon_id.hex[:8]}",
                server_url="http://test-server",
                status="online" if online else "offline",
                last_heartbeat_at=datetime.now(UTC) if online else None,
                allowed_roots=instance_roots if instance_roots is not None else ["~/.sillyhub"],
            )
        )
    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=daemon_id,
            user_id=user_id,
            provider=provider,
            status="online" if online else "offline",
            last_heartbeat_at=datetime.now(UTC) if online else None,
            allowed_roots=runtime_roots if runtime_roots is not None else [],
        )
    )
    await db_session.commit()
    return daemon_id, runtime_id


async def _reload_runtime_roots(db_session: AsyncSession, runtime_id: uuid.UUID) -> list[str]:
    rt = await db_session.get(DaemonRuntime, runtime_id)
    assert rt is not None
    return list(rt.allowed_roots or [])


class _RecordingHub:
    """记录 send_policy_update 调用的桩 hub（推送断言用）。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def send_policy_update(
        self,
        daemon_id: uuid.UUID,
        allowed_roots: list[str],
        version: int,
        *,
        payload_runtime_id: uuid.UUID | None = None,
    ) -> bool:
        self.calls.append(
            {
                "daemon_id": daemon_id,
                "allowed_roots": list(allowed_roots),
                "version": version,
                "runtime_id": payload_runtime_id,
            }
        )
        return True


@pytest.fixture()
def recording_hub(monkeypatch: pytest.MonkeyPatch) -> _RecordingHub:
    hub = _RecordingHub()

    def _factory() -> _RecordingHub:
        return hub

    from app.modules.daemon import ws_hub as ws_hub_module

    monkeypatch.setattr(ws_hub_module, "get_daemon_ws_hub", _factory)
    return hub


async def test_owner_bind_merges_root_into_all_runtimes(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """owner 直绑：全部 runtime 并入 root_path——非空原值保留追加，空值物化
    instance 兜底再追加（绝不收窄），且逐 runtime best-effort 推送。"""
    user = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=user)
    daemon_id, claude_rt = await _make_daemon_runtime(
        db_session, user, provider="claude", runtime_roots=["/opt/existing"]
    )
    _, codex_rt = await _make_daemon_runtime(
        db_session,
        user,
        provider="codex",
        runtime_roots=None,
        instance_roots=["~/.sillyhub"],
        existing_daemon_id=daemon_id,
    )

    binding, created = await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="/srv/proj",
        path_source="daemon-client",
    )

    assert created is True
    assert str(binding.daemon_id) == str(daemon_id)
    assert await _reload_runtime_roots(db_session, claude_rt) == ["/opt/existing", "/srv/proj"]
    # legacy 空值：物化 instance 兜底（~/.sillyhub）再追加工作区路径。
    assert await _reload_runtime_roots(db_session, codex_rt) == ["~/.sillyhub", "/srv/proj"]
    # 两个 runtime 各推送一次，payload 带合并后的完整 roots + 单调 version。
    assert len(recording_hub.calls) == 2
    pushed = {str(c["runtime_id"]): c for c in recording_hub.calls}
    assert pushed[str(claude_rt)]["allowed_roots"] == ["/opt/existing", "/srv/proj"]
    assert pushed[str(codex_rt)]["allowed_roots"] == ["~/.sillyhub", "/srv/proj"]
    assert all(c["version"] > 0 for c in recording_hub.calls)


async def test_owner_bind_skips_merge_when_covered(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """幂等：root_path 已被现有绝对根覆盖（含 Windows 大小写形态）则跳过，
    roots 不变、不推送；重复绑定同路径不产生重复条目。"""
    user = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=user)
    daemon_id, rt = await _make_daemon_runtime(db_session, user, runtime_roots=["/srv"])

    await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="/srv/proj",
        path_source="daemon-client",
    )
    assert await _reload_runtime_roots(db_session, rt) == ["/srv"]

    # Windows 形态大小写不敏感覆盖：C:\Work 覆盖 c:/work/proj。
    win_daemon, win_rt = await _make_daemon_runtime(db_session, user, runtime_roots=["C:\\Work"])
    await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=win_daemon,
        root_path="c:/work/proj",
        path_source="daemon-client",
    )
    assert await _reload_runtime_roots(db_session, win_rt) == ["C:\\Work"]
    assert recording_hub.calls == []


async def test_shared_bind_does_not_touch_owner_roots(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """安全边界：非 owner 走共享授权绑定（enabled workspace grant + 在线），
    绑定成功但 owner 的 runtime allowed_roots 不被触碰、无推送。"""
    owner = await _make_user(db_session, label="lender")
    borrower = await _make_user(db_session, label="borrower")
    ws_id = await _make_workspace(db_session, owner_id=owner)
    daemon_id, rt = await _make_daemon_runtime(
        db_session, owner, runtime_roots=["/opt/lender-only"]
    )
    db_session.add(
        DaemonRuntimeGrant(
            daemon_instance_id=daemon_id,
            grantee_type="workspace",
            grantee_id=ws_id,
            granted_by_user_id=owner,
            enabled=True,
        )
    )
    await db_session.commit()

    _binding, created = await upsert_my_binding(
        db_session,
        ws_id,
        borrower,
        daemon_id=daemon_id,
        root_path="/home/borrower/proj",
        path_source="daemon-client",
    )

    assert created is True
    assert await _reload_runtime_roots(db_session, rt) == ["/opt/lender-only"]
    assert recording_hub.calls == []


async def test_relative_root_path_skips_merge(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """防御：非绝对路径跳过并入（不阻断绑定），roots 不变、无推送。"""
    user = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=user)
    daemon_id, rt = await _make_daemon_runtime(db_session, user, runtime_roots=["/opt/existing"])

    binding, created = await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="relative/path",
        path_source="daemon-client",
    )

    assert created is True
    assert binding.root_path == "relative/path"
    assert await _reload_runtime_roots(db_session, rt) == ["/opt/existing"]
    assert recording_hub.calls == []


async def test_edit_binding_appends_new_path_keeps_old(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """编辑路径：换绑新路径时追加新值、保留旧值（只增不减，不回收已授予的
    写边界）。"""
    user = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=user)
    daemon_id, rt = await _make_daemon_runtime(db_session, user, runtime_roots=["/opt/existing"])

    await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="/srv/old",
        path_source="daemon-client",
    )
    binding, created = await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="/srv/new",
        path_source="daemon-client",
    )

    assert created is False
    assert binding.root_path == "/srv/new"
    roots = await _reload_runtime_roots(db_session, rt)
    assert roots == ["/opt/existing", "/srv/old", "/srv/new"]


async def test_tilde_root_rebind_does_not_append_duplicate(
    db_session: AsyncSession, recording_hub: _RecordingHub
) -> None:
    """``~`` 根幂等（quick 风险审查修）：``~`` 形态 backend 无法展开、不参与
    前缀覆盖判定，但重复保存同一路径按精确等值视为已覆盖——不得每次 PUT
    都追加一条重复项（DB JSON 与 policy_update 载荷单调膨胀）。首次追加
    语义不变。"""
    user = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=user)
    daemon_id, rt = await _make_daemon_runtime(db_session, user, runtime_roots=["/opt/existing"])

    await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="~/proj",
        path_source="daemon-client",
    )
    assert await _reload_runtime_roots(db_session, rt) == ["/opt/existing", "~/proj"]

    # 编辑路径（Edit 保存同一路径）→ 精确等值判定已覆盖，不再追加。
    await upsert_my_binding(
        db_session,
        ws_id,
        user,
        daemon_id=daemon_id,
        root_path="~/proj",
        path_source="daemon-client",
    )
    assert await _reload_runtime_roots(db_session, rt) == ["/opt/existing", "~/proj"]
    # 首次绑定推送过一次；第二次保存零推送（未发生合并）。
    assert len(recording_hub.calls) == 1
