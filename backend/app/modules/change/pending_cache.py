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

epoch 竞态：读侧先取 epoch 再查 DB，回填（set）**复用读时捕获的 epoch**——
若中途写入方 commit+bump，条目带旧 epoch 落缓存，下一位读者 epoch 不匹配即
重算，无长期脏缓存；bump 必须在数据 commit **之后**调用（写入方约定），
保证「epoch 已新 ⇒ 数据已新」。set 决不重读当前 epoch：DB 现算之后才读会把
旧集合配上新 epoch 盖章（中毒缓存直至 TTL），恰是上述不变量要防的反例。
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


async def get_cached_pending_keys(
    workspace_id: uuid.UUID, location: str | None
) -> tuple[int | None, set[str] | None]:
    """读侧入口：返回（读时 epoch, 命中集）。

    - 命中 → ``(epoch, keys)``；未命中 → ``(epoch, None)``；Redis 不可用 /
      epoch 键不存在 → ``(None, None)``（调用方回退现算）。
    - 读时 epoch 必须透传给 ``set_cached_pending_keys`` 盖章（见模块 docstring
      的 epoch 竞态段）——set 侧不再重读，防「现算后写入方 bump」的中毒窗口。
    """
    try:
        redis = get_redis()
        epoch = await redis.get(_epoch_key(workspace_id))
        if epoch is None:
            return None, None
        epoch_int = int(epoch)
        raw = await redis.get(_set_key(workspace_id, location))
        if raw is None:
            return epoch_int, None
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("epoch") != epoch_int:
            return epoch_int, None
        keys = payload.get("keys")
        if not isinstance(keys, list):
            return epoch_int, None
        return epoch_int, {k for k in keys if isinstance(k, str)}
    except Exception:
        return None, None


async def set_cached_pending_keys(
    workspace_id: uuid.UUID,
    location: str | None,
    keys: set[str],
    *,
    epoch: int | None = None,
) -> None:
    """写入缓存条目（best-effort）。

    ``epoch`` 传 :func:`get_cached_pending_keys` 返回的**读时值**——条目按它
    盖章，本函数不重读当前 epoch（重读会把现算期间写入方 bump 后的新 epoch
    盖到旧数据上，中毒缓存直至 TTL）。``epoch=None``（读时键不存在，或未传）
    才走键缺失初始化分支：NX 初始化为 0——不用裸 SET 覆盖，防把期间他人
    INCR 出的 epoch 拉回 0 使已盖章 0 的旧条目重新匹配；条目仍 stamp 0，
    期间若有 bump 则 0 ≠ 当前值，下一位读者失配重算。
    """
    try:
        redis = get_redis()
        if epoch is None:
            # 读时 epoch 键不存在：NX 初始化为 0——不覆盖期间他人的 INCR
            # （覆盖会把 epoch 拉回 0，使已 stamp 0 的旧条目重新匹配）。
            # 条目 stamp 0：期间若有 bump 则 0 ≠ 当前值，下一位读者失配重算。
            # 本函数任何路径都不读当前 epoch（读了就是把新 epoch 盖到旧数据上）。
            await redis.set(_epoch_key(workspace_id), "0", ex=_PENDING_EPOCH_TTL_SECONDS, nx=True)
            epoch = 0
        payload = json.dumps({"epoch": int(epoch), "keys": sorted(keys)})
        await redis.set(_set_key(workspace_id, location), payload, ex=_PENDING_SET_TTL_SECONDS)
    except Exception as exc:
        log.warning(
            "change_pending_keys_cache_set_failed",
            workspace_id=str(workspace_id),
            error=str(exc),
        )
