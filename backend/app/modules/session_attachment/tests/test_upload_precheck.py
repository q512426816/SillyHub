"""task-05 测试（2026-10-16-backend-mem-polling / D-004@v1）。

1. 附件上传先检后读：``UploadFile.size`` 超限 → 413 且 ``file.read()`` 零调用
   （超限文件不再整读进内存）；正常路径行为不变。
2. WS 大消息日志截断：超 8KB 只留 repr 前后各 4KB + 总长标注；≤8KB 原样。
"""

from __future__ import annotations

import pytest

from app.modules.daemon.router.gateway_misc import _truncate_ws_log_msg
from app.modules.session_attachment.router import upload_attachment
from app.modules.session_attachment.service import MAX_IMAGE_BYTES


class _FakeUploadFile:
    """duck-typing 假上传文件（不继承 UploadFile——其属性只读不可注入）——
    带预置 size，read 打桩计数验证「超限零读取」。"""

    def __init__(self, *, size: int, content: bytes = b"x") -> None:
        self.size = size
        self.filename = "probe.bin"
        self.content_type = "application/octet-stream"
        self._content = content
        self.read_calls = 0

    async def read(self) -> bytes:
        self.read_calls += 1
        return self._content


class TestUploadPrecheck:
    async def test_oversized_file_413_without_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """size 超 image 上限 → SessionAttachmentTooLarge(413)，内容零读取。"""
        from app.core.errors import AppError

        file = _FakeUploadFile(size=MAX_IMAGE_BYTES + 1)
        called = []

        async def _noop_upload(self, **kwargs):  # pragma: no cover - 不应被调
            called.append(kwargs)
            raise AssertionError("service.upload 不应在预检拒绝后被调用")

        import app.modules.session_attachment.service as svc_mod

        monkeypatch.setattr(svc_mod.SessionAttachmentService, "upload", _noop_upload)

        with pytest.raises(AppError) as ei:
            await upload_attachment(
                session=None,  # 预检在 session 使用前短路
                storage=None,
                current_user=type("U", (), {"id": "u1"})(),
                file=file,
                kind="image",
            )
        assert ei.value.code == "HTTP_413_SESSION_ATTACHMENT_TOO_LARGE"
        assert file.read_calls == 0, "超限文件不得整读进内存"
        assert called == []

    async def test_normal_file_reads_and_passes_to_service(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """size 在限内 → 正常 read 并把内容交给 service（行为不变）。"""
        file = _FakeUploadFile(size=16, content=b"small-bytes")
        captured = {}

        async def _fake_upload(self, *, data, **kwargs):
            captured["data"] = data
            captured.update(kwargs)
            return object()  # 返回值原样透传，构造细节与预检无关

        import app.modules.session_attachment.service as svc_mod

        monkeypatch.setattr(svc_mod.SessionAttachmentService, "upload", _fake_upload)

        await upload_attachment(
            session=None,
            storage=None,
            current_user=type("U", (), {"id": "u1"})(),
            file=file,
            kind="image",
        )
        assert file.read_calls == 1
        assert captured["data"] == b"small-bytes"


class TestWsLogTruncate:
    def test_small_message_untouched(self):
        data = {"type": "daemon:rpc_result", "payload": {"rpc_id": "r1"}}
        assert _truncate_ws_log_msg(data) is data

    def test_large_message_truncated_with_marker(self):
        big = {"payload": "x" * (64 * 1024)}
        out = _truncate_ws_log_msg(big)
        assert isinstance(out, str)
        assert "<truncated total=" in out
        assert len(out) < 9 * 1024, "截断结果必须显著小于原文"
        # 首尾各保留 4KB（原文 repr 首部含 {'payload': ' 前缀）
        assert out.startswith("{'payload': '")
        assert out.endswith("'}")

    def test_unrepresentable_object_degrades_to_typename(self):
        class _Bad:
            def __repr__(self):  # pragma: no cover
                raise RuntimeError("no repr")

        out = _truncate_ws_log_msg(_Bad())
        assert out == "<unrepresentable _Bad>"
