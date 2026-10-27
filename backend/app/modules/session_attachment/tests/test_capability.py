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
    """D-003：模型级三态（auto/true/false）× 列表命中 + 未命中保守 false。"""
    provider = type("P", (), {})()
    provider.id = uuid.uuid4()
    provider.models = [{"name": "glm-4.5", "multimodal": "true"}]
    assert resolve_gate(provider, "glm-4.5").supports_multimodal is True
    provider.models = [{"name": "glm-4.5", "multimodal": "false"}]
    assert resolve_gate(provider, "glm-4.5").supports_multimodal is False
    # auto：启发式（glm-4.6v 可看图 / glm-4.5 不可）
    provider.models = [{"name": "glm-4.6v", "multimodal": "auto"}]
    assert resolve_gate(provider, "glm-4.6v").supports_multimodal is True
    provider.models = [{"name": "glm-4.5", "multimodal": "auto"}]
    assert resolve_gate(provider, "glm-4.5").supports_multimodal is False
    # 未命中（会话选了列表外模型）→ 保守 false
    provider.models = [{"name": "glm-4.6v", "multimodal": "true"}]
    assert resolve_gate(provider, "deleted-model").supports_multimodal is False
    # model_name 缺省 → 主模型条目兜底（对齐旧供应商级 auto 行为）
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


def test_session_display_title_strips_attachment_markers() -> None:
    """2026-10-28-change-detail-sessions-source-fix FR-04：标题剥离附件标记。

    混合（附件标记 + 正文）→ 首个非空文本行前 30 字；截断残骸行同样丢弃。
    """
    from app.modules.session_attachment.service import session_display_title

    att1 = uuid.uuid4()
    att2 = uuid.uuid4()
    content = (
        f"[附件:{att1}|image|IMG_2038.png]\r\n"
        f"[附件:{att2}|image|IMG_2037.png]\r\n"
        "\r\n移动端四个页面布局乱了，帮我修一下"
    )
    assert session_display_title(content) == "移动端四个页面布局乱了，帮我修一下"

    # 截断残骸（uuid 未写全）不进标题
    assert session_display_title("[附件:02d8fdc9-023b-4e31-a787-6\n正文在这里") == "正文在这里"


def test_session_display_title_pure_attachment_falls_back_to_name() -> None:
    """FR-04：纯附件消息回退首个附件 name 段。"""
    from app.modules.session_attachment.service import session_display_title

    att = uuid.uuid4()
    assert session_display_title(f"[附件:{att}|image|IMG_2038.png]") == "IMG_2038.png"
    # 多附件取首个；name 含 | 时贪婪取到行尾 ]
    a1, a2 = uuid.uuid4(), uuid.uuid4()
    content = f"[附件:{a1}|file|报告|v2.pdf]\n[附件:{a2}|image|b.png]"
    assert session_display_title(content) == "报告|v2.pdf"


def test_session_display_title_plain_text_zero_regression() -> None:
    """FR-04：无附件标记的纯文本与旧口径逐字节一致（不 strip、含换行原样）。"""
    from app.modules.session_attachment.service import session_display_title

    plain = "普通会话首条消息"
    assert session_display_title(plain) == plain
    # 多行正文：整串前 30 字（含换行），与旧实现 (content or "")[:30] 逐字节一致
    multiline = "第一行\n第二行"
    assert session_display_title(multiline) == multiline[:30]
    # 前导空白保留（不 strip）；空文本归一 None
    assert session_display_title("  缩进开头") == "  缩进开头"
    assert session_display_title("") is None
    assert session_display_title(None) is None
