"""ql-20260825-001：``create_session`` 预会话首句附件单测。

覆盖修复的四段（对齐 inject 路径既有语义）：

1. DTO 层：``attachment_ids`` 非空允许空 prompt（D-7 看图说话豁免对齐）；
   两者都空 → 422；超 10 个 → pydantic 校验拒绝。
2. service 校验：附件不存在/跨用户 → 404；数量超限（图>5 或 文>5）→ 422；
   非 Claude 引擎 → 附件不支持 4xx。
3. happy path：首句带 1 图 1 文 —— AgentRunLog(user_input) 带附件标记行
   （前端 chips 回显数据源）；附件行 session_id 回填（draft→bound）；
   SESSION_INJECT payload 携带 attachments。
4. 纯附件空 prompt（看图说话）创建成功。

夹具范式镜像 ``test_session_create_config.py``（hub / redis mock）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentSession
from app.modules.daemon.schema import SessionCreateRequest
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionAttachmentInvalid,
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionNotFound,
)
from app.modules.session_attachment.model import SessionAttachment

from .test_session_create_config import (
    _create_runtime,
    _create_user,
    _mock_hub,
)


async def _seed_attachment(
    session,
    user_id: uuid.UUID,
    *,
    kind: str = "file",
    name: str = "doc.pdf",
    media_type: str = "application/pdf",
    sess_id: uuid.UUID | None = None,
) -> SessionAttachment:
    row = SessionAttachment(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=sess_id,
        kind=kind,
        media_type=media_type,
        bytes=64,
        name=name,
        object_key=f"attachments/{user_id}/{uuid.uuid4().hex}.bin",
        sha256=uuid.uuid4().hex,
        created_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    return row


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


@pytest.fixture()
def mocked_storage():
    """附件对象存储读打桩（assemble 多模态块读 bytes，不打桩会打真 MinIO）。"""
    backend = MagicMock()
    backend.read_bytes = AsyncMock(return_value=b"x" * 16)
    with patch(
        "app.modules.storage.factory.get_storage_backend", return_value=backend
    ):
        yield backend


# ════════════════════════════════════════════════════════════════════════════
# 1. DTO 层（D-7 豁免对齐）
# ════════════════════════════════════════════════════════════════════════════


class TestCreateRequestSchema:
    def test_attachments_allow_empty_prompt(self) -> None:
        req = SessionCreateRequest(
            prompt="", provider="claude", attachment_ids=[uuid.uuid4()]
        )
        assert len(req.attachment_ids) == 1

    def test_empty_prompt_without_attachments_rejected(self) -> None:
        with pytest.raises(ValueError, match="prompt is required"):
            SessionCreateRequest(prompt="   ", provider="claude")

    def test_attachment_ids_over_10_rejected(self) -> None:
        with pytest.raises(Exception):
            SessionCreateRequest(
                prompt="hi",
                provider="claude",
                attachment_ids=[uuid.uuid4() for _ in range(11)],
            )


# ════════════════════════════════════════════════════════════════════════════
# 2. service 校验分支
# ════════════════════════════════════════════════════════════════════════════


class TestCreateAttachmentValidation:
    @pytest.mark.asyncio
    async def test_missing_attachment_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNotFound) as exc_info:
            await svc.create_session(
                uid,
                provider="claude",
                prompt="带附件",
                attachment_ids=[uuid.uuid4()],
            )
        assert exc_info.value.http_status == 404
        rows = (await db_session.execute(select(AgentSession))).scalars().all()
        assert rows == []

    @pytest.mark.asyncio
    async def test_over_limit_rejected(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid, provider="claude")
        ids = [
            (await _seed_attachment(db_session, uid, kind="image", name=f"i{n}.png")).id
            for n in range(6)
        ]

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionAttachmentInvalid):
            await svc.create_session(
                uid, provider="claude", prompt="超量", attachment_ids=ids
            )

    @pytest.mark.asyncio
    async def test_non_claude_engine_rejected(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="codex")
        att = await _seed_attachment(db_session, uid)

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionAttachmentsUnsupported):
            await svc.create_session(
                uid,
                provider=None,
                runtime_id=str(rt.id),
                prompt="文本",
                attachment_ids=[att.id],
            )


# ════════════════════════════════════════════════════════════════════════════
# 3. happy path：标记行回显 + 回填 + payload 携带
# ════════════════════════════════════════════════════════════════════════════


class TestCreateWithAttachmentsHappyPath:
    @pytest.mark.asyncio
    async def test_marker_lines_and_backfill_and_payload(
        self, db_session, mocked_hub, mocked_redis, mocked_storage
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        img = await _seed_attachment(
            db_session, uid, kind="image", name="截图.png", media_type="image/png"
        )
        doc = await _seed_attachment(db_session, uid, kind="file", name="报告.pdf")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            runtime_id=str(rt.id),
            prompt="看下这两个文件",
            attachment_ids=[img.id, doc.id],
        )

        # AgentRunLog(user_input) 带 marker 行（回显数据源）。
        from app.modules.agent.model import AgentRunLog

        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 1
        content = logs[0].content_redacted or ""
        assert f"[附件:{img.id}|image|截图.png]" in content
        assert f"[附件:{doc.id}|file|报告.pdf]" in content
        assert "看下这两个文件" in content

        # 附件行回填 session_id（draft→bound）。
        img_after = await db_session.get(SessionAttachment, img.id)
        doc_after = await db_session.get(SessionAttachment, doc.id)
        assert img_after.session_id == result.agent_session.id
        assert doc_after.session_id == result.agent_session.id

        # SESSION_INJECT payload 携带 attachments。
        calls = mocked_hub.send_session_control.await_args_list
        inject_payloads = [
            c.kwargs.get("payload") or (c.args[2] if len(c.args) > 2 else None)
            for c in calls
        ]
        assert any(p and "attachments" in p for p in inject_payloads)

    @pytest.mark.asyncio
    async def test_attachments_only_empty_prompt_creates(
        self, db_session, mocked_hub, mocked_redis, mocked_storage
    ) -> None:
        """纯附件空 prompt（看图说话）：创建成功，marker 行即首条 user_input。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        img = await _seed_attachment(
            db_session, uid, kind="image", name="图.png", media_type="image/png"
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            runtime_id=str(rt.id),
            prompt="",
            attachment_ids=[img.id],
        )
        assert result.agent_session.status == "active"

        from app.modules.agent.model import AgentRunLog

        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 1
        assert logs[0].content_redacted == f"[附件:{img.id}|image|图.png]"

    @pytest.mark.asyncio
    async def test_without_attachments_zero_regression(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """无附件路径逐字节现状：user_input 只含纯 prompt。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid, provider=None, runtime_id=str(rt.id), prompt="普通首句"
        )

        from app.modules.agent.model import AgentRunLog

        logs = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert logs[0].content_redacted == "普通首句"
