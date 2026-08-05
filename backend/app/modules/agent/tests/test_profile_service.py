"""AgentProfileService 单测（task-03）。

覆盖：
* compute_effective_allowed_roots：空 overlay 回退 / 子集交集 / 拒超集（D-013）。
* CRUD：create/get/list/update/delete + 三级 visibility 越权场景（D-009）。
* copy：内容复制 + 可见性继承源档读权限。
* resolve_profile：四级兜底链（design §8 / D-005）+ provider 归一化。
* version：update 递增。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.agent.profile.service import (
    AgentProfileNotFound,
    AgentProfileOverlayTooWide,
    AgentProfilePermissionDenied,
    AgentProfileService,
)
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace

# ────────────────────────────────────────────────────────────────────────────
# Seed helpers
# ────────────────────────────────────────────────────────────────────────────


async def _make_user(session, *, suffix: str = "u", admin: bool = False) -> User:
    """创建 active 用户；admin=True 置 is_platform_admin。"""
    user = User(
        id=uuid.uuid4(),
        email=f"{suffix}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name=suffix,
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_workspace(session, *, default_agent: str | None = None) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_agent=default_agent,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_member(session, ws: Workspace, user: User) -> None:
    """授予 user 在 ws 的成员角色行（任意角色即视为 member）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"developer-{uuid.uuid4().hex[:6]}",
        name="Developer",
        is_system=True,
    )
    session.add(role)
    await session.flush()
    session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
        )
    )
    await session.commit()


async def _make_profile(
    session,
    *,
    owner: User,
    visibility: AgentProfileVisibility = AgentProfileVisibility.PRIVATE,
    workspace: Workspace | None = None,
    provider: str = "claude",
    name: str = "P",
    system_prompt: str | None = None,
    mcp_refs: list[str] | None = None,
    skill_refs: list[str] | None = None,
    allowed_roots_overlay: list[str] | None = None,
    is_system_default: bool = False,
    version: int = 1,
) -> AgentProfile:
    ws_id = workspace.id if visibility == AgentProfileVisibility.WORKSPACE and workspace else None
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name,
        owner_user_id=None if is_system_default and owner is None else owner.id,
        workspace_id=ws_id,
        visibility=visibility,
        provider=provider,
        model="m",
        system_prompt=system_prompt,
        mcp_refs=mcp_refs or [],
        skill_refs=skill_refs or [],
        allowed_roots_overlay=allowed_roots_overlay,
        version=version,
        is_system_default=is_system_default,
    )
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


# ════════════════════════════════════════════════════════════════════════════
# 1. compute_effective_allowed_roots（纯函数，D-013）
# ════════════════════════════════════════════════════════════════════════════


class TestComputeEffectiveAllowedRoots:
    # 纯函数测试（不触 DB）。沿用 async 标记以契合仓库 asyncio_mode=auto + autouse
    # 异步 fixture 的约定。

    async def test_overlay_none_returns_daemon(self) -> None:
        assert AgentProfileService.compute_effective_allowed_roots(["/a", "/b"], None) == [
            "/a",
            "/b",
        ]

    async def test_overlay_empty_returns_daemon(self) -> None:
        assert AgentProfileService.compute_effective_allowed_roots(["/a", "/b"], []) == ["/a", "/b"]

    async def test_overlay_subset_returns_intersection_in_daemon_order(self) -> None:
        # overlay ⊆ daemon → 交集按 daemon 顺序保留
        assert AgentProfileService.compute_effective_allowed_roots(
            ["/a", "/b", "/c"], ["/c", "/a"]
        ) == ["/a", "/c"]

    async def test_overlay_exact_match_returns_same(self) -> None:
        assert AgentProfileService.compute_effective_allowed_roots(["/a", "/b"], ["/b", "/a"]) == [
            "/a",
            "/b",
        ]

    async def test_overlay_superset_raises_with_extra(self) -> None:
        with pytest.raises(AgentProfileOverlayTooWide) as ei:
            AgentProfileService.compute_effective_allowed_roots(["/a"], ["/a", "/x", "/y"])
        assert ei.value.details is not None
        assert sorted(ei.value.details["extra_roots"]) == ["/x", "/y"]
        assert ei.value.http_status == 400

    async def test_overlay_disjoint_raises_all_overlay_as_extra(self) -> None:
        with pytest.raises(AgentProfileOverlayTooWide) as ei:
            AgentProfileService.compute_effective_allowed_roots(["/a"], ["/p", "/q"])
        assert ei.value.details is not None
        assert sorted(ei.value.details["extra_roots"]) == ["/p", "/q"]

    async def test_daemon_empty_overlay_nonempty_raises(self) -> None:
        # 从空沙箱放宽 → 拒
        with pytest.raises(AgentProfileOverlayTooWide):
            AgentProfileService.compute_effective_allowed_roots([], ["/a"])


# ════════════════════════════════════════════════════════════════════════════
# 2. CRUD + 三级 visibility（D-009）
# ════════════════════════════════════════════════════════════════════════════


class TestCreate:
    async def test_create_private_ok(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="owner")
        svc = AgentProfileService(db_session)
        p = await svc.create(
            name="my",
            visibility=AgentProfileVisibility.PRIVATE,
            provider="claude",
            actor=actor,
            system_prompt="hi",
        )
        assert p.owner_user_id == actor.id
        assert p.workspace_id is None
        assert p.visibility == AgentProfileVisibility.PRIVATE
        assert p.version == 1
        assert p.is_system_default is False
        assert p.system_prompt == "hi"

    async def test_create_workspace_member_ok(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="m")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, actor)
        svc = AgentProfileService(db_session)
        p = await svc.create(
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            provider="claude",
            actor=actor,
            workspace=ws,
        )
        assert p.workspace_id == ws.id

    async def test_create_workspace_non_member_denied(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="stranger")
        ws = await _make_workspace(db_session)
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.create(
                name="ws-p",
                visibility=AgentProfileVisibility.WORKSPACE,
                provider="claude",
                actor=actor,
                workspace=ws,
            )

    async def test_create_workspace_without_workspace_denied(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="m")
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.create(
                name="ws-p",
                visibility=AgentProfileVisibility.WORKSPACE,
                provider="claude",
                actor=actor,
            )

    async def test_create_platform_admin_ok(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="admin", admin=True)
        svc = AgentProfileService(db_session)
        p = await svc.create(
            name="plat",
            visibility=AgentProfileVisibility.PLATFORM,
            provider="claude",
            actor=admin,
        )
        assert p.visibility == AgentProfileVisibility.PLATFORM
        assert p.workspace_id is None

    async def test_create_platform_non_admin_denied(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="user")
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.create(
                name="plat",
                visibility=AgentProfileVisibility.PLATFORM,
                provider="claude",
                actor=actor,
            )


class TestGet:
    async def test_get_private_by_owner(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        assert await svc.get(profile_id=p.id, actor=owner) is not None

    async def test_get_private_by_other_denied(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        other = await _make_user(db_session, suffix="x")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.get(profile_id=p.id, actor=other)

    async def test_get_workspace_by_member(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        member = await _make_user(db_session, suffix="m")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_member(db_session, ws, member)
        p = await _make_profile(
            db_session, owner=owner, visibility=AgentProfileVisibility.WORKSPACE, workspace=ws
        )
        svc = AgentProfileService(db_session)
        got = await svc.get(profile_id=p.id, actor=member)
        assert got.id == p.id

    async def test_get_workspace_by_non_member_denied(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        stranger = await _make_user(db_session, suffix="s")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        p = await _make_profile(
            db_session, owner=owner, visibility=AgentProfileVisibility.WORKSPACE, workspace=ws
        )
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.get(profile_id=p.id, actor=stranger)

    async def test_get_platform_by_anyone(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="a", admin=True)
        user = await _make_user(db_session, suffix="u")
        p = await _make_profile(
            db_session,
            owner=admin,
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        assert (await svc.get(profile_id=p.id, actor=user)).id == p.id

    async def test_get_not_found(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="u")
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfileNotFound):
            await svc.get(profile_id=uuid.uuid4(), actor=actor)


class TestList:
    async def test_list_sees_own_private_and_platform_not_others_private(self, db_session) -> None:
        a = await _make_user(db_session, suffix="a")
        b = await _make_user(db_session, suffix="b")
        admin = await _make_user(db_session, suffix="admin", admin=True)
        await _make_profile(db_session, owner=a, name="a-priv")
        await _make_profile(db_session, owner=b, name="b-priv")  # 不可见
        await _make_profile(
            db_session,
            owner=admin,
            name="plat",
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        names = {p.name for p in await svc.list(actor=a)}
        assert names == {"a-priv", "plat"}

    async def test_list_workspace_member_sees_workspace_level(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        member = await _make_user(db_session, suffix="m")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_member(db_session, ws, member)
        await _make_profile(
            db_session,
            owner=owner,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        svc = AgentProfileService(db_session)
        names = {p.name for p in await svc.list(actor=member, workspace=ws)}
        assert "ws-p" in names

    async def test_list_workspace_non_member_does_not_see_workspace_level(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        stranger = await _make_user(db_session, suffix="s")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_profile(
            db_session,
            owner=owner,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        svc = AgentProfileService(db_session)
        names = {p.name for p in await svc.list(actor=stranger, workspace=ws)}
        assert "ws-p" not in names

    async def test_list_without_workspace_hides_workspace_level(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_profile(
            db_session,
            owner=owner,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        svc = AgentProfileService(db_session)
        names = {p.name for p in await svc.list(actor=owner)}
        assert "ws-p" not in names


# ════════════════════════════════════════════════════════════════════════════
# 2.5 list_visible_all 跨工作区聚合可见性（task-01 / design §7.1 / D-004）
#    逐档 _can_read_async 判定（不拼 ws clause），覆盖 R-01 越权 + R-07 owner-left-ws。
# ════════════════════════════════════════════════════════════════════════════


class TestListVisibleAll:
    async def test_actor_does_not_see_others_private(self, db_session) -> None:
        # R-01：actor A 不见 actor B 的 private 档
        a = await _make_user(db_session, suffix="a")
        b = await _make_user(db_session, suffix="b")
        await _make_profile(db_session, owner=a, name="a-priv")
        await _make_profile(db_session, owner=b, name="b-priv")
        svc = AgentProfileService(db_session)
        names = {e.profile.name for e in await svc.list_visible_all(actor=a)}
        assert "a-priv" in names
        assert "b-priv" not in names

    async def test_non_member_does_not_see_workspace_level(self, db_session) -> None:
        # 非成员不见该 ws 的 workspace 级档
        owner = await _make_user(db_session, suffix="o")
        stranger = await _make_user(db_session, suffix="s")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_profile(
            db_session,
            owner=owner,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        svc = AgentProfileService(db_session)
        names = {e.profile.name for e in await svc.list_visible_all(actor=stranger)}
        assert "ws-p" not in names

    async def test_owner_left_ws_workspace_level_matches_get_behavior(self, db_session) -> None:
        # R-07 边界：get() 经 _can_read_async 对 WORKSPACE 级 owner 短路（service.py
        # _can_read 的 WORKSPACE 分支 return owner_user_id==actor.id，不查成员），故 owner
        # 离开 ws 后该档对其仍可见。本变更 list_visible_all 复用 _can_read_async（task
        # implementation 明确「逐档 _can_read_async 判定，不拼 ws clause」），故聚合视图
        # 行为 = get() = owner 离开后仍可见（design §10 R-07 原措辞「不可见」系表述错误，
        # archive 时已勘误为「仍可见」，与本测试一致）。
        # 不改 _can_read_async：那会扩散影响 get/list/copy/resolve（2026-08-02-agent-profile-layer
        # 已 archive 的稳定 visibility 语义），超本 task「纯加法不改现有 CRUD」约束 +
        # allowed_paths 语义。designer 若坚持 owner 离开即不可见，需另起 change 改 _can_read_async
        # 的 WORKSPACE 分支去掉 owner 短路，并回归全量 profile/dispatch 读路径。
        owner = await _make_user(db_session, suffix="o")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        p = await _make_profile(
            db_session,
            owner=owner,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        # owner 离开 ws：删其在 ws 的成员行
        await db_session.execute(
            delete(UserWorkspaceRole).where(
                UserWorkspaceRole.user_id == owner.id,
                UserWorkspaceRole.workspace_id == ws.id,
            )
        )
        await db_session.commit()
        svc = AgentProfileService(db_session)
        # 聚合视图：owner 仍可见（owner 短路，与 get() 一致）
        names = {e.profile.name for e in await svc.list_visible_all(actor=owner)}
        assert "ws-p" in names
        # 对照：get() 同样让 owner 可见（证明聚合视图与单档 GET 行为一致，非聚合特例）
        assert (await svc.get(profile_id=p.id, actor=owner)).id == p.id

    async def test_aggregated_set_includes_own_private_ws_level_and_platform(
        self, db_session
    ) -> None:
        # 聚合集 = 自己 private + 所属 ws 级 + 平台预置
        actor = await _make_user(db_session, suffix="a")
        admin = await _make_user(db_session, suffix="admin", admin=True)
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, actor)
        await _make_profile(db_session, owner=actor, name="my-priv")
        await _make_profile(
            db_session,
            owner=actor,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        await _make_profile(
            db_session,
            owner=admin,
            name="plat",
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        names = {e.profile.name for e in await svc.list_visible_all(actor=actor)}
        assert {"my-priv", "ws-p", "plat"} <= names

    async def test_workspace_name_filled_only_for_workspace_level(self, db_session) -> None:
        # workspace_name：private/platform 为 None，workspace 级填归属名
        actor = await _make_user(db_session, suffix="a")
        admin = await _make_user(db_session, suffix="admin", admin=True)
        ws = await _make_workspace(db_session)
        ws.name = "我的工作区"
        db_session.add(ws)
        await db_session.commit()
        await _make_member(db_session, ws, actor)
        await _make_profile(db_session, owner=actor, name="my-priv")
        await _make_profile(
            db_session,
            owner=actor,
            name="ws-p",
            visibility=AgentProfileVisibility.WORKSPACE,
            workspace=ws,
        )
        await _make_profile(
            db_session,
            owner=admin,
            name="plat",
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        by_name = {e.profile.name: e for e in await svc.list_visible_all(actor=actor)}
        assert by_name["my-priv"].workspace_name is None
        assert by_name["ws-p"].workspace_name == "我的工作区"
        assert by_name["plat"].workspace_name is None


class TestUpdate:
    async def test_update_owner_increments_version(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner, version=1)
        svc = AgentProfileService(db_session)
        updated = await svc.update(
            profile_id=p.id, actor=owner, fields={"system_prompt": "new", "model": "m2"}
        )
        assert updated.version == 2
        assert updated.system_prompt == "new"
        assert updated.model == "m2"

    async def test_update_version_increments_each_call(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner, version=1)
        svc = AgentProfileService(db_session)
        await svc.update(profile_id=p.id, actor=owner, fields={"name": "v2"})
        await svc.update(profile_id=p.id, actor=owner, fields={"name": "v3"})
        third = await svc.update(profile_id=p.id, actor=owner, fields={"name": "v4"})
        assert third.version == 4

    async def test_update_non_owner_private_denied(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        other = await _make_user(db_session, suffix="x")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.update(profile_id=p.id, actor=other, fields={"name": "z"})

    async def test_update_platform_non_admin_denied(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="a", admin=True)
        user = await _make_user(db_session, suffix="u")
        p = await _make_profile(
            db_session,
            owner=admin,
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.update(profile_id=p.id, actor=user, fields={"name": "z"})

    async def test_update_platform_admin_ok(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="a", admin=True)
        p = await _make_profile(
            db_session,
            owner=admin,
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        updated = await svc.update(profile_id=p.id, actor=admin, fields={"system_prompt": "x"})
        assert updated.version == 2

    async def test_update_workspace_member_can_modify(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        member = await _make_user(db_session, suffix="m")
        ws = await _make_workspace(db_session)
        await _make_member(db_session, ws, owner)
        await _make_member(db_session, ws, member)
        p = await _make_profile(
            db_session, owner=owner, visibility=AgentProfileVisibility.WORKSPACE, workspace=ws
        )
        svc = AgentProfileService(db_session)
        updated = await svc.update(profile_id=p.id, actor=member, fields={"name": "by-member"})
        assert updated.version == 2

    async def test_update_visibility_to_platform_requires_admin(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.update(
                profile_id=p.id,
                actor=owner,
                fields={"visibility": AgentProfileVisibility.PLATFORM},
            )

    async def test_update_unknown_field_raises_value_error(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        with pytest.raises(ValueError):
            await svc.update(profile_id=p.id, actor=owner, fields={"bogus": "x"})


class TestDelete:
    async def test_delete_owner_ok(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        await svc.delete(profile_id=p.id, actor=owner)
        with pytest.raises(AgentProfileNotFound):
            await svc.get(profile_id=p.id, actor=owner)

    async def test_delete_non_owner_denied(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        other = await _make_user(db_session, suffix="x")
        p = await _make_profile(db_session, owner=owner)
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.delete(profile_id=p.id, actor=other)

    async def test_delete_system_default_admin_ok(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="a", admin=True)
        p = await _make_profile(
            db_session,
            owner=admin,
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        await svc.delete(profile_id=p.id, actor=admin)
        with pytest.raises(AgentProfileNotFound):
            await svc.get(profile_id=p.id, actor=admin)

    async def test_delete_system_default_non_admin_denied(self, db_session) -> None:
        admin = await _make_user(db_session, suffix="a", admin=True)
        user = await _make_user(db_session, suffix="u")
        p = await _make_profile(
            db_session,
            owner=admin,
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.delete(profile_id=p.id, actor=user)


class TestCopy:
    async def test_copy_creates_private_clone_owned_by_actor(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        src = await _make_profile(
            db_session,
            owner=owner,
            provider="claude",
            system_prompt="hello",
            mcp_refs=["m1"],
            skill_refs=["s1"],
            allowed_roots_overlay=["/a"],
        )
        svc = AgentProfileService(db_session)
        dup = await svc.copy(profile_id=src.id, actor=owner, name="clone")
        assert dup.id != src.id
        assert dup.owner_user_id == owner.id
        assert dup.visibility == AgentProfileVisibility.PRIVATE
        assert dup.is_system_default is False
        assert dup.version == 1
        assert dup.provider == "claude"
        assert dup.system_prompt == "hello"
        assert dup.mcp_refs == ["m1"]
        assert dup.skill_refs == ["s1"]
        assert dup.allowed_roots_overlay == ["/a"]

    async def test_copy_default_name_when_omitted(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        src = await _make_profile(db_session, owner=owner, name="原始")
        svc = AgentProfileService(db_session)
        dup = await svc.copy(profile_id=src.id, actor=owner)
        assert dup.name == "原始（副本）"

    async def test_copy_source_not_visible_denied(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        other = await _make_user(db_session, suffix="x")
        src = await _make_profile(db_session, owner=owner)  # private of owner
        svc = AgentProfileService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.copy(profile_id=src.id, actor=other)


# ════════════════════════════════════════════════════════════════════════════
# 3. resolve_profile 四级兜底链（design §8 / D-005）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveProfile:
    async def test_tier1_run_explicit_wins(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session, default_agent="claude")
        explicit = await _make_profile(db_session, owner=actor, name="explicit")
        ws_default = await _make_profile(db_session, owner=actor, name="ws-default")
        ws.default_agent_profile_id = ws_default.id
        db_session.add(ws)
        await db_session.commit()
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(run_profile_id=explicit.id, workspace=ws, actor=actor)
        assert resolved is not None and resolved.id == explicit.id

    async def test_tier1_not_visible_falls_through_to_tier2(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)
        # run 指定的是 owner 的 private 档，actor 不可见 → 回退
        owner_priv = await _make_profile(db_session, owner=owner, name="owner-priv")
        ws_default = await _make_profile(db_session, owner=actor, name="ws-default")
        ws.default_agent_profile_id = ws_default.id
        db_session.add(ws)
        await db_session.commit()
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(
            run_profile_id=owner_priv.id, workspace=ws, actor=actor
        )
        assert resolved is not None and resolved.id == ws_default.id

    async def test_tier2_workspace_default_used(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)
        ws_default = await _make_profile(db_session, owner=actor, name="ws-default")
        ws.default_agent_profile_id = ws_default.id
        db_session.add(ws)
        await db_session.commit()
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(run_profile_id=None, workspace=ws, actor=actor)
        assert resolved is not None and resolved.id == ws_default.id

    async def test_tier3_platform_default_by_default_provider(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)  # no default_agent_profile_id
        admin = await _make_user(db_session, suffix="admin", admin=True)
        await _make_profile(
            db_session,
            owner=admin,
            name="Claude Code 默认",
            visibility=AgentProfileVisibility.PLATFORM,
            provider="claude",
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(
            run_profile_id=None, workspace=ws, actor=actor, default_provider="claude"
        )
        assert resolved is not None and resolved.is_system_default is True
        assert resolved.provider == "claude"

    async def test_tier3_normalizes_claude_code_provider(self, db_session) -> None:
        """workspace.default_agent=claude_code 归一为 claude，命中预置档案。"""
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session, default_agent="claude_code")
        admin = await _make_user(db_session, suffix="admin", admin=True)
        await _make_profile(
            db_session,
            owner=admin,
            name="Claude Code 默认",
            visibility=AgentProfileVisibility.PLATFORM,
            provider="claude",
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        # default_provider=None → 用 workspace.default_agent
        resolved = await svc.resolve_profile(run_profile_id=None, workspace=ws, actor=actor)
        assert resolved is not None and resolved.provider == "claude"

    async def test_tier3_codex_provider(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)
        admin = await _make_user(db_session, suffix="admin", admin=True)
        await _make_profile(
            db_session,
            owner=admin,
            name="Codex 默认",
            visibility=AgentProfileVisibility.PLATFORM,
            provider="codex",
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(
            run_profile_id=None, workspace=ws, actor=actor, default_provider="codex"
        )
        assert resolved is not None and resolved.provider == "codex"

    async def test_tier4_all_missing_returns_none(self, db_session) -> None:
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)  # 无默认档案，无 default_agent
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(
            run_profile_id=None, workspace=ws, actor=actor, default_provider=None
        )
        assert resolved is None

    async def test_tier3_no_matching_provider_returns_none(self, db_session) -> None:
        """provider 未命中任何预置档案 → None（不阻断）。"""
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session)
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(
            run_profile_id=None, workspace=ws, actor=actor, default_provider="unknown"
        )
        assert resolved is None

    async def test_tier2_not_visible_falls_through_to_tier3(self, db_session) -> None:
        owner = await _make_user(db_session, suffix="o")
        actor = await _make_user(db_session, suffix="a")
        ws = await _make_workspace(db_session, default_agent="claude")
        admin = await _make_user(db_session, suffix="admin", admin=True)
        # ws 默认档是 owner 的 private，actor 不可见
        ws_default = await _make_profile(db_session, owner=owner, name="ws-default")
        ws.default_agent_profile_id = ws_default.id
        db_session.add(ws)
        await db_session.commit()
        await _make_profile(
            db_session,
            owner=admin,
            name="Claude Code 默认",
            visibility=AgentProfileVisibility.PLATFORM,
            provider="claude",
            is_system_default=True,
        )
        svc = AgentProfileService(db_session)
        resolved = await svc.resolve_profile(run_profile_id=None, workspace=ws, actor=actor)
        assert resolved is not None and resolved.is_system_default is True
