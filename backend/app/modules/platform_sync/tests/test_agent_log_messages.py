"""GET /api/agent-logs/{entry_id}/messages 对话化消息端点测试（task-03 / design §7.2）。

覆盖（mock RPC，不依赖 task-02 daemon 实现，仅消费其契约）：

- 200 status 四值分层透传（parsed/unsupported/parse_error/too_large 均 200，
  「RPC 成功≠解析成功」，前端判断回落）。
- camelCase→snake_case 外层映射（totalSegments→total_segments /
  skippedLines→skipped_lines）；messages 内层逐字段 snake_case 原样。
- before_seq query 参数透传 daemon 侧 beforeSeq；缺省不带该键。
- 老 daemon method-not-found → 422 ``HTTP_422_AGENT_LOG_UNSUPPORTED``（唯一 422）。
- 共享 helper 通道复用断言：scope 越权 404 / 二进制 409 / 无绑定 daemon 404 /
  forbidden 409 / remote not_found 404 / 其余远端错 502 / 离线·超时既有 504 透传。
- openapi 暴露 AgentLogMessagesResponse / AgentLogMessageItem（供 task-04 gen:types）。

RPC 层 mock：patch ``app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc``（helper
函数级 import，调用时解析 → patch 源模块生效）。夹具范式照
``test_agent_log_content.py``（shpsync_headers + client + db_session）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.platform_sync.model import AgentSessionLogORM

# 注册 workspace_member_runtimes 表（根 conftest import 列表不含本 model，
# 模块级 import 在 collection 期先于 db_engine 的 create_all 执行；本文件虽不
# 直接构造该 model，但「无绑定 daemon 404」用例会经共享 helper 查询该表）。
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime  # noqa: F401

_RPC = "app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc"

#: daemon 契约（task-02）外层 camelCase 返回的 parsed 形状样例（messages 内层
#: snake_case 与 NormalizedLogMessage 逐字对齐，design §7.1）。
_PARSED_RESULT: dict[str, Any] = {
    "status": "parsed",
    "messages": [
        {
            "seq": 1,
            "kind": "user_input",
            "text": "帮我修个 bug",
            "tool_name": None,
            "tool_use_id": None,
            "tool_input": None,
            "tool_result": None,
            "is_error": None,
            "ts": "2026-08-23T10:00:00.000Z",
        },
        {
            "seq": 2,
            "kind": "tool_use",
            "text": None,
            "tool_name": "Bash",
            "tool_use_id": "toolu_01",
            "tool_input": '{"command": "ls"}',
            "tool_result": None,
            "is_error": None,
            "ts": "2026-08-23T10:00:01.000Z",
        },
        {
            "seq": 3,
            "kind": "tool_result",
            "text": None,
            "tool_name": None,
            "tool_use_id": "toolu_01",
            "tool_input": None,
            "tool_result": "a.py\nb.py",
            "is_error": False,
            "ts": "2026-08-23T10:00:02.000Z",
        },
    ],
    "truncated": True,
    "totalSegments": 203,
    "skippedLines": 2,
}


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _make_entry(
    db_session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    fmt: str | None = "zcode-model-io-jsonl",
    agent_session_id: uuid.UUID | None = None,
    log_path: str = "C:/Users/x/.zcode/model-io/abc.jsonl",
) -> AgentSessionLogORM:
    row = AgentSessionLogORM(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        log_path=log_path,
        harness="zcode",
        format=fmt,
        exists=True,
        agent_session_id=agent_session_id,
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _make_instance_and_runtime(
    db_session: AsyncSession,
    user_id: uuid.UUID,
) -> tuple[uuid.UUID, uuid.UUID]:
    """建一对 daemon_instance + 绑定它的 runtime，返回 (instance_id, runtime_id)。"""
    instance_id = uuid.uuid4()
    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonInstance(
            id=instance_id,
            user_id=user_id,
            hostname="host-a",
            server_url="ws://host-a",
            status="online",
        )
    )
    await db_session.flush()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=instance_id,
            user_id=user_id,
            name="zcode@host-a",
            provider="zcode",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return instance_id, runtime_id


async def _make_session(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    ws_id: uuid.UUID,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=ws_id,
        runtime_id=runtime_id,
        provider="zcode",
        status="active",
        turn_count=1,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    return sess


async def _make_bound_entry(db_session: AsyncSession, ws_id: uuid.UUID) -> AgentSessionLogORM:
    """建一个绑定 runtime 会话的 entry（daemon 定位走优先路径）。"""
    uid = uuid.uuid4()
    _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
    sess = await _make_session(db_session, uid, rt_id, ws_id)
    return await _make_entry(db_session, ws_id, agent_session_id=sess.id)


def _rpc_mock(result: dict[str, Any] | None = None, exc: Exception | None = None) -> AsyncMock:
    if exc is not None:
        return AsyncMock(side_effect=exc)
    return AsyncMock(return_value=result if result is not None else _PARSED_RESULT)


# ── 1. status 四值一律 200 分层 + 字段映射 ──────────────────────────────────


class TestStatusLayering:
    @pytest.mark.asyncio
    async def test_parsed_200_camelcase_to_snake_case(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """parsed → 200；外层 totalSegments/skippedLines 落 snake_case，messages
        内层逐字段原样（tool_use/tool_result 配对字段齐全）。"""
        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        with patch(_RPC, _rpc_mock(_PARSED_RESULT)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "parsed"
        assert body["truncated"] is True
        assert body["total_segments"] == 203  # totalSegments → total_segments
        assert body["skipped_lines"] == 2  # skippedLines → skipped_lines
        assert "totalSegments" not in body and "skippedLines" not in body
        assert len(body["messages"]) == 3
        assert body["messages"][0] == {
            "seq": 1,
            "kind": "user_input",
            "text": "帮我修个 bug",
            "tool_name": None,
            "tool_use_id": None,
            "tool_input": None,
            "tool_result": None,
            "is_error": None,
            "ts": "2026-08-23T10:00:00.000Z",
        }
        tool_use = body["messages"][1]
        assert tool_use["kind"] == "tool_use"
        assert tool_use["tool_name"] == "Bash"
        assert tool_use["tool_use_id"] == "toolu_01"
        assert tool_use["tool_input"] == '{"command": "ls"}'
        tool_result = body["messages"][2]
        assert tool_result["kind"] == "tool_result"
        assert tool_result["tool_use_id"] == "toolu_01"
        assert tool_result["is_error"] is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("daemon_status", "truncated"),
        [
            ("unsupported", False),
            ("parse_error", False),
            ("too_large", False),
        ],
    )
    async def test_non_parsed_status_still_200(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
        daemon_status: str,
        truncated: bool,
    ) -> None:
        """unsupported/parse_error/too_large 同样 200 透传（不映射 4xx），
        前端判断回落原文端点（design §7.2 / D-003@v1）。"""
        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        result = {
            "status": daemon_status,
            "messages": [],
            "truncated": truncated,
            "totalSegments": 0,
            "skippedLines": 0,
        }
        with patch(_RPC, _rpc_mock(result)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body == {
            "status": daemon_status,
            "messages": [],
            "truncated": False,
            "total_segments": 0,
            "skipped_lines": 0,
        }

    @pytest.mark.asyncio
    async def test_rpc_method_and_args_shape(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """RPC 走新方法 read_agent_log_messages；args = {path, format}，
        format=None 时送空串（daemon 侧 typeof string 守卫 → 注册表查不到 →
        unsupported），不带 beforeSeq 键。"""
        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)
        # format 未上报（None）——文本放行，daemon 侧兜底。
        entry.format = None
        db_session.add(entry)
        await db_session.commit()

        rpc = _rpc_mock()
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 200, resp.text
        # send_host_fs_rpc(ws_hub, daemon_id, method, workspace_id, args)。
        assert rpc.await_args.args[2] == "read_agent_log_messages"
        assert rpc.await_args.args[3] == ws_id
        assert rpc.await_args.args[4] == {
            "path": entry.log_path,
            "format": "",
        }

    @pytest.mark.asyncio
    async def test_before_seq_passthrough_as_before_seq_camel(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """before_seq query (int) 透传 daemon 侧 beforeSeq（加载更早切片键）。"""
        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        rpc = _rpc_mock()
        with patch(_RPC, rpc):
            resp = await client.get(
                f"/api/agent-logs/{entry.id}/messages",
                headers=headers,
                params={"before_seq": 42},
            )

        assert resp.status_code == 200, resp.text
        assert rpc.await_args.args[4] == {
            "path": entry.log_path,
            "format": "zcode-model-io-jsonl",
            "beforeSeq": 42,
        }


# ── 2. format 黑名单（共享 helper 409）──────────────────────────────────────


class TestFormatBlacklist:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("fmt", ["cursor-sqlite-db", "zcode-model-io-zstd", "zstd"])
    async def test_binary_format_409_no_rpc(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
        fmt: str,
    ) -> None:
        """format 命中黑名单子串（sqlite/zstd）→ 409 中文（FR-04），不发起 RPC。"""
        ws_id, headers = shpsync_headers
        entry = await _make_entry(db_session, ws_id, fmt=fmt)

        rpc = _rpc_mock()
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_AGENT_LOG_BINARY_FORMAT"
        assert "二进制" in body["message"]
        rpc.assert_not_awaited()


# ── 3. scope：不存在 / 跨 workspace → 404（共享 helper）─────────────────────


class TestScopeVisibility:
    @pytest.mark.asyncio
    async def test_entry_not_found_404(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """未知 entry_id → 404 中文（不泄漏存在性）。"""
        _ws_id, headers = shpsync_headers
        resp = await client.get(f"/api/agent-logs/{uuid.uuid4()}/messages", headers=headers)
        assert resp.status_code == 404, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_404_AGENT_LOG_ENTRY_NOT_FOUND"
        assert "不存在" in body["message"]

    @pytest.mark.asyncio
    async def test_cross_workspace_entry_404(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """entry 属其它 workspace（token 绑定 ws 之外）→ 404（不泄漏存在性）。"""
        _ws_id, headers = shpsync_headers
        other_ws = uuid.uuid4()
        entry = await _make_entry(db_session, other_ws)

        resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)
        assert resp.status_code == 404, resp.text


# ── 4. 无绑定 daemon → 404（共享 helper）───────────────────────────────────


class TestDaemonResolution:
    @pytest.mark.asyncio
    async def test_no_daemon_binding_404_no_rpc(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """会话无 runtime 且 workspace 无 binding → 404 中文，不发起 RPC。"""
        ws_id, headers = shpsync_headers
        entry = await _make_entry(db_session, ws_id)

        rpc = _rpc_mock()
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 404, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_404_AGENT_LOG_NO_BOUND_DAEMON"
        assert "未找到可读取该日志的机器" in body["message"]
        rpc.assert_not_awaited()


# ── 5. RPC 错误映射：唯一 422 + throw 通道复用（共享 helper）────────────────


class TestDaemonErrorMapping:
    @pytest.mark.asyncio
    async def test_method_not_found_422_only_unsupported_code(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """老 daemon 未注册方法（ws-client _dispatchRpc 回 code='method_not_found'）
        → 422 HTTP_422_AGENT_LOG_UNSUPPORTED 中文（唯一 422 场景）。"""
        from app.modules.daemon.runtime.service import DaemonRpcRemoteError

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError(
            {
                "code": "method_not_found",
                "message": "unknown rpc method: host_fs.read_agent_log_messages",
            }
        )
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_422_AGENT_LOG_UNSUPPORTED"
        assert "守护进程版本过旧" in body["message"]

    @pytest.mark.asyncio
    async def test_forbidden_409_with_allowed_roots_hint(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """daemon 拒 forbidden（allowed_roots 白名单外）→ 409 中文含配置指引。"""
        from app.modules.daemon.runtime.service import DaemonRpcRemoteError

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "forbidden", "message": "path outside roots"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_AGENT_LOG_READ_FORBIDDEN"
        assert "allowed_roots" in body["message"]

    @pytest.mark.asyncio
    async def test_remote_not_found_404_chinese(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """daemon 回 not_found（文件被轮换清理）→ 404 中文（复用既有 code）。"""
        from app.modules.daemon.runtime.service import DaemonRpcRemoteError

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "not_found", "message": "ENOENT"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 404, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_404_AGENT_LOG_FILE_NOT_FOUND"
        assert "不存在" in body["message"]

    @pytest.mark.asyncio
    async def test_remote_other_error_502(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """daemon 回其它业务错（如 internal）→ 既有 502 网关语义，不 500。"""
        from app.modules.daemon.runtime.service import DaemonRpcRemoteError

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "internal", "message": "boom"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 502, resp.text
        assert resp.json()["code"] == "HTTP_502_DAEMON_RPC_REMOTE"

    @pytest.mark.asyncio
    async def test_daemon_offline_504_existing(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """机器离线 → 既有 ``DaemonRuntimeOffline`` 原样透传（HTTP_504）。"""
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        exc = DaemonRuntimeOffline("daemon offline", details={"daemon_id": str(uuid.uuid4())})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"

    @pytest.mark.asyncio
    async def test_rpc_timeout_504_existing(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """RPC 超时 → 既有 ``DaemonRpcTimeout``（HTTP_504）透传。"""
        from app.modules.daemon.runtime.service import DaemonRpcTimeout

        ws_id, headers = shpsync_headers
        entry = await _make_bound_entry(db_session, ws_id)

        with patch(_RPC, _rpc_mock(exc=DaemonRpcTimeout("rpc timeout"))):
            resp = await client.get(f"/api/agent-logs/{entry.id}/messages", headers=headers)

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_TIMEOUT"


# ── 6. openapi 暴露（供 task-04 pnpm gen:types 消费）───────────────────────


class TestOpenapiExposure:
    @pytest.mark.asyncio
    async def test_openapi_exposes_messages_schemas(self) -> None:
        """openapi 自动暴露 AgentLogMessagesResponse / AgentLogMessageItem。"""
        from app.main import app

        schemas = app.openapi()["components"]["schemas"]
        assert "AgentLogMessagesResponse" in schemas
        assert "AgentLogMessageItem" in schemas
        props = schemas["AgentLogMessagesResponse"]["properties"]
        assert set(props) == {"status", "messages", "truncated", "total_segments", "skipped_lines"}
        item_props = schemas["AgentLogMessageItem"]["properties"]
        assert set(item_props) == {
            "seq",
            "kind",
            "text",
            "tool_name",
            "tool_use_id",
            "tool_input",
            "tool_result",
            "is_error",
            "ts",
        }
