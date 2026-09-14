"""compact 端点测试矩阵（2026-09-14-session-ctx-compact task-02 / FR-02 / FR-03）。

覆盖矩阵（design §接口定义 + task-02 acceptance）：

- 三校验：无鉴权 401 / 非归属 404 / caps false（cursor）409 / turn running
  （首 run pending 即忙轮）409 TurnConflict / 会话 reconnecting 409 NotActive；
- claude 分路：mock inject_session 断言 prompt="/compact" + run_id/queued 映射；
  DaemonSessionTurnConflict（锁内竞态，复审 P1-1）→ 结构化 error 非 500；
  另一条真实链路回归（mocked hub 走完整 inject——run 建出、user_input 落
  "/compact"）；
- pi/codex 分路：mock send_rpc 断言 method="session_compact" / params 含
  session_id / timeout=15 与 CompactResult（camelCase）字段映射；ok=false 回执
  error 原文；三异常（Offline/Timeout/RemoteError）各自 error 文案
  （method_not_found → 升级提示，业务错误 → 原文）；DaemonRpcConflict 不映射
  走既有 AppError 兜底（非 200 结构化响应）。

Production code is covered by app/modules/daemon/session/service/compact.py.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.runtime.service import (
    DaemonRpcConflict,
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
)
from app.modules.daemon.session.service import DaemonSessionTurnConflict
from app.modules.daemon.session.service.compact import (
    COMPACT_PROMPT,
    COMPACT_RPC_METHOD,
    COMPACT_RPC_TIMEOUT_SECONDS,
)
from app.modules.daemon.session.service.results import SessionDispatchResult

from .test_session_switch_config import (
    _create_runtime,
    _create_user,
    _finish_first_turn,
)

# patch 目标（compact 经 svc.inject_session 方法面复用 inject——facade 委托；
# ws_hub 延迟解析）。
_FACADE_INJECT = "app.modules.daemon.service.DaemonService.inject_session"
_WS_HUB_GETTER = "app.modules.daemon.ws_hub.get_daemon_ws_hub"
_REDIS_GETTER = "app.modules.daemon.session.service.get_redis"


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch(_REDIS_GETTER, return_value=redis):
        yield redis


def _hub(*, send_rpc_return: object = None, send_rpc_side_effect: BaseException | None = None):
    """兼具 create/inject 派发（send_session_control）与 RPC（send_rpc）的 mock hub。

    ``send_rpc_side_effect`` 优先于 ``send_rpc_return``（AsyncMock 语义）。
    """
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    # create 链 placement 派发会 await send_wakeup（test_session_switch_config
    # _mock_hub 同款）；inject 控制指令走 send_session_control。
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    send_rpc = AsyncMock(return_value=send_rpc_return)
    if send_rpc_side_effect is not None:
        send_rpc.side_effect = send_rpc_side_effect
    hub.send_rpc = send_rpc
    return hub


async def _admin_user_id(db_session: AsyncSession) -> uuid.UUID:
    """conftest ``auth_admin_token`` 建的 admin（auth_headers 对应身份）。"""
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _seed_compact_session(
    db_session: AsyncSession,
    *,
    provider: str = "claude",
    finish_first: bool = True,
    owner_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, DaemonRuntime]:
    """service 层建 owner 的 runtime + 会话（owner 缺省=admin 匹配 auth_headers）。

    finish_first=True 把首轮置 completed（空闲轮，可压缩）；False 保持 pending
    （忙轮，D-002 守卫拒绝场景）。需在 mocked hub/redis patch 生效期内调用
    （create_session 会派发首轮控制消息 + 发事件）。
    """
    if owner_id is None:
        owner_id = await _admin_user_id(db_session)
    rt = await _create_runtime(db_session, owner_id, provider=provider)
    from app.modules.daemon.service import DaemonService

    svc = DaemonService(db_session)
    created = await svc.create_session(
        owner_id, provider=provider, prompt="first", runtime_id=str(rt.id)
    )
    if finish_first:
        await _finish_first_turn(db_session, created)
    return created.agent_session.id, rt


async def _set_session_status(db_session: AsyncSession, session_id: uuid.UUID, status: str) -> None:
    row = (
        (await db_session.execute(select(AgentSession).where(AgentSession.id == session_id)))
        .scalars()
        .one()
    )
    row.status = status
    db_session.add(row)
    await db_session.commit()


# ════════════════════════════════════════════════════════════════════════════
# 三校验拒绝路径
# ════════════════════════════════════════════════════════════════════════════


class TestCompactGuards:
    @pytest.mark.asyncio
    async def test_unauthenticated_401(self, client: AsyncClient) -> None:
        """无 Authorization 头 → 401（AuthTokenMissing），不触达 service。"""
        resp = await client.post(f"/api/daemon/sessions/{uuid.uuid4()}/compact", json={})
        assert resp.status_code == 401, resp.text
        assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    @pytest.mark.asyncio
    async def test_non_owner_404(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """会话属主是他人 → 404 不泄露存在性（归属校验同 inject 口径）。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            other = await _create_user(db_session)
            sid, _rt = await _seed_compact_session(db_session, provider="claude", owner_id=other)

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_caps_false_cursor_409(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """cursor 会话（caps compact=false，D-001）→ 409 结构化拒绝，不进任何分路。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="cursor")

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_SESSION_COMPACT_UNSUPPORTED"
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_turn_running_409(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """turn running（首 run pending 即忙轮，D-002 空闲守卫）→ 409 TurnConflict。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            # finish_first=False：首轮保持 pending（活跃轮）。
            sid, _rt = await _seed_compact_session(
                db_session, provider="claude", finish_first=False
            )

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["code"] == "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"

    @pytest.mark.asyncio
    async def test_session_reconnecting_409(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """会话 reconnecting → 409 NotActive（status≠active 拒，对齐 inject 口径）。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="pi")
        await _set_session_status(db_session, sid, "reconnecting")

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
        assert body["details"]["status"] == "reconnecting"
        hub.send_rpc.assert_not_awaited()


# ════════════════════════════════════════════════════════════════════════════
# claude 分路（FR-03：inject 复用）
# ════════════════════════════════════════════════════════════════════════════


class TestClaudeBranch:
    @pytest.mark.asyncio
    async def test_inject_reuse_prompt_and_mapping(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """mock inject_session：prompt="/compact" 透传 + run_id/queued 映射。"""
        hub = _hub()
        run_id = uuid.uuid4()
        fake_run = MagicMock()
        fake_run.id = run_id
        fake_result = SessionDispatchResult(
            agent_session=MagicMock(), agent_run=fake_run, lease_id=uuid.uuid4()
        )
        inject_mock = AsyncMock(return_value=fake_result)
        with (
            patch(_WS_HUB_GETTER, return_value=hub),
            patch(_FACADE_INJECT, inject_mock) as patched,
        ):
            sid, _rt = await _seed_compact_session(db_session, provider="claude")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is True
        assert body["provider"] == "claude"
        assert body["run_id"] == str(run_id)
        assert body["queued"] is False
        # claude 分路走 inject 不走 RPC。
        hub.send_rpc.assert_not_awaited()
        # prompt="/compact" + 用户身份透传（inject 复用形态钉定）。
        patched.assert_awaited_once()
        awaited = patched.await_args
        assert awaited is not None
        assert awaited.args == (sid, await _admin_user_id(db_session))
        assert awaited.kwargs.get("prompt") == COMPACT_PROMPT == "/compact"

    @pytest.mark.asyncio
    async def test_turn_conflict_mapped_to_error_not_500(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """锁内竞态（P1-1）：inject 抛 TurnConflict → 200 结构化 error，非 500。"""
        hub = _hub()
        inject_mock = AsyncMock(
            side_effect=DaemonSessionTurnConflict("Session 'x' already has an active run.")
        )
        with (
            patch(_WS_HUB_GETTER, return_value=hub),
            patch(_FACADE_INJECT, inject_mock),
        ):
            sid, _rt = await _seed_compact_session(db_session, provider="claude")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["provider"] == "claude"
        assert body["run_id"] is None
        assert body["error"], "竞态必须映射结构化 error 文案"

    @pytest.mark.asyncio
    async def test_real_inject_path_creates_compact_run(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """真实链路回归：mocked hub 走完整 inject——新 run 建出、user_input 落
        "/compact"、响应含 run_id/queued=False（claude 分路是调用方复用非修改）。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="claude")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is True
        assert body["provider"] == "claude"
        assert body["queued"] is False
        new_run_id = uuid.UUID(body["run_id"])

        run = await db_session.get(AgentRun, new_run_id)
        assert run is not None and run.agent_session_id == sid
        user_input = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == new_run_id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .one_or_none()
        )
        assert user_input is not None, "压缩轮必须落 user_input 留痕"
        assert user_input.content_redacted == "/compact"


# ════════════════════════════════════════════════════════════════════════════
# pi/codex 分路（D-003@v3：ws RPC 结构化回执）
# ════════════════════════════════════════════════════════════════════════════


class TestRpcBranch:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("provider", ["pi", "codex"])
    async def test_rpc_success_receipt_mapping(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        provider: str,
    ) -> None:
        """mock send_rpc：method/params/timeout 钉定 + CompactResult 字段映射。"""
        hub = _hub(
            send_rpc_return={
                "ok": True,
                "tokensBefore": 123456,
                "estimatedTokensAfter": 20480,
            }
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, rt = await _seed_compact_session(db_session, provider=provider)

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is True
        assert body["provider"] == provider
        assert body["tokens_before"] == 123456
        assert body["estimated_tokens_after"] == 20480
        assert body["run_id"] is None and body["queued"] is None and body["error"] is None
        # RPC 契约钉定：daemon_id（迁移期回退 runtime_id）+ method + params + timeout。
        hub.send_rpc.assert_awaited_once_with(
            rt.id,
            COMPACT_RPC_METHOD,
            {"session_id": str(sid)},
            timeout=COMPACT_RPC_TIMEOUT_SECONDS,
        )
        assert COMPACT_RPC_METHOD == "session_compact"
        assert COMPACT_RPC_TIMEOUT_SECONDS == 15

    @pytest.mark.asyncio
    async def test_rpc_receipt_not_ok_error_passthrough(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """回执 ok=false（如 pi "Nothing to compact"）→ accepted=False + error 原文。"""
        hub = _hub(send_rpc_return={"ok": False, "error": "Nothing to compact"})
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["error"] == "Nothing to compact"
        assert body["tokens_before"] is None

    @pytest.mark.asyncio
    async def test_rpc_offline_mapped(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """DaemonRuntimeOffline → error「daemon 离线」（结构化 200，非 504）。"""
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        hub = _hub(send_rpc_side_effect=DaemonRuntimeOffline("offline"))
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["error"] == "daemon 离线"

    @pytest.mark.asyncio
    async def test_rpc_timeout_mapped(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """DaemonRpcTimeout → error「daemon 未响应压缩命令」。"""
        hub = _hub(send_rpc_side_effect=DaemonRpcTimeout("timed out"))
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="codex")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["error"] == "daemon 未响应压缩命令"

    @pytest.mark.asyncio
    async def test_rpc_remote_method_not_found_upgrade_hint(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """旧 daemon 无 handler（method_not_found）→「daemon 未支持压缩，请升级 daemon」。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {"code": "method_not_found", "message": "No handler for session_compact"}
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["error"] == "daemon 未支持压缩，请升级 daemon"

    @pytest.mark.asyncio
    async def test_rpc_remote_business_error_original_text(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """新 daemon 业务错误（非 method_not_found）→ 远端 error 原文呈现。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {"code": "compact_busy", "message": "会话忙，无法压缩"}
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="codex")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is False
        assert body["error"] == "会话忙，无法压缩"

    @pytest.mark.asyncio
    async def test_rpc_conflict_not_mapped(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """DaemonRpcConflict 不捕获——走既有 AppError 兜底（非 200 结构化响应）。"""
        hub = _hub(send_rpc_side_effect=DaemonRpcConflict("rpc_id collision"))
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_compact_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/compact", json={}, headers=auth_headers
            )

        # 未被映射为 SessionCompactResponse（无 accepted 键），按 AppError 状态上抛。
        assert resp.status_code != 200, resp.text
        assert "accepted" not in resp.json()
