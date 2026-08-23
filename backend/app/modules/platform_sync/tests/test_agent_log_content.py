"""GET /api/agent-logs/{entry_id}/content 内容端点测试（task-05 / design §3.3.5）。

覆盖：

- 200 成功 + 尾部 262144 字节截断断言（ASCII 精确长度 / 多字节字符被切
  ``errors="ignore"`` 吞掉）+ 小文件不截断 + size_bytes=截断前总字节数。
- format 黑名单（sqlite/zstd 子串）→ 409 中文「二进制暂不支持在线查看」；
  文本类（*-jsonl / None）放行。
- scope：entry 不存在/跨 workspace → 404 中文（不泄漏存在性）。
- daemon 定位：会话 runtime→daemon_instance_id 优先于 workspace binding；
  都无绑定 → 404 中文「未找到可读取该日志的机器」。
- daemon 错误映射：forbidden → 409 中文（含 allowed_roots 指引）；
  not_found → 404 中文；离线 → 既有 DaemonRuntimeOffline（504）；RPC 超时 →
  既有 DaemonRpcTimeout（504）。

RPC 层 mock：patch ``app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc``（端点
函数级 import，调用时解析 → patch 源模块生效）。夹具范式照
``test_agent_log_push.py``（shpsync_headers + client + db_session）。
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
# 模块级 import 在 collection 期先于 db_engine 的 create_all 执行）。
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

_RPC = "app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc"


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _make_entry(
    db_session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    fmt: str | None = "claude-code-transcript-jsonl",
    agent_session_id: uuid.UUID | None = None,
    log_path: str = "C:/Users/x/.claude/projects/p/abc.jsonl",
) -> AgentSessionLogORM:
    row = AgentSessionLogORM(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        log_path=log_path,
        harness="claude-code",
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
            name="claude@host-a",
            provider="claude",
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
        provider="claude",
        status="active",
        turn_count=1,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    return sess


def _rpc_mock(result: dict[str, Any] | None = None, exc: Exception | None = None) -> AsyncMock:
    if exc is not None:
        return AsyncMock(side_effect=exc)
    return AsyncMock(return_value=result if result is not None else {"content": ""})


# ── 1. 200 成功 + 截断 ──────────────────────────────────────────────────────


class TestContentSuccess:
    @pytest.mark.asyncio
    async def test_small_file_not_truncated(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """小文件 200 原样返回：truncated=False、size_bytes=总字节数。"""
        ws_id, headers = shpsync_headers
        # 建一个绑定 runtime 的会话（daemon 定位优先路径）。
        uid = uuid.uuid4()
        _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        entry = await _make_entry(db_session, ws_id, agent_session_id=sess.id)

        with patch(_RPC, _rpc_mock({"content": "hello log line"})):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body == {"content": "hello log line", "truncated": False, "size_bytes": 14}

    @pytest.mark.asyncio
    async def test_large_file_tail_truncated(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """超 262144 字节取尾部：truncated=True、size_bytes=截断前总字节数、
        content 为尾部 262144 字节（ASCII 精确断言）。"""
        ws_id, headers = shpsync_headers
        uid = uuid.uuid4()
        _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        entry = await _make_entry(db_session, ws_id, agent_session_id=sess.id)

        big = "x" * 300_000 + "tail-end"
        with patch(_RPC, _rpc_mock({"content": big})):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["truncated"] is True
        assert body["size_bytes"] == len(big.encode("utf-8"))  # 300008
        assert body["content"] == big[-262144:]
        assert body["content"].endswith("tail-end")

    @pytest.mark.asyncio
    async def test_multibyte_cut_dropped_via_errors_ignore(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """尾部截断切中多字节字符：errors=ignore 丢弃残缺字节，不崩不乱补。"""
        ws_id, headers = shpsync_headers
        uid = uuid.uuid4()
        _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        entry = await _make_entry(db_session, ws_id, agent_session_id=sess.id)

        cjk = "汉" * 100_000  # 300000 字节（每字 3 字节）
        with patch(_RPC, _rpc_mock({"content": cjk})):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["truncated"] is True
        assert body["size_bytes"] == 300_000
        # 300000 - 262144 = 37856；37856 % 3 == 2 → 尾部切片开头是 1 字节残缺
        # 字符 → ignore 丢弃，余 262143 字节 = 87381 个整字符。
        assert len(body["content"]) == 87_381
        assert set(body["content"]) == {"汉"}


# ── 2. format 黑名单（409）与文本类放行 ─────────────────────────────────────


class TestFormatBlacklist:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("fmt", ["sqlite3-db", "claude-code-transcript-zstd", "zstd"])
    async def test_binary_format_409_chinese(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
        fmt: str,
    ) -> None:
        """format 命中黑名单子串（sqlite/zstd）→ 409 中文，不发起 RPC。"""
        ws_id, headers = shpsync_headers
        entry = await _make_entry(db_session, ws_id, fmt=fmt)

        rpc = _rpc_mock({"content": "should-not-be-called"})
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_AGENT_LOG_BINARY_FORMAT"
        assert "二进制" in body["message"]
        rpc.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_text_format_none_passes(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """format=None（未上报）放行（读取侧兜底），jsonl 文本类放行。"""
        ws_id, headers = shpsync_headers
        uid = uuid.uuid4()
        _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        entry_none = await _make_entry(db_session, ws_id, fmt=None, agent_session_id=sess.id)
        entry_jsonl = await _make_entry(
            db_session,
            ws_id,
            fmt="opencode-session-json-tree",
            agent_session_id=sess.id,
            log_path="C:/other/tree.json",
        )

        with patch(_RPC, _rpc_mock({"content": "text"})):
            r1 = await client.get(f"/api/agent-logs/{entry_none.id}/content", headers=headers)
            r2 = await client.get(f"/api/agent-logs/{entry_jsonl.id}/content", headers=headers)
        assert r1.status_code == 200
        assert r2.status_code == 200


# ── 3. scope：不存在 / 跨 workspace → 404 ──────────────────────────────────


class TestScopeVisibility:
    @pytest.mark.asyncio
    async def test_entry_not_found_404(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """未知 entry_id → 404 中文（不泄漏存在性）。"""
        _ws_id, headers = shpsync_headers
        resp = await client.get(f"/api/agent-logs/{uuid.uuid4()}/content", headers=headers)
        assert resp.status_code == 404, resp.text
        assert "不存在" in resp.json()["message"]

    @pytest.mark.asyncio
    async def test_cross_workspace_entry_404(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """entry 属其它 workspace（shpsync_ token 绑定 ws 之外）→ 404。"""
        _ws_id, headers = shpsync_headers
        other_ws = uuid.uuid4()
        entry = await _make_entry(db_session, other_ws)

        resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)
        assert resp.status_code == 404, resp.text


# ── 4. daemon 定位：优先级与无绑定 ─────────────────────────────────────────


class TestDaemonResolution:
    @pytest.mark.asyncio
    async def test_session_runtime_preferred_over_workspace_binding(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """会话 runtime→daemon_instance_id 优先；workspace binding 只作回落。"""
        ws_id, headers = shpsync_headers
        uid = uuid.uuid4()
        session_instance_id, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        entry = await _make_entry(db_session, ws_id, agent_session_id=sess.id)
        # 干扰项：workspace member binding 指向另一台 daemon（不应被选中）。
        other_instance = uuid.uuid4()
        db_session.add(
            DaemonInstance(
                id=other_instance,
                user_id=uid,
                hostname="host-b",
                server_url="ws://host-b",
                status="online",
            )
        )
        await db_session.flush()
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws_id,
                user_id=uid,
                daemon_id=other_instance,
                root_path="/host/b/source",
                path_source="daemon-client",
            )
        )
        await db_session.commit()

        rpc = _rpc_mock({"content": "hi"})
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 200, resp.text
        # send_host_fs_rpc(ws_hub, daemon_id, method, workspace_id, args)：
        # daemon_id 位置参数 = 会话 runtime 绑定的 instance，不是 binding 的。
        assert rpc.await_args.args[1] == session_instance_id

    @pytest.mark.asyncio
    async def test_workspace_binding_fallback_when_session_pending(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """会话未激活（无 runtime 绑定）→ 回落 workspace binding 定位。"""
        ws_id, headers = shpsync_headers
        uid = uuid.uuid4()
        # tool_report 会话 pending：agent_session 关联存在但 runtime_id 为 NULL。
        pending_sess = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            workspace_id=ws_id,
            provider="claude",
            status="pending",
            origin="tool_report",
            turn_count=0,
            created_at=datetime.now(UTC),
            last_active_at=datetime.now(UTC),
        )
        db_session.add(pending_sess)
        await db_session.flush()
        entry = await _make_entry(db_session, ws_id, agent_session_id=pending_sess.id)

        binding_instance = uuid.uuid4()
        db_session.add(
            DaemonInstance(
                id=binding_instance,
                user_id=uid,
                hostname="host-c",
                server_url="ws://host-c",
                status="online",
            )
        )
        await db_session.flush()
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws_id,
                user_id=uid,
                daemon_id=binding_instance,
                root_path="/host/c/source",
                path_source="daemon-client",
            )
        )
        await db_session.commit()

        rpc = _rpc_mock({"content": "fallback"})
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 200, resp.text
        assert rpc.await_args.args[1] == binding_instance

    @pytest.mark.asyncio
    async def test_no_daemon_binding_404_chinese(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """会话无 runtime 且 workspace 无 binding → 404 中文（不发起 RPC）。"""
        ws_id, headers = shpsync_headers
        entry = await _make_entry(db_session, ws_id)

        rpc = _rpc_mock({"content": "x"})
        with patch(_RPC, rpc):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 404, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_404_AGENT_LOG_NO_BOUND_DAEMON"
        assert "未找到可读取该日志的机器" in body["message"]
        rpc.assert_not_awaited()


# ── 5. daemon 错误四类映射（forbidden/not_found/offline/timeout）───────────


class TestDaemonErrorMapping:
    async def _setup_bound_entry(
        self, db_session: AsyncSession, ws_id: uuid.UUID
    ) -> AgentSessionLogORM:
        uid = uuid.uuid4()
        _inst, rt_id = await _make_instance_and_runtime(db_session, uid)
        sess = await _make_session(db_session, uid, rt_id, ws_id)
        return await _make_entry(db_session, ws_id, agent_session_id=sess.id)

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
        entry = await self._setup_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "forbidden", "message": "path outside roots"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

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
        """daemon 回 not_found（文件不存在/被清理）→ 404 中文。"""
        from app.modules.daemon.runtime.service import DaemonRpcRemoteError

        ws_id, headers = shpsync_headers
        entry = await self._setup_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "not_found", "message": "ENOENT"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 404, resp.text
        assert "不存在" in resp.json()["message"]

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
        entry = await self._setup_bound_entry(db_session, ws_id)

        exc = DaemonRpcRemoteError({"code": "internal", "message": "boom"})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

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
        entry = await self._setup_bound_entry(db_session, ws_id)

        exc = DaemonRuntimeOffline("daemon offline", details={"daemon_id": str(uuid.uuid4())})
        with patch(_RPC, _rpc_mock(exc=exc)):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"

    @pytest.mark.asyncio
    async def test_rpc_timeout_504_existing(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """RPC 超时 → 既有 ``DaemonRpcTimeout``（HTTP_504），不降级为空串。"""
        from app.modules.daemon.runtime.service import DaemonRpcTimeout

        ws_id, headers = shpsync_headers
        entry = await self._setup_bound_entry(db_session, ws_id)

        with patch(_RPC, _rpc_mock(exc=DaemonRpcTimeout("rpc timeout"))):
            resp = await client.get(f"/api/agent-logs/{entry.id}/content", headers=headers)

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RPC_TIMEOUT"
