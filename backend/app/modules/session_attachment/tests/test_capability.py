"""session_attachment 门控与组装单测（task-14 精简版）。

覆盖：D-9 三态启发式表驱动 + resolve_gate 无 provider 保守侧；组装 helper 的
内联/降级/回拉三链路（D-4 总量闸门）+ D-3 标记行格式。inject 全链路（WS/DB
fixture）由 E2E 验收（task-15），完整 pytest 矩阵登记为后续测试债。
"""

from __future__ import annotations

import uuid

from app.modules.session_attachment.capability import (
    resolve_gate,
    supports_multimodal_by_model_name,
)
from app.modules.session_attachment.model import SessionAttachment
from app.modules.session_attachment.service import (
    MAX_INLINE_ATTACHMENTS_BYTES,
    assemble_inject_attachments,
    attachment_marker_line,
)
from app.modules.session_attachment.storage import SessionAttachmentStorage


class _FakeBackend:
    def __init__(self, size: int = 1000) -> None:
        self._size = size

    async def get_object_stream(self, key: str):
        yield b"x" * self._size

    async def head_object(self, key: str):
        raise FileNotFoundError(key)

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        return None


def _row(kind: str = "image", media: str = "image/png", size: int = 1000) -> SessionAttachment:
    return SessionAttachment(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=None,
        kind=kind,
        media_type=media,
        bytes=size,
        name="a.png",
        object_key="attachments/u/k",
        sha256="h" * 64,
        width=1,
        height=1,
    )


def test_multimodal_heuristic_table() -> None:
    supports = [
        "glm-4.6v",
        "GLM-4.5V",
        "qwen3-vl-plus",
        "gpt-4o-mini",
        "gpt-5",
        "claude-sonnet-4-5",
        "gemini-2.5-pro",
        "o3",
    ]
    rejects = ["glm-4.5", "deepseek-v3", "my-relay-alias", "", None]
    for name in supports:
        assert supports_multimodal_by_model_name(name), name
    for name in rejects:
        assert not supports_multimodal_by_model_name(name), name


def test_resolve_gate_three_states() -> None:
    provider = type("P", (), {})()
    provider.id = uuid.uuid4()
    provider.multimodal = "true"
    provider.model = "glm-4.5"
    assert resolve_gate(provider).supports_multimodal is True
    provider.multimodal = "false"
    assert resolve_gate(provider).supports_multimodal is False
    provider.multimodal = "auto"
    provider.model = "glm-4.6v"
    assert resolve_gate(provider).supports_multimodal is True
    # 无 provider（本机凭证）→ 保守不支持
    gate = resolve_gate(None)
    assert gate.supports_multimodal is False and gate.effective_provider_id is None


async def test_assemble_inline_downgrade_and_pullback() -> None:
    img = _row(kind="image", media="image/png")
    st = SessionAttachmentStorage(_FakeBackend(1000))

    # 支持 → 内联 base64（deliver=block）
    payloads = await assemble_inject_attachments([img], supports_multimodal=True, storage=st)
    assert payloads[0]["deliver"] == "block" and payloads[0].get("data")

    # 不支持（D-9）→ 降级落盘（deliver=disk，media_type 保留）
    payloads = await assemble_inject_attachments([img], supports_multimodal=False, storage=st)
    assert payloads[0]["deliver"] == "disk" and payloads[0]["media_type"] == "image/png"

    # D-4 总量闸门：超限整体回拉（block 无 data 带 object_key）
    big = _row(size=MAX_INLINE_ATTACHMENTS_BYTES)
    st_big = SessionAttachmentStorage(_FakeBackend(MAX_INLINE_ATTACHMENTS_BYTES + 1))
    payloads = await assemble_inject_attachments([big], supports_multimodal=True, storage=st_big)
    assert payloads[0]["deliver"] == "block" and not payloads[0].get("data")
    assert payloads[0]["object_key"]


def test_marker_line_format() -> None:
    row = _row()
    assert attachment_marker_line(row) == f"[附件:{row.id}|image|a.png]"
