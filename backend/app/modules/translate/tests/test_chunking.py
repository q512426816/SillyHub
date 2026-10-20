"""chunking 纯函数测试：保护切分 / 值得翻判定 / 分块保真（零外部依赖）。"""

from __future__ import annotations

import pytest

from app.modules.translate.chunking import (
    SourceSegment,
    collect_chunks,
    is_translation_worthy,
    split_protected,
    split_translatable,
)

# -- split_protected ---------------------------------------------------------------


def test_pure_code_block_is_single_protected_segment() -> None:
    text = "```python\nprint('hi')\n```"
    segs = split_protected(text)
    assert segs == [SourceSegment(text=text, translatable=False)]


def test_prose_and_inline_code_and_url_split() -> None:
    text = "I will read `src/app.py` and docs at https://example.com/a?b=1 then continue."
    segs = split_protected(text)
    kinds = [s.translatable for s in segs]
    # 交替：正文 / 行内代码 / 正文 / URL / 正文
    assert kinds == [True, False, True, False, True]
    assert segs[1].text == "`src/app.py`"
    assert segs[3].text == "https://example.com/a?b=1"
    assert "".join(s.text for s in segs) == text


def test_fenced_block_protected_across_lines() -> None:
    text = "First run this:\n```\nSELECT 1;\nSELECT 2;\n```\nthen check www.foo.bar/x for results."
    segs = split_protected(text)
    fenced = [s for s in segs if not s.translatable]
    assert any("SELECT 1;" in s.text for s in fenced)
    assert any(s.text == "www.foo.bar/x" for s in fenced)
    assert "".join(s.text for s in segs) == text


def test_unterminated_fence_fails_open_as_prose() -> None:
    # 流式截断形态：未闭合围栏不匹配保护 → 全文按正文（fail-open 设计）
    text = "```python\nprint('streaming...'"
    segs = split_protected(text)
    assert all(s.translatable for s in segs)


def test_adjacent_same_kind_merged() -> None:
    # URL 紧跟行内代码（中间无正文）→ 两个相邻保护段合并为一个
    text = "see `a.py`https://x.io/y now"
    segs = split_protected(text)
    assert [s.translatable for s in segs] == [True, False, True]


# -- is_translation_worthy ---------------------------------------------------------


def test_short_text_not_worthy() -> None:
    assert not is_translation_worthy("too short")


def test_cjk_dominant_not_worthy() -> None:
    assert not is_translation_worthy(
        "这段思考内容大部分都是中文字符，只有少量 English words 夹杂其中。"
    )


def test_latin_dominant_worthy() -> None:
    assert is_translation_worthy(
        "The agent decided to read the config file first before running the migration."
    )


def test_no_letters_not_worthy() -> None:
    assert not is_translation_worthy("12345 67890 !!! ??? ... /// $$$ %%% 12345678901234")


def test_empty_not_worthy() -> None:
    assert not is_translation_worthy("   \n\t  ")


# -- split_translatable ------------------------------------------------------------


def test_short_text_single_chunk() -> None:
    assert split_translatable("hello world") == ["hello world"]


def test_empty_text_no_chunks() -> None:
    assert split_translatable("") == []


def test_paragraph_boundaries_reassembly_fidelity() -> None:
    text = "Para one here.\n\nPara two here.\n\n\nPara three after multi-newline."
    chunks = split_translatable(text, max_chars=1000)
    assert "".join(chunks) == text


def test_long_text_chunk_caps_and_fidelity() -> None:
    sentence = "This is a reasonably long sentence about agent reasoning steps. "
    text = sentence * 200  # ~10800 字符
    chunks = split_translatable(text, max_chars=1000)
    assert all(len(c) <= 1000 for c in chunks)
    assert "".join(chunks) == text
    assert len(chunks) >= 10  # 确实切了


def test_sentence_split_on_oversize_paragraph() -> None:
    text = "First sentence ends here. " * 150  # 无换行单段 ~3300 字符
    chunks = split_translatable(text, max_chars=1000)
    assert all(len(c) <= 1000 for c in chunks)
    assert "".join(chunks) == text
    # 句界切分：块数应远少于硬切上限（3300/1000=4 块足矣）
    assert len(chunks) <= 5


def test_hard_split_unsplittable_run() -> None:
    text = "x" * 2500  # 无句界无段界
    chunks = split_translatable(text, max_chars=1000)
    assert [len(c) for c in chunks] == [1000, 1000, 500]
    assert "".join(chunks) == text


def test_max_chars_zero_raises() -> None:
    with pytest.raises(ValueError):
        split_translatable("abc", max_chars=0)


def test_greedy_packing_fills_budget() -> None:
    # 两段各 400 字符 → 合并为一块 ≤1000
    text = "a" * 400 + "\n\n" + "b" * 400
    chunks = split_translatable(text, max_chars=1000)
    assert len(chunks) == 1
    assert "".join(chunks) == text


# -- collect_chunks ----------------------------------------------------------------


def test_collect_chunks_only_translatable() -> None:
    segs = [
        SourceSegment("hello ", True),
        SourceSegment("`code`", False),
        SourceSegment("world", True),
    ]
    assert collect_chunks(segs) == ["hello ", "world"]
