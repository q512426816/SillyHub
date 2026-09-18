"""POST /api/workspaces/probe 批量探测端点测试（2026-08-24-session-team-mission-context task-10 / FR-03 / D-008@v2）。

覆盖任务卡 acceptance：
- 多工作区批量：workspace_ids 进 → 每工作区 workspace_id/git_mode/daemon_name/
  daemon_online 出（git_mode ∈ git/direct/unknown 三态），每次调用实时探测不缓存。
- 机器解析按任一成员 binding（含他人绑定），与简报/mission_status 同源同口径
  （机器名 display_alias||hostname）。
- 未绑机器 → daemon_name=None + daemon_online=False。
- 探测 RPC 失败 / 未绑 daemon → git_mode=unknown 不抛 5xx（fail-safe）。
- 缺失（查无行）的 workspace_id 跳过不报错（与 collect 无效 id 跳过同语义）。
- 无 WORKSPACE_WRITE 权限 → 403；空或超限（>20）workspace_ids → 422；非法
  uuid 格式 → 422。
- ql-20260918-012（工作区 Git 地址识别）：repo_url——git 态实时识别回填 DB /
  已识别回 DB 值零额外 RPC / direct 态不发 RPC / RPC 降级归 None 不 5xx。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.daemon.host_fs.delegate import HostFsDelegate
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


async def _make_workspace(
    session: AsyncSession,
    name: str | None = None,
) -> uuid.UUID:
    """建一个 workspace 行（不绑 daemon，供探测端点批量查询）。"""
    ws_id = uuid.uuid4()
    session.add(
        Workspace(
            id=ws_id,
            name=name or f"ws-{ws_id.hex[:8]}",
            slug=f"ws-{ws_id.hex[:8]}",
            root_path=f"/tmp/{ws_id.hex}",
        )
    )
    await session.commit()
    return ws_id


async def _make_binding_with_named_daemon(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    display_alias: str | None = None,
    daemon_status: str = "online",
) -> None:
    """建 workspace binding + 在线可控的 daemon 实例行（机器名/在线断言用）。

    与 agent 侧 test_mission_status 同款 ORM 播种：binding 属主 user_id 与
    daemon_instances.user_id 一致，满足 query_daemon_online_by_id 的属主校验；
    binding 属主是「他人」（非调用者 admin）——任一成员 binding 口径（UB-2）。
    """
    user_id = uuid.uuid4()
    daemon_id = uuid.uuid4()
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=False,
            root_path=f"/tmp/ws-{workspace_id.hex[:8]}",
            path_source="member",
        )
    )
    session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"host-{daemon_id.hex[:6]}",
            display_alias=display_alias,
            server_url="http://localhost:8001",
            status=daemon_status,
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _make_granted_user(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    permission: str,
) -> User:
    """建非管理员用户并只在指定 workspace 授一个含 permission 的角色。"""
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="not-a-real-hash",
        display_name="普通用户",
        status="active",
        is_platform_admin=False,
    )
    role_id = uuid.uuid4()
    session.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    session.add(RolePermission(role_id=role_id, permission=permission))
    session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def _post_probe(client, auth_headers: dict[str, str], workspace_ids: list[uuid.UUID]):
    return await client.post(
        "/api/workspaces/probe",
        json={"workspace_ids": [str(w) for w in workspace_ids]},
        headers=auth_headers,
    )


class TestProbeEndpoint:
    """POST /api/workspaces/probe（批量三态 git 模式 + 任一成员 binding 机器状态）。"""

    @pytest.mark.asyncio
    async def test_batch_multi_workspaces_git_and_direct(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """多工作区批量：每工作区一条，git/direct 两态 + 机器名/在线口径正确。

        - ws1：他人 binding + 在线 daemon（display_alias 优先）→ git 态。
        - ws2：binding + 离线 daemon（display_alias 缺省回退 hostname）→ direct 态。
        探测回调对两个工作区各调一次（实时探测，不缓存，R-02）。
        """
        ws1 = await _make_workspace(db_session, name="在线机器工作区")
        ws2 = await _make_workspace(db_session, name="离线机器工作区")
        await _make_binding_with_named_daemon(
            db_session, ws1, display_alias="牛逼的电脑", daemon_status="online"
        )
        await _make_binding_with_named_daemon(
            db_session, ws2, display_alias=None, daemon_status="offline"
        )

        probed: list[str] = []

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            probed.append(str(workspace.id))
            return "git" if str(workspace.id) == str(ws1) else "direct"

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)

        resp = await _post_probe(client, auth_headers, [ws1, ws2])
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 2
        by_id = {item["workspace_id"]: item for item in items}
        item1 = by_id[str(ws1)]
        assert item1["git_mode"] == "git"
        assert item1["daemon_name"] == "牛逼的电脑"  # display_alias 优先
        assert item1["daemon_online"] is True
        item2 = by_id[str(ws2)]
        assert item2["git_mode"] == "direct"
        assert item2["daemon_name"].startswith("host-")  # 回退 hostname
        assert item2["daemon_online"] is False
        # 每工作区各探测一次（实时探测，不缓存）
        assert sorted(probed) == sorted([str(ws1), str(ws2)])

    @pytest.mark.asyncio
    async def test_unbound_workspace_offline_no_name_unknown_mode(
        self, client, db_session, auth_headers
    ) -> None:
        """未绑机器：daemon_name=None + daemon_online=False + git_mode=unknown。

        不 mock 探测——走真实 delegate：无 binding → _via_rpc 抛
        HostFsDelegateUnavailable → probe 内部归 unknown 不抛（fail-safe）。
        """
        ws = await _make_workspace(db_session, name="未绑机器工作区")

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        assert item["workspace_id"] == str(ws)
        assert item["daemon_name"] is None
        assert item["daemon_online"] is False
        assert item["git_mode"] == "unknown"

    @pytest.mark.asyncio
    async def test_rpc_failure_returns_unknown_no_5xx(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """探测 RPC 失败（DaemonRpcTimeout）→ git_mode=unknown，200 不 5xx。

        patch 在 _via_rpc 层（transport 通道），走 probe_workspace_git_mode
        真实异常收敛分支；机器字段照常组装（binding/daemon 行与 RPC 无关）。
        """
        from app.modules.daemon.service import DaemonRpcTimeout

        ws = await _make_workspace(db_session, name="RPC故障工作区")
        await _make_binding_with_named_daemon(
            db_session, ws, display_alias="故障机器", daemon_status="online"
        )

        async def _fake_via_rpc(self: HostFsDelegate, **kwargs) -> dict:
            raise DaemonRpcTimeout("transport deadline exceeded")

        monkeypatch.setattr(HostFsDelegate, "_via_rpc", _fake_via_rpc)

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        item = resp.json()[0]
        assert item["git_mode"] == "unknown"
        assert item["daemon_name"] == "故障机器"
        assert item["daemon_online"] is True

    @pytest.mark.asyncio
    async def test_missing_workspace_ids_skipped(self, client, db_session, auth_headers) -> None:
        """缺失（查无行）的 workspace_id 跳过不报错——与 collect_scope 无效 id
        跳过同语义（fail-safe 不 5xx）。"""
        real_ws = await _make_workspace(db_session, name="存在的工作区")
        missing = uuid.uuid4()

        resp = await _post_probe(client, auth_headers, [missing, real_ws])
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert [item["workspace_id"] for item in items] == [str(real_ws)]

    @pytest.mark.asyncio
    async def test_forbidden_without_workspace_write_403(self, client, db_session) -> None:
        """无任何 WORKSPACE_WRITE 权限的用户 → 403（require_permission_any）。"""
        some_ws = await _make_workspace(db_session, name="只读用户的工作区")
        user = await _make_granted_user(
            db_session, workspace_id=some_ws, permission="workspace:read"
        )

        resp = await client.post(
            "/api/workspaces/probe",
            json={"workspace_ids": [str(some_ws)]},
            headers={"Authorization": f"Bearer {_token_for(user)}"},
        )
        assert resp.status_code == 403, resp.text

    @pytest.mark.asyncio
    async def test_empty_ids_422(self, client, db_session, auth_headers) -> None:
        """workspace_ids 为空 → 422（Pydantic min_length=1）。"""
        resp = await client.post(
            "/api/workspaces/probe", json={"workspace_ids": []}, headers=auth_headers
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_over_limit_21_ids_422(self, client, db_session, auth_headers) -> None:
        """workspace_ids 超过 20 上限 → 422（对齐 scope 口径上限）。"""
        ids = [uuid.uuid4() for _ in range(21)]
        resp = await _post_probe(client, auth_headers, ids)
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_invalid_uuid_422(self, client, db_session, auth_headers) -> None:
        """workspace_ids 含非 uuid 字符串 → 422（list[UUID] 类型校验）。"""
        resp = await client.post(
            "/api/workspaces/probe",
            json={"workspace_ids": ["not-a-uuid"]},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_route_not_shadowed_by_dynamic_segment(
        self, client, db_session, auth_headers
    ) -> None:
        """POST /workspaces/probe 可达（注册于 /{workspace_id} 动态段之前），
        非 405/404。"""
        resp = await _post_probe(client, auth_headers, [uuid.uuid4()])
        # 查无行 → 200 空列表（而非 405/404 证明路由匹配成功）
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    # ── ql-20260918-012（工作区 Git 地址识别）：repo_url 识别 + 回填 ──

    @pytest.mark.asyncio
    async def test_git_mode_repo_url_detected_and_backfilled(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """git 态 + repo_url 未识别 → delegate.git_remote_url 实时读取，
        响应携带地址且回填 DB（本端点唯一写副作用）。"""
        from sqlalchemy import select as sa_select

        ws = await _make_workspace(db_session, name="待识别工作区")
        await _make_binding_with_named_daemon(
            db_session, ws, display_alias="识别机器", daemon_status="online"
        )

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            return "git"

        async def _fake_remote(self: HostFsDelegate, workspace: Workspace) -> str | None:
            return "git@github.com:foo/bar.git"

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)
        monkeypatch.setattr(HostFsDelegate, "git_remote_url", _fake_remote)

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        item = resp.json()[0]
        assert item["git_mode"] == "git"
        assert item["repo_url"] == "git@github.com:foo/bar.git"
        # 回填落库：后续 probe 直接回 DB 值（零额外 RPC）
        row = (
            await db_session.execute(sa_select(Workspace).where(Workspace.id == ws))
        ).scalar_one()
        assert row.repo_url == "git@github.com:foo/bar.git"

    @pytest.mark.asyncio
    async def test_repo_url_already_filled_skips_extra_rpc(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """repo_url 已识别（DB 非空）→ 直接回 DB 值，不再调 git_remote_url。"""
        from sqlalchemy import select as sa_select

        ws = await _make_workspace(db_session, name="已识别工作区")
        row = (
            await db_session.execute(sa_select(Workspace).where(Workspace.id == ws))
        ).scalar_one()
        row.repo_url = "https://example.com/x/y.git"
        await db_session.commit()
        await _make_binding_with_named_daemon(
            db_session, ws, display_alias="已识别机器", daemon_status="online"
        )

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            return "git"

        remote_calls: list[str] = []

        async def _fake_remote(self: HostFsDelegate, workspace: Workspace) -> str | None:
            remote_calls.append(str(workspace.id))
            return "should-not-be-used"

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)
        monkeypatch.setattr(HostFsDelegate, "git_remote_url", _fake_remote)

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        item = resp.json()[0]
        assert item["repo_url"] == "https://example.com/x/y.git"
        assert remote_calls == []

    @pytest.mark.asyncio
    async def test_direct_mode_repo_url_none(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """direct 态（根下无 .git）→ repo_url=None 且不发 git_remote RPC。"""
        ws = await _make_workspace(db_session, name="直通工作区")
        await _make_binding_with_named_daemon(
            db_session, ws, display_alias="直通机器", daemon_status="online"
        )

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            return "direct"

        remote_calls: list[str] = []

        async def _fake_remote(self: HostFsDelegate, workspace: Workspace) -> str | None:
            remote_calls.append(str(workspace.id))
            return None

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)
        monkeypatch.setattr(HostFsDelegate, "git_remote_url", _fake_remote)

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        item = resp.json()[0]
        assert item["git_mode"] == "direct"
        assert item["repo_url"] is None
        assert remote_calls == []

    @pytest.mark.asyncio
    async def test_git_remote_degrade_repo_url_none_no_5xx(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """git_remote RPC 降级（旧 daemon 不识别/超时 → delegate 归 None）→
        repo_url=None 不 5xx，DB 不动（下次 probe 重试）。"""
        from sqlalchemy import select as sa_select

        ws = await _make_workspace(db_session, name="降级工作区")
        await _make_binding_with_named_daemon(
            db_session, ws, display_alias="降级机器", daemon_status="online"
        )

        async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
            return "git"

        async def _fake_remote(self: HostFsDelegate, workspace: Workspace) -> str | None:
            return None  # delegate._via_rpc_or_degrade 收敛后的形态

        monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)
        monkeypatch.setattr(HostFsDelegate, "git_remote_url", _fake_remote)

        resp = await _post_probe(client, auth_headers, [ws])
        assert resp.status_code == 200, resp.text
        item = resp.json()[0]
        assert item["repo_url"] is None
        row = (
            await db_session.execute(sa_select(Workspace).where(Workspace.id == ws))
        ).scalar_one()
        assert row.repo_url is None
