"""Tests for approval → bound-session service-identity injection (task-04 / D-006@v2).

D-006@v2（2026-08-14-change-center-conversation-driven design §5 P2 / §7）：审批
通过/打回后，后端**以服务身份**向 ``change_session_links`` 最新绑定会话注入审批
消息（绕过 ``inject_session`` 的会话归属校验 ``_get_owned_session_for_update``——
多成员工作区审批人可≠会话创建人）。注入 best-effort（R-03）：三类降级（turn 冲突
→ ``turn_conflict`` / 会话非 active → ``session_inactive`` / 其它异常 →
``inject_failed``）均不回滚审批记录与阶段状态。

覆盖（acceptance task-04）：
- 注入成功：approve/打回后绑定会话收到固定格式消息（含 change_key/阶段/结果/意见）
- 无绑定会话：notified_session=false、notify_error=null，不调用注入
- 三类降级：turn_conflict / session_inactive / inject_failed，均不回滚审批
- 服务身份绕过归属校验：多成员审批人（≠会话创建人）仍能注入；对照
  ``inject_session`` 受归属校验 404，而 ``inject_session_as_service`` 无用户
  上下文也能注入。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.change.model import ChangeSessionLink
from app.modules.change.schema import PendingReview
from app.modules.change.service import ChangeService
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import (
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionTurnConflict,
    SessionService,
)

# ── Helpers ────────────────────────────────────────────────────────────────


def _patch_projection(pending: PendingReview):
    """Patch StageProjectionService.compute_pending_review to return ``pending``."""
    return patch(
        "app.modules.change.service.StageProjectionService.compute_pending_review",
        new=AsyncMock(return_value=pending),
    )


def _patch_inject_as_service(side_effect=None):
    """Patch ``SessionService.inject_session_as_service``（服务身份注入）。

    返回 ``(patch_ctx, mock)``：``mock`` 供断言（assert_awaited_once_with 等）。
    """
    mock = AsyncMock()
    if side_effect is not None:
        mock.side_effect = side_effect
    return (
        patch(
            "app.modules.daemon.session.service.SessionService.inject_session_as_service",
            new=mock,
        ),
        mock,
    )


async def _create_session(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    status: str = "active",
) -> AgentSession:
    """Create a minimal AgentSession row（无 runtime/lease——注入在 service 层 mock 掉）。"""
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status=status,
        turn_count=0,
        workspace_id=workspace_id,
        created_at=datetime.now(UTC),
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def _bind_session(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    session_id: uuid.UUID,
    created_at: datetime | None = None,
) -> None:
    """Write a ChangeSessionLink row（可指定 created_at 控制最新一条语义）。"""
    session.add(
        ChangeSessionLink(
            id=uuid.uuid4(),
            change_id=change_id,
            session_id=session_id,
            created_at=created_at or datetime.now(UTC),
        )
    )
    await session.commit()


async def _setup_bound_change(
    session: AsyncSession,
    tmp_path: Path,
    *,
    stage: str,
    owner_user_id: uuid.UUID,
) -> tuple[uuid.UUID, uuid.UUID, AgentSession]:
    """Create workspace + change at ``stage`` + an active session bound to it.

    返回 ``(workspace_id, change_id, session)``。
    """
    ws = await _create_test_workspace(session, root_path=str(tmp_path))
    change = await _create_test_change(
        session,
        workspace_id=ws.id,
        current_stage=stage,
        path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
    )
    sess = await _create_session(session, workspace_id=ws.id, user_id=owner_user_id)
    await _bind_session(session, change_id=change.id, session_id=sess.id)
    return ws.id, change.id, sess


# ── 注入成功 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
class TestReviewNotifyInjectsToBoundSession:
    """审批通过/打回后向绑定会话注入固定格式消息（acceptance ①）。"""

    async def test_proposal_approve_injects_message(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, sess = await _setup_bound_change(
            db_session, tmp_path, stage="brainstorm", owner_user_id=owner
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            result = await svc.proposal_review(ws_id, change_id, "approve", "写得好", uuid.uuid4())

        assert result["notified_session"] is True
        assert result["notify_error"] is None
        # 固定格式：`[平台审批] 变更 <change_key> 的 <阶段> 审批已<通过/打回（decision）>。<意见>。请继续推进。`
        inject_mock.assert_awaited_once_with(
            sess.id,
            prompt=(
                f"[平台审批] 变更 {change.change_key} 的 proposal_review 审批已通过。"
                f"写得好。请继续推进。"
            ),
        )

    async def test_proposal_approve_no_comment_message(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """comment 为 None → 意见段省略，不留双句号。"""
        owner = uuid.uuid4()
        ws_id, change_id, sess = await _setup_bound_change(
            db_session, tmp_path, stage="brainstorm", owner_user_id=owner
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            await svc.proposal_review(ws_id, change_id, "approve", None, uuid.uuid4())

        inject_mock.assert_awaited_once_with(
            sess.id,
            prompt=f"[平台审批] 变更 {change.change_key} 的 proposal_review 审批已通过。请继续推进。",
        )

    async def test_plan_replan_injects_reject_message(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """打回类：消息带 `打回（decision）`。"""
        owner = uuid.uuid4()
        ws_id, change_id, sess = await _setup_bound_change(
            db_session, tmp_path, stage="plan", owner_user_id=owner
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PLAN_REVIEW), patch_ctx:
            result = await svc.plan_review(ws_id, change_id, "replan", "计划要重做", uuid.uuid4())

        assert result["notified_session"] is True
        assert result["notify_error"] is None
        inject_mock.assert_awaited_once_with(
            sess.id,
            prompt=(
                f"[平台审批] 变更 {change.change_key} 的 plan_review 审批已打回（replan）。"
                f"计划要重做。请继续推进。"
            ),
        )

    async def test_human_test_pass_injects_message(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, sess = await _setup_bound_change(
            db_session, tmp_path, stage="verify", owner_user_id=owner
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.HUMAN_TEST), patch_ctx:
            await svc.human_test(ws_id, change_id, "pass", "验收通过", uuid.uuid4())

        inject_mock.assert_awaited_once_with(
            sess.id,
            prompt=(
                f"[平台审批] 变更 {change.change_key} 的 human_test 审批已通过。"
                f"验收通过。请继续推进。"
            ),
        )

    async def test_archive_confirm_injects_message(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, sess = await _setup_bound_change(
            db_session, tmp_path, stage="archive", owner_user_id=owner
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.ARCHIVE_CONFIRM), patch_ctx:
            result = await svc.archive_confirm(ws_id, change_id, "确认归档", uuid.uuid4())

        assert result["notified_session"] is True
        assert result["notify_error"] is None
        inject_mock.assert_awaited_once_with(
            sess.id,
            prompt=(
                f"[平台审批] 变更 {change.change_key} 的 archive_confirm 审批已通过。"
                f"确认归档。请继续推进。"
            ),
        )

    async def test_latest_link_session_wins(self, db_session: AsyncSession, tmp_path: Path):
        """多 link：取 created_at 最新一条（design §8）。"""
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="brainstorm", owner_user_id=owner
        )
        # 第二条会话 + 更新的 link
        second = await _create_session(db_session, workspace_id=ws_id, user_id=owner)
        await _bind_session(
            db_session,
            change_id=change_id,
            session_id=second.id,
            created_at=datetime.now(UTC),
        )
        change = await ChangeService(db_session).get(ws_id, change_id)
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())

        inject_mock.assert_awaited_once_with(
            second.id,
            prompt=f"[平台审批] 变更 {change.change_key} 的 proposal_review 审批已通过。ok。请继续推进。",
        )

    async def test_notify_session_false_skips_injection(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """notify_session=False → 不注入，notified_session=false、notify_error=null。"""
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="brainstorm", owner_user_id=owner
        )
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            result = await svc.proposal_review(
                ws_id, change_id, "approve", "ok", uuid.uuid4(), notify_session=False
            )

        assert result["notified_session"] is False
        assert result["notify_error"] is None
        inject_mock.assert_not_awaited()


# ── 无绑定会话 ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
class TestReviewNotifyNoBoundSession:
    """无绑定会话：notified_session=false、notify_error=null，不调用注入（acceptance ④）。"""

    async def test_no_link_skips_injection(self, db_session: AsyncSession, tmp_path: Path):
        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
            path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
        )
        svc = ChangeService(db_session)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            result = await svc.proposal_review(ws.id, change.id, "approve", "ok", uuid.uuid4())

        assert result["notified_session"] is False
        assert result["notify_error"] is None
        # 审批照常推进（无绑定不阻断）
        assert result["change"].current_stage == "plan"
        inject_mock.assert_not_awaited()


# ── 三类降级（best-effort，不回滚审批 R-03） ──────────────────────────────


@pytest.mark.asyncio
class TestReviewNotifyDegradation:
    """turn 冲突 / 会话非 active / 其它异常 → 语义化降级，审批不回滚。"""

    async def test_turn_conflict_degrades(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="brainstorm", owner_user_id=owner
        )
        svc = ChangeService(db_session)
        patch_ctx, _m = _patch_inject_as_service(
            side_effect=DaemonSessionTurnConflict("agent busy")
        )
        with _patch_projection(PendingReview.PROPOSAL_REVIEW), patch_ctx:
            result = await svc.proposal_review(ws_id, change_id, "approve", "ok", uuid.uuid4())

        assert result["notified_session"] is False
        assert result["notify_error"] == "turn_conflict"
        # best-effort：审批不回滚——阶段已推进、review_history 已记录
        assert result["change"].current_stage == "plan"
        stages = result["change"].stages or {}
        assert any(r.get("decision") == "approve" for r in stages.get("review_history", []))

    async def test_session_inactive_degrades(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="plan", owner_user_id=owner
        )
        svc = ChangeService(db_session)
        patch_ctx, _m = _patch_inject_as_service(
            side_effect=DaemonSessionNotActive("session ended")
        )
        with _patch_projection(PendingReview.PLAN_REVIEW), patch_ctx:
            result = await svc.plan_review(ws_id, change_id, "approve", None, uuid.uuid4())

        assert result["notified_session"] is False
        assert result["notify_error"] == "session_inactive"
        assert result["change"].current_stage == "execute"

    async def test_other_exception_degrades(self, db_session: AsyncSession, tmp_path: Path):
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="verify", owner_user_id=owner
        )
        svc = ChangeService(db_session)
        patch_ctx, _m = _patch_inject_as_service(side_effect=RuntimeError("boom"))
        with _patch_projection(PendingReview.HUMAN_TEST), patch_ctx:
            result = await svc.human_test(ws_id, change_id, "pass", "ok", uuid.uuid4())

        assert result["notified_session"] is False
        assert result["notify_error"] == "inject_failed"
        assert result["change"].current_stage == "archive"

    async def test_reject_degrades_approval_still_recorded(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """打回类审批 + 降级：rework 记录照常落库，notify_error 语义化。"""
        owner = uuid.uuid4()
        ws_id, change_id, _sess = await _setup_bound_change(
            db_session, tmp_path, stage="verify", owner_user_id=owner
        )
        svc = ChangeService(db_session)
        patch_ctx, _m = _patch_inject_as_service(side_effect=DaemonSessionTurnConflict("busy"))
        with _patch_projection(PendingReview.HUMAN_TEST), patch_ctx:
            result = await svc.human_test(ws_id, change_id, "bug", "验收不过", uuid.uuid4())

        assert result["notified_session"] is False
        assert result["notify_error"] == "turn_conflict"
        # 打回落库：review_history rerun 条目 + last_review
        stages = result["change"].stages or {}
        assert any(r.get("decision") == "bug" for r in stages.get("review_history", []))
        assert any(
            r.get("action") == "rerun" and r.get("stage") == "execute"
            for r in stages.get("review_history", [])
        )


# ── 服务身份绕过归属校验（多成员审批人≠会话创建人） ─────────────────────


@pytest.mark.asyncio
class TestServiceIdentityInjection:
    """``inject_session_as_service`` 无用户上下文也能注入（acceptance ②）。

    对照：``inject_session`` 用非会话创建人身份注入 → 归属校验 404；
    而 ``inject_session_as_service``（服务身份）对同一会话注入成功。
    """

    async def _setup_full_session(
        self, db_session: AsyncSession, ws_id: uuid.UUID
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Create user（会话创建人）+ runtime + interactive lease + active session。

        返回 ``(owner_user_id, session_id)``。
        """
        from app.modules.auth.model import User

        owner = uuid.uuid4()
        db_session.add(
            User(
                id=owner,
                email=f"owner-{uuid.uuid4().hex}@example.com",
                password_hash="x",
                display_name="Owner",
                status="active",
            )
        )
        now = datetime.now(UTC)
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=owner,
            name="daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=now,
        )
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            attempt_number=1,
            metadata_={"claim_token": "tok"},
        )
        db_session.add(lease)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=owner,
            provider="claude",
            status="active",
            turn_count=1,
            runtime_id=rt.id,
            lease_id=lease.id,
            workspace_id=ws_id,
            created_at=now,
        )
        db_session.add(sess)
        await db_session.commit()
        await db_session.refresh(sess)
        return owner, sess.id

    async def test_service_identity_bypasses_ownership(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        from app.modules.auth.model import User

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        _owner, sess_id = await self._setup_full_session(db_session, ws.id)

        # 审批人（另一个成员）≠ 会话创建人
        approver = uuid.uuid4()
        db_session.add(
            User(
                id=approver,
                email=f"appr-{uuid.uuid4().hex}@example.com",
                password_hash="x",
                display_name="Approver",
                status="active",
            )
        )
        await db_session.commit()

        svc = SessionService(db_session)
        # 对照：用户身份注入受归属校验 → 404（存在性不泄露）
        with pytest.raises(DaemonSessionNotFound):
            await svc.inject_session(sess_id, approver, prompt="x")

        # 服务身份注入：无用户上下文，仍成功（绕过 _get_owned_session_for_update）
        hub = MagicMock()
        hub.is_connected.return_value = True
        hub.connected_runtime_ids = []
        hub.connected_daemon_ids = []
        hub.send_wakeup = AsyncMock(return_value=True)
        hub.send_session_control = AsyncMock(return_value=True)
        redis = AsyncMock()
        redis.publish = AsyncMock()
        # 避免 30s readiness 等待（正常路径：daemon 上报 mark_ready；测试打桩直通）
        from app.modules.daemon.session.service import get_session_readiness

        get_session_readiness().mark_ready(sess_id)
        with (
            patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub),
            patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        ):
            result = await svc.inject_session_as_service(
                sess_id, prompt="[平台审批] 变更 c1 的 plan_review 审批已通过。请继续推进。"
            )

        assert result.agent_run.agent_session_id == sess_id
        assert result.agent_run.status == "pending"
        await db_session.refresh(result.agent_session)
        assert result.agent_session.turn_count == 2
        # SESSION_INJECT 控制消息已发（含 prompt）
        hub.send_session_control.assert_awaited()
        _prompt = hub.send_session_control.await_args.args[2]["prompt"]
        assert "请继续推进" in _prompt


# ── Router 层：notify_session 透传 + notified_session/notify_error 出响应 ─────


@pytest.mark.asyncio
class TestReviewEndpointNotifyPassthrough:
    """审批 HTTP 端点把 ``notify_session`` 透传给 service，并把返回的
    ``notified_session`` / ``notify_error`` 填进 ``ReviewResponse``
    （task-04 接线补全，前端 task-10 三类降级提示依赖真实值）。"""

    async def _setup_http(
        self, client, db_session: AsyncSession, tmp_path: Path
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Create workspace + change（brainstorm，含完成块）+ 他人会话绑定。"""
        from app.modules.auth.model import User

        ws = await _create_test_workspace(db_session, root_path=str(tmp_path))
        change = await _create_test_change(
            db_session,
            workspace_id=ws.id,
            current_stage="brainstorm",
            path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
        )
        # 会话创建人 ≠ 审批人（平台 admin）：服务身份注入的多成员场景
        owner = uuid.uuid4()
        db_session.add(
            User(
                id=owner,
                email=f"owner-{uuid.uuid4().hex}@example.com",
                password_hash="x",
                display_name="Owner",
                status="active",
            )
        )
        await db_session.commit()
        sess = await _create_session(db_session, workspace_id=ws.id, user_id=owner)
        await _bind_session(db_session, change_id=change.id, session_id=sess.id)
        return ws.id, change.id

    async def test_proposal_review_endpoint_surfaces_notified_session(
        self,
        client,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup_http(client, db_session, tmp_path)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with (
            patch(
                "app.modules.change.service.StageProjectionService.compute_pending_review",
                new=AsyncMock(return_value=PendingReview.PROPOSAL_REVIEW),
            ),
            patch_ctx,
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/proposal-review",
                json={"decision": "approve", "comment": "ok", "notify_session": True},
                headers=auth_headers,
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 响应透传真实注入结果（不再恒 false）
        assert body["notified_session"] is True
        assert body["notify_error"] is None
        # 注入确以服务身份触发（mock 被调用，消息含 change_key）
        inject_mock.assert_awaited_once()
        prompt_arg = inject_mock.await_args.kwargs["prompt"]
        assert "变更" in prompt_arg and "请继续推进" in prompt_arg

    async def test_proposal_review_endpoint_surfaces_turn_conflict(
        self,
        client,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup_http(client, db_session, tmp_path)
        patch_ctx, _m = _patch_inject_as_service(
            side_effect=DaemonSessionTurnConflict("agent busy")
        )
        with (
            patch(
                "app.modules.change.service.StageProjectionService.compute_pending_review",
                new=AsyncMock(return_value=PendingReview.PROPOSAL_REVIEW),
            ),
            patch_ctx,
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/proposal-review",
                json={"decision": "approve", "comment": "ok", "notify_session": True},
                headers=auth_headers,
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["notified_session"] is False
        assert body["notify_error"] == "turn_conflict"
        # best-effort：审批不回滚——响应里阶段已推进到 plan
        assert body["change"]["current_stage"] == "plan"

    async def test_proposal_review_endpoint_notify_session_false(
        self,
        client,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ):
        from app.modules.change.schema import PendingReview

        ws_id, change_id = await self._setup_http(client, db_session, tmp_path)
        patch_ctx, inject_mock = _patch_inject_as_service()
        with (
            patch(
                "app.modules.change.service.StageProjectionService.compute_pending_review",
                new=AsyncMock(return_value=PendingReview.PROPOSAL_REVIEW),
            ),
            patch_ctx,
        ):
            resp = await client.post(
                f"/api/workspaces/{ws_id}/changes/{change_id}/proposal-review",
                json={"decision": "approve", "comment": "ok", "notify_session": False},
                headers=auth_headers,
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["notified_session"] is False
        assert body["notify_error"] is None
        inject_mock.assert_not_awaited()
