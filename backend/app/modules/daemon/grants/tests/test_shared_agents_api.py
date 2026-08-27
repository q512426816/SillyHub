"""task-04（2026-08-28-daemon-agent-share）：平台共享智能体 CRUD API 单测。

覆盖任务卡验收面：
- 创建五重校验逐条：他人 runtime 拒 / 离线 runtime 拒 / writable_dir 越界拒 /
  档案非 platform 未显式 promote 拒 / promote 升级成功（响应提示）/ 重复建拒；
- active 仅含 enabled 行 + runtime 在线状态 + 档案显示字段；
- PATCH 停用后 active 不再返回 / DELETE 物理删；
- 非 admin 调四个管理端点 403，active 任意登录用户可访问。

按任务卡约束用 httpx AsyncClient（ASGITransport）直挂本 router 的裸 FastAPI
应用——不依赖 task-07 的 app 挂载；鉴权经 ``get_current_user`` override
（require_platform_admin 是其子依赖，一并生效）。

fixture 说明：本文件在模块内 shadow 共享 conftest 的 ``db_engine``/``db_session``
（conftest 只建 grants 表 FK 闭包最小集，缺 agent_profiles/workspaces/
daemon_runtimes；本文件按需扩成 8 表闭包，不动共享文件——与并行任务的
test_grants_authorization 互不影响）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.core.errors import register_exception_handlers
from app.models.base import BaseModel
from app.modules.agent.profile import model as _profile_model  # noqa: F401
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility

# 注册模型（顺序无关，幂等）：users / daemon / grants / profile / llm_provider /
# tool_policy / workspace——8 表闭包见 _selected_metadata。
from app.modules.auth import model as _auth_model  # noqa: F401
from app.modules.auth.model import User
from app.modules.daemon import model as _daemon_model  # noqa: F401
from app.modules.daemon.grants import model as _grants_model  # noqa: F401
from app.modules.daemon.grants.router import router as grants_router
from app.modules.daemon.grants.service import _is_within, _norm_path_key
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.llm_provider import model as _llm_model  # noqa: F401
from app.modules.tool_gateway import tool_policy as _tool_policy_model  # noqa: F401
from app.modules.workspace import model as _ws_model  # noqa: F401
from app.modules.workspace.model import Workspace


def _selected_metadata() -> MetaData:
    """本文件测试所需表的 FK 闭包（照共享 conftest 的 selected-metadata 范式扩表）。

    FK 闭包：daemon_runtime_grants → daemon_instances/users；
    daemon_runtimes → users/daemon_instances；agent_profiles →
    users/workspaces/llm_providers/tool_policies；tool_policies → workspaces；
    workspaces → agent_profiles（default 档案 FK，与 agent_profiles 循环，一并入集）。
    """
    full = BaseModel.metadata
    needed = (
        "users",
        "daemon_instances",
        "daemon_runtimes",
        "daemon_runtime_grants",
        "agent_profiles",
        "workspaces",
        "llm_providers",
        "tool_policies",
    )
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine() -> AsyncIterator[Any]:
    """模块内 shadow 共享 conftest：扩 8 表闭包的内存 SQLite 引擎。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    meta = _selected_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
async def db_session(db_engine: Any) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ── seed helpers ─────────────────────────────────────────────────────────────


async def _seed_user(
    db_session: AsyncSession, *, name: str, is_platform_admin: bool = False
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name=name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _seed_workspace(db_session: AsyncSession, *, deleted: bool = False) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="platform-src",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/work/platform-src",
        deleted_at=(datetime.now(UTC) if deleted else None),
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _seed_instance(db_session: AsyncSession, *, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="admin-host",
        server_url="http://test",
        os="win32",
        arch="x86_64",
        status="online",
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


async def _seed_runtime(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    instance_id: uuid.UUID,
    allowed_roots: list[str],
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance_id,
        user_id=user_id,
        name="admin-rt",
        provider="claude",
        allowed_roots=allowed_roots,
        status=status,
    )
    db_session.add(rt)
    await db_session.commit()
    await db_session.refresh(rt)
    return rt


async def _seed_profile(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    visibility: AgentProfileVisibility = AgentProfileVisibility.PLATFORM,
) -> AgentProfile:
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="共享助手档案",
        owner_user_id=owner_user_id,
        visibility=visibility,
        provider="claude",
    )
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)
    return profile


class Seed:
    """一个标准可创建场景的全套种子数据（admin + 在线 runtime + platform 档案 + 工作区）。"""

    def __init__(
        self,
        admin: User,
        runtime: DaemonRuntime,
        profile: AgentProfile,
        workspace: Workspace,
    ) -> None:
        self.admin = admin
        self.runtime = runtime
        self.profile = profile
        self.workspace = workspace


async def _seed_valid(db_session: AsyncSession, *, roots: list[str] | None = None) -> Seed:
    admin = await _seed_user(db_session, name="admin", is_platform_admin=True)
    inst = await _seed_instance(db_session, user_id=admin.id)
    runtime = await _seed_runtime(
        db_session,
        user_id=admin.id,
        instance_id=inst.id,
        allowed_roots=roots or ["C:/work/platform-src", "C:/work/shared-out"],
    )
    profile = await _seed_profile(db_session, owner_user_id=admin.id)
    workspace = await _seed_workspace(db_session)
    return Seed(admin, runtime, profile, workspace)


def _payload(seed: Seed, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "agent_profile_id": str(seed.profile.id),
        "pinned_runtime_id": str(seed.runtime.id),
        "source_workspace_id": str(seed.workspace.id),
        "writable_dir": "C:/work/shared-out/docs",
    }
    body.update(overrides)
    return body


def _build_client(db_session: AsyncSession, user: User) -> AsyncClient:
    """挂本 router 的裸 app + 异常处理器 + DB/鉴权 override（同 loop 免跨线程问题）。"""
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(grants_router)
    register_exception_handlers(app)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_session
    # require_platform_admin 是 get_current_user 的子依赖，override 一处全覆盖。
    app.dependency_overrides[get_current_user] = lambda: user

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── 路径归一化单元（Windows 兼容的选择说明见 service._norm_path_key）────────


class TestPathNormalization:
    def test_norm_key_unifies_separator_case_and_trailing_slash(self) -> None:
        assert _norm_path_key("C:\\Work\\OUT\\") == _norm_path_key("c:/work/out")

    def test_is_within_segment_boundary(self) -> None:
        assert _is_within("C:/work/out", "C:\\work")
        assert _is_within("C:/work/out/sub", "C:/work/out/")
        # 段边界：/tmp/abc123 不算 ⊆ /tmp/abc
        assert not _is_within("/tmp/abc123", "/tmp/abc")
        assert not _is_within("C:/other", "C:/work")


# ── 创建五重校验 ─────────────────────────────────────────────────────────────


class TestCreateValidations:
    async def test_create_ok_platform_profile_no_promote_hint(
        self, db_session: AsyncSession
    ) -> None:
        """档案已是 platform：直接建成功，visibility_promoted=false（无升级提示）。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post("/shared-agents", json=_payload(seed))
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["visibility_promoted"] is False
        assert body["enabled"] is True
        assert body["agent_profile_id"] == str(seed.profile.id)
        assert body["pinned_runtime_id"] == str(seed.runtime.id)
        assert body["source_workspace_id"] == str(seed.workspace.id)
        assert body["writable_dir"] == "C:/work/shared-out/docs"
        assert set(body) >= {
            "id",
            "agent_profile_id",
            "pinned_runtime_id",
            "source_workspace_id",
            "writable_dir",
            "enabled",
        }

    async def test_create_rejects_foreign_runtime(self, db_session: AsyncSession) -> None:
        """校验 1（D-003）：runtime 属他人名下 → 403。"""
        seed = await _seed_valid(db_session)
        other = await _seed_user(db_session, name="other", is_platform_admin=True)
        other_inst = await _seed_instance(db_session, user_id=other.id)
        foreign_rt = await _seed_runtime(
            db_session,
            user_id=other.id,
            instance_id=other_inst.id,
            allowed_roots=["C:/work/shared-out"],
        )
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents", json=_payload(seed, pinned_runtime_id=str(foreign_rt.id))
            )
        assert resp.status_code == 403
        assert resp.json()["code"] == "HTTP_403_SHARED_AGENT_RUNTIME_NOT_OWNED"

    async def test_create_rejects_offline_runtime(self, db_session: AsyncSession) -> None:
        """校验 1（D-003）：runtime 离线 → 409。"""
        seed = await _seed_valid(db_session)
        inst = await _seed_instance(db_session, user_id=seed.admin.id)
        offline = await _seed_runtime(
            db_session,
            user_id=seed.admin.id,
            instance_id=inst.id,
            allowed_roots=["C:/work/shared-out"],
            status="offline",
        )
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents", json=_payload(seed, pinned_runtime_id=str(offline.id))
            )
        assert resp.status_code == 409
        assert resp.json()["code"] == "HTTP_409_SHARED_AGENT_RUNTIME_OFFLINE"

    async def test_create_rejects_unknown_runtime(self, db_session: AsyncSession) -> None:
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents",
                json=_payload(seed, pinned_runtime_id=str(uuid.uuid4())),
            )
        assert resp.status_code == 404

    async def test_create_rejects_writable_dir_outside_roots(
        self, db_session: AsyncSession
    ) -> None:
        """校验 2（D-002@v2）：writable_dir 越出 allowed_roots → 400（含段边界变体）。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents", json=_payload(seed, writable_dir="D:/anywhere")
            )
            # 大小写/分隔符归一后仍越界 + 段边界变体（C:/work/shared-out2 非 ⊆ shared-out）
            resp2 = await client.post(
                "/shared-agents",
                json=_payload(seed, writable_dir="c:\\work\\shared-out2\\x"),
            )
        assert resp.status_code == 400
        assert resp.json()["code"] == "HTTP_400_SHARED_AGENT_WRITABLE_DIR_INVALID"
        assert resp2.status_code == 400

    async def test_create_accepts_windows_normalized_dir(self, db_session: AsyncSession) -> None:
        """归一化比较（Windows 兼容）：盘符大小写 + 反斜杠 + 尾斜杠不误拒。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents",
                json=_payload(seed, writable_dir="c:\\WORK\\shared-out\\docs\\"),
            )
        assert resp.status_code == 201, resp.text

    async def test_create_rejects_empty_writable_dir(self, db_session: AsyncSession) -> None:
        """校验 2：writable_dir 非空（schema 层 min_length → 422）。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post("/shared-agents", json=_payload(seed, writable_dir=""))
        assert resp.status_code == 422

    async def test_create_rejects_missing_or_deleted_workspace(
        self, db_session: AsyncSession
    ) -> None:
        """校验 3：source_workspace 不存在 / 已软删 → 404。"""
        seed = await _seed_valid(db_session)
        deleted_ws = await _seed_workspace(db_session, deleted=True)
        async with _build_client(db_session, seed.admin) as client:
            resp_missing = await client.post(
                "/shared-agents",
                json=_payload(seed, source_workspace_id=str(uuid.uuid4())),
            )
            resp_deleted = await client.post(
                "/shared-agents",
                json=_payload(seed, source_workspace_id=str(deleted_ws.id)),
            )
        assert resp_missing.status_code == 404
        assert resp_deleted.status_code == 404
        assert resp_deleted.json()["code"] == "HTTP_404_SHARED_AGENT_WORKSPACE_NOT_FOUND"

    async def test_create_rejects_unknown_profile(self, db_session: AsyncSession) -> None:
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents",
                json=_payload(seed, agent_profile_id=str(uuid.uuid4())),
            )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SHARED_AGENT_PROFILE_NOT_FOUND"

    async def test_create_rejects_non_platform_profile_without_promote(
        self, db_session: AsyncSession
    ) -> None:
        """校验 4（R-05）：私有档案不带 promote_visibility → 400 拒，且不落行不升级。"""
        seed = await _seed_valid(db_session)
        private = await _seed_profile(
            db_session,
            owner_user_id=seed.admin.id,
            visibility=AgentProfileVisibility.PRIVATE,
        )
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents",
                json=_payload(
                    seed,
                    agent_profile_id=str(private.id),
                    promote_visibility=False,
                ),
            )
            list_resp = await client.get("/shared-agents")
        assert resp.status_code == 400
        assert resp.json()["code"] == "HTTP_400_SHARED_AGENT_PROMOTE_REQUIRED"
        # 静默升级被禁止：档案可见性未变，grant 未落行
        await db_session.refresh(private)
        assert private.visibility == AgentProfileVisibility.PRIVATE
        assert list_resp.json() == []

    async def test_create_with_promote_upgrades_profile_and_hints(
        self, db_session: AsyncSession
    ) -> None:
        """校验 4（R-05）：显式 promote_visibility=true → 升级为 platform + 响应提示。"""
        seed = await _seed_valid(db_session)
        private = await _seed_profile(
            db_session,
            owner_user_id=seed.admin.id,
            visibility=AgentProfileVisibility.WORKSPACE,
        )
        async with _build_client(db_session, seed.admin) as client:
            resp = await client.post(
                "/shared-agents",
                json=_payload(
                    seed,
                    agent_profile_id=str(private.id),
                    promote_visibility=True,
                ),
            )
        assert resp.status_code == 201, resp.text
        assert resp.json()["visibility_promoted"] is True
        await db_session.refresh(private)
        assert private.visibility == AgentProfileVisibility.PLATFORM

    async def test_create_duplicate_rejected(self, db_session: AsyncSession) -> None:
        """校验 5（D-008）：同 daemon + platform + 同管理员重复建 → 409（应用级查重，
        SQLite 下唯一约束对 NULL grantee_id 不拦截）。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            first = await client.post("/shared-agents", json=_payload(seed))
            # 换档案/目录/工作区也不行——唯一键是 daemon 实体 + platform + 管理员
            other_profile = await _seed_profile(db_session, owner_user_id=seed.admin.id)
            second = await client.post(
                "/shared-agents",
                json=_payload(seed, agent_profile_id=str(other_profile.id)),
            )
        assert first.status_code == 201
        assert second.status_code == 409
        assert second.json()["code"] == "HTTP_409_SHARED_AGENT_DUPLICATE"


# ── active 公共端点 ──────────────────────────────────────────────────────────


class TestActiveEndpoint:
    async def test_active_only_enabled_with_runtime_status_and_profile_fields(
        self, db_session: AsyncSession
    ) -> None:
        """active 仅含 enabled 行；runtime_online 反映 runtime 状态；display 字段取档案。"""
        seed = await _seed_valid(db_session)
        normal_user = await _seed_user(db_session, name="normal")
        # 第二台 runtime（创建时在线，创建后掉线——R-04：离线不删行，active 带在线状态）
        inst2 = await _seed_instance(db_session, user_id=seed.admin.id)
        rt2 = await _seed_runtime(
            db_session,
            user_id=seed.admin.id,
            instance_id=inst2.id,
            allowed_roots=["C:/work/shared-out"],
            status="online",
        )
        async with _build_client(db_session, seed.admin) as client:
            await client.post("/shared-agents", json=_payload(seed))
            await client.post(
                "/shared-agents",
                json=_payload(seed, pinned_runtime_id=str(rt2.id)),
            )
            first_id = (await client.get("/shared-agents")).json()[0]["id"]
            await client.patch(f"/shared-agents/{first_id}", json={"enabled": False})
        # 第一行停用后，第二行的 runtime 掉线（离线发生在创建之后，符合 D-003 创建校验）
        rt2.status = "offline"
        db_session.add(rt2)
        await db_session.commit()

        async with _build_client(db_session, normal_user) as client:
            resp = await client.get("/shared-agents/active")
        assert resp.status_code == 200
        rows = resp.json()
        # 停用行被剔除，仅剩离线 runtime 那行
        assert len(rows) == 1
        assert rows[0]["id"] != first_id
        assert rows[0]["agent_profile_id"] == str(seed.profile.id)
        assert rows[0]["display_name"] == "共享助手档案"
        assert rows[0]["provider"] == "claude"
        assert rows[0]["runtime_online"] is False


# ── PATCH / DELETE ───────────────────────────────────────────────────────────


class TestPatchAndDelete:
    async def test_patch_disable_then_reenable(self, db_session: AsyncSession) -> None:
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            grant_id = (await client.post("/shared-agents", json=_payload(seed))).json()["id"]
            disabled = await client.patch(f"/shared-agents/{grant_id}", json={"enabled": False})
            assert disabled.status_code == 200
            assert disabled.json()["enabled"] is False
            # 管理列表含停用行
            listed = await client.get("/shared-agents")
            assert [r["enabled"] for r in listed.json()] == [False]
            # active 不再返回
            assert (await client.get("/shared-agents/active")).json() == []
            # 重新启用后 active 恢复
            enabled = await client.patch(f"/shared-agents/{grant_id}", json={"enabled": True})
            assert enabled.json()["enabled"] is True
            assert len((await client.get("/shared-agents/active")).json()) == 1

    async def test_delete_is_physical_and_then_404(self, db_session: AsyncSession) -> None:
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            grant_id = (await client.post("/shared-agents", json=_payload(seed))).json()["id"]
            deleted = await client.delete(f"/shared-agents/{grant_id}")
            assert deleted.status_code == 204
            assert (await client.get("/shared-agents")).json() == []
            assert (await client.get("/shared-agents/active")).json() == []
            patch_after = await client.patch(f"/shared-agents/{grant_id}", json={"enabled": True})
            assert patch_after.status_code == 404
            delete_after = await client.delete(f"/shared-agents/{grant_id}")
            assert delete_after.status_code == 404

    async def test_delete_then_recreate_allowed(self, db_session: AsyncSession) -> None:
        """物理删后同 daemon 可重新创建（D-008 唯一约束只拦现存行）。"""
        seed = await _seed_valid(db_session)
        async with _build_client(db_session, seed.admin) as client:
            grant_id = (await client.post("/shared-agents", json=_payload(seed))).json()["id"]
            assert (await client.delete(f"/shared-agents/{grant_id}")).status_code == 204
            recreate = await client.post("/shared-agents", json=_payload(seed))
        assert recreate.status_code == 201


# ── 权限矩阵 ─────────────────────────────────────────────────────────────────


class TestAdminPermissionMatrix:
    async def test_non_admin_rejected_on_all_admin_endpoints(
        self, db_session: AsyncSession
    ) -> None:
        """非 admin 调 GET/POST/PATCH/DELETE 四个管理端点 → 403（active 端点除外）。"""
        seed = await _seed_valid(db_session)
        normal_user = await _seed_user(db_session, name="normal")
        any_id = str(uuid.uuid4())
        async with _build_client(db_session, normal_user) as client:
            resp_get = await client.get("/shared-agents")
            assert resp_get.status_code == 403, "GET 管理列表应 403"
            resp_post = await client.post("/shared-agents", json=_payload(seed))
            assert resp_post.status_code == 403, "POST 创建应 403"
            resp_patch = await client.patch(f"/shared-agents/{any_id}", json={"enabled": False})
            assert resp_patch.status_code == 403, "PATCH 应 403"
            resp_delete = await client.delete(f"/shared-agents/{any_id}")
            assert resp_delete.status_code == 403, "DELETE 应 403"
            # active 公共端点任意登录用户可访问（空列表 200）
            assert (await client.get("/shared-agents/active")).status_code == 200
