"""Tests for ``GET /agent-runs/{run_id}/execution-context`` + diff redact。

覆盖 ``2026-06-14-unified-agent-execution``：

task-02（端点骨架）+ task-11（完整测试套件）AC-01..09：

- 端点 AC-01..03/08：task / stage / scan 三类 run 都能构建上下文（200），
  响应含 ``render_bundle_to_claude_md`` 输出 + lease.metadata 全字段回填
  （prompt/provider/repo_url/branch/allowed_paths/tool_config/resume_session_id）。
- R-02：跨 user 访问 → 403；同 user → 200（正向用例防误杀）。
- 404：run 不存在；401：未认证。
- diff redact AC-09（TestCompleteLeaseDiffRedact）：含密钥 diff/output 入库前经
  ``redact_output`` 二次脱敏（task-07 已在 ``complete_lease`` 接入 output/error/patch
  三处，单一真相源 git_gateway.redact_output）。

> AC-06（no_online_daemon）/AC-07（状态映射）/AC-08（kill cancel_lease）/AC-10
> （service.py 无 SIGTERM）已由 ``test_no_online_daemon.py``（task-01/03）与
> ``test_kill_and_state_mapping.py``（task-04）覆盖，本文件不重复。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db_session, *, is_admin: bool = True) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"exec-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Exec",
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


async def _make_run(
    db_session,
    tmp_path,
    owner: User,
    *,
    run_type: str = "task",
    lease_meta: dict | None = None,
) -> uuid.UUID:
    """创建 task / stage / scan run + workspace + change + lease。

    owner 同时被加为 workspace_owner 成员（UserWorkspaceRole），与生产路径
    一致——_user_owns_run 现在按 membership 校验，不再看 Workspace.created_by。
    """
    from app.modules.auth.model import Role, UserWorkspaceRole

    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="Exec WS",
            slug=f"exec-ws-{ws_id.hex[:6]}",
            root_path=str(tmp_path),
            status="active",
            created_by=owner.id,
        )
    )
    # 测试 DB 不跑 alembic，没有 seed 角色；这里手工建一个 workspace_owner role。
    owner_role_id = uuid.uuid4()
    db_session.add(
        Role(
            id=owner_role_id,
            key="workspace_owner",
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
            change_key=f"exec-{change_id.hex[:6]}",
            title="Exec Change",
            status="in_progress",
            location="change",
            path=str(tmp_path / "change"),
        )
    )

    task_id = uuid.uuid4() if run_type == "task" else None
    if task_id is not None:
        db_session.add(
            Task(
                id=task_id,
                workspace_id=ws_id,
                change_id=change_id,
                task_key="task-01",
                title="Exec Task",
                status="in_progress",
                allowed_paths=["src/"],
            )
        )

    agent_type = {
        "task": "claude_code",
        "stage": "stage_dispatch",
        "scan": "scan",
    }[run_type]
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            task_id=task_id,
            change_id=change_id,
            agent_type=agent_type,
            status="pending",
        )
    )
    db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))

    rt_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=rt_id,
            user_id=owner.id,
            name="exec-daemon",
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
            metadata_=lease_meta or {},
        )
    )
    await db_session.commit()
    return run_id


# ---- task / stage / scan 200 -------------------------------------------------


async def test_get_execution_context_task_run(client, db_session, tmp_path):
    """AC-01/08：task run → 200，完整 bundle 字段从 lease.metadata 回填。"""
    owner = await _make_user(db_session)
    run_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="task",
        lease_meta={
            "prompt": "实现 task-02",
            "provider": "claude_code",
            "model": "claude-sonnet-4",
            "repo_url": "https://github.com/o/r",
            "branch": "dev",
            "allowed_paths": ["src/", "tests/"],
            "tool_config": {"EDITOR": "vim"},
            "resume_session_id": "sess-123",
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["agent_run_id"] == str(run_id)
    # claude_md 来自 render_bundle_to_claude_md（非空，覆盖 design Phase 2 缺口）
    assert body["claude_md"]
    # lease.metadata 全字段回填
    assert body["prompt"] == "实现 task-02"
    assert body["provider"] == "claude_code"
    assert body["model"] == "claude-sonnet-4"
    assert body["repo_url"] == "https://github.com/o/r"
    assert body["branch"] == "dev"
    assert body["allowed_paths"] == ["src/", "tests/"]
    assert body["tool_config"] == {"EDITOR": "vim"}
    assert body["resume_session_id"] == "sess-123"


async def test_get_execution_context_stage_run(client, db_session, tmp_path):
    """AC-02/08：stage run（lease.metadata.stage 标记）→ 200，stage_dispatch bundle。

    task-02（2026-07-07-daemon-skill-execution）：stage 投递重构后——
    - claude_md 留空（不覆盖 worktree CLAUDE.md，D-005）
    - prompt 改为 skill 调用指令 /<skill_name> --change <id> --stage <stage>（D-001/D-007）
    - stage_meta + stage_dispatch 透传（daemon 注入 STAGE_META env）
    """
    owner = await _make_user(db_session)
    run_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="stage",
        lease_meta={
            "stage": "plan",
            "prompt": "生成计划",  # 旧式 stage prompt，stage run 改用 skill 调用指令覆盖
            "step_prompt": "current step",
            "read_only": False,
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # task-02/D-005：stage run claude_md 留空（不写 worktree CLAUDE.md）
    assert body["claude_md"] == ""
    # task-02/D-001：prompt 改为 skill 调用指令（覆盖旧式 stage prompt）
    assert body["prompt"].startswith("/sillyspec-plan")
    assert "--stage plan" in body["prompt"]
    # task-02/D-007：stage_meta + stage_dispatch 透传
    assert body["stage_meta"] is not None
    assert body["stage_meta"]["stage"] == "plan"
    assert body["stage_meta"]["skill_name"] == "sillyspec-plan"
    assert body["stage_dispatch"] is True


async def test_get_execution_context_scan_run(client, db_session, tmp_path):
    """AC-03/08：scan run（lease.metadata.root_path/spec_root 标记）→ 200，含 scan 命令。"""
    owner = await _make_user(db_session)
    run_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="scan",
        lease_meta={
            "root_path": str(tmp_path),
            "spec_root": str(tmp_path / "spec"),
            "runtime_root": str(tmp_path / "rt"),
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["claude_md"]
    assert "sillyspec run scan" in body["claude_md"]


# ---- 403 / 404 / 401 ---------------------------------------------------------


async def test_get_execution_context_cross_user_403(client, db_session, tmp_path):
    """R-02：普通用户访问他人 run → 403（归属校验对非 admin 生效）。"""
    owner = await _make_user(db_session, is_admin=False)
    intruder = await _make_user(db_session, is_admin=False)
    run_id = await _make_run(
        db_session, tmp_path, owner, run_type="task", lease_meta={"prompt": "x"}
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(intruder)),
    )
    assert resp.status_code == 403


async def test_get_execution_context_platform_admin_cross_user_200(client, db_session, tmp_path):
    """platform admin 跨 user 访问 → 200（与 rbac.has_permission 语义一致；
    daemon 用 admin 签发的 API key 鉴权时不应被 workspace.created_by 残留阻塞）。"""
    owner = await _make_user(db_session, is_admin=False)
    admin = await _make_user(db_session, is_admin=True)
    run_id = await _make_run(
        db_session, tmp_path, owner, run_type="task", lease_meta={"prompt": "x"}
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(admin)),
    )
    assert resp.status_code == 200, resp.text


async def test_get_execution_context_not_found_404(client, db_session, tmp_path):
    """run 不存在 → 404。"""
    owner = await _make_user(db_session)
    resp = await client.get(
        f"/api/agent-runs/{uuid.uuid4()}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 404


async def test_get_execution_context_unauthenticated_401(client, db_session):
    """无 token → 401。"""
    resp = await client.get(f"/api/agent-runs/{uuid.uuid4()}/execution-context")
    assert resp.status_code == 401


async def test_get_execution_context_same_user_access_allowed(client, db_session, tmp_path):
    """正向用例：owner 自己访问 → 200（防 403 误杀）。"""
    owner = await _make_user(db_session)
    run_id = await _make_run(
        db_session, tmp_path, owner, run_type="task", lease_meta={"prompt": "x"}
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200


async def _make_claimed_lease(
    db_session,
    agent_run_id: uuid.UUID,
    runtime_id: uuid.UUID,
) -> tuple[DaemonTaskLease, str]:
    """构造一个 claimed lease（complete_lease 需要 token 校验）。"""
    now = datetime.now(UTC)
    token = "claim-tok"
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        status="claimed",
        claimed_at=now,
        lease_expires_at=now + timedelta(seconds=60),
        metadata_={"claim_token": token},
    )
    db_session.add(lease)
    await db_session.commit()
    await db_session.refresh(lease)
    return lease, token


class TestCompleteLeaseDiffRedact:
    """AC-09：daemon 上报的 diff/output 经 ``redact_output`` 二次脱敏后入库。

    task-07 已在 ``complete_lease``（daemon/service.py）接入 ``redact_output``，
    对 output/error/patch 三处二次脱敏（单一真相源 git_gateway.redact_output，
    daemon 不移植正则规则）。
    """

    @pytest.mark.asyncio
    async def test_complete_lease_redacts_diff(self, db_session):
        owner = await _make_user(db_session)
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner.id,
            name="d",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="running")
        db_session.add(run)
        await db_session.commit()

        lease, token = await _make_claimed_lease(db_session, run.id, rt.id)

        # 含 PAT + bearer token 的 diff payload
        leaky_diff = (
            "diff --git a/config.py b/config.py\n"
            '+api_key = "ghp_abcdef1234567890uvwxyz"\n'
            "+Authorization: Bearer sk-ant-abc123secret\n"
        )
        await DaemonService(db_session).complete_lease(
            lease.id, token, {"status": "completed", "output": leaky_diff}
        )

        refreshed = await db_session.get(AgentRun, run.id)
        # task-07 接入 redact_output 后这两段密钥应被替换为 ***REDACTED***
        assert "ghp_abcdef1234567890uvwxyz" not in (refreshed.output_redacted or "")
        assert "sk-ant-abc123secret" not in (refreshed.output_redacted or "")

    @pytest.mark.asyncio
    async def test_complete_lease_redacts_patch_before_apply(self, db_session):
        """AC-06：patch 入库（_apply_patch_to_worktree）前经 redact_output 脱敏。

        用 ``patch.object`` 拦截 ``_apply_patch_to_worktree`` 捕获 patch_data，
        断言 daemon 上报的含密钥 patch 在入库前已被替换为 ***REDACTED***。
        """
        owner = await _make_user(db_session)
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner.id,
            name="d",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="running")
        db_session.add(run)
        await db_session.commit()

        lease, token = await _make_claimed_lease(db_session, run.id, rt.id)

        leaky_patch = 'diff --git a/config.py b/config.py\n+token = "ghp_abcdef1234567890uvwxyz"\n'

        captured: dict = {}

        async def _capture(self, *, agent_run_id, patch_data, use_3way=True):
            captured["patch_data"] = patch_data

        svc = DaemonService(db_session)
        with patch.object(DaemonService, "_apply_patch_to_worktree", _capture):
            await svc.complete_lease(
                lease.id,
                token,
                {"status": "completed", "patch": leaky_patch},
            )

        assert "ghp_abcdef1234567890uvwxyz" not in captured["patch_data"]
        assert "***REDACTED***" in captured["patch_data"]

    @pytest.mark.asyncio
    async def test_large_diff_does_not_crash_complete_lease(self, db_session):
        """大 diff（>100KB）调 complete_lease 不抛异常。"""
        owner = await _make_user(db_session)
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner.id,
            name="d",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="running")
        db_session.add(run)
        await db_session.commit()

        lease, token = await _make_claimed_lease(db_session, run.id, rt.id)

        big_output = "x" * (150 * 1024)  # 150KB
        # 不抛异常即通过（后端二次 redact 不重复截断但需处理大 payload 不 OOM）
        await DaemonService(db_session).complete_lease(
            lease.id, token, {"status": "completed", "output": big_output}
        )

        refreshed = await db_session.get(AgentRun, run.id)
        assert refreshed.status == "completed"
