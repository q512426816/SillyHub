"""Tests for subagent attribution in ``_extract_sdk_messages``.

2026-06-28-daemon-subagent-transcript task-08 / D-008@v1（Grill X-001）：
``_extract_sdk_messages`` 把 SDK message 展开为 0..N 条 flat record，归属字段
（``parent_tool_use_id`` / ``subagent_type`` / ``depth``）必须注入到*每条* record
——归属是 message 级属性，同 message 的所有 content block 同属一个子代理。

与 ``usage`` / ``session_id`` 区分：后者是 message 级聚合量，仍走 ``stamp()`` 仅注入
首条避免重复累加；归属不经 stamp，循环后统一写入每条（D-008）。

本文件为纯函数白盒测试（``_extract_sdk_messages`` 无 self/class 依赖），不涉及 db。
落库三列（submit_messages → AgentRunLog）+ migration up/down 见 task-13（PG）。
"""

from __future__ import annotations

from app.modules.daemon.run_sync.service import (
    TOOL_RESULT_MAX_CHARS,
    _extract_sdk_messages,
)


def _assistant_msg(
    blocks: list[dict],
    *,
    parent_tool_use_id: str | None = None,
    subagent_type: str | None = None,
    depth: int | None = None,
    message_id: str = "msg-1",
) -> dict:
    msg: dict = {
        "type": "assistant",
        "message": {"id": message_id, "role": "assistant", "content": blocks},
    }
    if parent_tool_use_id is not None:
        msg["parent_tool_use_id"] = parent_tool_use_id
    if subagent_type is not None:
        msg["subagent_type"] = subagent_type
    if depth is not None:
        msg["depth"] = depth
    return msg


def test_main_agent_no_attribution_injected_is_none() -> None:
    """主 agent（无 parent_tool_use_id）→ records 不含归属字段（brownfield 兼容）。"""
    msg = _assistant_msg([{"type": "text", "text": "主 agent 回复"}])
    records = _extract_sdk_messages(msg)
    assert len(records) >= 1
    for r in records:
        assert "parent_tool_use_id" not in r
        assert "subagent_type" not in r
        assert "depth" not in r


def test_subagent_attribution_injected_into_every_record() -> None:
    """D-008 核心：子代理 message 展开的多 block，每条 record 都带归属。"""
    msg = _assistant_msg(
        [
            {"type": "thinking", "thinking": "子代理思考"},
            {"type": "text", "text": "子代理回复"},
            {"type": "tool_use", "id": "toolu_x", "name": "Bash", "input": {"command": "ls"}},
        ],
        parent_tool_use_id="toolu_sub_1",
        subagent_type="general-purpose",
        depth=1,
    )
    records = _extract_sdk_messages(msg)
    # thinking + text + tool_use(stdout) + tool_use(tool_call) ≥ 4 条
    assert len(records) >= 4
    for r in records:
        assert r["parent_tool_use_id"] == "toolu_sub_1"
        assert r["subagent_type"] == "general-purpose"
        assert r["depth"] == 1


def test_partial_attribution_only_present_fields() -> None:
    """仅 parent_tool_use_id 存在（subagent_type/depth 缺失）→ 只注入该字段。"""
    msg = _assistant_msg(
        [{"type": "text", "text": "部分归属"}],
        parent_tool_use_id="toolu_only",
    )
    records = _extract_sdk_messages(msg)
    assert len(records) >= 1
    for r in records:
        assert r["parent_tool_use_id"] == "toolu_only"
        assert "subagent_type" not in r
        assert "depth" not in r


def test_depth_non_int_not_injected() -> None:
    """depth 非整数（如字符串/bool）→ 不注入（防御 daemon 透传异常类型）。"""
    msg = _assistant_msg(
        [{"type": "text", "text": "x"}],
        parent_tool_use_id="toolu_d",
        # 故意传错类型验证防御（depth 传 str，type:ignore 抑制 arg-type）
        depth="1",
    )
    records = _extract_sdk_messages(msg)
    for r in records:
        assert r["parent_tool_use_id"] == "toolu_d"
        assert "depth" not in r  # 字符串 depth 被拒


def test_empty_parent_string_treated_as_main() -> None:
    """parent_tool_use_id 空串 → 视为主 agent，不注入（与 daemon _parentKeyOf 一致）。"""
    msg = _assistant_msg(
        [{"type": "text", "text": "x"}],
        parent_tool_use_id="",
    )
    records = _extract_sdk_messages(msg)
    for r in records:
        assert "parent_tool_use_id" not in r


def test_usage_still_first_record_only_while_attribution_every_record() -> None:
    """usage 仍首条 stamp（不重复），归属每条都有——两者机制独立（D-008 vs stamp）。"""
    msg = _assistant_msg(
        [
            {"type": "text", "text": "a"},
            {"type": "text", "text": "b"},
        ],
        parent_tool_use_id="toolu_mix",
        subagent_type="Explore",
        depth=2,
    )
    msg["message"]["usage"] = {"input_tokens": 100, "output_tokens": 50}
    records = _extract_sdk_messages(msg)
    assert len(records) == 2
    # usage 只在首条
    assert records[0].get("usage") == {"input_tokens": 100, "output_tokens": 50}
    assert "usage" not in records[1]
    # 归属每条都有
    for r in records:
        assert r["parent_tool_use_id"] == "toolu_mix"
        assert r["subagent_type"] == "Explore"
        assert r["depth"] == 2


def _user_tool_result_msg(text: str, *, tool_use_id: str = "toolu_1") -> dict:
    """构造 user message（含单个 tool_result block）喂给 ``_extract_sdk_messages``。"""
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": text}],
        },
    }


def test_tool_result_long_output_truncated_with_annotation() -> None:
    """ql-20260709-001：tool_result 超 TOOL_RESULT_MAX_CHARS 截断 + 中文标注。

    回归 sillyspec scan 59 行输出被原 3000 上限砍尾的 bug——放宽到 100000 后，
    超长输出截断并追加标注保留原始长度信息。
    """
    long_text = "x" * (TOOL_RESULT_MAX_CHARS + 500)
    records = _extract_sdk_messages(_user_tool_result_msg(long_text, tool_use_id="toolu_long"))
    assert len(records) == 1
    annotation = f"\n...(输出过长，已截断，共 {len(long_text)} 字符)"
    assert records[0]["content"] == "[TOOL_RESULT] " + "x" * TOOL_RESULT_MAX_CHARS + annotation
    # tool_use_id 透传（ql-20260706-002 tool_kind 配对回查用）
    assert records[0]["tool_use_id"] == "toolu_long"


def test_tool_result_short_output_not_truncated() -> None:
    """短输出（< TOOL_RESULT_MAX_CHARS）原样保留、不加标注。"""
    records = _extract_sdk_messages(
        _user_tool_result_msg("scan 完成，共 59 行", tool_use_id="toolu_short")
    )
    assert len(records) == 1
    assert records[0]["content"] == "[TOOL_RESULT] scan 完成，共 59 行"
