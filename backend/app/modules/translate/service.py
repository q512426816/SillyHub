"""翻译编排：值得翻判定 → 双层缓存 → 子进程推理 → 保真重组。

缓存双层（design 边界四问之并发写：纯函数结果幂等）：

- 进程内 LRU（``OrderedDict``，上限 ``settings.translate_cache_max_entries``）；
- Redis best-effort 层（key ``translate:v1:zh:{sha1(text)}``，TTL 7 天）——
  Redis 缺席/超时静默跳过并进入 60s 冷却（避免每请求重复付超时成本）。

缓存粒度=送翻块（≤1000 字符），非整条 item——同前缀文本的摘要/全文两次
请求间无共享是设计接受的代价（design 风险节）。
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from typing import Any

from app.modules.translate.chunking import (
    SourceSegment,
    collect_chunks,
    is_translation_worthy,
    should_translate_segment,
    split_paragraph_segments,
    split_protected,
)
from app.modules.translate.schema import TranslateItemIn, TranslateItemOut

# ── 进程内 LRU ────────────────────────────────────────────────────────────────

_lru_lock = threading.Lock()
_lru: OrderedDict[str, str] = OrderedDict()


def _lru_max() -> int:
    from app.core.config import get_settings

    return max(16, get_settings().translate_cache_max_entries)


def _lru_get(key: str) -> str | None:
    with _lru_lock:
        val = _lru.get(key)
        if val is not None:
            _lru.move_to_end(key)
        return val


def _lru_put(key: str, value: str) -> None:
    with _lru_lock:
        _lru[key] = value
        _lru.move_to_end(key)
        while len(_lru) > _lru_max():
            _lru.popitem(last=False)


# ── Redis best-effort 层 ─────────────────────────────────────────────────────

_REDIS_TTL_SEC = 7 * 24 * 3600
_REDIS_COOLDOWN_SEC = 60.0
_redis_skip_until = 0.0


def _cache_key(text: str, target: str) -> str:
    digest = hashlib.sha1(f"{target}\x00{text}".encode()).hexdigest()
    return f"translate:v1:{target}:{digest}"


def _redis_client() -> Any | None:
    if time.monotonic() < _redis_skip_until:
        return None
    try:
        from app.core.redis import get_redis

        return get_redis()
    except Exception:
        return None


async def _redis_get(key: str) -> str | None:
    client = _redis_client()
    if client is None:
        return None
    try:
        return await client.get(key)
    except Exception:
        global _redis_skip_until
        _redis_skip_until = time.monotonic() + _REDIS_COOLDOWN_SEC
        return None


async def _redis_put(key: str, value: str) -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        await client.set(key, value, ex=_REDIS_TTL_SEC)
    except Exception:
        global _redis_skip_until
        _redis_skip_until = time.monotonic() + _REDIS_COOLDOWN_SEC


def reset_cache_for_tests() -> None:
    """测试隔离：清空 LRU 与 Redis 冷却标记（生产勿调）。"""
    global _redis_skip_until
    with _lru_lock:
        _lru.clear()
    _redis_skip_until = 0.0


# ── 编排主体 ─────────────────────────────────────────────────────────────────


async def translate_items(items: list[TranslateItemIn], target: str = "zh") -> dict:
    """批量翻译编排。返回 ``{engine_ready, reason, items}``（router 直接组装响应）。

    fail-soft 语义：总闸关闭/引擎不可用 → ``engine_ready=False`` 且全部原文
    透传（``translated=False``）；单条不值得翻（中文为主/过短）→ 该条透传但
    不影响 engine_ready。
    """
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.translate_thinking_enabled:
        return {
            "engine_ready": False,
            "reason": "translation disabled by settings",
            "items": [TranslateItemOut(id=i.id, text=i.text, translated=False) for i in items],
        }

    results: dict[str, TranslateItemOut] = {}
    # 实际送翻过（含缓存回填）的 item——translated 标记只认这个集合，不认
    # 「整条 worthy 通过」（2026-10-22-fix-translate-cjk-segments）。
    translated_ids: set[str] = set()
    # 待推理项：item id → 保护切分后的段列表（送翻段占位 None 待填）
    pending: dict[str, list[SourceSegment]] = {}
    # 全局送翻块队列（跨 item 合批送模型）
    pending_chunks: list[str] = []
    # chunk 在 pending_chunks 中的归属填充游标：按 (item_id, seg_idx) 顺序消费
    chunk_owners: list[tuple[str, int]] = []

    for item in items:
        if not is_translation_worthy(item.text):
            results[item.id] = TranslateItemOut(id=item.id, text=item.text, translated=False)
            continue
        # 保护切分 → 再按自然段拆细：段级判定需要能区分"中文段落 + 英文段落"
        segments = split_paragraph_segments(split_protected(item.text))
        pending[item.id] = segments
        for seg_idx, seg in enumerate(segments):
            # 纯空白正文段（如两代码块间的空行）按原样保留，不进翻译管线
            if not seg.translatable or not seg.text.strip():
                continue
            # 段级二次判定：整条 worthy 只看总量，中文正文夹英文代码块时会整条
            # 通过；中文为主的段必须原样保留，禁止送进 en→zh 模型。
            if not should_translate_segment(seg.text):
                continue
            seg_chunks = collect_chunks([seg])
            if not seg_chunks:
                continue
            # 送翻段清空为占位——译文按块顺序回填（重组=保护段原样+译文段拼接）
            pending[item.id][seg_idx] = SourceSegment("", True)
            for chunk in seg_chunks:
                key = _cache_key(chunk, target)
                cached = _lru_get(key)
                if cached is None:
                    cached = await _redis_get(key)
                if cached is not None:
                    _lru_put(key, cached)  # Redis 命中回填 LRU
                    _fill_chunk(pending, item.id, seg_idx, cached)
                    translated_ids.add(item.id)
                else:
                    chunk_owners.append((item.id, seg_idx))
                    pending_chunks.append(chunk)

    engine_ready = True
    reason: str | None = None
    if pending_chunks:
        model_spec = settings.translate_model_dir or settings.translate_model_repo
        from app.modules.translate.engine import get_translator

        translator, engine_error = get_translator(model_spec)
        if translator is None:
            engine_ready = False
            reason = engine_error or "translate engine unavailable"
        else:
            from fastapi.concurrency import run_in_threadpool

            try:
                translations = await run_in_threadpool(translator.translate, pending_chunks)
            except Exception as exc:  # 引擎崩溃（退避/超时）→ fail-soft 全量透传
                engine_ready = False
                reason = f"{type(exc).__name__}: {exc}"
                translations = None
            if translations is not None:
                if len(translations) != len(pending_chunks):  # 协议异常防御
                    engine_ready = False
                    reason = "translation count mismatch"
                else:
                    cache_writes: list[tuple[str, str]] = []
                    for (item_id, seg_idx), chunk, translated in zip(
                        chunk_owners, pending_chunks, translations, strict=True
                    ):
                        _fill_chunk(pending, item_id, seg_idx, translated)
                        translated_ids.add(item_id)
                        cache_writes.append((_cache_key(chunk, target), translated))
                    for key, value in cache_writes:
                        _lru_put(key, value)
                        await _redis_put(key, value)

    if not engine_ready:
        # 引擎不可用：全部原文透传（含已缓存命中的项也回退——统一降级口径，
        # 避免同屏半译半原文的混乱；缓存仍在，恢复后即命中）
        return {
            "engine_ready": False,
            "reason": reason,
            "items": [TranslateItemOut(id=i.id, text=i.text, translated=False) for i in items],
        }

    # 重组：送翻段的占位填充后逐段拼接（保护段原样）
    for item in items:
        if item.id in results:
            continue
        segments = pending[item.id]
        rebuilt = "".join(seg.text for seg in segments)
        results[item.id] = TranslateItemOut(
            id=item.id,
            text=rebuilt,
            translated=item.id in translated_ids,
        )
    return {
        "engine_ready": True,
        "reason": None,
        "items": [results[i.id] for i in items],
    }


def _fill_chunk(
    pending: dict[str, list[SourceSegment]],
    item_id: str,
    seg_idx: int,
    translated: str,
) -> None:
    """把单块译文按序填回所属送翻段（段内块顺序拼接）。

    送翻段在 pending 中临时以 ``SourceSegment(text=已译拼接, translatable=True)``
    累积；块按产生顺序到达（缓存命中乱序于请求流内不会发生——同请求内先查
    缓存后推理，两类写入按 chunk_owners 顺序执行）。
    """
    segs = pending[item_id]
    segs[seg_idx] = SourceSegment(text=segs[seg_idx].text + translated, translatable=True)
