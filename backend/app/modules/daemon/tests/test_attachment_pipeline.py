"""task-11 轻重构⑤定向测试：session / group 附件校验与装配共享核心。

覆盖两个层面：

- 核心 ``attachment_pipeline`` 三函数单元路径：归属校验（正常/保序/去重、
  缺失、数量超限、类型非法、恰好满额边界）、gate 解析透传、MinIO 组装
  调用形参（含 patch 源模块属性照常拦截——D-007 延迟 import 面）；
- 收敛调用点错误族等价性：session inject 校验 404 资源隐藏 /
  ``DaemonSessionAttachmentInvalid`` 422 语义（数量超限 + 引擎门控 422）、
  group 校验 ``GroupChatInvalid`` 400 群错误族、session create 校验
  not-found details 口径、group 装配 gate 基准（属主=群主、引擎=成员）。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.daemon import attachment_pipeline
from app.modules.daemon.group.service.helpers import GroupChatInvalid
from app.modules.daemon.group.service.messages import _validate_group_attachments
from app.modules.daemon.group.service.shadow import _assemble_group_inject_attachments
from app.modules.daemon.session.service.attachments import (
    _assemble_inject_attachment_payload,
    _resolve_inject_gate,
    _validate_inject_attachment_rows,
    validate_create_attachments,
)
from app.modules.daemon.session.service.errors import (
    DaemonSessionAttachmentInvalid,
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionNotFound,
)


class _FakeResult:
    """scalars().all() 返回预设行（忽略真实 SQL）。"""

    def __init__(self, rows: list) -> None:
        self._rows = rows

    def scalars(self) -> _FakeResult:
        return self

    def all(self) -> list:
        return list(self._rows)


class _FakeDB:
    """execute 恒返回预设附件行（校验核心不触真实库）。"""

    def __init__(self, rows: list) -> None:
        self._rows = rows

    async def execute(self, stmt: object) -> _FakeResult:
        return _FakeResult(self._rows)


def _row(kind: str, row_id: uuid.UUID | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=row_id or uuid.uuid4(), kind=kind)


class TestValidateOwnedAttachmentsCore:
    async def test_normal_path_preserves_input_order_and_dedupes(self) -> None:
        """正常路径：按入参顺序去重返回（查询行序与勾选序解耦）。"""
        a, b, c = _row("image"), _row("file"), _row("image")
        db = _FakeDB([c, a, b])  # 查询返回序与入参序不同
        out = await attachment_pipeline.validate_owned_attachments(
            db,
            user_id=uuid.uuid4(),
            attachment_ids=[a.id, b.id, c.id, a.id],  # a 重复勾选
            not_found_error=lambda: pytest.fail("不应触发 not_found"),
            invalid_count_error=lambda *_: pytest.fail("不应触发 invalid_count"),
        )
        assert out == [a, b, c]

    async def test_missing_id_raises_not_found_factory(self) -> None:
        """缺失/跨用户（行数 != 去重 id 数）→ 调用点工厂错误。"""
        a = _row("image")
        db = _FakeDB([a])  # 请求两个、只归属一个

        def _boom() -> Exception:
            return GroupChatInvalid("部分附件不存在或无权访问。", details={})

        with pytest.raises(GroupChatInvalid, match="部分附件不存在"):
            await attachment_pipeline.validate_owned_attachments(
                db,
                user_id=uuid.uuid4(),
                attachment_ids=[a.id, uuid.uuid4()],
                not_found_error=_boom,
                invalid_count_error=lambda *_: pytest.fail("不应触发 invalid_count"),
            )

    async def test_image_over_limit_raises_count_factory_with_counts(self) -> None:
        """数量超限（图 6 > 5）→ 工厂收到 (image_n, file_n) 真实计数。"""
        rows = [_row("image") for _ in range(6)]
        seen: dict[str, int] = {}

        def _boom(image_n: int, file_n: int) -> Exception:
            seen["i"], seen["f"] = image_n, file_n
            return DaemonSessionAttachmentInvalid("x", details={})

        with pytest.raises(DaemonSessionAttachmentInvalid):
            await attachment_pipeline.validate_owned_attachments(
                _FakeDB(rows),
                user_id=uuid.uuid4(),
                attachment_ids=[r.id for r in rows],
                not_found_error=lambda: pytest.fail("不应触发 not_found"),
                invalid_count_error=_boom,
            )
        assert seen == {"i": 6, "f": 0}

    async def test_illegal_kind_counted_as_invalid(self) -> None:
        """类型非法（非 image/file 行）→ 归入数量/类型判定拒绝。"""
        rows = [_row("image"), _row("video")]  # video 计不进 image+file

        def _boom(image_n: int, file_n: int) -> Exception:
            return DaemonSessionAttachmentInvalid("x", details={})

        with pytest.raises(DaemonSessionAttachmentInvalid):
            await attachment_pipeline.validate_owned_attachments(
                _FakeDB(rows),
                user_id=uuid.uuid4(),
                attachment_ids=[r.id for r in rows],
                not_found_error=lambda: pytest.fail("不应触发 not_found"),
                invalid_count_error=_boom,
            )

    async def test_exactly_at_limit_passes(self) -> None:
        """边界：图 5 + 文 5 恰好满额 → 放行。"""
        rows = [_row("image") for _ in range(5)] + [_row("file") for _ in range(5)]
        out = await attachment_pipeline.validate_owned_attachments(
            _FakeDB(rows),
            user_id=uuid.uuid4(),
            attachment_ids=[r.id for r in rows],
            not_found_error=lambda: pytest.fail("不应触发 not_found"),
            invalid_count_error=lambda *_: pytest.fail("不应触发 invalid_count"),
        )
        assert len(out) == 10


class TestGateAndAssembleCore:
    async def test_resolve_multimodal_gate_passes_basis_through(self) -> None:
        """gate 核心：基准参数透传 resolve_session_gate、返回 supports 标量。"""
        import app.modules.session_attachment.capability as capability_module

        async def _fake_gate(db, *, user_id, session_llm_provider_id, agent_kind):
            return SimpleNamespace(
                supports_multimodal=(agent_kind == "claude"), _basis=session_llm_provider_id
            )

        uid, basis = uuid.uuid4(), uuid.uuid4()
        with patch.object(capability_module, "resolve_session_gate", _fake_gate):
            assert await attachment_pipeline.resolve_multimodal_gate(
                _FakeDB([]), user_id=uid, session_llm_provider_id=basis, agent_kind="claude"
            )
            assert not await attachment_pipeline.resolve_multimodal_gate(
                _FakeDB([]), user_id=uid, session_llm_provider_id=basis, agent_kind="codex"
            )

    async def test_assemble_attachments_builds_storage_and_passes_flag(self) -> None:
        """组装核心：行 + supports_multimodal 透传，storage 由工厂后端构造。"""
        import app.modules.session_attachment.service as att_service
        import app.modules.storage.factory as storage_factory
        from app.modules.session_attachment.storage import SessionAttachmentStorage

        sentinel_backend = object()
        spy = AsyncMock(return_value=[{"deliver": "disk"}])
        with (
            patch.object(storage_factory, "get_storage_backend", lambda: sentinel_backend),
            patch.object(att_service, "assemble_inject_attachments", spy),
        ):
            rows = [_row("file")]
            out = await attachment_pipeline.assemble_attachments(rows, supports_multimodal=False)
        assert out == [{"deliver": "disk"}]
        kwargs = spy.await_args.kwargs
        assert kwargs["supports_multimodal"] is False
        assert isinstance(kwargs["storage"], SessionAttachmentStorage)


class TestSessionWrapperEquivalence:
    async def test_inject_validation_missing_raises_404_hiding(self) -> None:
        """session inject：缺失 → DaemonSessionNotFound（404 资源隐藏 + details）。"""
        a = _row("image")
        svc = SimpleNamespace(_session=_FakeDB([a]))
        with pytest.raises(DaemonSessionNotFound) as exc_info:
            await _validate_inject_attachment_rows(
                svc,
                session_id=uuid.uuid4(),
                session_user_id=uuid.uuid4(),
                session_provider="claude",
                attachment_ids=[a.id, uuid.uuid4()],
            )
        assert exc_info.value.http_status == 404
        assert "部分附件不存在" in exc_info.value.message

    async def test_inject_validation_over_limit_422_semantics(self) -> None:
        """session inject：数量超限 → DaemonSessionAttachmentInvalid（422 语义）。"""
        rows = [_row("image") for _ in range(6)]
        svc = SimpleNamespace(_session=_FakeDB(rows))
        with pytest.raises(DaemonSessionAttachmentInvalid) as exc_info:
            await _validate_inject_attachment_rows(
                svc,
                session_id=uuid.uuid4(),
                session_user_id=uuid.uuid4(),
                session_provider="claude",
                attachment_ids=[r.id for r in rows],
            )
        assert exc_info.value.http_status == 422
        assert exc_info.value.code == "HTTP_422_SESSION_ATTACHMENT_INVALID"
        assert "附件数量超限（图片≤5、文件≤5）或类型非法。" in exc_info.value.message
        assert exc_info.value.details == {"image_count": 6, "file_count": 0}

    async def test_inject_validation_engine_gate_422(self) -> None:
        """session inject：非多模态引擎 → DaemonSessionAttachmentsUnsupported（422）。"""
        import app.modules.daemon.session.service.attachments as att_module

        svc = SimpleNamespace(_session=_FakeDB([]))
        with patch.object(att_module, "get_provider_caps", lambda p: {"multimodal": False}):
            with pytest.raises(DaemonSessionAttachmentsUnsupported) as exc_info:
                await _validate_inject_attachment_rows(
                    svc,
                    session_id=uuid.uuid4(),
                    session_user_id=uuid.uuid4(),
                    session_provider="codex",
                    attachment_ids=[uuid.uuid4()],
                )
        assert exc_info.value.http_status == 422

    async def test_create_validation_not_found_details_reason(self) -> None:
        """session create：缺失 → 404，details 保留 create 原口径 reason。"""
        a = _row("image")
        svc = SimpleNamespace(_session=_FakeDB([a]))
        with pytest.raises(DaemonSessionNotFound) as exc_info:
            await validate_create_attachments(
                svc,
                user_id=uuid.uuid4(),
                provider="claude",
                attachment_ids=[a.id, uuid.uuid4()],
            )
        assert exc_info.value.details == {"reason": "attachment_not_found"}

    async def test_create_validation_none_ids_returns_empty(self) -> None:
        """session create 边界：无附件 → 空列表（不触库不报错）。"""
        svc = SimpleNamespace(_session=_FakeDB([]))
        out = await validate_create_attachments(
            svc, user_id=uuid.uuid4(), provider="claude", attachment_ids=None
        )
        assert out == []

    async def test_resolve_inject_gate_wrapper_delegates(self) -> None:
        """session ``_resolve_inject_gate``：基准口径计算留调用点、核心共享。"""
        import app.modules.session_attachment.capability as capability_module

        async def _fake_gate(db, *, user_id, session_llm_provider_id, agent_kind):
            return SimpleNamespace(supports_multimodal=True, _seen=basis)

        basis = uuid.uuid4()
        with patch.object(capability_module, "resolve_session_gate", _fake_gate):
            assert await _resolve_inject_gate(
                SimpleNamespace(_session=_FakeDB([])),
                user_id=uuid.uuid4(),
                gate_provider_id_basis=basis,
                agent_kind="claude",
            )

    async def test_assemble_payload_wrapper_delegates(self) -> None:
        """session ``_assemble_inject_attachment_payload``：共享组装核心。"""
        import app.modules.session_attachment.service as att_service
        import app.modules.storage.factory as storage_factory

        spy = AsyncMock(return_value=[{"deliver": "block"}])
        with (
            patch.object(storage_factory, "get_storage_backend", lambda: object()),
            patch.object(att_service, "assemble_inject_attachments", spy),
        ):
            out = await _assemble_inject_attachment_payload(
                SimpleNamespace(_session=_FakeDB([])), [_row("image")], supports_multimodal=True
            )
        assert out == [{"deliver": "block"}]
        assert spy.await_args.kwargs["supports_multimodal"] is True


class TestGroupWrapperEquivalence:
    async def test_group_validation_missing_raises_group_invalid_400(self) -> None:
        """group：缺失 → GroupChatInvalid（400 群错误族，非 404）。"""
        a = _row("file")
        svc = SimpleNamespace(_session=_FakeDB([a]))
        with pytest.raises(GroupChatInvalid) as exc_info:
            await _validate_group_attachments(svc, uuid.uuid4(), [a.id, uuid.uuid4()])
        assert exc_info.value.http_status == 400
        assert exc_info.value.details == {"reason": "attachment_not_found"}

    async def test_group_validation_over_limit_message_and_details(self) -> None:
        """group：数量超限 → 400，文案/details 与收敛前逐字相同（常量单源 5/5）。"""
        rows = [_row("file") for _ in range(6)]
        svc = SimpleNamespace(_session=_FakeDB(rows))
        with pytest.raises(GroupChatInvalid) as exc_info:
            await _validate_group_attachments(svc, uuid.uuid4(), [r.id for r in rows])
        assert "附件数量超限（图片≤5、文件≤5）或类型非法。" in exc_info.value.message
        assert exc_info.value.details == {"image_count": 0, "file_count": 6}

    async def test_group_assembly_gate_basis_owner_and_member(self) -> None:
        """group 装配：gate 基准=群主属主 + 成员供应商/引擎，组装走共享核心。"""
        import app.modules.session_attachment.capability as capability_module
        import app.modules.session_attachment.service as att_service
        import app.modules.storage.factory as storage_factory

        seen: dict[str, object] = {}

        async def _fake_gate(db, *, user_id, session_llm_provider_id, agent_kind):
            seen.update(
                user_id=user_id,
                session_llm_provider_id=session_llm_provider_id,
                agent_kind=agent_kind,
            )
            return SimpleNamespace(supports_multimodal=True)

        assemble_spy = AsyncMock(return_value=[{"deliver": "disk"}])
        owner, member_provider_id = uuid.uuid4(), uuid.uuid4()
        member = SimpleNamespace(provider="claude", llm_provider_id=member_provider_id)
        with (
            patch.object(capability_module, "resolve_session_gate", _fake_gate),
            patch.object(storage_factory, "get_storage_backend", lambda: object()),
            patch.object(att_service, "assemble_inject_attachments", assemble_spy),
        ):
            out = await _assemble_group_inject_attachments(
                SimpleNamespace(_session=_FakeDB([])),
                [_row("image")],
                member=member,
                owner_user_id=owner,
            )
        assert out == [{"deliver": "disk"}]
        assert seen["user_id"] == owner  # 属主=群主（成员供应商行归属者）
        assert seen["session_llm_provider_id"] == member_provider_id
        assert seen["agent_kind"] == "claude"
        assert assemble_spy.await_args.kwargs["supports_multimodal"] is True

    async def test_group_assembly_member_provider_fallback_claude(self) -> None:
        """group 装配边界：成员 provider 缺省回落 ``claude``。"""
        import app.modules.session_attachment.capability as capability_module
        import app.modules.session_attachment.service as att_service
        import app.modules.storage.factory as storage_factory

        seen: dict[str, object] = {}

        async def _fake_gate(db, *, user_id, session_llm_provider_id, agent_kind):
            seen["agent_kind"] = agent_kind
            return SimpleNamespace(supports_multimodal=False)

        assemble_spy = AsyncMock(return_value=[])
        with (
            patch.object(capability_module, "resolve_session_gate", _fake_gate),
            patch.object(storage_factory, "get_storage_backend", lambda: object()),
            patch.object(att_service, "assemble_inject_attachments", assemble_spy),
        ):
            await _assemble_group_inject_attachments(
                SimpleNamespace(_session=_FakeDB([])),
                [],
                member=SimpleNamespace(provider=None, llm_provider_id=None),
                owner_user_id=uuid.uuid4(),
            )
        assert seen["agent_kind"] == "claude"
        assert assemble_spy.await_args.kwargs["supports_multimodal"] is False
