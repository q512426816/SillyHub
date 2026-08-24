"""Tests for Edit structuredPatch passthrough in ``_extract_sdk_messages``.

ql-20260824-020：会话「进度」视图 Edit 工具展开要显示**文件内真实行号**（用户
反馈片段内行号不对）。Claude Code 的 Edit 结果在 ``SDKUserMessage.tool_use_result
.structuredPatch`` 里带 ``oldStart``/``newStart`` 文件行号，但 backend 原只从
content block 取文本、把 tool_use_result 整体丢弃。

本文件锁定 backend 透传契约：user message 带 tool_use_result.structuredPatch 时，
tool_result flat record 附加 ``edit_patch`` 字段（structuredPatch 序列化 JSON），
供前端 Edit 详情优先渲染带真实行号的 diff；缺失/非 Edit 不附加。

纯函数白盒测试，不涉及 db。
"""

from __future__ import annotations

import json

from app.modules.daemon.run_sync.service import _extract_sdk_messages

# 真实 structuredPatch 形状（transcript 实证，3d4b19ee session）：
# hunk = {oldStart, newStart, oldLines, newLines, lines: [" ctx", "-del", "+add"]}
_EDIT_PATCH = [
    {
        "oldStart": 55,
        "newStart": 55,
        "oldLines": 9,
        "newLines": 17,
        "lines": [
            " - 对于 plan 模式，用户可回复确认",
            " ",
            "+## 补充信息",
            "+",
            "+| 问题 | 平台会话 ID |",
            " ## 待补充信息",
            "-- [ ] 复现命令示例",
            "+- [ ] 会话 239c 中具体命令",
        ],
    }
]


def _edit_user_msg(*, with_patch: bool = True) -> dict:
    """构造 Edit tool_result 的 user message（tool_use_result 挂 msg 顶层）。"""
    msg: dict = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_edit_1",
                    "content": "The file src/a.ts has been updated successfully.",
                }
            ],
        },
    }
    if with_patch:
        msg["tool_use_result"] = {
            "type": "update",
            "filePath": "src/a.ts",
            "content": "...",
            "structuredPatch": _EDIT_PATCH,
            "originalFile": "...",
            "userModified": False,
        }
    return msg


def test_edit_tool_result_attaches_edit_patch_json() -> None:
    """Edit tool_result（带 structuredPatch）→ flat record 附 edit_patch JSON 字段。"""
    records = _extract_sdk_messages(_edit_user_msg(with_patch=True))
    tool_results = [r for r in records if r["event_type"] == "tool_result"]
    assert len(tool_results) == 1
    rec = tool_results[0]
    assert "edit_patch" in rec
    patch = json.loads(rec["edit_patch"])
    assert patch == _EDIT_PATCH
    assert patch[0]["oldStart"] == 55
    # 原 content 行仍带 tool_use_id（配对语义不变）
    assert rec["tool_use_id"] == "toolu_edit_1"
    assert "has been updated" in rec["content"]


def test_tool_result_without_patch_has_no_edit_patch() -> None:
    """tool_result 不带 tool_use_result（Bash/Read 等）→ 不附 edit_patch 字段。"""
    msg = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_bash",
                    "content": "command output",
                }
            ],
        },
    }
    records = _extract_sdk_messages(msg)
    tool_results = [r for r in records if r["event_type"] == "tool_result"]
    assert len(tool_results) == 1
    assert "edit_patch" not in tool_results[0]


def test_tool_use_result_without_structured_patch_no_edit_patch() -> None:
    """tool_use_result 存在但无 structuredPatch（非 Edit / 空 patch）→ 不附字段。"""
    msg = _edit_user_msg(with_patch=False)
    msg["tool_use_result"] = {"type": "update", "filePath": "src/a.ts"}
    records = _extract_sdk_messages(msg)
    tool_results = [r for r in records if r["event_type"] == "tool_result"]
    assert len(tool_results) == 1
    assert "edit_patch" not in tool_results[0]
