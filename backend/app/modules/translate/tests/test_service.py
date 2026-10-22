"""service 编排测试：总闸 / 值得翻跳过 / 引擎不可用 fail-soft / 缓存 / 重组。"""

from __future__ import annotations

import pytest

from app.modules.translate.chunking import collect_chunks, split_protected
from app.modules.translate.schema import TranslateItemIn
from app.modules.translate.service import (
    _cache_key,
    _lru_put,
    reset_cache_for_tests,
    translate_items,
)


class _FakeTranslator:
    """同步假引擎：按块回显 "译[{n}]:{chunk}" 并计数（缓存命中断言用）。"""

    def __init__(self) -> None:
        self.calls = 0
        self.batches: list[list[str]] = []

    def translate(self, texts: list[str]) -> list[str]:
        self.calls += 1
        self.batches.append(list(texts))
        return [f"译[{i}]:{t}" for i, t in enumerate(texts)]


@pytest.fixture(autouse=True)
def _reset_caches():
    reset_cache_for_tests()
    yield
    reset_cache_for_tests()


@pytest.fixture()
def fake_translator(monkeypatch: pytest.MonkeyPatch) -> _FakeTranslator:
    t = _FakeTranslator()
    monkeypatch.setattr("app.modules.translate.engine.get_translator", lambda spec: (t, None))
    return t


async def test_master_switch_disabled_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "translate_thinking_enabled", False)
    out = await translate_items([TranslateItemIn(id="a", text="hello world agent")])
    assert out["engine_ready"] is False
    assert out["items"][0].text == "hello world agent"
    assert out["items"][0].translated is False


async def test_unworthy_items_passthrough_without_engine(
    fake_translator: _FakeTranslator,
) -> None:
    out = await translate_items(
        [
            TranslateItemIn(id="cjk", text="这段内容以中文为主，不需要翻译处理，直接透传即可。"),
            TranslateItemIn(id="short", text="ok"),
        ]
    )
    assert out["engine_ready"] is True
    assert all(i.translated is False for i in out["items"])
    assert fake_translator.calls == 0  # 全跳过 → 零推理


async def test_engine_unavailable_fail_soft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.translate.engine.get_translator", lambda spec: (None, "boom"))
    out = await translate_items(
        [TranslateItemIn(id="a", text="The agent reads the file and continues the work.")]
    )
    assert out["engine_ready"] is False
    assert out["reason"] == "boom"
    assert out["items"][0].text == "The agent reads the file and continues the work."
    assert out["items"][0].translated is False


async def test_translation_reassembly_with_protected_segments(
    fake_translator: _FakeTranslator,
) -> None:
    text = "Run this first:\n```\nls -la\n```\nthen read https://example.com/x for details."
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    item = out["items"][0]
    assert item.translated is True
    # 精确全等：保护段原样 + 送翻段译文（fence 后换行属下段正文，随段送翻）
    assert (
        item.text
        == "译[0]:Run this first:\n"
        + "```\nls -la\n```"
        + "译[1]:\nthen read "
        + "https://example.com/x"
        + "译[2]: for details."
    )
    assert fake_translator.calls == 1


async def test_cache_hit_skips_engine(fake_translator: _FakeTranslator) -> None:
    item = TranslateItemIn(id="a", text="One two three four five six seven eight nine ten.")
    out1 = await translate_items([item])
    assert fake_translator.calls == 1
    out2 = await translate_items([item])
    assert fake_translator.calls == 1  # 全命中缓存，零新增推理
    assert out2["items"][0].text == out1["items"][0].text
    assert out2["items"][0].translated is True


async def test_engine_error_fail_soft(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Boom:
        def translate(self, texts: list[str]) -> list[str]:
            raise RuntimeError("worker died")

    monkeypatch.setattr("app.modules.translate.engine.get_translator", lambda spec: (_Boom(), None))
    out = await translate_items(
        [TranslateItemIn(id="a", text="Some english text that is long enough to translate.")]
    )
    assert out["engine_ready"] is False
    assert "RuntimeError" in (out["reason"] or "")
    assert out["items"][0].translated is False


async def test_lru_eviction_beyond_cap(
    fake_translator: _FakeTranslator, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "translate_cache_max_entries", 16)
    # 8 条不同文本（每条至少一块）填满后逐条再翻——淘汰后重翻不报错
    items = [
        TranslateItemIn(id=f"i{n}", text=f"unique text number {n} with enough words to pass gate.")
        for n in range(8)
    ]
    out = await translate_items(items)
    assert all(i.translated for i in out["items"])
    out2 = await translate_items(items)
    assert all(i.translated for i in out2["items"])


async def test_redis_absence_is_silent(
    fake_translator: _FakeTranslator, monkeypatch: pytest.MonkeyPatch
) -> None:
    # get_redis 抛异常 → 冷却标记 + 静默跳过（不 crash、不阻断翻译）
    def _raise() -> None:
        raise RuntimeError("redis down")

    monkeypatch.setattr("app.core.redis.get_redis", _raise)
    out = await translate_items(
        [TranslateItemIn(id="a", text="Redis is down but translation must still work fine.")]
    )
    assert out["engine_ready"] is True
    assert out["items"][0].translated is True


async def test_cjk_body_with_code_block_not_translated(
    fake_translator: _FakeTranslator,
) -> None:
    """生产事故形态：中文正文 + 英文代码块整条 worthy 通过，但中文段必须原样保留。

    修复前：代码块保护后中文正文仍送进 en→zh 模型 → "命令："变"发件人:"、
    大段中文消失，且 translated=true（2026-10-22 生产实测）。
    """
    text = (
        "命令：\n```\ndocker compose exec backend python -m app.modules.translate\n```\n"
        "落地后站点恢复正常可用，注意观察日志。"
    )
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    item = out["items"][0]
    assert item.text == text  # 原文无损
    assert item.translated is False  # 未发生任何送翻
    assert fake_translator.calls == 0  # 零推理


async def test_mixed_cjk_and_english_paragraphs(fake_translator: _FakeTranslator) -> None:
    """中文段落保留、英文段落正常送翻（自然段级拆分后的混合内容）。"""
    cjk_para = "先排查配置文件。\n\n"
    en_para = (
        "The server returned an error because the cache directory was missing, "
        "so the build failed before packaging."
    )
    text = cjk_para + en_para
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    item = out["items"][0]
    assert item.translated is True
    assert item.text.startswith(cjk_para)  # 中文段原样
    assert item.text != text  # 英文段已被翻译
    assert fake_translator.calls == 1


async def test_cjk_quotes_preserved_and_no_backslash_garbage(
    fake_translator: _FakeTranslator,
) -> None:
    """生产复现（2026-10-22）：源端中文引用必须原样保留，送翻块零中文 token。

    修复前 opus-mt 收到中文 token 时解码崩溃，中文引用被译成 "^\\ "、整段变
    连续反斜杠；修复后中文片段作为保护段不送模型。
    """
    text = (
        'The user gave a decision: "合并键应该是工区不是厂房" (bug report) — '
        'record D-001 with title "单位级明细表合并键=工区（用户实测反馈）" now.'
    )
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    item = out["items"][0]
    # 中文引用逐字保留
    assert "合并键应该是工区不是厂房" in item.text
    assert "单位级明细表合并键" in item.text
    assert "工区（用户实测反馈）" in item.text
    # 无连续反斜杠乱码（≥3 个 \\ 视为解码崩溃指纹）
    assert "\\\\\\" not in item.text
    # 送进模型的块里不得有任何中文 token
    import re as _re

    cjk_re = _re.compile(r"[　-〿＀-￯㐀-䶿一-鿿]")
    for batch in fake_translator.batches:
        for chunk in batch:
            assert not cjk_re.search(chunk), f"中文 token 泄漏进送翻块: {chunk!r}"


async def test_pure_code_content_translated_false(fake_translator: _FakeTranslator) -> None:
    text = "```\ngit status\ngit diff\n```"
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    assert out["items"][0].translated is False
    assert out["items"][0].text == text
    assert fake_translator.calls == 0


async def test_partial_cache_hit_keeps_chunk_order(fake_translator: _FakeTranslator) -> None:
    """2026-10-23-translate-budget-align / FR-02：部分命中缓存的多块段块序不乱。

    修复前：缓存命中块扫描期立即回填、推理块推理后追加——中间块命中时译文
    变成 [块2译文, 块1译文, 块3译文]（缓存块全部前置，归档 review P2）。
    修复后按块产生顺序全序回填，任何部分命中组合都与原文块序逐块对齐。
    """
    # 每句内容唯一（重复同句会让相邻块内容相同 → 同一缓存 key 连带命中，
    # 构不出「部分命中」形态）
    text = "".join(
        f"Unique english sentence number {i} for chunk ordering regression. " for i in range(40)
    )  # ~2600 字符单段（无段界/无保护标记）→ 3 块
    chunks = collect_chunks(split_protected(text))
    assert len(chunks) == 3
    assert len(set(chunks)) == 3  # 块内容互异，缓存 key 互不相同
    # 预填中间块缓存（模拟部分命中：LRU 淘汰/Redis TTL 过期后的跨请求残缺形态）
    _lru_put(_cache_key(chunks[1], "zh"), "CACHED[1]")

    out = await translate_items([TranslateItemIn(id="a", text=text)])
    item = out["items"][0]
    assert item.translated is True
    # 只有未命中的块1/块3进引擎（fake 按批内序号回显 "译[i]:<chunk>"）
    assert fake_translator.batches == [[chunks[0], chunks[2]]]
    # 全序拼装：块1译文 + 缓存中间块 + 块3译文（修复前 CACHED[1] 打头）
    assert item.text == f"译[0]:{chunks[0]}CACHED[1]译[1]:{chunks[2]}"
