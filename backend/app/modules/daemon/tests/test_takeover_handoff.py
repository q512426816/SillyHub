"""takeover handoff 档测试（2026-09-30-tool-report-activation-wrong-machine
task-05 / FR-04 / D-004@v1 / D-005@v2；2026-10-04-handoff-doc-kind-contract
改用真实 NormalizedLogMessage 契约形态——kind 五值 / tool_input JSON 字符串）。

覆盖：

- ``build_handoff_prompt`` 纯函数：模板节（元信息/涉及文件去重/最近操作尾部 8
  条/最近对话 user_input 全文 + reply 截断）、system_event 跳过、thinking 跳过、
  tool_result 失败标记回贴配对 tool_use、tool_input 截断坏 JSON 的 regex 兜底、
  体积帽 + 截断声明行、字段缺失降级省略、末尾拼用户首条消息；
- handoff 端到端：RPC 成功（mocked hub send_rpc 回 parsed messages）→
  handoff_doc=True 且首 prompt 含交接文档（AgentRunLog user_input 断言，含
  工作目录 entry 级 agent_cwd 回退）；RPC 失败（send_rpc 抛错/非 parsed）→
  handoff_doc=False 降级普通新会话；
- 引擎重选（D-005@v2）：显式 provider ∉ 原机支持集合 → 422；合法重选 →
  新会话 provider 落所选值（原机集合含多 provider 行）。

独立于 test_takeover.py（task-05 卡避免与 task-06 同 Wave 测试文件相交）。
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.session.service.takeover import (
    build_handoff_prompt,
)

from .test_session_fork import _admin_user_id
from .test_session_switch_config import _create_runtime
from .test_takeover import _seed_tool_report_session, _takeover

_WS_HUB_GETTER = "app.modules.daemon.ws_hub.get_daemon_ws_hub"
_REDIS_GETTER = "app.modules.daemon.session.service.get_redis"

HOSTNAME = "DESKTOP-HJ0AM09"


@pytest.fixture()
def mocked_hub():
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    hub.send_rpc = AsyncMock(return_value=None)
    with patch(_WS_HUB_GETTER, return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch(_REDIS_GETTER, return_value=redis):
        yield redis


def _msg(kind: str = "", *, text: str = "", tool_name: str = "", **extra) -> dict:
    """真实契约形态：kind 五值、tool_input 为 JSON 字符串摘要。"""
    return {"kind": kind, "text": text, "tool_name": tool_name, **extra}


# ════════════════════════════════════════════════════════════════════════════
# build_handoff_prompt 纯函数
# ════════════════════════════════════════════════════════════════════════════


class TestBuildHandoffPrompt:
    def test_sections_and_dedup(self) -> None:
        messages = [
            _msg("user_input", text="先扫描下 login 超时"),
            _msg("reply", text="好" * 800),  # 截断到 500
            _msg(
                "tool_use",
                tool_name="Read",
                tool_use_id="t1",
                tool_input=json.dumps({"file_path": "C:/a/login.py"}),
            ),
            _msg(
                "tool_use",
                tool_name="Edit",
                tool_use_id="t2",
                tool_input=json.dumps({"path": "C:/a/login.py"}),
            ),
            _msg("tool_result", tool_name="Edit", tool_use_id="t2", is_error=True),
            _msg(
                "tool_use",
                tool_name="Bash",
                tool_use_id="t3",
                tool_input=json.dumps({"command": "ls"}),
            ),
            # 系统注入伪用户消息与 thinking 噪声：均不进最近对话。
            _msg("user_input", text="[BACKGROUND] task done", sender="system_event"),
            _msg("thinking", text="让我想想方案"),
            _msg("user_input", text="改成 30 秒超时"),
        ]
        doc = build_handoff_prompt(
            harness="zcode",
            cwd="C:/proj",
            messages=messages,
            user_prompt="继续修",
        )
        assert doc.startswith("【上下文交接文档】")
        assert "本地 harness：zcode" in doc
        assert "工作目录：C:/proj" in doc
        # 涉及文件去重保序（JSON 字符串 tool_input 可提取）。
        assert doc.count("C:/a/login.py") >= 1
        files_section = doc.split("涉及文件")[1].split("最近操作")[0]
        assert files_section.count("C:/a/login.py") == 1
        # user_input 全文 + reply 截断；system_event / thinking 不出现。
        assert "用户：先扫描下 login 超时" in doc
        assert "用户：改成 30 秒超时" in doc
        assert "助手：" + "好" * 500 in doc and "好" * 501 not in doc
        assert "[BACKGROUND]" not in doc
        assert "让我想想方案" not in doc
        # 最近操作：tool_use 计数 + tool_result 失败标记回贴配对行。
        assert "- Read" in doc and "- Bash" in doc
        assert "- Edit（失败）" in doc
        # 末尾拼用户消息。
        assert doc.endswith("用户：继续修")

    def test_truncated_tool_input_regex_fallback(self) -> None:
        """tool_input 2KB 截断的坏 JSON（daemon 摘要口径）→ regex 兜底仍可提取
        path 类字段；含 JSON 转义的 Windows 路径正确反转义。"""
        truncated_unix = '{"file_path":"C:/a/login.py","old_string":"lorem ipsum '
        truncated_win = '{"path":"C:\\\\worktrees\\\\copy-1","new_string":"xxx '
        doc = build_handoff_prompt(
            harness="zcode",
            cwd="C:/proj",
            messages=[
                _msg("tool_use", tool_name="Edit", tool_input=truncated_unix),
                _msg("tool_use", tool_name="Edit", tool_input=truncated_win),
            ],
            user_prompt="go",
        )
        assert "C:/a/login.py" in doc
        assert "C:\\worktrees\\copy-1" in doc

    def test_missing_fields_degrade(self) -> None:
        """无 tool 段 / 空消息 → 省略对应节不报错。"""
        doc = build_handoff_prompt(
            harness="zcode",
            cwd="",
            messages=[_msg("user_input", text="hi")],
            user_prompt="go",
        )
        assert "涉及文件" not in doc
        assert "最近操作" not in doc
        assert "最近对话" in doc
        assert "工作目录：unknown" in doc

    def test_max_chars_cap_and_note(self) -> None:
        messages = [_msg("user_input", text="x" * 500) for _ in range(100)]
        doc = build_handoff_prompt(
            harness="zcode",
            cwd="C:/p",
            messages=messages,
            user_prompt="go",
            max_chars=2000,
        )
        assert len(doc) <= 2000 + len("go") + 20
        assert "已截断" in doc


# ════════════════════════════════════════════════════════════════════════════
# handoff 端到端（RPC 成功 / 降级） + 引擎重选
# ════════════════════════════════════════════════════════════════════════════


class TestHandoffEndToEnd:
    @pytest.mark.asyncio
    async def test_handoff_doc_injected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """RPC parsed → handoff_doc=True，首 prompt=交接文档+用户消息。

        会话行 cwd 置空（真实建桶形态）→ 交接文档工作目录回退 entry 级
        agent_cwd（2026-10-04-handoff-doc-kind-contract）。"""
        owner_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, owner_id, provider="claude", name=HOSTNAME)
        rt.allowed_roots = ["C:/Users/qinyi"]
        rt.daemon_instance_id = uuid.uuid4()
        db_session.add(rt)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session,
            harness="zcode",
            provider="claude",
            reported_machine_name=HOSTNAME,
            session_cwd="",
        )
        source_id = source.id

        mocked_hub.send_rpc.return_value = {
            "status": "parsed",
            "messages": [
                _msg("user_input", text="本地任务：修 login 超时"),
                _msg(
                    "tool_use",
                    tool_name="Edit",
                    tool_use_id="t1",
                    tool_input=json.dumps({"file_path": "C:/a/login.py"}),
                ),
            ],
            "truncated": False,
        }

        resp = await _takeover(client, auth_headers, source_id, prompt="接着修")
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "handoff"
        assert body["handoff_doc"] is True

        db_session.expire_all()
        run = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.agent_session_id == uuid.UUID(body["session_id"])
                    )
                )
            )
            .scalars()
            .first()
        )
        assert run is not None
        user_input = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert user_input is not None
        assert "【上下文交接文档】" in user_input.content_redacted
        assert "本地任务：修 login 超时" in user_input.content_redacted
        # 工作目录回退 entry 级 agent_cwd（fixture 默认 cwd 值）。
        assert (
            "工作目录：C:/Users/qinyi/IdeaProjects/multi-agent-platform"
            in user_input.content_redacted
        )
        assert user_input.content_redacted.endswith("用户：接着修")

    @pytest.mark.asyncio
    async def test_rpc_failure_degrades(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """RPC 抛错 → handoff_doc=False 降级普通新会话（不阻塞接手）。"""
        owner_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, owner_id, provider="claude", name=HOSTNAME)
        rt.allowed_roots = ["C:/Users/qinyi"]
        rt.daemon_instance_id = uuid.uuid4()
        db_session.add(rt)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session, harness="zcode", provider="claude", reported_machine_name=HOSTNAME
        )
        mocked_hub.send_rpc.side_effect = RuntimeError("daemon offline race")

        resp = await _takeover(client, auth_headers, source.id, prompt="接着修")
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "handoff"
        assert body["handoff_doc"] is False

    @pytest.mark.asyncio
    async def test_provider_reselect_422_and_ok(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """重选不在原机集合 → 422；合法重选（原机多 provider 行）→ 新会话落所选。"""
        owner_id = await _admin_user_id(db_session)
        daemon_id = uuid.uuid4()
        claude_rt = await _create_runtime(db_session, owner_id, provider="claude", name=HOSTNAME)
        claude_rt.allowed_roots = ["C:/Users/qinyi"]
        claude_rt.daemon_instance_id = daemon_id
        db_session.add(claude_rt)
        codex_rt = await _create_runtime(db_session, owner_id, provider="codex", name=HOSTNAME)
        codex_rt.allowed_roots = ["C:/Users/qinyi"]
        codex_rt.daemon_instance_id = daemon_id
        db_session.add(codex_rt)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session, harness="zcode", provider="claude", reported_machine_name=HOSTNAME
        )
        source_id = source.id

        # 2026-09-30-takeover-handoff-any-location：白名单外引擎（openclaw
        # 不可会话）→ 422 独立文案（对齐新建会话 SESSION_SUPPORTED 口径）。
        resp = await _takeover(client, auth_headers, source_id, prompt="hi", provider="openclaw")
        assert resp.status_code == 422, resp.text
        assert "不支持会话" in resp.json()["message"]

        # 非法重选：原机无 pi。
        resp = await _takeover(client, auth_headers, source_id, prompt="hi", provider="pi")
        assert resp.status_code == 422, resp.text
        assert "不在原机支持的可会话引擎集合" in resp.json()["message"]

        # 合法重选：codex（同机另一 provider 行）。
        mocked_hub.send_rpc.return_value = {"status": "parsed", "messages": [], "truncated": False}
        resp = await _takeover(client, auth_headers, source_id, prompt="hi", provider="codex")
        assert resp.status_code == 201, resp.text
        body = resp.json()
        db_session.expire_all()
        new_session = await db_session.get(AgentSession, uuid.UUID(body["session_id"]))
        assert new_session is not None
        assert new_session.provider == "codex"
        assert new_session.fork_of_session_id == source_id
