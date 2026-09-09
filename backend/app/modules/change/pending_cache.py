"""变更列表 pending_review 集 Redis 缓存（ql-20260909-016）。

``ChangeService._resolve_pending_change_keys``（pending_review_only 过滤，
变更列表「进行中+聚焦待我处理」模式下每次翻页/自动重取触发）原每次都要拉
workspace 全部 change 的 ``latest_progress`` 肥 JSON（serializeForSync 六表，
单条数十 KB 级）后 Python 算 pending 集。本模块提供 read-through 缓存：

- 缓存条目 ``change_pending_keys:{workspace_id}:{location|_}`` →
  ``{"epoch": N, "keys": [...]}``，TTL 300s 硬顶（epoch 漏 bump 的兜底）；
- 失效：写入方 ``bump_pending_epoch`` INCR ``change_pending_epoch:{workspace_id}``
  ——挂四处 commit 后（progress 推送 / 平台删除 / 归档投影 / reparse），读侧
  条目 epoch ≠ 当前 epoch 即重算覆盖；
- best-effort：Redis 不可用一律返回 None / 静默吞异常，调用方回退现算
  （与 permission_cache 降级范式同款，零行为变化）。

epoch 竞态：读侧先取 epoch 再查 DB——若中途写入方 commit+bump，条目带旧
epoch 落缓存，下一位读者 epoch 不匹配即重算，无长期脏缓存；bump 必须在
数据 commit **之后**调用（写入方约定），保证「epoch 已新 ⇒ 数据已新」。
"""

from __future__ import annotations

import json
import uuid

from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

# 缓存条目 TTL（秒）——epoch 失效是主通道，TTL 只兜漏 bump 的极端场景。
_PENDING_SET_TTL_SECONDS = 300
# epoch 键 TTL（秒）——长期驻留即可，过期重建从 0 计也无碍（条目一并失效）。
_PENDING_EPOCH_TTL_SECONDS = 7 * 24 * 3600


def _epoch_key(workspace_id: uuid.UUID) -> str:
    return f"change_pending_epoch:{workspace_id}"


def _set_key(workspace_id: uuid.UUID, location: str | None) -> str:
    return f"change_pending_keys:{workspace_id}:{location or '_'}"


async def bump_pending_epoch(workspace_id: uuid.UUID | None) -> None:
    """数据 commit 后调用：workspace 级 pending 集失效（INCR epoch；best-effort）。

    ``workspace_id=None``（shk_live 过渡期行）不影响任何 workspace 过滤的
    pending 集，直接跳过。
    """
    if workspace_id is None:
        return
    try:
        key = _epoch_key(workspace_id)
        redis = get_redis()
        epoch = await redis.incr(key)
        if epoch == 1:
            await redis.expire(key, _PENDING_EPOCH_TTL_SECONDS)
    except Exception as exc:
        log.warning(
            "change_pending_epoch_bump_failed", workspace_id=str(workspace_id), error=str(exc)
        )


async def get_cached_pending_keys(workspace_id: uuid.UUID, location: str | None) -> set[str] | None:
    """命中（epoch 匹配）返回缓存集；未命中/Redis 不可用返回 None（回退现算）。"""
    try:
        redis = get_redis()
        epoch = await redis.get(_epoch_key(workspace_id))
        if epoch is None:
            return None
        raw = await redis.get(_set_key(workspace_id, location))
        if raw is None:
            return None
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("epoch") != int(epoch):
            return None
        keys = payload.get("keys")
        if not isinstance(keys, list):
            return None
        return {k for k in keys if isinstance(k, str)}
    except Exception:
        return None


async def set_cached_pending_keys(
    workspace_id: uuid.UUID, location: str | None, keys: set[str]
) -> None:
    """写入缓存条目（带当前 epoch；best-effort）。"""
    try:
        redis = get_redis()
        epoch = await redis.get(_epoch_key(workspace_id))
        if epoch is None:
            # 尚无任何 bump（无写入过）：初始化为 0 并设 TTL，条目落同 epoch。
            # 用 SET 而非 INCR——INCR 会把键置 1 而条目存 0，首次写入即自失配
            # （读侧恒 miss，缓存形同虚设）。并发双初始化最坏互相覆盖回 0，
            # 已有条目 epoch 不匹配 → 多一次重算，无害。
            await redis.set(_epoch_key(workspace_id), "0", ex=_PENDING_EPOCH_TTL_SECONDS)
            epoch = "0"
        payload = json.dumps({"epoch": int(epoch), "keys": sorted(keys)})
        await redis.set(_set_key(workspace_id, location), payload, ex=_PENDING_SET_TTL_SECONDS)
    except Exception as exc:
        log.warning(
            "change_pending_keys_cache_set_failed",
            workspace_id=str(workspace_id),
            error=str(exc),
        )
