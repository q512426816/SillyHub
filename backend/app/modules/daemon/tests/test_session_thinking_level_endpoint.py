"""thinking-level 两端点测试矩阵（2026-09-14-session-thinking-level task-05 /
FR-03 / FR-04 / FR-05）。

覆盖矩阵（design §接口定义 + §兼容策略 + task-05 acceptance）：

- 三校验：无鉴权 401 / 非归属 404 / caps false（cursor）409 / 会话
  reconnecting 409 NotActive；
- GET 状态校验轻于 POST：忙轮（首 run pending）下 GET 仍 200 派发 RPC，
  POST 忙轮 409 TurnConflict（D-002「仅空闲」约束）；
- GET RPC 映射：成功 {levels,current} 字段映射 + RPC 契约钉定；离线/超时
  走既有 504 上抛（GET 响应无 error 字段，不 200 假数据）；RemoteError
  method_not_found → 502 升级提示、业务错误 → 502 原文；
- POST 词表校验：非法档 400（文案带七档清单，不触达 RPC）；
- POST RPC：成功 {ok} / ok=false error 原文 / 三异常映射（Offline/Timeout
  → 结构化 error，method_not_found → 升级提示，业务错误原文）；
  DaemonRpcConflict 不映射走既有 AppError 兜底；
- 创建链透传（FR-03/P1-8）：thinking_level 经 POST /sessions → create 形参
  → placement lease metadata → claim payload 白名单逐跳可见，且
  AgentSession.config 无此键（不落库定案）；不携带时全链无键（零回归）。

Production code is covered by app/modules/daemon/session/service/thinking_level.py.
ws 层全 mock（patch get_daemon_ws_hub），不依赖真 daemon。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.runtime.service import (
    DaemonRpcConflict,
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.session.service.thinking_level import (
    GET_THINKING_LEVELS_RPC_METHOD,
    SET_THINKING_LEVEL_RPC_METHOD,
    THINKING_LEVEL_RPC_TIMEOUT_SECONDS,
    VALID_THINKING_LEVELS,
)

from .test_session_switch_config import (
    _create_runtime,
    _create_user,
    _finish_first_turn,
)

# patch 目标（ws_hub 延迟解析，照 compact 测试先例）。
_WS_HUB_GETTER = "app.modules.daemon.ws_hub.get_daemon_ws_hub"
_REDIS_GETTER = "app.modules.daemon.session.service.get_redis"


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch(_REDIS_GETTER, return_value=redis):
        yield redis


def _hub(*, send_rpc_return: object = None, send_rpc_side_effect: BaseException | None = None):
    """兼具 create 派发（send_wakeup/send_session_control）与 RPC 的 mock hub。

    ``send_rpc_side_effect`` 优先于 ``send_rpc_return``（AsyncMock 语义）。
    """
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
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


async def _seed_thinking_session(
    db_session: AsyncSession,
    *,
    provider: str = "claude",
    finish_first: bool = True,
    owner_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, DaemonRuntime]:
    """service 层建 owner 的 runtime + 会话（owner 缺省=admin 匹配 auth_headers）。

    finish_first=True 把首轮置 completed（空闲轮，可切档）；False 保持 pending
    （忙轮，POST 切档拒绝 / GET 仍放行）。需在 mocked hub patch 生效期内调用
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


class TestThinkingLevelGuards:
    @pytest.mark.asyncio
    async def test_unauthenticated_401(self, client: AsyncClient) -> None:
        """无 Authorization 头 → 401（AuthTokenMissing），两端点同口径。"""
        sid = uuid.uuid4()
        resp_get = await client.get(f"/api/daemon/sessions/{sid}/thinking-levels")
        assert resp_get.status_code == 401, resp_get.text
        assert resp_get.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"
        resp_post = await client.post(
            f"/api/daemon/sessions/{sid}/thinking-level", json={"level": "high"}
        )
        assert resp_post.status_code == 401, resp_post.text

    @pytest.mark.asyncio
    async def test_non_owner_404(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """会话属主是他人 → 404 不泄露存在性（归属校验同 inject/compact 口径）。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            other = await _create_user(db_session)
            sid, _rt = await _seed_thinking_session(db_session, provider="claude", owner_id=other)

        resp_get = await client.get(
            f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
        )
        assert resp_get.status_code == 404, resp_get.text
        assert resp_get.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"
        resp_post = await client.post(
            f"/api/daemon/sessions/{sid}/thinking-level",
            json={"level": "high"},
            headers=auth_headers,
        )
        assert resp_post.status_code == 404, resp_post.text
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("via_post", [False, True])
    async def test_caps_false_cursor_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        via_post: bool,
    ) -> None:
        """cursor 会话（caps thinking_level=false，task-01 @generated 表）→ 409。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="cursor")

        if via_post:
            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "high"},
                headers=auth_headers,
            )
        else:
            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_SESSION_THINKING_LEVEL_UNSUPPORTED"
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_session_reconnecting_409_not_active(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """会话 reconnecting → POST 409 NotActive（status≠active 拒）。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="claude")
        await _set_session_status(db_session, sid, "reconnecting")

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/thinking-level",
            json={"level": "high"},
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
        assert body["details"]["status"] == "reconnecting"
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_post_turn_running_409(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """POST 忙轮（首 run pending 即活跃轮，D-002「仅空闲」）→ 409 TurnConflict。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            # finish_first=False：首轮保持 pending（活跃轮）。
            sid, _rt = await _seed_thinking_session(
                db_session, provider="claude", finish_first=False
            )

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/thinking-level",
            json={"level": "high"},
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["code"] == "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_get_turn_running_still_ok(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """GET 状态校验轻于 POST：忙轮下查询无副作用，仍 200 派发 RPC。"""
        hub = _hub(send_rpc_return={"levels": ["low", "high"], "current": "low"})
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(
                db_session, provider="claude", finish_first=False
            )

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["levels"] == ["low", "high"]
        hub.send_rpc.assert_awaited_once()


# ════════════════════════════════════════════════════════════════════════════
# GET 分路（FR-04：ws RPC session_get_thinking_levels）
# ════════════════════════════════════════════════════════════════════════════


class TestGetLevelsRpc:
    @pytest.mark.asyncio
    async def test_get_success_mapping_and_contract(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """成功回执映射 {levels, current} + RPC 契约钉定（method/params/timeout）。"""
        hub = _hub(
            send_rpc_return={"levels": ["off", "low", "medium", "high"], "current": "medium"}
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["levels"] == ["off", "low", "medium", "high"]
        assert body["current"] == "medium"
        # RPC 契约钉定：daemon_id（迁移期回退 runtime_id）+ method + params + timeout。
        hub.send_rpc.assert_awaited_once_with(
            rt.id,
            GET_THINKING_LEVELS_RPC_METHOD,
            {"session_id": str(sid)},
            timeout=THINKING_LEVEL_RPC_TIMEOUT_SECONDS,
        )
        assert GET_THINKING_LEVELS_RPC_METHOD == "session_get_thinking_levels"
        assert THINKING_LEVEL_RPC_TIMEOUT_SECONDS == 15

    @pytest.mark.asyncio
    async def test_get_defensive_coercion(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """回执防御性收敛：levels 非 str 元素弃置 / current 非 str → None。"""
        hub = _hub(send_rpc_return={"levels": ["off", 42, None, "high"], "current": 7})
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="claude")

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["levels"] == ["off", "high"]
        assert body["current"] is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("exc", "code"),
        [
            (DaemonRuntimeOffline("offline"), "HTTP_504_DAEMON_RUNTIME_OFFLINE"),
            (DaemonRpcTimeout("timed out"), "HTTP_504_DAEMON_RPC_TIMEOUT"),
        ],
    )
    async def test_get_offline_timeout_504(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        exc: BaseException,
        code: str,
    ) -> None:
        """GET 离线/超时走既有 504 AppError 上抛（响应无 error 字段，不 200 假数据）。"""
        hub = _hub(send_rpc_side_effect=exc)
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == code

    @pytest.mark.asyncio
    async def test_get_remote_method_not_found_502_upgrade_hint(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """旧 daemon 无 handler（method_not_found）→ 502 +「请升级 daemon」文案。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {
                    "code": "method_not_found",
                    "message": "No handler for session_get_thinking_levels",
                }
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="codex")

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 502, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_502_DAEMON_SESSION_THINKING_LEVELS_UNAVAILABLE"
        assert body["message"] == "daemon 未支持思考级别，请升级 daemon"

    @pytest.mark.asyncio
    async def test_get_remote_business_error_502_original(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """新 daemon 业务错误（非 method_not_found）→ 502 远端原文。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {"code": "thinking_levels_unavailable", "message": "会话忙，档位暂不可查"}
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.get(
                f"/api/daemon/sessions/{sid}/thinking-levels", headers=auth_headers
            )

        assert resp.status_code == 502, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_502_DAEMON_SESSION_THINKING_LEVELS_UNAVAILABLE"
        assert body["message"] == "会话忙，档位暂不可查"


# ════════════════════════════════════════════════════════════════════════════
# POST 分路（FR-05：词表校验 + ws RPC session_set_thinking_level）
# ════════════════════════════════════════════════════════════════════════════


class TestSetLevelRpc:
    @pytest.mark.asyncio
    async def test_post_invalid_level_400(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """非法档（不在七档词表）→ 400 + 文案带合法档位清单，不触达 RPC。"""
        hub = _hub()
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="claude")

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/thinking-level",
            json={"level": "ultra"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_400_DAEMON_SESSION_THINKING_LEVEL_INVALID"
        # 文案带合法档位清单（前端可直接提示）；词表钉定七档。
        assert "/".join(VALID_THINKING_LEVELS) in body["message"]
        assert tuple(VALID_THINKING_LEVELS) == (
            "off",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        )
        hub.send_rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_post_success_contract(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """成功回执 {ok:true} + RPC 契约钉定（params 含 session_id + level）。"""
        hub = _hub(send_rpc_return={"ok": True})
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "xhigh"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["error"] is None
        hub.send_rpc.assert_awaited_once_with(
            rt.id,
            SET_THINKING_LEVEL_RPC_METHOD,
            {"session_id": str(sid), "level": "xhigh"},
            timeout=THINKING_LEVEL_RPC_TIMEOUT_SECONDS,
        )
        assert SET_THINKING_LEVEL_RPC_METHOD == "session_set_thinking_level"

    @pytest.mark.asyncio
    async def test_post_receipt_not_ok_error_passthrough(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """回执 ok=false（如 pi 模型不支持 xhigh）→ ok=false + error 原文。"""
        hub = _hub(send_rpc_return={"ok": False, "error": "当前模型不支持 xhigh 档位"})
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "xhigh"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is False
        assert body["error"] == "当前模型不支持 xhigh 档位"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("exc", "expected_error"),
        [
            (DaemonRuntimeOffline("offline"), "daemon 离线"),
            (DaemonRpcTimeout("timed out"), "daemon 未响应思考级别切换命令"),
        ],
    )
    async def test_post_offline_timeout_mapped(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        exc: BaseException,
        expected_error: str,
    ) -> None:
        """离线/超时 → 200 结构化 error（照 compact 口径，不抛 5xx）。"""
        hub = _hub(send_rpc_side_effect=exc)
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="codex")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "high"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is False
        assert body["error"] == expected_error

    @pytest.mark.asyncio
    async def test_post_remote_method_not_found_upgrade_hint(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """旧 daemon 无 handler（method_not_found）→「daemon 未支持思考级别，请升级 daemon」。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {"code": "method_not_found", "message": "No handler for session_set_thinking_level"}
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="claude")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "high"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is False
        assert body["error"] == "daemon 未支持思考级别，请升级 daemon"

    @pytest.mark.asyncio
    async def test_post_remote_business_error_original_text(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """新 daemon 业务错误（非 method_not_found）→ 远端 error 原文呈现。"""
        hub = _hub(
            send_rpc_side_effect=DaemonRpcRemoteError(
                {"code": "thinking_level_busy", "message": "本轮对话进行中，无法切换档位"}
            )
        )
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="codex")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "high"},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is False
        assert body["error"] == "本轮对话进行中，无法切换档位"

    @pytest.mark.asyncio
    async def test_post_conflict_not_mapped(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """DaemonRpcConflict 不捕获——走既有 AppError 兜底（非 200 结构化响应）。"""
        hub = _hub(send_rpc_side_effect=DaemonRpcConflict("rpc_id collision"))
        with patch(_WS_HUB_GETTER, return_value=hub):
            sid, _rt = await _seed_thinking_session(db_session, provider="pi")

            resp = await client.post(
                f"/api/daemon/sessions/{sid}/thinking-level",
                json={"level": "high"},
                headers=auth_headers,
            )

        # 未被映射为 SessionThinkingLevelResponse（无 ok 键），按 AppError 状态上抛。
        assert resp.status_code != 200, resp.text
        assert "ok" not in resp.json()


# ════════════════════════════════════════════════════════════════════════════
# 创建链透传（FR-03：POST /sessions → create 形参 → lease metadata → claim
# payload 白名单；P1-8/NG-04：不写 AgentSession.config）
# ════════════════════════════════════════════════════════════════════════════


class TestCreateChainPassthrough:
    @pytest.mark.asyncio
    async def test_create_level_reaches_lease_metadata_and_claim_payload(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """携带 thinking_level 创建 → placement lease metadata + claim payload
        白名单逐跳可见，且 AgentSession.config 无此键（不落库，P1-8）。"""
        hub = _hub()
        admin_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, admin_id, provider="claude")
        with patch(_WS_HUB_GETTER, return_value=hub):
            resp = await client.post(
                "/api/daemon/sessions",
                json={
                    "prompt": "hi",
                    "runtime_id": str(rt.id),
                    "thinking_level": "high",
                },
                headers=auth_headers,
            )

        assert resp.status_code == 201, resp.text
        session_id = uuid.UUID(resp.json()["session_id"])

        session_row = await db_session.get(AgentSession, session_id)
        assert session_row is not None
        # P1-8/NG-04：档位不落 AgentSession.config。
        assert "thinking_level" not in (session_row.config or {})
        assert session_row.lease_id is not None

        lease = await db_session.get(DaemonTaskLease, session_row.lease_id)
        assert lease is not None
        # 逐跳 1：placement 写 lease metadata。
        assert (lease.metadata_ or {}).get("thinking_level") == "high"

        # 逐跳 2：build_claim_payload interactive 分支白名单透传。
        payload = await build_claim_payload(db_session, lease)
        assert payload["thinking_level"] == "high"

    @pytest.mark.asyncio
    async def test_create_without_level_no_metadata_key(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """不携带 thinking_level 创建 → lease metadata 无键（零回归，缺键穿透）。"""
        hub = _hub()
        admin_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, admin_id, provider="claude")
        with patch(_WS_HUB_GETTER, return_value=hub):
            resp = await client.post(
                "/api/daemon/sessions",
                json={"prompt": "hi", "runtime_id": str(rt.id)},
                headers=auth_headers,
            )

        assert resp.status_code == 201, resp.text
        session_id = uuid.UUID(resp.json()["session_id"])

        session_row = await db_session.get(AgentSession, session_id)
        assert session_row is not None
        assert session_row.lease_id is not None
        lease = await db_session.get(DaemonTaskLease, session_row.lease_id)
        assert lease is not None
        assert "thinking_level" not in (lease.metadata_ or {})
        # claim payload 无键时置 None（model 同款无条件映射），daemon 侧
        # undefined 穿透不伪造默认值。
        payload = await build_claim_payload(db_session, lease)
        assert payload.get("thinking_level") is None
