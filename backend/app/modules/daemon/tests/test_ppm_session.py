"""PPM 条目会话三通道单测（2026-08-28-session-ppm-task-binding / task-02）。

覆盖 TaskCard acceptance 后端段（design §5 Phase 1 接线 / §7 / §9、FR-01/FR-02/
FR-05、D-004@v2、D-005@v1），GWT 逐条对应：

1. create 通道（HTTP 层）：成对 ``ppm_item_kind``+``ppm_item_id`` → 201 且
   ``ppm_item_session_links`` 落行（workspace 快照 = 项目关联工作区升序第一个，
   D-004@v2），``AgentSession.workspace_id`` 未显式指定时同步回填；显式
   workspace_id 优先（link 快照仍取解析值）；item 不存在 → 201 降级 +
   ``session_ppm_bind_item_missing`` warning（§9 不 4xx）；项目无关联工作区 →
   两者留空仍 201；只传其一 422 / kind 非法 422；不带 ppm 参数零绑定（零回归）。
2. inject 通道（service 层）：``bind_ppm_item_*`` 成对 → 幂等追加 link（第二次
   调用不重行）且 SESSION_INJECT prompt 无任何 PPM 前导（前导/物化归 task-03）；
   item 不存在 → warning 跳过、消息照发；只传其一 422（HTTP 层）。
3. list 通道（HTTP 层）：``ppm_item_kind``+``ppm_item_id`` 命中已绑定会话、
   排除未绑定 / 异 kind 绑定；kind 非法 422；只传其一 422；不带参数零回归。

HTTP 层复用 backend/conftest.py 的 in-memory SQLite + AsyncClient + admin auth
fixture；service 层复用 test_session_service.py 的 mocked hub/redis 范式；PPM
fixture 构造对齐 ppm/common/tests/test_session_binding.py（task-01，本文件自带
副本——conftest 模块名共享不跨文件 import）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.ws_hub import DaemonWsHub
from app.modules.ppm.common.session_binding import PpmItemSessionLink
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.ppm.task.model import PlanTask
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ── HTTP 层 fixtures（对齐 test_session_router.py）────────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


# ── service 层 fixtures（对齐 test_session_service.py）────────────────────────


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


# ── helpers ──────────────────────────────────────────────────────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
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


async def _connect_mock_ws(hub: DaemonWsHub, runtime_id: uuid.UUID) -> AsyncMock:
    """往 fresh hub 挂一个记录 sent_messages 的 mock websocket（HTTP 层派发用）。"""
    ws = AsyncMock()
    # 类型只能声明在局部变量上；直接注解 mock 属性会触发 mypy misc（non-self attribute）。
    sent_messages: list[dict[str, Any]] = []
    ws.sent_messages = sent_messages

    async def _send_json(message: dict[str, Any]) -> None:
        sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    await hub.connect(runtime_id, ws)
    return ws


async def _make_workspace(db_session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="ppm-ws",
        slug=f"ppm-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_project(db_session: AsyncSession) -> PpmProjectMaintenance:
    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_code=f"PRJ-{uuid.uuid4().hex[:12]}",
        project_name="PPM 会话通道测试项目",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


async def _link_project_workspace(
    db_session: AsyncSession, *, ppm_project_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    db_session.add(PpmProjectWorkspace(ppm_project_id=ppm_project_id, workspace_id=workspace_id))
    await db_session.commit()


async def _make_plan_task(
    db_session: AsyncSession, *, user_id: uuid.UUID, project_id: uuid.UUID | None
) -> PlanTask:
    task = PlanTask(
        id=uuid.uuid4(),
        user_id=user_id,
        content="PPM 绑定通道测试任务",
        status="进行中",
        project_id=project_id,
        file_urls=[],
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)
    return task


async def _make_problem(db_session: AsyncSession, *, project_id: uuid.UUID) -> PpmProblemList:
    problem = PpmProblemList(
        id=uuid.uuid4(),
        project_id=project_id,
        status="进行中",
    )
    db_session.add(problem)
    await db_session.commit()
    await db_session.refresh(problem)
    return problem


async def _links_of(db_session: AsyncSession, session_id: uuid.UUID) -> list[PpmItemSessionLink]:
    return list(
        (
            await db_session.execute(
                select(PpmItemSessionLink).where(PpmItemSessionLink.session_id == session_id)
            )
        )
        .scalars()
        .all()
    )


async def _make_bindable_session(
    db_session: AsyncSession, *, with_workspace: bool = True
) -> tuple[object, uuid.UUID, AgentSession, Workspace | None]:
    """service 层注入用：建一个（可选挂工作区的）活跃会话并完结首 turn。

    对齐 test_session_service.py::_create_bindable_session 范式（自带独立用户
    ——service 层用例不走 auth fixture；mocked hub 由调用方 fixture 提供；
    workspace 归属校验 patch 成恒过）。
    """
    from app.modules.daemon.service import DaemonService

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"ppm-svc-{uid}@example.com",
            password_hash="x",
            display_name="PpmSvc",
            status="active",
        )
    )
    await db_session.commit()
    await _create_runtime(db_session, uid)
    ws = (
        await _make_workspace(db_session, root_path=f"/tmp/ppm-bind-{uuid.uuid4()}")
        if with_workspace
        else None
    )
    create_kwargs: dict = {"workspace_id": ws.id} if ws is not None else {}
    with patch(
        "app.modules.daemon.session.service.allowed_workspace_ids",
        new_callable=AsyncMock,
        return_value={ws.id} if ws is not None else set(),
    ):
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first", **create_kwargs)
    created.agent_run.status = "completed"
    created.agent_run.finished_at = datetime.now(UTC)
    await db_session.commit()
    return svc, uid, created.agent_session, ws


# ── create 通道（FR-01 / D-004@v2 / D-005@v1）────────────────────────────────


class TestCreateChannelPpmBinding:
    """POST /api/daemon/sessions 携带成对 ppm_item_* → 写 link + 工作区解析。"""

    async def test_pair_writes_link_and_backfills_workspace(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Given 项目关联两个工作区（升序第一个为期望值，插入序刻意相反）+
        挂在该项目下的计划任务；When 不带 workspace_id 创建携带成对 ppm 字段；
        Then 201、link 落行且 workspace 快照与 AgentSession.workspace_id 均为
        workspace_id 升序第一个（D-004@v2）。"""
        admin = await _get_admin(db_session)
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock_ws(fresh_ws_hub, rt.id)

        ws_a = await _make_workspace(db_session, root_path=f"/tmp/ppm-a-{uuid.uuid4()}")
        ws_b = await _make_workspace(db_session, root_path=f"/tmp/ppm-b-{uuid.uuid4()}")
        expected_ws = min(ws_a.id, ws_b.id)
        other_ws = max(ws_a.id, ws_b.id)
        project = await _make_project(db_session)
        # 插入序：较大 workspace_id 先插——解析必须仍取升序第一个（D-004@v2）。
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=other_ws)
        await _link_project_workspace(
            db_session, ppm_project_id=project.id, workspace_id=expected_ws
        )
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=project.id)

        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": "帮我跟进这个计划任务",
                "ppm_item_kind": "plan_task",
                "ppm_item_id": str(task.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        sid = uuid.UUID(resp.json()["session_id"])

        links = await _links_of(db_session, sid)
        assert len(links) == 1
        assert links[0].kind == "plan_task"
        assert links[0].item_id == task.id
        assert links[0].workspace_id == expected_ws
        sess = await db_session.get(AgentSession, sid)
        assert sess is not None
        assert sess.workspace_id == expected_ws  # 未显式指定 → 回填解析值

    async def test_explicit_workspace_wins_link_snapshot_keeps_resolved(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Given 显式 workspace_id（非解析的第一个）；When 成对 ppm 字段创建；
        Then AgentSession.workspace_id 用显式值（显式优先），link.workspace_id
        仍快照解析出的项目第一个关联工作区（D-004@v2 同键）。"""
        admin = await _get_admin(db_session)
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock_ws(fresh_ws_hub, rt.id)

        ws_low = await _make_workspace(db_session, root_path=f"/tmp/ppm-lo-{uuid.uuid4()}")
        ws_high = await _make_workspace(db_session, root_path=f"/tmp/ppm-hi-{uuid.uuid4()}")
        low, high = min(ws_low.id, ws_high.id), max(ws_low.id, ws_high.id)
        project = await _make_project(db_session)
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=low)
        await _link_project_workspace(db_session, ppm_project_id=project.id, workspace_id=high)
        task = await _make_plan_task(db_session, user_id=admin.id, project_id=project.id)

        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": "显式工作区优先",
                "workspace_id": str(high),
                "ppm_item_kind": "plan_task",
                "ppm_item_id": str(task.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        sid = uuid.UUID(resp.json()["session_id"])

        sess = await db_session.get(AgentSession, sid)
        assert sess is not None and sess.workspace_id == high
        links = await _links_of(db_session, sid)
        assert len(links) == 1
        assert links[0].workspace_id == low

    async def test_item_missing_degrades_to_plain_session_with_warning(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Given ppm_item_id 指向不存在的条目；When 成对字段创建；Then 仍 201
        （§9 降级普通会话不 4xx/5xx）、零 link 行、log.warning 落
        ``session_ppm_bind_item_missing``。"""
        admin = await _get_admin(db_session)
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock_ws(fresh_ws_hub, rt.id)

        with patch("app.modules.daemon.session.service.log") as mock_log:
            resp = await client.post(
                "/api/daemon/sessions",
                json={
                    "provider": "claude",
                    "prompt": "条目已删仍可开会话",
                    "ppm_item_kind": "problem",
                    "ppm_item_id": str(uuid.uuid4()),
                },
                headers=auth_headers,
            )
        assert resp.status_code == 201, resp.text
        sid = uuid.UUID(resp.json()["session_id"])

        assert await _links_of(db_session, sid) == []
        warning_events = [
            c
            for c in mock_log.warning.call_args_list
            if c.args and c.args[0] == "session_ppm_bind_item_missing"
        ]
        assert warning_events, "item 查无必须落 session_ppm_bind_item_missing warning"

    async def test_no_workspace_association_leaves_blank_and_201(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Given 条目存在但项目无关联工作区（快照可空，D-004）；When 成对字段
        创建；Then 201、link 落行且 workspace_id 为 None、会话 workspace_id
        留空（两者留空不阻塞）。"""
        admin = await _get_admin(db_session)
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock_ws(fresh_ws_hub, rt.id)

        project = await _make_project(db_session)  # 无 ppm_project_workspace 行
        problem = await _make_problem(db_session, project_id=project.id)

        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": "无关联工作区的问题会话",
                "ppm_item_kind": "problem",
                "ppm_item_id": str(problem.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        sid = uuid.UUID(resp.json()["session_id"])

        links = await _links_of(db_session, sid)
        assert len(links) == 1
        assert links[0].workspace_id is None
        sess = await db_session.get(AgentSession, sid)
        assert sess is not None and sess.workspace_id is None

    async def test_only_kind_or_only_id_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Given 只传 ppm_item_kind / ppm_item_id 其一；When 创建；Then 422
        （DTO 成对校验，两方向都拒）。"""
        resp_kind = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "hi", "ppm_item_kind": "plan_task"},
            headers=auth_headers,
        )
        assert resp_kind.status_code == 422
        resp_id = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "hi", "ppm_item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_id.status_code == 422

    async def test_invalid_kind_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Given ppm_item_kind 传 Literal 外的值；When 创建；Then 422。"""
        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": "hi",
                "ppm_item_kind": "task",
                "ppm_item_id": str(uuid.uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_without_ppm_params_zero_binding(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Given 不带任何 ppm 参数；When 普通创建；Then 201 且零 ppm link 行
        （零回归——新字段全 Optional 缺省零分支）。"""
        admin = await _get_admin(db_session)
        rt = await _create_runtime(db_session, admin.id)
        await _connect_mock_ws(fresh_ws_hub, rt.id)

        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "普通会话"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        all_links = (await db_session.execute(select(PpmItemSessionLink))).scalars().all()
        assert all_links == []


# ── inject 通道（FR-02 / D-005@v1）──────────────────────────────────────────


class TestInjectChannelPpmBinding:
    """inject 追问携带 bind_ppm_item_* → 幂等追加 link，不注入前导。"""

    @pytest.mark.asyncio
    async def test_bind_idempotent_and_no_preamble(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """Given 已完结首轮的活跃会话 + 真实 PlanTask；When 连续两轮 inject 携带
        成对 bind_ppm_item_*；Then 仅一行 link（幂等不重行）且每轮
        SESSION_INJECT 的 prompt 均为裸用户消息——不含任何 PPM 前导（前导归
        task-03，对齐 bind_quick_id 行为）。"""
        svc, uid, session, ws = await _make_bindable_session(db_session)
        task = await _make_plan_task(db_session, user_id=uid, project_id=None)

        for i in range(2):
            result = await svc.inject_session(
                session.id,
                uid,
                prompt=f"第{i + 1}问：任务进展",
                bind_ppm_item_kind="plan_task",
                bind_ppm_item_id=task.id,
            )
            assert result.agent_run is not None  # 消息照常派发
            # 完结本轮，允许下一轮 inject
            result.agent_run.status = "completed"
            result.agent_run.finished_at = datetime.now(UTC)
            await db_session.commit()

        links = await _links_of(db_session, session.id)
        assert len(links) == 1
        assert links[0].kind == "plan_task"
        assert links[0].item_id == task.id
        # workspace 快照取会话自身 workspace_id（对齐 bind_session_to_quicklog 模式）
        assert links[0].workspace_id == ws.id
        # 无 PPM 前导：最后一轮控制消息 prompt = 裸用户消息
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT

        assert mocked_hub.send_session_control.await_count >= 2
        msg_type, payload = (
            mocked_hub.send_session_control.await_args.args[1],
            mocked_hub.send_session_control.await_args.args[2],
        )
        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert payload["prompt"] == "第2问：任务进展"
        assert "PPM" not in payload["prompt"]

    @pytest.mark.asyncio
    async def test_bind_item_missing_warning_and_skip(
        self, db_session: AsyncSession, mocked_hub, mocked_redis
    ) -> None:
        """Given bind_ppm_item_id 指向不存在条目；When 追问携带成对字段；
        Then 消息照常派发（run 建立）、零 link 行、warning 落
        ``session_ppm_bind_item_missing``（§9 降级不报错）。"""
        svc, uid, session, _ws = await _make_bindable_session(db_session)

        with patch("app.modules.daemon.session.service.log") as mock_log:
            result = await svc.inject_session(
                session.id,
                uid,
                prompt="条目不存在的追问",
                bind_ppm_item_kind="problem",
                bind_ppm_item_id=uuid.uuid4(),
            )

        assert result.agent_run is not None
        assert await _links_of(db_session, session.id) == []
        warning_events = [
            c
            for c in mock_log.warning.call_args_list
            if c.args and c.args[0] == "session_ppm_bind_item_missing"
        ]
        assert warning_events

    async def test_only_kind_or_only_id_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Given 只传 bind_ppm_item_* 其一；When 追问；Then 422（与 create 通道
        同口径，DTO 层成对校验）。"""
        resp_kind = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/inject",
            json={"prompt": "hi", "bind_ppm_item_kind": "plan_task"},
            headers=auth_headers,
        )
        assert resp_kind.status_code == 422
        resp_id = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/inject",
            json={"prompt": "hi", "bind_ppm_item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_id.status_code == 422


# ── list 通道（FR-05 / D-005@v1）────────────────────────────────────────────


class TestListChannelPpmFilter:
    """GET /api/daemon/sessions?ppm_item_kind=&ppm_item_id= links 子查询命中。"""

    async def _make_plain_session(
        self, db_session: AsyncSession, user_id: uuid.UUID
    ) -> AgentSession:
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            runtime_id=None,
            lease_id=None,
            provider="claude",
            status="ended",
            turn_count=1,
            created_at=datetime.now(UTC),
            ended_at=datetime.now(UTC),
        )
        db_session.add(sess)
        await db_session.commit()
        return sess

    async def test_hit_and_miss(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """Given 绑定 plan_task 条目的会话 + 未绑定会话 + 绑定其它条目/异 kind
        的会话；When ppm 双参数筛选；Then 只命中第一条（排除未绑定 / 异 item /
        异 kind——kind+item_id 双条件子查询）。"""
        admin = await _get_admin(db_session)
        s_bound = await self._make_plain_session(db_session, admin.id)
        s_unbound = await self._make_plain_session(db_session, admin.id)
        s_other_item = await self._make_plain_session(db_session, admin.id)
        s_other_kind = await self._make_plain_session(db_session, admin.id)

        item_id = uuid.uuid4()
        for sess, kind, item in (
            (s_bound, "plan_task", item_id),
            (s_other_item, "plan_task", uuid.uuid4()),  # 同 kind 异 item
            (s_other_kind, "problem", item_id),  # 异 kind 同 item_id 值
        ):
            db_session.add(
                PpmItemSessionLink(
                    id=uuid.uuid4(),
                    kind=kind,
                    item_id=item,
                    session_id=sess.id,
                    workspace_id=None,
                )
            )
        await db_session.commit()

        resp = await client.get(
            "/api/daemon/sessions",
            params={"ppm_item_kind": "plan_task", "ppm_item_id": str(item_id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        got = {i["id"] for i in body["items"]}
        assert got == {str(s_bound.id)}
        assert str(s_unbound.id) not in got
        assert str(s_other_item.id) not in got
        assert str(s_other_kind.id) not in got

        # 不存在的 item → 空结果（不是 500）
        resp_miss = await client.get(
            "/api/daemon/sessions",
            params={"ppm_item_kind": "plan_task", "ppm_item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_miss.status_code == 200
        assert resp_miss.json()["total"] == 0

    async def test_invalid_kind_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Given kind 传 Literal 外的值；When 筛选；Then 422（Query Literal）。"""
        resp = await client.get(
            "/api/daemon/sessions",
            params={"ppm_item_kind": "foo", "ppm_item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_only_kind_or_only_id_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Given 只传 ppm_item_kind / ppm_item_id 其一；When 筛选；Then 422
        （endpoint 手工成对校验，与 create/inject 同口径）。"""
        resp_kind = await client.get(
            "/api/daemon/sessions",
            params={"ppm_item_kind": "plan_task"},
            headers=auth_headers,
        )
        assert resp_kind.status_code == 422
        resp_id = await client.get(
            "/api/daemon/sessions",
            params={"ppm_item_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_id.status_code == 422

    async def test_no_ppm_params_baseline(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """Given 已含 ppm 绑定 link 的会话集；When 不带 ppm 参数列表；Then
        owner 全量可见（ppm 绑定不影响无参查询——零回归）。"""
        admin = await _get_admin(db_session)
        s_bound = await self._make_plain_session(db_session, admin.id)
        await self._make_plain_session(db_session, admin.id)
        db_session.add(
            PpmItemSessionLink(
                id=uuid.uuid4(),
                kind="plan_task",
                item_id=uuid.uuid4(),
                session_id=s_bound.id,
                workspace_id=None,
            )
        )
        await db_session.commit()

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 2
        assert str(s_bound.id) in {i["id"] for i in body["items"]}
