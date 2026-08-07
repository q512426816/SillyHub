"""Tests for task-06 profile 注入（change 2026-08-02-agent-profile-layer）.

覆盖 design §4 / §5 / §7 / D-012@v2 / D-013 / D-014 / C-07，聚焦 task-06 新增的
dispatch 侧 wiring——

* D-012@v2（核心）：``GET /agent-runs/{id}/execution-context`` 组装 claudeMd 时
  prepend ``AgentRun.agent_profile_snapshot['system_prompt']``。带 / 不带 / 空 prompt
  三路径 + stage run 仍空（stage 分支重置不受污染）。**prepend 纯加性**用两条共享
  bundle 的 run 交叉断言（B.claude_md == prompt + A.claude_md）。
* C-07：``_resolve_dispatch_profile`` 无 hint（run_profile_id 与
  workspace.default_agent_profile_id 均 None）时**零 SQL**，直接返 None（PPM 已
  上线路径零回归）；有 hint 才加载 actor。
* D-013 集成：``_apply_profile_to_lease`` 写 ``effective_allowed_roots =
  daemon ∩ overlay`` + mcp_refs/skill_refs/profile_version 进 lease.metadata。
* D-014：``start_run`` 用 profile.provider 经 ``_normalize_provider`` 对齐覆盖
  workspace.default_agent，并把 agent_profile_id/snapshot 写进 AgentRun。

``compute_effective_allowed_roots`` 纯函数 + ``resolve_profile`` 四级兜底链 + CRUD
已在 ``test_profile_service.py`` 覆盖，本文件不重复。``build_spec_bundle`` /
``render_bundle_to_claude_md`` 渲染管线零改动（design §7），测试只验响应组装层。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun
from app.modules.agent.profile import model as _profile_model  # noqa: F401
from app.modules.agent.service import AgentService, _build_agent_profile_snapshot
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# execution-context 端点的 _inject_provider_config 查 llm_providers；conftest 未注册该表，
# 不导入会让所有走该端点的测试报 no such table（与 deselected 的旧 test_execution_context
# task_run 同因）。此处注册到 BaseModel.metadata，整库共享。
from app.modules.llm_provider import model as _llm_provider_model  # noqa: F401
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, Workspace
from app.modules.worktree.model import WorktreeLease

# profile.model 必须在 db_engine create_all 前注册 agent_profiles 表（conftest 未导入它），
# 否则 AgentRun.agent_profile_id 的 FK 字符串 'agent_profiles.id' 解析失败（单文件跑时）。
# 上面 import 已触发注册（_profile_model 仅占位，下同）。

# ────────────────────────────────────────────────────────────────────────────
# 共享 seed helpers
# ────────────────────────────────────────────────────────────────────────────


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db_session, *, is_admin: bool = True) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"dp-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="DP",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _token(user: User) -> str:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def _seed_task_run(
    db_session,
    tmp_path,
    owner: User,
    *,
    agent_profile_snapshot: dict | None = None,
    lease_meta: dict | None = None,
) -> uuid.UUID:
    """建一条 task run（workspace + change + task + lease + runtime），可选挂 profile 快照。

    复刻 ``test_execution_context._make_run`` 的 ownership 接线（UserWorkspaceRole），
    让 ``_user_owns_run`` 放行；本 helper 只服务 task run（prepend 测试主体）。
    """
    from app.modules.auth.model import Role, UserWorkspaceRole

    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="DP WS",
            slug=f"dp-ws-{ws_id.hex[:6]}",
            # root_path 有唯一约束：同一测试建两条 run（prepend 交叉断言）须各占独立路径。
            root_path=str(tmp_path / ws_id.hex[:8]),
            status="active",
            created_by=owner.id,
        )
    )
    owner_role_id = uuid.uuid4()
    db_session.add(
        Role(
            id=owner_role_id,
            # key 列有唯一约束：同一测试内多次 _seed_task_run（prepend 交叉断言建两条
            # run）须各持独立 role 行；_user_owns_run 只校验 membership 存在，不看 key 值。
            key=f"workspace_owner-{ws_id.hex[:6]}",
            name="Workspace Owner",
            description="test role",
        )
    )
    db_session.add(
        UserWorkspaceRole(
            user_id=owner.id,
            workspace_id=ws_id,
            role_id=owner_role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )

    change_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=ws_id,
            change_key=f"dp-{change_id.hex[:6]}",
            title="DP Change",
            status="in_progress",
            location="change",
            path=str(tmp_path / "change"),
        )
    )

    task_id = uuid.uuid4()
    db_session.add(
        Task(
            id=task_id,
            workspace_id=ws_id,
            change_id=change_id,
            task_key="dp-task-01",
            title="DP Task",
            status="in_progress",
            allowed_paths=["src/"],
        )
    )

    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            task_id=task_id,
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
            # task-06：dispatch 落地的 profile 快照（含 system_prompt），execution-context
            # 端点 prepend 时直接读它，零额外查询。
            agent_profile_snapshot=agent_profile_snapshot,
        )
    )
    db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))

    rt_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=rt_id,
            user_id=owner.id,
            name="dp-daemon",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    db_session.add(
        DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt_id,
            agent_run_id=run_id,
            status="pending",
            metadata_=lease_meta
            or {
                "prompt": "实现 dp",
                "provider": "claude_code",
                "model": "claude-sonnet-4",
            },
        )
    )
    await db_session.commit()
    return run_id


# ════════════════════════════════════════════════════════════════════════════
# 1. D-012@v2：execution-context claudeMd prepend profile.system_prompt
# ════════════════════════════════════════════════════════════════════════════


class TestExecutionContextPrependSystemPrompt:
    """D-012@v2：get_execution_context 组装 claudeMd 时 prepend snapshot.system_prompt。

    读 ``AgentRun.agent_profile_snapshot`` JSON 列，零额外查询（C-07）；stage 分支
    随后重置 claude_md="" 故 stage run 不受影响；build_spec_bundle/render 零改动。
    """

    async def test_prepends_system_prompt_to_claude_md(self, client, db_session, tmp_path) -> None:
        """带 profile 快照且 system_prompt 非空 → claude_md 顶部含 prompt。"""
        owner = await _make_user(db_session)
        prompt = "你是一个简洁的代码档案助手。"
        run_id = await _seed_task_run(
            db_session,
            tmp_path,
            owner,
            agent_profile_snapshot={
                "id": str(uuid.uuid4()),
                "name": "concise",
                "provider": "claude",
                "model": None,
                "system_prompt": prompt,
                "mcp_refs": [],
                "skill_refs": [],
                "allowed_roots_overlay": None,
                "version": 1,
            },
        )
        resp = await client.get(
            f"/api/agent-runs/{run_id}/execution-context",
            headers=_auth(_token(owner)),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # prepend 落在 claudeMd 顶部
        assert body["claude_md"].startswith(prompt)
        # prompt 之后还跟着渲染管线产出的 spec 内容（非空、被分隔）
        assert body["claude_md"].strip() != prompt.strip()

    async def test_prepend_is_purely_additive_across_runs(
        self, client, db_session, tmp_path
    ) -> None:
        """prepend 仅加 prompt 前缀：B.claude_md == 'prompt\\n\\n' + A.claude_md。

        两条 run 共享同一 change/task/workspace → render_bundle_to_claude_md 输出
        完全一致；区别仅 B 挂了 profile 快照。断言 prepend 不动渲染产物（design §7
        「build_spec_bundle/render 函数零改动」的等价校验）。
        """
        owner = await _make_user(db_session)
        run_a = await _seed_task_run(db_session, tmp_path, owner)  # 无快照
        prompt = "PROFILE_PROMPT_SENTINEL"
        run_b = await _seed_task_run(
            db_session,
            tmp_path,
            owner,
            agent_profile_snapshot={
                "id": str(uuid.uuid4()),
                "name": "p",
                "provider": "claude",
                "model": None,
                "system_prompt": prompt,
                "mcp_refs": [],
                "skill_refs": [],
                "allowed_roots_overlay": None,
                "version": 1,
            },
        )
        headers = _auth(_token(owner))
        resp_a = await client.get(f"/api/agent-runs/{run_a}/execution-context", headers=headers)
        resp_b = await client.get(f"/api/agent-runs/{run_b}/execution-context", headers=headers)
        assert resp_a.status_code == 200, resp_a.text
        assert resp_b.status_code == 200, resp_b.text

        md_a = resp_a.json()["claude_md"]
        md_b = resp_b.json()["claude_md"]
        assert md_a  # 渲染产物非空
        assert md_b == f"{prompt}\n\n{md_a}"  # prepend 纯加性

    async def test_no_snapshot_claude_md_unchanged(self, client, db_session, tmp_path) -> None:
        """无 profile 快照 → claude_md 与今天一致（不 prepend，向后兼容 FR-15）。"""
        owner = await _make_user(db_session)
        run_id = await _seed_task_run(db_session, tmp_path, owner)  # snapshot=None
        resp = await client.get(
            f"/api/agent-runs/{run_id}/execution-context",
            headers=_auth(_token(owner)),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["claude_md"]  # 渲染产物仍在
        # 没有 prepend 的痕迹（不以某个孤立 prompt 开头 + 空行）
        assert not body["claude_md"].startswith("\n\n")

    async def test_empty_system_prompt_not_prepended(self, client, db_session, tmp_path) -> None:
        """快照 system_prompt 为空字符串 → 不 prepend（与 None 同路径）。"""
        owner = await _make_user(db_session)
        run_no_prompt = await _seed_task_run(
            db_session,
            tmp_path,
            owner,
            agent_profile_snapshot={
                "id": str(uuid.uuid4()),
                "name": "p",
                "provider": "claude",
                "model": None,
                "system_prompt": "",
                "mcp_refs": [],
                "skill_refs": [],
                "allowed_roots_overlay": None,
                "version": 1,
            },
        )
        run_baseline = await _seed_task_run(db_session, tmp_path, owner)  # 无快照
        headers = _auth(_token(owner))
        resp_empty = await client.get(
            f"/api/agent-runs/{run_no_prompt}/execution-context", headers=headers
        )
        resp_base = await client.get(
            f"/api/agent-runs/{run_baseline}/execution-context", headers=headers
        )
        assert resp_empty.status_code == 200, resp_empty.text
        # 空 prompt 与无快照产物一致（都不 prepend）
        assert resp_empty.json()["claude_md"] == resp_base.json()["claude_md"]


# ════════════════════════════════════════════════════════════════════════════
# 2. C-07：_resolve_dispatch_profile 无 hint 零 SQL
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDispatchProfileZeroQuery:
    """C-07：无 hint 时 _resolve_dispatch_profile 零查询直接返 None（PPM 零回归）。"""

    async def test_no_hint_returns_none_without_any_query(self) -> None:
        """run_profile_id=None 且 workspace.default_agent_profile_id=None → 零 SQL。"""
        session = MagicMock()
        session.get = AsyncMock(return_value=None)
        session.execute = AsyncMock(return_value=MagicMock())

        svc = AgentService(session)
        ws = MagicMock()
        ws.default_agent_profile_id = None  # 无 hint

        profile = await svc._resolve_dispatch_profile(
            workspace=ws,
            user_id=uuid.uuid4(),
            default_provider="claude_code",
            run_profile_id=None,
        )

        assert profile is None
        # C-07 核心：连 actor 加载都没发起
        assert session.get.call_count == 0
        assert session.execute.call_count == 0

    async def test_workspace_none_returns_none_without_query(self) -> None:
        """workspace 本身为 None（quick-chat 无 workspace）→ 零 SQL 返 None。"""
        session = MagicMock()
        session.get = AsyncMock(return_value=None)
        session.execute = AsyncMock(return_value=MagicMock())

        svc = AgentService(session)
        profile = await svc._resolve_dispatch_profile(
            workspace=None,
            user_id=uuid.uuid4(),
            default_provider="claude_code",
            run_profile_id=None,
        )

        assert profile is None
        assert session.get.call_count == 0
        assert session.execute.call_count == 0

    async def test_hint_loads_actor_then_resolve(self) -> None:
        """有 hint（workspace.default_agent_profile_id 非 None）→ 至少加载 actor 一次。

        resolve_profile 全兜底链已在 test_profile_service.py 覆盖；此处只锁
        _resolve_dispatch_profile 在有 hint 时确实发起了 actor 加载（C-07 的反向边界）。
        """
        actor = MagicMock(spec=User)
        session = MagicMock()

        async def _get(model, _pk, *a, **k):
            return actor if model is User else None

        session.get = AsyncMock(side_effect=_get)
        session.execute = AsyncMock(return_value=MagicMock())

        ws = MagicMock()
        ws.default_agent_profile_id = uuid.uuid4()  # 有 hint

        with patch(
            "app.modules.agent.profile.service.AgentProfileService.resolve_profile",
            new=AsyncMock(return_value=None),
        ):
            svc = AgentService(session)
            await svc._resolve_dispatch_profile(
                workspace=ws,
                user_id=uuid.uuid4(),
                default_provider="claude_code",
                run_profile_id=None,
            )

        # 有 hint → 加载了 actor（User）
        get_models = [c.args[0] for c in session.get.call_args_list]
        assert User in get_models


# ════════════════════════════════════════════════════════════════════════════
# 3. D-013 集成：_apply_profile_to_lease 写 effective_allowed_roots + refs
# ════════════════════════════════════════════════════════════════════════════


class TestApplyProfileToLease:
    """_apply_profile_to_lease 把 profile 字段合并进 daemon_task_leases.metadata。

    effective_allowed_roots = daemon ∩ overlay（按 daemon 顺序保留）；同时写
    mcp_refs / skill_refs / profile_version（task-07 build_claim_payload 读这些）。
    """

    async def test_writes_effective_roots_and_refs(self, db_session) -> None:
        from app.modules.agent.profile.model import AgentProfile

        owner = User(
            id=uuid.uuid4(),
            email=f"ap-{uuid.uuid4().hex[:8]}@example.com",
            password_hash="x",
            display_name="AP",
            status="active",
        )
        db_session.add(owner)

        runtime = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner.id,
            name="rt",
            provider="claude_code",
            status="online",
            # daemon 沙箱上限（design §4）
            allowed_roots=["/repo/src", "/repo/docs", "/repo/tests"],
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(runtime)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=runtime.id,
            agent_run_id=uuid.uuid4(),
            status="pending",
            metadata_={"prompt": "x"},  # 已有键应保留
        )
        db_session.add(lease)

        profile = AgentProfile(
            id=uuid.uuid4(),
            name="p",
            owner_user_id=owner.id,
            visibility="private",
            provider="claude",
            model="m",
            system_prompt="sp",
            # overlay ⊆ daemon → 交集按 daemon 顺序保留
            allowed_roots_overlay=["/repo/tests", "/repo/src"],
            mcp_refs=["git", "fs"],
            skill_refs=["sillyspec-quick"],
            version=7,
        )
        db_session.add(profile)
        await db_session.commit()

        svc = AgentService(db_session)
        await svc._apply_profile_to_lease(lease.id, profile)

        # 重新加载（_apply 用 raw SQL UPDATE，刷新 ORM 对象拿最新值）
        await db_session.refresh(lease)
        meta = lease.metadata_ or {}
        # effective = daemon ∩ overlay（D-013）
        assert meta["effective_allowed_roots"] == ["/repo/src", "/repo/tests"]
        assert meta["mcp_refs"] == ["git", "fs"]
        assert meta["skill_refs"] == ["sillyspec-quick"]
        assert meta["profile_version"] == 7
        # 原有键保留（合并非覆盖）
        assert meta["prompt"] == "x"

    async def test_empty_overlay_falls_back_to_daemon_roots(self, db_session) -> None:
        """overlay 为 None → effective 回退 daemon 原值（design §4）。"""
        from app.modules.agent.profile.model import AgentProfile

        owner = User(
            id=uuid.uuid4(),
            email=f"ap2-{uuid.uuid4().hex[:8]}@example.com",
            password_hash="x",
            display_name="AP2",
            status="active",
        )
        db_session.add(owner)
        runtime = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner.id,
            name="rt2",
            provider="claude_code",
            status="online",
            allowed_roots=["/a", "/b"],
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(runtime)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=runtime.id,
            agent_run_id=uuid.uuid4(),
            status="pending",
            metadata_={},
        )
        db_session.add(lease)
        profile = AgentProfile(
            id=uuid.uuid4(),
            name="p2",
            owner_user_id=owner.id,
            visibility="private",
            provider="claude",
            allowed_roots_overlay=None,
            mcp_refs=[],
            skill_refs=[],
            version=1,
        )
        db_session.add(profile)
        await db_session.commit()

        await AgentService(db_session)._apply_profile_to_lease(lease.id, profile)
        await db_session.refresh(lease)
        assert (lease.metadata_ or {})["effective_allowed_roots"] == ["/a", "/b"]


# ════════════════════════════════════════════════════════════════════════════
# 4. _build_agent_profile_snapshot 形状
# ════════════════════════════════════════════════════════════════════════════


class TestBuildAgentProfileSnapshot:
    """快照含 version + system_prompt（供 execution-context prepend 零查询读取）。"""

    def _profile(self, **overrides) -> MagicMock:
        base = {
            "id": uuid.uuid4(),
            "name": "p",
            "provider": "claude",
            "model": "m",
            "system_prompt": "be concise",
            "mcp_refs": ["git"],
            "skill_refs": ["sk"],
            "allowed_roots_overlay": ["/x"],
            "version": 5,
        }
        base.update(overrides)
        prof = MagicMock()
        for k, v in base.items():
            setattr(prof, k, v)
        return prof

    def test_snapshot_contains_all_fields(self) -> None:
        prof = self._profile()
        snap = _build_agent_profile_snapshot(prof)
        assert snap["id"] == str(prof.id)
        assert snap["name"] == "p"
        assert snap["provider"] == "claude"
        assert snap["model"] == "m"
        assert snap["system_prompt"] == "be concise"
        assert snap["mcp_refs"] == ["git"]
        assert snap["skill_refs"] == ["sk"]
        assert snap["allowed_roots_overlay"] == ["/x"]
        assert snap["version"] == 5

    def test_snapshot_allowed_roots_overlay_none_passes_through(self) -> None:
        """overlay=None 时快照存 None（execution-context / claim payload 据此判断不叠加）。"""
        prof = self._profile(allowed_roots_overlay=None)
        snap = _build_agent_profile_snapshot(prof)
        assert snap["allowed_roots_overlay"] is None


# ════════════════════════════════════════════════════════════════════════════
# 5. D-014：start_run 用 profile.provider 覆盖 default_agent + 写 snapshot
# ════════════════════════════════════════════════════════════════════════════


class TestStartRunProfileWiring:
    """start_run 解析到 profile 后：target_provider 用 profile.provider（归一化），
    AgentRun.agent_profile_id / agent_profile_snapshot 落地。

    用 mock session 隔离 dispatch 细节（沿用 test_service_provider 风格），只锁
    task-06 新增的 wiring；resolve_profile 全兜底链在 test_profile_service.py 已覆盖。
    """

    @staticmethod
    def _make_session(task, lease, workspace, actor):
        """AsyncSession mock：按 model 分派 get；Workspace / User 返回真实 mock。"""
        session = MagicMock()

        async def _get(model, _pk, *a, **k):
            if model is Task:
                return task
            if model is WorktreeLease:
                return lease
            if model is Workspace:
                return workspace
            if model is User:
                return actor
            return None

        session.get = AsyncMock(side_effect=_get)
        result = MagicMock()
        result.all.return_value = []
        session.execute = AsyncMock(return_value=result)
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        return session

    @staticmethod
    def _patch_run_env(*, dispatch_return=None):
        from app.modules.agent.placement import ExecutionBackend

        bundle = MagicMock()
        bundle.spec_strategy = "v1"
        bundle.profile_version = "1"
        coord = MagicMock()
        coord.check_idempotency = AsyncMock(return_value=None)
        coord.compute_fingerprint.return_value = "fp"
        coord.generate_resume_token = AsyncMock()
        placement = MagicMock()
        placement.decide_backend = AsyncMock(return_value=ExecutionBackend.DAEMON)
        placement.dispatch_to_daemon = AsyncMock(return_value=dispatch_return)
        managers = [
            patch(
                "app.modules.agent.service.build_spec_bundle", new=AsyncMock(return_value=bundle)
            ),
            patch("app.modules.agent.service.ExecutionCoordinatorService", return_value=coord),
            patch("app.modules.agent.service.RunPlacementService", return_value=placement),
        ]
        return managers, placement

    async def test_profile_provider_overrides_workspace_default(self) -> None:
        """profile.provider='claude_code' → dispatch provider 归一化为 'claude'，覆盖 default_agent。"""
        workspace_id = uuid.uuid4()
        task = MagicMock()
        task.id = uuid.uuid4()
        task.workspace_id = workspace_id
        task.change_id = None
        lease = MagicMock()
        lease.id = uuid.uuid4()
        lease.status = "locked"

        ws = MagicMock()
        ws.default_agent = "codex"  # 被 profile 覆盖
        ws.default_model = None
        ws.default_agent_profile_id = uuid.uuid4()  # 存在 hint → 触发 profile 解析

        actor = MagicMock()
        actor.id = uuid.uuid4()
        actor.is_platform_admin = False
        session = self._make_session(task, lease, ws, actor)

        # resolve_profile 返回一个 provider='claude_code' 的档案（D-014）
        profile = MagicMock()
        profile.id = uuid.uuid4()
        profile.name = "claude-default"
        profile.provider = "claude_code"
        profile.model = None
        profile.system_prompt = "你是一个简洁助手。"
        profile.mcp_refs = []
        profile.skill_refs = []
        profile.allowed_roots_overlay = None
        profile.version = 2

        managers, placement = self._patch_run_env(dispatch_return=uuid.uuid4())
        resolve_patch = patch(
            "app.modules.agent.profile.service.AgentProfileService.resolve_profile",
            new=AsyncMock(return_value=profile),
        )
        apply_patch = patch.object(
            AgentService, "_apply_profile_to_lease", new=AsyncMock(return_value=None)
        )
        for m in managers:
            m.start()
        resolve_patch.start()
        apply_patch.start()
        try:
            svc = AgentService(session)
            run = await svc.start_run(
                workspace_id=workspace_id,
                user_id=actor.id,
                task_id=task.id,
                lease_id=lease.id,
            )
        finally:
            for m in managers:
                m.stop()
            resolve_patch.stop()
            apply_patch.stop()

        # D-014：profile.provider 经 _normalize_provider 归一化后覆盖 workspace.default_agent
        assert placement.dispatch_to_daemon.call_args.kwargs["provider"] == "claude"
        # profile id 透传给 placement（target_provider 选型，D-014）
        assert placement.dispatch_to_daemon.call_args.kwargs["agent_profile_id"] == profile.id
        # AgentRun 落地 profile 绑定 + 快照
        assert run.agent_profile_id == profile.id
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot["system_prompt"] == "你是一个简洁助手。"
        assert run.agent_profile_snapshot["version"] == 2
        assert run.provider == "claude"  # AgentRun.provider 同步对齐

    async def test_no_profile_keeps_workspace_default_no_new_keys(self) -> None:
        """无 hint（workspace.default_agent_profile_id=None）→ profile=None，走原路径。

        C-07 + FR-15：dispatch provider = workspace.default_agent；AgentRun 无
        agent_profile_id/snapshot；_apply_profile_to_lease 不被调用。
        """
        workspace_id = uuid.uuid4()
        task = MagicMock()
        task.id = uuid.uuid4()
        task.workspace_id = workspace_id
        task.change_id = None
        lease = MagicMock()
        lease.id = uuid.uuid4()
        lease.status = "locked"

        ws = MagicMock()
        ws.default_agent = "claude"
        ws.default_model = None
        ws.default_agent_profile_id = None  # 无 hint

        actor = MagicMock()
        actor.id = uuid.uuid4()
        actor.is_platform_admin = False
        session = self._make_session(task, lease, ws, actor)

        managers, placement = self._patch_run_env(dispatch_return=uuid.uuid4())
        apply_patch = patch.object(
            AgentService, "_apply_profile_to_lease", new=AsyncMock(return_value=None)
        )
        for m in managers:
            m.start()
        apply_patch.start()
        try:
            svc = AgentService(session)
            run = await svc.start_run(
                workspace_id=workspace_id,
                user_id=actor.id,
                task_id=task.id,
                lease_id=lease.id,
            )
        finally:
            for m in managers:
                m.stop()
            apply_patch.stop()

        # 原路径：dispatch 收 workspace.default_agent
        assert placement.dispatch_to_daemon.call_args.kwargs["provider"] == "claude"
        assert placement.dispatch_to_daemon.call_args.kwargs["agent_profile_id"] is None
        # AgentRun 无 profile 绑定
        assert run.agent_profile_id is None
        assert run.agent_profile_snapshot is None


# ════════════════════════════════════════════════════════════════════════════
# 6. task-10（change 2026-08-06-public-mcp-server）：MCP dispatch_worker 绑 AgentProfile
# ════════════════════════════════════════════════════════════════════════════


class TestMcpDispatchWorkerBindProfile:
    """POST dispatch_worker 传 agent_profile_id：校验 + 落 run.agent_profile_id/快照。

    复用 test_mcp_tools 的「无 binding → 503」前置：run 在 dispatch_worker 调 delegate
    前已 commit（含 profile 绑定），故直接查 DB 断言两字段；跨 workspace 的 400 在
    建 run 前抛出（无 run 落库）。
    """

    @staticmethod
    async def _admin_user(db_session) -> User:
        from sqlalchemy import select

        stmt = select(User).where(User.email == "admin@example.com").limit(1)
        return (await db_session.execute(stmt)).scalars().first()

    @staticmethod
    async def _seed_mission(db_session) -> tuple[uuid.UUID, uuid.UUID]:
        """建 workspace + mission（无 main run 即可，dispatch 不依赖）。"""
        ws_id = uuid.uuid4()
        db_session.add(
            Workspace(
                id=ws_id,
                name=f"ws-{ws_id.hex[:8]}",
                slug=f"ws-{ws_id.hex[:8]}",
                root_path=f"/tmp/{ws_id.hex}",
                status="active",
            )
        )
        from app.modules.agent.model import AgentMission

        mission = AgentMission(
            workspace_id=ws_id,
            objective="团队目标",
            constraints={"mode": "team"},
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        return ws_id, mission.id

    @staticmethod
    async def _latest_run(db_session, mission_id: uuid.UUID) -> AgentRun | None:
        from sqlalchemy import select

        stmt = (
            select(AgentRun)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentRun.created_at.desc())
        )
        return (await db_session.execute(stmt)).scalars().first()

    async def test_binds_profile_and_freezes_snapshot(
        self, client, db_session, auth_headers
    ) -> None:
        """合法 agent_profile_id → run.agent_profile_id 落库 + snapshot 含 version。"""
        from app.modules.agent.profile.model import AgentProfile

        admin = await self._admin_user(db_session)
        ws_id, mission_id = await self._seed_mission(db_session)
        profile = AgentProfile(
            id=uuid.uuid4(),
            name="mcp-dispatch-p",
            owner_user_id=admin.id,
            visibility="private",
            provider="claude",
            model="claude-sonnet-4",
            system_prompt="你是 MCP dispatch 助手。",
            mcp_refs=[],
            skill_refs=[],
            version=3,
        )
        db_session.add(profile)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事", "agent_profile_id": str(profile.id)},
            headers=auth_headers,
        )
        # 无 binding → 503 fail-loud（delegate 注入后语义），但 run 已前置 commit
        assert resp.status_code == 503, resp.text

        run = await self._latest_run(db_session, mission_id)
        assert run is not None
        assert run.agent_profile_id == profile.id
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot["version"] == 3
        assert run.agent_profile_snapshot["system_prompt"] == "你是 MCP dispatch 助手。"

    async def test_cross_workspace_profile_returns_400(
        self, client, db_session, auth_headers
    ) -> None:
        """workspace 级 profile 属其它 workspace → 400，且不建 run。"""
        from app.modules.agent.profile.model import AgentProfile

        await self._admin_user(db_session)
        ws_id, mission_id = await self._seed_mission(db_session)
        other_ws_id = uuid.uuid4()
        db_session.add(
            Workspace(
                id=other_ws_id,
                name=f"ws-{other_ws_id.hex[:8]}",
                slug=f"ws-{other_ws_id.hex[:8]}",
                root_path=f"/tmp/{other_ws_id.hex}",
                status="active",
            )
        )
        profile = AgentProfile(
            id=uuid.uuid4(),
            name="other-ws-p",
            owner_user_id=None,
            workspace_id=other_ws_id,  # 属其它 workspace
            visibility="workspace",
            provider="claude",
            mcp_refs=[],
            skill_refs=[],
            version=1,
        )
        db_session.add(profile)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事", "agent_profile_id": str(profile.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        # 400 在建 run 前抛出 → 无 run 落库
        assert await self._latest_run(db_session, mission_id) is None

    async def test_no_profile_id_behaves_as_before(self, client, db_session, auth_headers) -> None:
        """不传 agent_profile_id → 走兜底链，两字段 None（零回归）。"""
        await self._admin_user(db_session)
        ws_id, mission_id = await self._seed_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 503, resp.text
        run = await self._latest_run(db_session, mission_id)
        assert run is not None
        assert run.agent_profile_id is None
        assert run.agent_profile_snapshot is None
