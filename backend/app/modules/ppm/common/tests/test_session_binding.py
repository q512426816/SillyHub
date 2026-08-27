"""PPM 任务/问题 ↔ 会话绑定基座单测（2026-08-28-session-ppm-task-binding / task-01）。

覆盖 TaskCard acceptance（design §5 Phase 1 / §7 / FR-01 / D-004@v2 / D-005@v1）：

1. ``bind_session_to_ppm_item`` 幂等——同一 (kind, item_id, session_id) 重复执行
   不抛异常且表中仅一行；
2. ``resolve_item_workspace_id`` 多关联工作区取 workspace_id 升序第一个
   （D-004@v2）、无关联/条目不存在返回 None；
3. ``load_ppm_item`` 命中（plan_task/problem 两 kind）与 None；
4. ``load_item_files`` 存活行过滤 + 非 uuid 条目剔除（R-03）；
5. ``GET /api/ppm/item-sessions`` 返回关联会话列表（结构同 change sessions：
   id/provider/status/turn_count/mode/author/last_active_at/title）+ 软删过滤 +
   kind 非法值 422 + 无关联返回 []。

复用 backend/conftest.py 的 in-memory SQLite + AsyncClient + admin auth fixture，
构造真实 User / DaemonRuntime / AgentSession / AgentRun / AgentRunLog / PlanTask /
PpmProblemList / PpmProjectMaintenance / PpmProjectWorkspace / File 行（不 mock
model，避免遮蔽真实 FK 路径；fixture 模式参照 change/tests/test_quicklog_sessions_api.py，
问题/项目/task 模型由本子包 conftest 注册）。

Author: SillySpec change 2026-08-28-session-ppm-task-binding (W1 task-01)
Created: 2026-08-28
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime
from app.modules.file.model import File
from app.modules.ppm.common.session_binding import (
    bind_session_to_ppm_item,
    load_item_files,
    load_ppm_item,
    resolve_item_workspace_id,
)
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.ppm.task.model import PlanTask
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── Fixtures / helpers（模式对齐 change/tests/test_quicklog_sessions_api.py）──


async def _make_user(session: AsyncSession, *, email: str, display: str | None = None) -> User:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name=display or email.split("@")[0],
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_admin(db_session: AsyncSession) -> User:
    """取根 conftest ``auth_headers`` fixture 已建好的平台管理员。"""
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_workspace(session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t-ws",
        slug=f"t-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _make_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    provider: str = "claude",
    status: str = "ended",
    config: dict | None = None,
    last_active_at: datetime | None = None,
    deleted_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider=provider,
        status=status,
        turn_count=1,
        config=config,
        change_id=None,
        created_at=now,
        last_active_at=last_active_at or now,
        ended_at=now if status in ("ended", "failed") else None,
        deleted_at=deleted_at,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_run(session: AsyncSession, *, agent_session_id: uuid.UUID) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=agent_session_id,
        session_id=None,
        started_at=datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_log(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    content: str,
    timestamp: datetime | None = None,
) -> AgentRunLog:
    log = AgentRunLog(
        id=uuid.uuid4(),
        run_id=run_id,
        channel="user_input",
        content_redacted=content,
        timestamp=timestamp or datetime.now(UTC),
    )
    session.add(log)
    await session.commit()
    await session.refresh(log)
    return log


async def _make_plan_task(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
    file_urls: list[str] | None = None,
) -> PlanTask:
    task = PlanTask(
        id=uuid.uuid4(),
        user_id=user_id,
        content="任务内容",
        status="进行中",
        project_id=project_id,
        file_urls=file_urls or [],
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def _make_problem(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
) -> PpmProblemList:
    problem = PpmProblemList(
        id=uuid.uuid4(),
        project_id=project_id,
        status="进行中",
    )
    session.add(problem)
    await session.commit()
    await session.refresh(problem)
    return problem


async def _make_project(session: AsyncSession) -> PpmProjectMaintenance:
    """造 PPM 项目维护行（project_code 唯一索引，用 uuid 防撞）。"""
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"PRJ-{uuid.uuid4().hex[:12]}",
        project_name="测试项目",
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def _link_project_workspace(
    session: AsyncSession,
    *,
    ppm_project_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> None:
    session.add(PpmProjectWorkspace(ppm_project_id=ppm_project_id, workspace_id=workspace_id))
    await session.commit()


async def _make_file(
    session: AsyncSession,
    *,
    uploaded_by: uuid.UUID,
    deleted_at: datetime | None = None,
) -> File:
    f = File(
        id=uuid.uuid4(),
        owner_type="ppm_plan_task",
        original_name=f"附件-{uuid.uuid4().hex[:6]}.txt",
        stored_key=f"2026/08/28/{uuid.uuid4()}",
        mime_type="text/plain",
        size=16,
        uploaded_by=uploaded_by,
        deleted_at=deleted_at,
    )
    session.add(f)
    await session.commit()
    await session.refresh(f)
    return f


async def _count_links(db_session: AsyncSession) -> int:
    from app.modules.ppm.common.session_binding import PpmItemSessionLink

    return (
        await db_session.execute(select(func.count()).select_from(PpmItemSessionLink))
    ).scalar_one()


# ── bind_session_to_ppm_item（幂等 best-effort，D-005@v1）───────────────────


class TestBindSessionToPpmItem:
    async def test_bind_idempotent_single_row(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """同一 (kind, item_id, session_id) 重复执行不抛异常且表中仅一行。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        task = await _make_plan_task(db_session, user_id=admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")

        # 第一次：插入；第二次：命中存在即返回——均不抛。
        await bind_session_to_ppm_item(
            db_session, workspace_id=ws.id, kind="plan_task", item_id=task.id, session_id=sess.id
        )
        await bind_session_to_ppm_item(
            db_session, workspace_id=ws.id, kind="plan_task", item_id=task.id, session_id=sess.id
        )
        await db_session.commit()

        assert await _count_links(db_session) == 1
        from app.modules.ppm.common.session_binding import PpmItemSessionLink

        link = (await db_session.execute(select(PpmItemSessionLink))).scalars().one()
        assert link.kind == "plan_task"
        assert link.item_id == task.id
        assert link.session_id == sess.id
        assert link.workspace_id == ws.id

    async def test_bind_problem_kind_and_null_workspace(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """problem kind 可绑定；workspace_id 无关联时可空传 None。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        project = await _make_project(db_session)
        problem = await _make_problem(db_session, project_id=project.id)

        await bind_session_to_ppm_item(
            db_session, workspace_id=None, kind="problem", item_id=problem.id, session_id=sess.id
        )
        await db_session.commit()

        assert await _count_links(db_session) == 1


# ── resolve_item_workspace_id（D-004@v2 workspace_id 升序第一个）─────────────


class TestResolveItemWorkspaceId:
    async def test_returns_lowest_workspace_id(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """两关联工作区取 workspace_id 升序第一个——插入序刻意相反，锁定排序键。"""
        admin = await _make_admin(db_session)
        ws_high = await _make_workspace(db_session, root_path=f"/tmp/wh-{uuid.uuid4()}")
        ws_low = await _make_workspace(db_session, root_path=f"/tmp/wl-{uuid.uuid4()}")
        expected = min(ws_high.id, ws_low.id)
        other = max(ws_high.id, ws_low.id)
        project = await _make_project(db_session)
        # 插入序：较大的 workspace_id 先插——结果必须仍取升序第一个。
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=other)
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=expected)
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=project.id)

        resolved = await resolve_item_workspace_id(db_session, "plan_task", task.id)
        assert resolved == expected

    async def test_none_when_no_workspace_association(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """项目无关联工作区返回 None（不抛，D-004 留空不阻塞）。"""
        admin = await _make_admin(db_session)
        project = await _make_project(db_session)
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=project.id)

        assert await resolve_item_workspace_id(db_session, "plan_task", task.id) is None

    async def test_none_when_item_missing(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """条目不存在返回 None（design §9 容错口径）。"""
        assert await resolve_item_workspace_id(db_session, "plan_task", uuid.uuid4()) is None
        assert await resolve_item_workspace_id(db_session, "problem", uuid.uuid4()) is None

    async def test_none_when_plan_task_has_no_project(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """PlanTask.project_id 可空——无项目直接 None，不进关联表查询。"""
        admin = await _make_admin(db_session)
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=None)

        assert await resolve_item_workspace_id(db_session, "plan_task", task.id) is None

    async def test_problem_kind_resolves_via_project(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """problem kind 走同一条 project → ppm_project_workspace 链路。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        project = await _make_project(db_session)
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=ws.id)
        problem = await _make_problem(db_session, project_id=project.id)

        assert await resolve_item_workspace_id(db_session, "problem", problem.id) == ws.id


# ── load_ppm_item / load_item_files（task-02/03 消费的读取 helper）───────────


class TestLoadPpmItemAndFiles:
    async def test_load_ppm_item_hit_and_none(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """plan_task/problem 两 kind 命中；查无返回 None 不抛。"""
        admin = await _make_admin(db_session)
        project = await _make_project(db_session)
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=project.id)
        problem = await _make_problem(db_session, project_id=project.id)

        loaded_task = await load_ppm_item(db_session, "plan_task", task.id)
        assert isinstance(loaded_task, PlanTask)
        assert loaded_task.id == task.id

        loaded_problem = await load_ppm_item(db_session, "problem", problem.id)
        assert isinstance(loaded_problem, PpmProblemList)
        assert loaded_problem.id == problem.id

        assert await load_ppm_item(db_session, "plan_task", uuid.uuid4()) is None
        assert await load_ppm_item(db_session, "problem", uuid.uuid4()) is None

    async def test_load_item_files_filters_deleted_and_non_uuid(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """存活行过滤 + 非 uuid 条目剔除（R-03）+ 缺号行自然剔除。"""
        admin = await _make_admin(db_session)
        f_alive = await _make_file(db_session, uploaded_by=admin.id)
        f_deleted = await _make_file(db_session, uploaded_by=admin.id, deleted_at=datetime.now(UTC))
        f_missing = uuid.uuid4()  # 有 uuid 但无 File 行
        task = await _make_plan_task(
            db_session,
            user_id=admin.id,
            file_urls=[
                str(f_alive.id),
                str(f_deleted.id),
                "https://legacy.example.com/old-url.pdf",  # R-03 历史 URL 字符串
                "",
                str(f_missing),
            ],
        )

        files = await load_item_files(db_session, "plan_task", task.id)
        assert [f.id for f in files] == [f_alive.id]

    async def test_load_item_files_empty_when_item_missing(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """item 不存在返回空列表（不抛）。"""
        assert await load_item_files(db_session, "plan_task", uuid.uuid4()) == []

    async def test_load_item_files_empty_when_no_valid_entries(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """file_urls 全是非 uuid 历史字符串 → 空列表（不进 SQL）。"""
        admin = await _make_admin(db_session)
        task = await _make_plan_task(
            db_session, user_id=admin.id, file_urls=["http://a/b.png", "/etc/hosts"]
        )

        assert await load_item_files(db_session, "plan_task", task.id) == []


# ── GET /api/ppm/item-sessions（FR-01 读取面）───────────────────────────────


class TestListItemSessions:
    async def test_returns_bound_sessions_with_structure(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """绑定命中：返回 AgentSessionListItem，title=首条 user_input 前 30 字、
        author 含展示名、mode 从 config 透传（结构同 change sessions）。"""
        admin = await _make_admin(db_session)
        owner = await _make_user(
            db_session, email=f"owner-{uuid.uuid4()}@example.com", display="PpmOwner"
        )
        rt = await _make_runtime(db_session, owner.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        task = await _make_plan_task(db_session, user_id=owner.id)

        sess = await _make_session(
            db_session,
            user_id=owner.id,
            runtime_id=rt.id,
            config={"mode": "team"},
            last_active_at=datetime.now(UTC),
        )
        await bind_session_to_ppm_item(
            db_session, workspace_id=ws.id, kind="plan_task", item_id=task.id, session_id=sess.id
        )
        await db_session.commit()

        run = await _make_run(db_session, agent_session_id=sess.id)
        first_input = "帮我分析这个计划任务的排期风险并给出具体的调整建议超长文本"
        await _make_log(
            db_session,
            run_id=run.id,
            content=first_input,
            timestamp=datetime.now(UTC) - timedelta(minutes=5),
        )
        await _make_log(
            db_session,
            run_id=run.id,
            content="后面这条不该当标题",
            timestamp=datetime.now(UTC),
        )

        # 噪声：未绑定到该 item 的会话不出现——命中只认 link 行。
        s_noise = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)

        resp = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "plan_task", "item_id": str(task.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        # 结构同 GET /changes/{id}/sessions（acceptance）。
        assert set(item) == {
            "id",
            "provider",
            "status",
            "turn_count",
            "mode",
            "author",
            "last_active_at",
            "title",
        }
        assert item["id"] == str(sess.id)
        assert item["provider"] == "claude"
        assert item["status"] == "ended"
        assert item["turn_count"] == 1
        assert item["mode"] == "team"
        assert item["title"] == first_input[:30]
        assert item["author"]["user_id"] == str(owner.id)
        assert item["author"]["display_name"] == "PpmOwner"
        assert item["last_active_at"] is not None
        assert s_noise.id not in {i["id"] for i in items}

    async def test_deleted_session_filtered(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """软删会话（deleted_at 非空）即使有 link 也不出现（同 change 侧口径）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        project = await _make_project(db_session)
        problem = await _make_problem(db_session, project_id=project.id)

        s_live = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        s_deleted = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, deleted_at=datetime.now(UTC)
        )
        for s in (s_live, s_deleted):
            await bind_session_to_ppm_item(
                db_session,
                workspace_id=None,
                kind="problem",
                item_id=problem.id,
                session_id=s.id,
            )
        await db_session.commit()

        resp = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "problem", "item_id": str(problem.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()}
        assert ids == {str(s_live.id)}

    async def test_invalid_kind_returns_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """kind 非法值（Literal 外）返回 422。"""
        resp = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "foo", "item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text

    async def test_plain_user_cannot_read_others_task_sessions(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """ql-20260828-003 越权收紧：普通用户查他人任务的关联会话 → []

        口径=task_scope_clause（非超管：经理项目集 OR user_id=自己）。他人任务
        且无项目共享 → 不可见，与「无关联」同语义（不泄露存在性/他人会话）。
        同请求里自己的任务正常返回（同一断言内对照，防误伤）。
        """
        from app.core.config import get_settings
        from app.core.security import create_access_token

        admin = await _make_admin(db_session)
        owner = await _make_user(db_session, email=f"own-{uuid.uuid4()}@example.com")
        rt = await _make_runtime(db_session, owner.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")

        t_own = await _make_plan_task(db_session, user_id=owner.id)
        t_other = await _make_plan_task(db_session, user_id=admin.id)
        s_own = await _make_session(db_session, user_id=owner.id, runtime_id=rt.id)
        s_other = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        for t, s in ((t_own, s_own), (t_other, s_other)):
            await bind_session_to_ppm_item(
                db_session, workspace_id=ws.id, kind="plan_task", item_id=t.id, session_id=s.id
            )
        await db_session.commit()

        settings = get_settings()
        token, _ = create_access_token(
            user_id=owner.id, email=owner.email, is_admin=False, settings=settings
        )
        headers = {"Authorization": f"Bearer {token}"}

        # 他人任务 → 不可见空列表（无关联同语义，不 403 不泄露存在性）。
        resp = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "plan_task", "item_id": str(t_other.id)},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

        # 自己的任务 → 正常返回（可见性收紧不误伤本人）。
        resp2 = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "plan_task", "item_id": str(t_own.id)},
            headers=headers,
        )
        assert resp2.status_code == 200, resp2.text
        assert {i["id"] for i in resp2.json()} == {str(s_own.id)}

    async def test_plain_user_problem_visibility_by_duty(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """ql-20260828-003 越权收紧（problem 维度）：责任人对自己的问题可见，
        无关用户对他人的问题不可见。"""
        from app.core.config import get_settings
        from app.core.security import create_access_token

        admin = await _make_admin(db_session)
        duty = await _make_user(db_session, email=f"duty-{uuid.uuid4()}@example.com")
        outsider = await _make_user(db_session, email=f"out-{uuid.uuid4()}@example.com")
        rt = await _make_runtime(db_session, admin.id)
        project = await _make_project(db_session)

        problem = await _make_problem(db_session, project_id=project.id)
        problem.duty_user_id = duty.id
        db_session.add(problem)
        s = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        await bind_session_to_ppm_item(
            db_session, workspace_id=None, kind="problem", item_id=problem.id, session_id=s.id
        )
        await db_session.commit()

        settings = get_settings()

        # 责任人（duty_user_id=me）→ 可见。
        token_duty, _ = create_access_token(
            user_id=duty.id, email=duty.email, is_admin=False, settings=settings
        )
        resp = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "problem", "item_id": str(problem.id)},
            headers={"Authorization": f"Bearer {token_duty}"},
        )
        assert resp.status_code == 200, resp.text
        assert {i["id"] for i in resp.json()} == {str(s.id)}

        # 无关用户（非创建/责任/验证/处置、非经理、非超管）→ 不可见空列表。
        token_out, _ = create_access_token(
            user_id=outsider.id, email=outsider.email, is_admin=False, settings=settings
        )
        resp2 = await client.get(
            "/api/ppm/item-sessions",
            params={"kind": "problem", "item_id": str(problem.id)},
            headers={"Authorization": f"Bearer {token_out}"},
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json() == []

    async def test_empty_when_no_links(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无关联返回空列表（不 404——任务刚建、尚无会话是常态）。"""
        for kind in ("plan_task", "problem"):
            resp = await client.get(
                "/api/ppm/item-sessions",
                params={"kind": kind, "item_id": str(uuid.uuid4())},
                headers=auth_headers,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json() == []
