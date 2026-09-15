"""Tests for POST /api/daemon/sessions/export（2026-09-14-session-export task-04）.

覆盖（蓝图卡 implementation 逐项）：

- chat 单会话 md 内容断言（会话头 / 用户消息 / 助手正文前缀剥离 / 群聊
  member_name 前缀 / 附件标记行保留 / 非 chat 渠道行不出现）；
- stdout 噪声排除表驱动——样例逐条搬前端判定用例（R-08 防漂移）：
  ``session-log-assembler.test.ts``（classifySessionLog 直测段）+
  ``session-log-sanitize.test.ts`` / ``task-line-assembler.test.ts``
  （classifySessionLog 的 [TOOL_*]/[SYSTEM]/[TASK_*] 判定段），幸存正文
  反例 ≥2；
- 多会话 chat zip / full 单/多 zip 结构（zipfile 解包 + RFC5987 文件名）；
- 权限 404 三场景（跨用户 / 已软删 / 群非成员）不 mock 权限检查走真实
  HTTP，群参与者正例 + 混合批次整包 404；
- 附件正常打包 bytes 一致 / 对象读取失败 missing=true 降级整包继续；
- 413 附件元数据 bytes 预聚合超限；截断 monkeypatch EXPORT_LOG_ROW_LIMIT
  保最早 + truncated/dropped_rows + 文件尾标注；
- 路由顺序双证（路由表字面量前置 + 真实 POST 不被 {session_id} 吞）；
- 422（0 个 / 51 个 ids、非法 tier）。

权限 404 用例不 mock 权限检查；zip 断言一律走标准库 zipfile 解包。
"""

from __future__ import annotations

import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from io import BytesIO
from urllib.parse import unquote

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import AgentSessionTask, DaemonInstance, DaemonRuntime
from app.modules.daemon.session.service import export as export_service
from app.modules.daemon.session.service.export import _assistant_text_from_stdout
from app.modules.session_attachment.model import SessionAttachment
from app.modules.session_attachment.storage import SessionAttachmentStorage
from app.modules.workspace.model import Workspace

EXPORT_URL = "/api/daemon/sessions/export"

# 前端 session-log-assembler.test.ts:1032 的 SKILL_BODY 原样搬（R-08 防漂移）。
SKILL_BODY = (
    "Base directory for this skill: C:\\repo\\.claude\\skills\\sillyspec-execute\n\n"
    '## 何时使用\n\n- 用户说"开始写代码、执行任务、跑 execute、开干"'
)


# ── 造数据 helpers（Bearer / 造法照 test_runtimes_usage_endpoint.py 的
#    _seed_admin + create_access_token 先例；ORM 直插照 test_group_logs_
#    pagination.py 的 _seed_chat_session_with_logs）────────────────────────


async def _create_user(
    db_session: AsyncSession, *, name: str, admin: bool = False
) -> tuple[User, str]:
    """建用户行 + 手签 Bearer（platform admin 自动短路端点 TASK_RUN_AGENT 闸门）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"sexp-{name}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("x"),
        display_name=name,
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email or "",
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _grant_task_run_agent(
    db_session: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """给普通用户发 task:run_agent（端点闸门），照 test_group_attachments 的
    _grant_workspace_role 形态。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"sexp-{uuid.uuid4().hex[:8]}",
        name="sexp-test-role",
        description="session export seed",
        is_system=False,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.TASK_RUN_AGENT))
    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _seed_runtime(db_session: AsyncSession, owner_id: uuid.UUID) -> DaemonRuntime:
    """在线机器行（会话头「运行时」行 + runtime_id FK 用）。"""
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="sexp-host",
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=owner_id,
        name="sexp-host",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)
    await db_session.commit()
    return runtime


async def _seed_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str | None,
    runtime_id: uuid.UUID | None = None,
    session_kind: str = "chat",
    workspace_id: uuid.UUID | None = None,
    deleted_at: datetime | None = None,
    turn_count: int = 0,
    config_snapshot: dict | None = None,
) -> AgentSession:
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        provider="claude",
        status="ended",
        title=title,
        session_kind=session_kind,
        workspace_id=workspace_id,
        deleted_at=deleted_at,
        turn_count=turn_count,
        config_snapshot=config_snapshot,
        created_at=datetime(2026, 9, 1, 8, 0, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 9, 1, 8, 5, 0, tzinfo=UTC),
        ended_at=datetime(2026, 9, 1, 8, 5, 0, tzinfo=UTC),
    )
    db_session.add(sess)
    await db_session.commit()
    return sess


async def _seed_run(
    db_session: AsyncSession,
    session_id: uuid.UUID,
    *,
    started_at: datetime,
    model: str | None = "claude-sonnet-4",
    status: str = "completed",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model=model,
        status=status,
        agent_session_id=session_id,
        started_at=started_at,
        finished_at=started_at + timedelta(minutes=1),
        input_tokens=100,
        output_tokens=200,
        diff_summary="M 1 file",
    )
    db_session.add(run)
    await db_session.commit()
    return run


async def _seed_log(
    db_session: AsyncSession,
    run_id: uuid.UUID,
    *,
    channel: str,
    content: str,
    ts: datetime,
    metadata: dict | None = None,
    tool_kind: str | None = None,
    parent_tool_use_id: str | None = None,
    subagent_type: str | None = None,
    depth: int | None = None,
    edit_patch: str | None = None,
) -> AgentRunLog:
    row = AgentRunLog(
        id=uuid.uuid4(),
        run_id=run_id,
        timestamp=ts,
        channel=channel,
        content_redacted=content,
        metadata_=metadata,
        tool_kind=tool_kind,
        parent_tool_use_id=parent_tool_use_id,
        subagent_type=subagent_type,
        depth=depth,
        edit_patch=edit_patch,
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _seed_task(
    db_session: AsyncSession,
    *,
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    task_name: str,
    status: str = "completed",
    summary: str | None = "全部通过",
) -> AgentSessionTask:
    task = AgentSessionTask(
        id=uuid.uuid4(),
        session_id=session_id,
        run_id=run_id,
        task_id=f"bg-{uuid.uuid4().hex[:6]}",
        task_name=task_name,
        status=status,
        summary=summary,
        started_at=datetime(2026, 9, 1, 8, 1, 0, tzinfo=UTC),
        updated_at=datetime(2026, 9, 1, 8, 2, 0, tzinfo=UTC),
    )
    db_session.add(task)
    await db_session.commit()
    return task


async def _seed_attachment(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    name: str,
    kind: str = "image",
    media_type: str = "image/png",
    size_bytes: int = 8,
    object_key: str | None = None,
) -> SessionAttachment:
    att = SessionAttachment(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=session_id,
        kind=kind,
        media_type=media_type,
        bytes=size_bytes,
        name=name,
        object_key=object_key or f"attachments/{user_id}/{uuid.uuid4().hex}.bin",
        sha256=uuid.uuid4().hex,
    )
    db_session.add(att)
    await db_session.commit()
    return att


async def _post_export(
    client: AsyncClient,
    token: str,
    session_ids: list[uuid.UUID],
    tier: str = "chat",
) -> httpx.Response:
    return await client.post(
        EXPORT_URL,
        json={"session_ids": [str(sid) for sid in session_ids], "tier": tier},
        headers={"Authorization": f"Bearer {token}"},
    )


def _zip_names(resp) -> list[str]:
    with zipfile.ZipFile(BytesIO(resp.content)) as archive:
        return archive.namelist()


def _zip_read(resp, name: str) -> bytes:
    with zipfile.ZipFile(BytesIO(resp.content)) as archive:
        return archive.read(name)


def _filename_star(resp) -> str:
    """解析 Content-Disposition 的 RFC5987 filename* 段（中文原名回读）。"""
    header = resp.headers["content-disposition"]
    assert "filename*=UTF-8''" in header, header
    encoded = header.split("filename*=UTF-8''", 1)[1]
    return unquote(encoded)


# ── 1. stdout 噪声排除表驱动（纯函数，R-08：样例搬前端判定用例）─────────────


class TestAssistantTextNoiseExclusion:
    """``_assistant_text_from_stdout`` 与前端 classifySessionLog 逐条同源。

    排除样例（期望 None）取自前端既有判定用例：AskUserQuestion /
    [TOOL_RESULT]（通用 + User answered 形态）/ [(SYSTEM|RESULT)…] 前缀 /
    [TOOL_USE] 文本行 / 合法 [TASK_*] 生命周期行 / 技能装载载荷行 /
    CLI 合成鉴权与网关错误行 / OVERRIDE 撤回令箭 / [THINKING] 前缀 / 空行；
    幸存样例（期望剥前缀后的正文）含裸文本与 [ASSISTANT] 正常答复反例。
    """

    # (输入行, 期望输出 None=排除 / str=剥前缀幸存正文, 样例来源)
    EXCLUDED_CASES = [
        # session-log-sanitize.test.ts:139（AskUserQuestion 卡片协议行，contains 判定）
        pytest.param('{"tool": "AskUserQuestion", "question": "..."}', id="ask-user-question"),
        # session-log-sanitize.test.ts:140（User answered 答复回显形态）
        pytest.param("[TOOL_RESULT] User answered: yes", id="tool-result-user-answered"),
        # session-log-sanitize.test.ts:137-138（[(SYSTEM|RESULT)…] 前缀技术标记）
        pytest.param("[SYSTEM:thinking_tokens] 48", id="system-prefix"),
        pytest.param("[RESULT:done] something", id="result-prefix"),
        # session-log-sanitize.test.ts:114/125（[TOOL_USE] 文本行，与 tool_call JSON 双发去重）
        pytest.param('[TOOL_USE] Read: {"file_path": "a.ts"}', id="tool-use-text"),
        pytest.param("[TOOL_USE] Glob: x", id="tool-use-text-null-channel"),
        # session-log-sanitize.test.ts:118/126（[TOOL_RESULT] 通用行归 tool_result 段不进正文）
        pytest.param("[TOOL_RESULT] 文件内容如下", id="tool-result-general"),
        pytest.param("[TOOL_RESULT] done", id="tool-result-done"),
        # task-line-assembler.test.ts:107/135/123（合法 [TASK_*] 生命周期行）
        pytest.param('[TASK_STARTED] {"task_id":"bg-1","async":true}', id="task-started"),
        pytest.param('[TASK_PROGRESS] {"elapsed_ms":42}', id="task-progress"),
        pytest.param(
            '[TASK_NOTIFICATION] {"status":"completed","elapsed_ms":45000,"summary":"全部通过"}',
            id="task-notification-completed",
        ),
        # session-log-sanitize.test.ts:98（[THINKING] 前缀：chat 档排除，属 full 档）
        pytest.param("[THINKING] 正在思考", id="thinking-prefix"),
        # session-log-assembler.test.ts:1054（技能装载载荷行，仅 [ASSISTANT] 前缀形态）
        pytest.param(f"[ASSISTANT] {SKILL_BODY}", id="skill-load-payload"),
        # session-log-assembler.test.ts:1161/1167（CLI 合成鉴权 / 模型网关错误行）
        pytest.param("[ASSISTANT] Not logged in · Please run /login", id="cli-auth-error"),
        pytest.param(
            "[ASSISTANT] API Error: Request rejected (429) · [1310][已达上限]",
            id="gateway-error",
        ),
        # session-log-assembler.test.ts:250/284（OVERRIDE 撤回令箭行）
        pytest.param("[ASSISTANT_OVERRIDE] main:msg_1:1", id="assistant-override"),
        pytest.param("[THINKING_OVERRIDE] main:msg_9:2", id="thinking-override"),
        # session-log-sanitize.test.ts:141-142（空行 / 纯空白）
        pytest.param("", id="empty"),
        pytest.param("   ", id="whitespace-only"),
    ]

    SURVIVOR_CASES = [
        # session-log-sanitize.test.ts:83/90/94（干净正文 / [ASSISTANT] / [LOG:xxx] 剥前缀）
        pytest.param("你好，现在几点了？", "你好，现在几点了？", id="clean-text"),
        pytest.param("[ASSISTANT] 你好", "你好", id="assistant-prefix-stripped"),
        pytest.param("[LOG:info] 消息", "消息", id="log-prefix-stripped"),
        # session-log-assembler.test.ts:1060/1204（[ASSISTANT] 正常答复反例）
        pytest.param("[ASSISTANT] 正常答复", "正常答复", id="normal-reply"),
        pytest.param(
            "[ASSISTANT] 已完成修改，共 3 个文件", "已完成修改，共 3 个文件", id="done-reply"
        ),
        # session-log-assembler.test.ts:1178（正文提及错误词的成功回复：行首锚定不误吞）
        pytest.param(
            "[ASSISTANT] 日志里出现了 API Error: 429，原因是限流，我加了重试",
            "日志里出现了 API Error: 429，原因是限流，我加了重试",
            id="mid-text-error-mention",
        ),
        # session-log-assembler.test.ts:1195/1198（裸文本错误词：前缀门控不误吞）
        pytest.param(
            "Not logged in · Please run /login",
            "Not logged in · Please run /login",
            id="bare-auth-error-survives",
        ),
        pytest.param(
            "我遇到了 API Error，建议排查", "我遇到了 API Error，建议排查", id="bare-gateway-word"
        ),
        # session-log-assembler.test.ts:1059（技能装载 SKILL_BODY 裸文本：无前缀不吞）
        pytest.param(SKILL_BODY, SKILL_BODY, id="bare-skill-body-survives"),
        # task-line-assembler.test.ts:281/298/302/308（坏 [TASK_*] 行降级普通文本保留）
        pytest.param(
            "[TASK_PROGRESS] not-json", "[TASK_PROGRESS] not-json", id="bad-task-progress"
        ),
        pytest.param(
            '[TASK_NOTIFICATION] {"status":"weird","elapsed_ms":1}',
            '[TASK_NOTIFICATION] {"status":"weird","elapsed_ms":1}',
            id="bad-task-notification-status",
        ),
        pytest.param("[TASK_STARTED] 启动了", "[TASK_STARTED] 启动了", id="task-started-non-json"),
        pytest.param("[TASK_STARTED] 42", "[TASK_STARTED] 42", id="task-started-scalar-json"),
    ]

    @pytest.mark.parametrize(("content",), EXCLUDED_CASES)
    def test_noise_line_excluded(self, content: str) -> None:
        assert _assistant_text_from_stdout(content) is None

    @pytest.mark.parametrize(("content", "expected"), SURVIVOR_CASES)
    def test_survivor_text_returned(self, content: str, expected: str) -> None:
        assert _assistant_text_from_stdout(content) == expected


# ── 2. chat 档 Markdown 内容断言 ─────────────────────────────────────────────


class TestChatMarkdown:
    async def _seed_two_turn_session(
        self, db_session: AsyncSession
    ) -> tuple[User, str, AgentSession, DaemonRuntime]:
        owner, token = await _create_user(db_session, name="owner", admin=True)
        runtime = await _seed_runtime(db_session, owner.id)
        sess = await _seed_session(
            db_session,
            user_id=owner.id,
            title="导出测试会话",
            runtime_id=runtime.id,
            turn_count=2,
        )
        base = datetime(2026, 9, 1, 8, 1, 0, tzinfo=UTC)
        # 第 1 轮：用户消息 + 幸存助手正文 + 各类不进 chat 档的渠道/噪声行。
        run1 = await _seed_run(db_session, sess.id, started_at=base)
        await _seed_log(
            db_session, run1.id, channel="user_input", content="你好，帮我看看报错", ts=base
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="stdout",
            content="[ASSISTANT] 已完成修改，共 3 个文件",
            ts=base + timedelta(seconds=10, milliseconds=250),
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="stderr",
            content="STDERR-NOISE",
            ts=base + timedelta(seconds=20),
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="tool_call",
            content='{"tool":"Read","args":{"file_path":"a.ts"},"tool_use_id":"tu_1"}',
            ts=base + timedelta(seconds=30),
            tool_kind="Read",
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="pending_input",
            content="PENDING-NOISE",
            ts=base + timedelta(seconds=40),
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="system",
            content="SYSTEM-NOISE",
            ts=base + timedelta(seconds=50),
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="stdout",
            content='[TOOL_USE] Read: {"file_path": "a.ts"}',
            ts=base + timedelta(seconds=60),
        )
        # 第 2 轮：群聊投影行（metadata_.member_name 发言者前缀）+ 附件标记行。
        run2 = await _seed_run(db_session, sess.id, started_at=base + timedelta(minutes=2))
        await _seed_log(
            db_session,
            run2.id,
            channel="user_input",
            content="[附件:截图.png|image] 这是报错截图",
            ts=base + timedelta(minutes=2, milliseconds=120),
            metadata={"member_name": "阿明"},
        )
        await _seed_log(
            db_session,
            run2.id,
            channel="stdout",
            content="[LOG:info] 已定位问题",
            ts=base + timedelta(minutes=2, seconds=10, milliseconds=780),
            metadata={"member_name": "小码"},
        )
        return owner, token, sess, runtime

    @pytest.mark.asyncio
    async def test_chat_single_session_md_content(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """单会话 chat 档：会话头 + 分轮正文 + 前缀剥离 + 群昵称 + 附件标记行。"""
        _, token, sess, runtime = await self._seed_two_turn_session(db_session)

        resp = await _post_export(client, token, [sess.id], tier="chat")

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/markdown")
        # RFC5987 中文下载文件名（FR-04）：单会话 .md 用会话名（sanitize 标题 +
        # id 前 8，design §响应矩阵；QA 验收发现的实现偏差已修正）。
        filename = _filename_star(resp)
        assert filename == f"导出测试会话_{str(sess.id)[:8]}.md"

        md = resp.content.decode("utf-8")
        # 会话头（标题 / 供应商 / 运行时 / 状态 / 创建时间 / 轮数）。
        lines = md.splitlines()
        assert lines[0] == "# 导出测试会话"
        assert "- 供应商：claude" in lines
        assert f"- 运行时：{runtime.id}" in lines
        assert "- 状态：ended" in lines
        assert any(line.startswith("- 创建时间：") for line in lines)
        assert "- 轮数：2" in lines
        # 分轮 + 用户消息 / 助手正文（[ASSISTANT] 前缀剥离）。
        assert "## 第 1 轮 · 2026-09-01 16:01" in md
        assert "**用户**：你好，帮我看看报错" in md
        assert "**助手**：已完成修改，共 3 个文件" in md
        # ql-20260915-003：每条消息北京时间毫秒时间点（UTC+8；造数带毫秒尾数）。
        assert "- 时区：北京时间（UTC+8，消息时间精确到毫秒）" in md
        assert "[16:01:00.000] **用户**：你好，帮我看看报错" in md
        assert "[16:01:10.250] **助手**：已完成修改，共 3 个文件" in md
        # 第 2 轮：群聊 member_name 发言者前缀 + 附件标记行原样保留。
        assert "## 第 2 轮 · 2026-09-01 16:03" in md
        assert "[16:03:00.120] **阿明**：[附件:截图.png|image] 这是报错截图" in md
        assert "[16:03:10.780] **小码**：已定位问题" in md
        assert "**阿明**：[附件:截图.png|image] 这是报错截图" in md
        assert "**小码**：已定位问题" in md  # [LOG:info] 前缀剥离
        # 非 chat 渠道行与 stdout 噪声行不出现。
        assert "STDERR-NOISE" not in md
        assert "PENDING-NOISE" not in md
        assert "SYSTEM-NOISE" not in md
        assert '"tool": "Read"' not in md
        assert "[TOOL_USE]" not in md

    @pytest.mark.asyncio
    async def test_chat_multi_session_returns_zip(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """多会话 chat 档：application/zip，每会话一个 {标题}_{id前8}.md。"""
        owner, token = await _create_user(db_session, name="multi", admin=True)
        sess1 = await _seed_session(db_session, user_id=owner.id, title="会话甲")
        sess2 = await _seed_session(db_session, user_id=owner.id, title="会话乙")
        run1 = await _seed_run(
            db_session, sess1.id, started_at=datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
        )
        await _seed_log(
            db_session,
            run1.id,
            channel="user_input",
            content="甲的问题",
            ts=datetime(2026, 9, 1, 8, 0, tzinfo=UTC),
        )
        run2 = await _seed_run(
            db_session, sess2.id, started_at=datetime(2026, 9, 1, 9, 0, tzinfo=UTC)
        )
        await _seed_log(
            db_session,
            run2.id,
            channel="user_input",
            content="乙的问题",
            ts=datetime(2026, 9, 1, 9, 0, tzinfo=UTC),
        )

        resp = await _post_export(client, token, [sess1.id, sess2.id], tier="chat")

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/zip"
        filename = _filename_star(resp)
        assert filename.startswith("会话导出_对话_") and filename.endswith(".zip")
        expected = {
            f"会话甲_{str(sess1.id)[:8]}.md",
            f"会话乙_{str(sess2.id)[:8]}.md",
        }
        assert set(_zip_names(resp)) == expected
        assert "甲的问题" in _zip_read(resp, f"会话甲_{str(sess1.id)[:8]}.md").decode("utf-8")
        assert "乙的问题" in _zip_read(resp, f"会话乙_{str(sess2.id)[:8]}.md").decode("utf-8")


# ── 3. full 档 zip 结构 ─────────────────────────────────────────────────────


class TestFullZip:
    async def _seed_full_session(
        self, db_session: AsyncSession, *, title: str, owner_id: uuid.UUID
    ) -> AgentSession:
        sess = await _seed_session(
            db_session,
            user_id=owner_id,
            title=title,
            turn_count=1,
            config_snapshot={"provider_name": "Anthropic"},
        )
        base = datetime(2026, 9, 1, 8, 1, 0, tzinfo=UTC)
        run = await _seed_run(db_session, sess.id, started_at=base)
        await _seed_log(
            db_session,
            run.id,
            channel="user_input",
            content="看下这个报错",
            ts=base,
        )
        await _seed_log(
            db_session,
            run.id,
            channel="stdout",
            content="[ASSISTANT] 已修复",
            ts=base + timedelta(seconds=5),
        )
        await _seed_log(
            db_session,
            run.id,
            channel="tool_call",
            content='{"tool":"Edit","tool_use_id":"tu_e"}',
            ts=base + timedelta(seconds=6),
            tool_kind="Edit",
            parent_tool_use_id="tu_sub",
            subagent_type="general-purpose",
            depth=2,
            edit_patch="@@ -1 +1 @@\n-a\n+b\n",
        )
        await _seed_task(db_session, session_id=sess.id, run_id=run.id, task_name="跑测试")
        return sess

    @pytest.mark.asyncio
    async def test_full_single_session_zip_structure(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """full 单会话：{标题}_{id前8}/full.json 顶层字段全 + logs 全字段。"""
        owner, token = await _create_user(db_session, name="fulladmin", admin=True)
        sess = await self._seed_full_session(db_session, title="完整导出", owner_id=owner.id)
        att = await _seed_attachment(
            db_session,
            user_id=sess.user_id,
            session_id=sess.id,
            name="截图.png",
        )

        # 对象读取失败（确定性降级）：不依赖真实 MinIO 可达性。
        async def _boom(self: SessionAttachmentStorage, object_key: str) -> bytes:
            raise RuntimeError("object lost in storage")

        monkeypatch.setattr(SessionAttachmentStorage, "read_bytes", _boom)

        resp = await _post_export(client, token, [sess.id], tier="full")

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/zip"
        filename = _filename_star(resp)
        assert filename.startswith("会话导出_完整信息_") and filename.endswith(".zip")
        base_dir = f"完整导出_{str(sess.id)[:8]}"
        names = _zip_names(resp)
        assert f"{base_dir}/full.json" in names
        # 读取失败 → missing 降级：不写附件本体条目（R-03 整包继续）。
        assert [n for n in names if "/attachments/" in n] == []

        full = json.loads(_zip_read(resp, f"{base_dir}/full.json"))
        # 顶层字段全（design §接口定义 full JSON 结构）。
        assert set(full) == {
            "export_version",
            "session",
            "runs",
            "logs",
            "tasks",
            "attachments",
            "truncated",
            "dropped_rows",
        }
        assert full["export_version"] == 1
        assert full["session"]["id"] == str(sess.id)
        assert full["session"]["title"] == "完整导出"
        assert full["session"]["config_snapshot"] == {"provider_name": "Anthropic"}
        assert full["truncated"] is False
        assert full["dropped_rows"] == 0
        # runs 元数据字段。
        assert full["runs"][0]["model"] == "claude-sonnet-4"
        assert full["runs"][0]["status"] == "completed"
        assert full["runs"][0]["input_tokens"] == 100
        assert full["runs"][0]["output_tokens"] == 200
        assert full["runs"][0]["diff_summary"] == "M 1 file"
        # logs 全字段（channel/content_redacted/tool_kind/parent_tool_use_id/
        # subagent_type/depth/edit_patch/metadata）。
        tool_log = next(row for row in full["logs"] if row["channel"] == "tool_call")
        assert set(tool_log) == {
            "id",
            "run_id",
            "timestamp",
            "channel",
            "content_redacted",
            "tool_kind",
            "parent_tool_use_id",
            "subagent_type",
            "depth",
            "edit_patch",
            "metadata",
        }
        assert tool_log["tool_kind"] == "Edit"
        assert tool_log["parent_tool_use_id"] == "tu_sub"
        assert tool_log["subagent_type"] == "general-purpose"
        assert tool_log["depth"] == 2
        assert tool_log["edit_patch"].startswith("@@ -1 +1 @@")
        # 任务卡快照。
        assert full["tasks"] == [
            {"task_name": "跑测试", "status": "completed", "summary": "全部通过"}
        ]
        # 附件清单字段与 missing 降级标记；zip_path 指向条目名约定。
        att_meta = full["attachments"][0]
        assert set(att_meta) == {
            "id",
            "name",
            "kind",
            "media_type",
            "bytes",
            "zip_path",
            "missing",
        }
        assert att_meta["id"] == str(att.id)
        assert att_meta["name"] == "截图.png"
        assert att_meta["missing"] is True
        assert att_meta["zip_path"] == f"{base_dir}/attachments/{att.id}_截图.png"

    @pytest.mark.asyncio
    async def test_full_multi_session_distinct_dirs(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """full 多会话：每会话一目录，同名标题靠 id 前 8 位防重名（R-05）。"""
        owner, token = await _create_user(db_session, name="multifull", admin=True)
        sess1 = await self._seed_full_session(db_session, title="同名会话", owner_id=owner.id)
        sess2 = await self._seed_full_session(db_session, title="同名会话", owner_id=owner.id)

        resp = await _post_export(client, token, [sess1.id, sess2.id], tier="full")

        assert resp.status_code == 200, resp.text
        names = set(_zip_names(resp))
        dir1 = f"同名会话_{str(sess1.id)[:8]}"
        dir2 = f"同名会话_{str(sess2.id)[:8]}"
        assert dir1 != dir2
        assert {f"{dir1}/full.json", f"{dir2}/full.json"} <= names
        payload1 = json.loads(_zip_read(resp, f"{dir1}/full.json"))
        payload2 = json.loads(_zip_read(resp, f"{dir2}/full.json"))
        assert payload1["session"]["id"] == str(sess1.id)
        assert payload2["session"]["id"] == str(sess2.id)


# ── 4. 权限 404（不 mock 权限检查，走真实端点）──────────────────────────────


class TestPermission404:
    async def _make_group_env(
        self, db_session: AsyncSession
    ) -> tuple[AgentSession, User, str, User, str]:
        """群环境：workspace + 群会话 + 群主 + 成员（member）+ 门外人（outsider）。

        成员与门外人都显式持有 task:run_agent（过端点闸门但非 workspace
        admin），404 只能来自服务层群判定——非成员 404、成员 200。
        """
        ws = Workspace(
            id=uuid.uuid4(),
            name="sexp-ws",
            slug=f"sexp-ws-{uuid.uuid4().hex[:8]}",
            root_path=f"C:/tmp/sexp-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(ws)
        owner, _ = await _create_user(db_session, name="群主")
        group_sess = await _seed_session(
            db_session,
            user_id=owner.id,
            title="群时间线",
            session_kind="group",
            workspace_id=ws.id,
        )
        group = AgentGroupChat(
            id=group_sess.id,
            session_id=group_sess.id,
            workspace_id=ws.id,
            title="导出测试群",
            created_by=owner.id,
        )
        db_session.add(group)
        member, member_token = await _create_user(db_session, name="成员甲")
        outsider, outsider_token = await _create_user(db_session, name="门外人")
        db_session.add(
            AgentGroupMember(
                id=uuid.uuid4(),
                group_id=group.id,
                member_type="user",
                display_name="成员甲",
                user_id=member.id,
            )
        )
        await db_session.commit()
        # 闸门权限挂在独立 workspace 上：两端点访问权齐平，区分只在群成员判定。
        gate_ws = Workspace(
            id=uuid.uuid4(),
            name="sexp-gate-ws",
            slug=f"sexp-gate-{uuid.uuid4().hex[:8]}",
            root_path=f"C:/tmp/sexp-gate-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(gate_ws)
        await db_session.commit()
        await _grant_task_run_agent(db_session, workspace_id=gate_ws.id, user_id=member.id)
        await _grant_task_run_agent(db_session, workspace_id=gate_ws.id, user_id=outsider.id)
        return group_sess, member, member_token, outsider, outsider_token

    @pytest.mark.asyncio
    async def test_cross_user_session_404_not_leaking(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """跨用户访问他人会话 404，且响应与不存在的 id 完全同构（不泄露存在性）。"""
        gate_ws = Workspace(
            id=uuid.uuid4(),
            name="sexp-xuser-ws",
            slug=f"sexp-xuser-{uuid.uuid4().hex[:8]}",
            root_path=f"C:/tmp/xuser-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(gate_ws)
        other, _ = await _create_user(db_session, name="他人")
        sess = await _seed_session(db_session, user_id=other.id, title="他人的会话")
        requester, token = await _create_user(db_session, name="请求者")
        await _grant_task_run_agent(db_session, workspace_id=gate_ws.id, user_id=requester.id)
        await db_session.commit()

        resp = await _post_export(client, token, [sess.id])
        missing = await _post_export(client, token, [uuid.uuid4()])

        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"
        # 存在的他人会话与不存在的 id 响应同构：仅凭响应无法区分两者。
        assert resp.json()["code"] == missing.json()["code"]

    @pytest.mark.asyncio
    async def test_soft_deleted_session_404_even_for_owner(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """已软删会话：属主本人导出也 404（对齐详情端点软删口径）。"""
        gate_ws = Workspace(
            id=uuid.uuid4(),
            name="sexp-del-ws",
            slug=f"sexp-del-{uuid.uuid4().hex[:8]}",
            root_path=f"C:/tmp/del-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(gate_ws)
        owner, token = await _create_user(db_session, name="属主")
        await _grant_task_run_agent(db_session, workspace_id=gate_ws.id, user_id=owner.id)
        sess = await _seed_session(
            db_session,
            user_id=owner.id,
            title="已删会话",
            deleted_at=datetime.now(UTC),
        )

        resp = await _post_export(client, token, [sess.id])

        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_group_non_member_404_member_200(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """群会话：非成员非 admin 404；群参与者 200（同一判定函数正反例）。"""
        group_sess, _, member_token, _, outsider_token = await self._make_group_env(db_session)

        denied = await _post_export(client, outsider_token, [group_sess.id])
        allowed = await _post_export(client, member_token, [group_sess.id])

        assert denied.status_code == 404
        assert denied.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"
        assert allowed.status_code == 200, allowed.text
        assert allowed.headers["content-type"].startswith("text/markdown")

    @pytest.mark.asyncio
    async def test_mixed_batch_all_or_nothing_404(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """可访问 + 不可访问混合批次：整包 404，不做部分成功（FR-03）。"""
        gate_ws = Workspace(
            id=uuid.uuid4(),
            name="sexp-mix-ws",
            slug=f"sexp-mix-{uuid.uuid4().hex[:8]}",
            root_path=f"C:/tmp/mix-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(gate_ws)
        other, _ = await _create_user(db_session, name="他人乙")
        owner, token = await _create_user(db_session, name="属主乙")
        await _grant_task_run_agent(db_session, workspace_id=gate_ws.id, user_id=owner.id)
        mine = await _seed_session(db_session, user_id=owner.id, title="我的会话")
        foreign = await _seed_session(db_session, user_id=other.id, title="别人的会话")

        resp = await _post_export(client, token, [mine.id, foreign.id])

        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"


# ── 5. 附件打包与降级 ───────────────────────────────────────────────────────


class TestAttachmentPackaging:
    @pytest.mark.asyncio
    async def test_attachment_bytes_packaged_verbatim(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """附件本体正常取流：zip 内 attachments/{id}_{名} 条目 bytes 逐字节一致。"""
        owner, token = await _create_user(db_session, name="attowner", admin=True)
        sess = await _seed_session(db_session, user_id=owner.id, title="附件会话")
        blob = f"PNGDATA-{uuid.uuid4().hex}".encode()
        att = await _seed_attachment(
            db_session,
            user_id=owner.id,
            session_id=sess.id,
            name="截图 v2.png",
            size_bytes=len(blob),
        )

        async def _fake_read(self: SessionAttachmentStorage, object_key: str) -> bytes:
            assert object_key == att.object_key
            return blob

        monkeypatch.setattr(SessionAttachmentStorage, "read_bytes", _fake_read)

        resp = await _post_export(client, token, [sess.id], tier="full")

        assert resp.status_code == 200, resp.text
        base_dir = f"附件会话_{str(sess.id)[:8]}"
        entry = f"{base_dir}/attachments/{att.id}_截图 v2.png"
        assert entry in _zip_names(resp)
        assert _zip_read(resp, entry) == blob
        full = json.loads(_zip_read(resp, f"{base_dir}/full.json"))
        assert full["attachments"] == [
            {
                "id": str(att.id),
                "name": "截图 v2.png",
                "kind": "image",
                "media_type": "image/png",
                "bytes": len(blob),
                "zip_path": entry,
                "missing": False,
            }
        ]

    @pytest.mark.asyncio
    async def test_attachment_read_failure_degrades_missing(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """对象读取失败（丢失/存储异常）：missing=true + 不写条目，整包继续 200。"""
        owner, token = await _create_user(db_session, name="missowner", admin=True)
        sess = await _seed_session(db_session, user_id=owner.id, title="丢附件会话")
        run = await _seed_run(
            db_session, sess.id, started_at=datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
        )
        await _seed_log(
            db_session,
            run.id,
            channel="user_input",
            content="正文仍在",
            ts=datetime(2026, 9, 1, 8, 0, tzinfo=UTC),
        )
        att = await _seed_attachment(
            db_session,
            user_id=owner.id,
            session_id=sess.id,
            name="丢失.bin",
            kind="file",
            media_type="application/octet-stream",
        )

        async def _boom(self: SessionAttachmentStorage, object_key: str) -> bytes:
            raise RuntimeError("object lost in storage")

        monkeypatch.setattr(SessionAttachmentStorage, "read_bytes", _boom)

        resp = await _post_export(client, token, [sess.id], tier="full")

        assert resp.status_code == 200, resp.text
        base_dir = f"丢附件会话_{str(sess.id)[:8]}"
        names = _zip_names(resp)
        assert f"{base_dir}/full.json" in names
        assert [n for n in names if "/attachments/" in n] == []
        full = json.loads(_zip_read(resp, f"{base_dir}/full.json"))
        assert full["attachments"][0]["id"] == str(att.id)
        assert full["attachments"][0]["missing"] is True
        # 整包继续：其余内容完整（不 500）。
        assert full["logs"][0]["content_redacted"] == "正文仍在"


# ── 6. 413 体量防护 ─────────────────────────────────────────────────────────


class TestAttachmentTotalTooLarge413:
    @pytest.mark.asyncio
    async def test_full_tier_attachment_bytes_precheck_413(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """full 档附件元数据 bytes 预聚合超 512MB → 413 + 分批导出提示（R-09）。

        只造元数据不造真实对象；预检查发生在附件取流之前，未 monkeypatch
        read_bytes 也不会触达存储（若顺序回退会因 MinIO 不可达降级 200，
        本用例即红）。
        """
        owner, token = await _create_user(db_session, name="bigowner", admin=True)
        sess = await _seed_session(db_session, user_id=owner.id, title="大附件会话")
        # 2 × 300MB = 600MB > 512MB（EXPORT_ATTACHMENTS_TOTAL_BYTES_LIMIT）。
        await _seed_attachment(
            db_session,
            user_id=owner.id,
            session_id=sess.id,
            name="a.bin",
            kind="file",
            media_type="application/octet-stream",
            size_bytes=300 * 1024 * 1024,
        )
        await _seed_attachment(
            db_session,
            user_id=owner.id,
            session_id=sess.id,
            name="b.bin",
            kind="file",
            media_type="application/octet-stream",
            size_bytes=300 * 1024 * 1024,
        )

        resp = await _post_export(client, token, [sess.id], tier="full")

        assert resp.status_code == 413
        body = resp.json()
        assert body["code"] == "HTTP_413_SESSION_EXPORT_TOO_LARGE"
        assert "分批导出" in body["message"]
        assert body["details"]["limit_bytes"] == 512 * 1024 * 1024
        assert body["details"]["total_bytes"] == 600 * 1024 * 1024

    @pytest.mark.asyncio
    async def test_chat_tier_skips_attachment_precheck(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """chat 档不打包附件：同样元数据超限也 200（413 仅 full 档口径）。"""
        owner, token = await _create_user(db_session, name="bigchat", admin=True)
        sess = await _seed_session(db_session, user_id=owner.id, title="chat 大附件")
        await _seed_attachment(
            db_session,
            user_id=owner.id,
            session_id=sess.id,
            name="a.bin",
            kind="file",
            media_type="application/octet-stream",
            size_bytes=600 * 1024 * 1024,
        )

        resp = await _post_export(client, token, [sess.id], tier="chat")

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/markdown")


# ── 7. 截断（保最早 + truncated/dropped_rows + 尾标注）──────────────────────


class TestTruncation:
    async def _seed_six_rows(
        self, db_session: AsyncSession, *, owner_id: uuid.UUID
    ) -> AgentSession:
        sess = await _seed_session(db_session, user_id=owner_id, title="截断会话")
        base = datetime(2026, 9, 1, 8, 0, 0, tzinfo=UTC)
        run = await _seed_run(db_session, sess.id, started_at=base)
        await _seed_log(db_session, run.id, channel="user_input", content="原始问题", ts=base)
        for i in range(1, 6):
            await _seed_log(
                db_session,
                run.id,
                channel="stdout",
                content=f"[ASSISTANT] 助手第{i}段答复",
                ts=base + timedelta(seconds=i),
            )
        return sess

    @pytest.mark.asyncio
    async def test_truncated_chat_md_keeps_earliest_rows(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """行数上限 monkeypatch 到 3：保最早 3 行 + 尾标注 truncated/dropped。"""
        monkeypatch.setattr(export_service, "EXPORT_LOG_ROW_LIMIT", 3)
        owner, token = await _create_user(db_session, name="truncmd", admin=True)
        sess = await self._seed_six_rows(db_session, owner_id=owner.id)

        resp = await _post_export(client, token, [sess.id], tier="chat")

        assert resp.status_code == 200, resp.text
        md = resp.content.decode("utf-8")
        # 保最早：前 3 行（原始问题 + 第1/2段）在，第3~5段（较晚 3 行）被丢。
        assert "**用户**：原始问题" in md
        assert "**助手**：助手第1段答复" in md
        assert "**助手**：助手第2段答复" in md
        assert "助手第3段答复" not in md
        assert "助手第4段答复" not in md
        assert "助手第5段答复" not in md
        # 文件尾标注（truncated + 丢弃行数）。
        assert "truncated: true" in md
        assert "丢弃 3 行" in md
        assert "已保留最早的 3 行" in md

    @pytest.mark.asyncio
    async def test_truncated_full_json_flags(
        self, client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """full 档同口径：truncated=true、dropped_rows=3、logs 只剩最早 3 行。"""
        monkeypatch.setattr(export_service, "EXPORT_LOG_ROW_LIMIT", 3)
        owner, token = await _create_user(db_session, name="truncfull", admin=True)
        sess = await self._seed_six_rows(db_session, owner_id=owner.id)

        resp = await _post_export(client, token, [sess.id], tier="full")

        assert resp.status_code == 200, resp.text
        base_dir = f"截断会话_{str(sess.id)[:8]}"
        full = json.loads(_zip_read(resp, f"{base_dir}/full.json"))
        assert full["truncated"] is True
        assert full["dropped_rows"] == 3
        assert len(full["logs"]) == 3
        assert full["logs"][0]["content_redacted"] == "原始问题"
        assert full["logs"][-1]["content_redacted"] == "[ASSISTANT] 助手第2段答复"
        # runs 不受日志行数截断影响。
        assert len(full["runs"]) == 1

    @pytest.mark.asyncio
    async def test_under_limit_not_truncated(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """未超限会话：truncated=False、dropped_rows=0、无尾标注（零回归）。"""
        owner, token = await _create_user(db_session, name="notrunc", admin=True)
        sess = await self._seed_six_rows(db_session, owner_id=owner.id)

        resp = await _post_export(client, token, [sess.id], tier="chat")

        assert resp.status_code == 200, resp.text
        md = resp.content.decode("utf-8")
        assert "助手第5段答复" in md
        assert "truncated" not in md


# ── 8. 路由顺序（R-01 双证：路由表 + 真实请求）──────────────────────────────


class TestRouteOrder:
    def test_export_literal_route_registered_before_session_id_param(self) -> None:
        """路由表证据：/sessions/export 字面量前置于 /sessions/{session_id}。"""
        from app.main import app

        export_idx = param_idx = None
        for idx, route in enumerate(app.routes):
            name = getattr(getattr(route, "endpoint", None), "__name__", None)
            if name == "export_sessions":
                export_idx = idx
            elif name in ("get_session_detail", "delete_session") and (
                param_idx is None or idx < param_idx
            ):
                param_idx = idx
        assert export_idx is not None, "export_sessions 路由未注册"
        assert param_idx is not None, "/sessions/{session_id} 参数路由未注册"
        assert export_idx < param_idx

    @pytest.mark.asyncio
    async def test_real_post_not_swallowed_by_param_route(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """真实请求证据：POST /sessions/export 命中字面量路由（200），不被
        {session_id} 参数路由吞成 422/405（照 test_runtimes_usage_endpoint.py
        :148 先例）。"""
        owner, token = await _create_user(db_session, name="route", admin=True)
        sess = await _seed_session(db_session, user_id=owner.id, title="路由顺序")

        resp = await _post_export(client, token, [sess.id], tier="chat")

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/markdown")


# ── 9. 请求校验 422 ─────────────────────────────────────────────────────────


class TestRequestValidation422:
    @pytest.mark.asyncio
    async def test_empty_session_ids_422(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """0 个 ids：SessionExportRequest min_length=1 拒绝（FR-01）。"""
        _, token = await _create_user(db_session, name="vempty", admin=True)
        resp = await _post_export(client, token, [])
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_51_session_ids_422(self, client: AsyncClient, db_session: AsyncSession) -> None:
        _, token = await _create_user(db_session, name="v51", admin=True)
        ids = [uuid.uuid4() for _ in range(51)]
        resp = await _post_export(client, token, ids)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_tier_422(self, client: AsyncClient, db_session: AsyncSession) -> None:
        _, token = await _create_user(db_session, name="vtier", admin=True)
        resp = await _post_export(client, token, [uuid.uuid4()], tier="both")
        assert resp.status_code == 422
