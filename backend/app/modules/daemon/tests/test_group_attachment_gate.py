"""群附件引擎门控 caps 口径测试（2026-10-15-dsh-engine-acp task-06 / FR-07 / R-03）。

发送侧（messages.py 影子直聊路径）与触发侧（shadow.py _trigger_group_member）
原先各自硬编码 `provider != "claude"` 即拒——与单聊 attachments.py 的 caps
判定不一致（pi/cursor 单聊放行、群聊被拒的口径债）。本变更统一为
helpers.group_attachment_gate_denied（caps.attachments 同源查表）。

覆盖：
- 判定函数逐引擎参数化：claude/pi/cursor/dsh 放行（denied=False），codex 与
  未知引擎拒绝（denied=True，get_provider_caps 默认拒绝对象）；
- provider=None 回落 claude 放行（存量成员缺省语义保持）；
- 源级接线断言（镜像 test_provider_caps_alignment 的源文件读取式先例）：
  两个服务文件均无旧硬编码门控残根、均消费共享判定助手。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.daemon.group.service.helpers import group_attachment_gate_denied

_SERVICE_DIR = Path(__file__).parents[1] / "group" / "service"


class TestGroupAttachmentGateDenied:
    """判定函数逐引擎行为（caps.attachments 同源）。"""

    @pytest.mark.parametrize(
        ("provider", "denied"),
        [
            ("claude", False),
            ("pi", False),  # R-03 有意行为变化：单聊本就放行，群聊对齐
            ("cursor", False),  # R-03 同上（disk-only 落盘链路）
            ("dsh", False),  # 2026-10-15-dsh-engine-acp 新引擎随 caps=true 放行
            ("codex", True),  # caps.attachments=false（D-6 沿袭）
            ("unknown-engine", True),  # 未知引擎默认拒绝对象
        ],
    )
    def test_per_engine(self, provider: str, denied: bool) -> None:
        assert group_attachment_gate_denied(provider) is denied

    def test_none_provider_falls_back_to_claude(self) -> None:
        """provider=None 回落 claude 放行（旧硬编码 `(provider or 'claude')` 语义保持）。"""
        assert group_attachment_gate_denied(None) is False


class TestGateWiringSourceLevel:
    """源级接线：两处门控消费共享判定，无硬编码残根（读取式断言先例）。"""

    def test_messages_gate_uses_shared_helper(self) -> None:
        src = (_SERVICE_DIR / "messages.py").read_text(encoding="utf-8")
        assert "group_attachment_gate_denied(member.provider)" in src
        # 旧硬编码门控形态不得复活（附件门控上下文的 claude 比较）。
        assert "仅 Claude 支持附件" not in src
        assert "（仅 Claude 支持多模态与文件注入）" not in src

    def test_shadow_gate_uses_shared_helper(self) -> None:
        src = (_SERVICE_DIR / "shadow.py").read_text(encoding="utf-8")
        assert "group_attachment_gate_denied(member.provider)" in src
        assert "仅 Claude 支持附件" not in src
        assert "（仅 Claude 支持多模态与文件注入）" not in src
