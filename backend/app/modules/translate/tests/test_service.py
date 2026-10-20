"""service 编排测试：总闸 / 值得翻跳过 / 引擎不可用 fail-soft / 缓存 / 重组。"""

from __future__ import annotations

import pytest

from app.modules.translate.schema import TranslateItemIn
from app.modules.translate.service import reset_cache_for_tests, translate_items


class _FakeTranslator:
    """同步假引擎：按块回显 "译[{n}]:{chunk}" 并计数（缓存命中断言用）。"""

    def __init__(self) -> None:
        self.calls = 0

    def translate(self, texts: list[str]) -> list[str]:
        self.calls += 1
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


async def test_pure_code_content_translated_false(fake_translator: _FakeTranslator) -> None:
    text = "```\ngit status\ngit diff\n```"
    out = await translate_items([TranslateItemIn(id="a", text=text)])
    assert out["items"][0].translated is False
    assert out["items"][0].text == text
    assert fake_translator.calls == 0
