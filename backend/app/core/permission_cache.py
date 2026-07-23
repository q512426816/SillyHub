"""集中式权限缓存 helper。

为 ``rbac.has_permission`` 与 PPM ``data_scope`` 热路径提供 Redis 缓存。降级范式抄
``api_key_service``:Redis 故障时业务读写静默降级(认证/鉴权永不因缓存层失败),
只有 ``invalidate_all_permissions`` 失败升 ERROR(D-002@v2,安全事件必须告警)。

熔断器(2026-07-23-backend-permission-perf):Redis 连接失败连续达阈值后,缓存层直接
跳过 Redis 回退查 DB,不等待连接超时。熔断状态为进程级模块变量。

key 设计(D-003@v2 三键分离,闭合 platform/all/everywhere 互相覆盖污染):
- 权限集 platform/all/workspace 各占一键;``everywhere`` 读 platform+all 内存并集,不单独存
- PPM data_scope 占 ``ppm-scope:{user_id}`` 一键

D-005@v1 安全关键:ppm-scope 的 ``manager_project_ids`` 必须反序列化为 ``set[uuid.UUID]``。
JSON 只能存 str,若读回仍是 set[str],则 ``data_scope.problem_operable`` 的
``project_id in manager_pids``(uuid-in-set[str])恒为 False,经理编辑/删除问题会静默失效。
"""

from __future__ import annotations

import json
import time
import uuid

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

# ── 熔断器状态（2026-07-23-backend-permission-perf）──────────────────────
# 进程级模块变量,4 个读写函数共享。熔断器三态:CLOSED(正常)/OPEN(断开)/HALF_OPEN(试探)。
# CLOSED：正常读写 Redis。
# OPEN：直接跳过缓存,不碰 Redis。Cooldown 超时后转为 HALF_OPEN。
# HALF_OPEN：允许 1 次试探性操作,成功→CLOSED,失败→OPEN。
_BreakerState: dict = {
    "failure_count": 0,
    "state": "CLOSED",
    "open_at": 0.0,
}


def _breaker_is_open() -> bool:
    """熔断器是否断开?断开=True（不碰 Redis,直接降级）。

    - CLOSED/HALF_OPEN → False（允许操作）
    - OPEN → 检查 cooldown 是否超时：未超时 → True；超时 → 转 HALF_OPEN,依然返回 True
      （HALF_OPEN 允许一次试探,调用方执行成功后会调 _record_success 恢复,失败会调
      _record_failure 重回 OPEN）。
    """
    threshold = get_settings().permission_cache_breaker_threshold
    if threshold == 0:  # 禁用熔断器
        return False
    state = _BreakerState["state"]
    if state == "CLOSED":
        return False
    if state == "OPEN":
        cooldown = get_settings().permission_cache_breaker_cooldown
        if cooldown > 0 and time.monotonic() - _BreakerState["open_at"] >= cooldown:
            _BreakerState["state"] = "HALF_OPEN"
        return True  # OPEN 或刚转 HALF_OPEN 时仍然阻止后续请求（本次先降级）
    # HALF_OPEN 或意外未知状态→放行试探
    return False


def _record_failure() -> None:
    """记录一次 Redis 操作失败。达标后切换为 OPEN。"""
    threshold = get_settings().permission_cache_breaker_threshold
    if threshold == 0:
        return
    _BreakerState["failure_count"] += 1
    if _BreakerState["failure_count"] >= threshold:
        _BreakerState["state"] = "OPEN"
        _BreakerState["open_at"] = time.monotonic()


def _record_success() -> None:
    """记录一次 Redis 操作成功。HALF_OPEN 时恢复 CLOSED。"""
    if _BreakerState["state"] == "HALF_OPEN":
        _BreakerState["state"] = "CLOSED"
        _BreakerState["failure_count"] = 0
    elif _BreakerState["state"] == "CLOSED":
        _BreakerState["failure_count"] = 0


def _perm_cache_key(user_id: uuid.UUID, *, scope: str, workspace_id: uuid.UUID | None) -> str:
    """构造权限缓存 key(D-003@v2 三键分离)。

    - scope='platform' → ``perm:{user_id}:platform``
    - scope='all'      → ``perm:{user_id}:all``
    - scope='workspace'→ ``perm:{user_id}:{workspace_id}``(workspace_id 必填)

    scope 非法、或 workspace 模式缺 workspace_id → ValueError(编程错误,向上抛,
    不走降级——这是调用方 bug,不是 Redis 故障)。
    """
    if scope == "platform":
        return f"perm:{user_id}:platform"
    if scope == "all":
        return f"perm:{user_id}:all"
    if scope == "workspace":
        if workspace_id is None:
            raise ValueError("workspace_id is required when scope='workspace'")
        return f"perm:{user_id}:{workspace_id}"
    raise ValueError(f"invalid scope: {scope!r} (expected one of 'platform'/'all'/'workspace')")


async def get_cached_permissions(
    user_id: uuid.UUID, *, scope: str, workspace_id: uuid.UUID | None = None
) -> set[str] | None:
    """返回缓存的权限集合;miss 或 Redis 故障返回 None(调用方回退查 DB)。

    scope ∈ {'platform','all','workspace'};workspace 仅 scope='workspace' 时必填。
    非法 scope → ValueError(编程错误)。Redis 故障 / 值损坏 → None(降级,不抛)。
    """
    key = _perm_cache_key(user_id, scope=scope, workspace_id=workspace_id)
    if _breaker_is_open():  # 熔断:直接返回 None(miss),调用方回退查 DB
        return None
    try:
        raw = await get_redis().get(key)
    except Exception as exc:  # D-004 缓存层降级:任何 Redis 故障都回退查 DB
        _record_failure()
        log.warning("permission_cache.read_failed", key=key, error=str(exc))
        return None
    _record_success()
    if raw is None:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            log.warning("permission_cache.read_corrupt", key=key, error="payload not a list")
            return None
        return set(data)
    except (ValueError, TypeError) as exc:  # 值损坏(非合法 JSON)→ 当作 miss
        log.warning("permission_cache.read_corrupt", key=key, error=str(exc))
        return None


async def set_cached_permissions(
    user_id: uuid.UUID,
    perms: set[str],
    *,
    scope: str,
    workspace_id: uuid.UUID | None = None,
) -> None:
    """回填权限集合;Redis 故障静默吞错(D-004 降级,不影响请求)。

    value 为 ``json.dumps(sorted(list(perms)))``(sorted 保证可读、确定性);
    TTL 读 ``settings.permission_cache_ttl``,``ttl<=0`` 跳过 set(禁用缓存,排障用途)。
    """
    key = _perm_cache_key(user_id, scope=scope, workspace_id=workspace_id)
    ttl = get_settings().permission_cache_ttl
    if ttl <= 0:  # 禁用缓存(D-004 排障)
        return
    if _breaker_is_open():  # 熔断:直接跳过,不写 Redis
        return
    value = json.dumps(sorted(list(perms)))
    try:
        await get_redis().set(key, value, ex=ttl)
    except Exception as exc:  # D-004 缓存层降级:写失败不影响请求
        _record_failure()
        log.warning("permission_cache.write_failed", key=key, error=str(exc))
        return
    _record_success()


async def get_cached_ppm_scope(user_id: uuid.UUID) -> dict | None:
    """返回 ``{manager_project_ids: set[uuid.UUID], is_super_admin: bool}``;miss 返回 None。

    D-005@v1 反序列化保证类型:``manager_project_ids`` 必须还原为 ``set[uuid.UUID]``,
    ``is_super_admin`` 强制 ``bool(...)``。反序列化失败(UUID 非法 / 结构损坏)→ 当作
    miss 返回 None(降级,不抛)。
    """
    key = f"ppm-scope:{user_id}"
    if _breaker_is_open():  # 熔断:直接返回 None(miss),调用方回退查 DB
        return None
    try:
        raw = await get_redis().get(key)
    except Exception as exc:  # D-004 缓存层降级
        _record_failure()
        log.warning("permission_cache.ppm_scope_read_failed", key=key, error=str(exc))
        return None
    _record_success()
    if raw is None:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            log.warning(
                "permission_cache.ppm_scope_read_corrupt",
                key=key,
                error="payload not a dict",
            )
            return None
        manager_ids = {uuid.UUID(item) for item in data["manager_project_ids"]}
        return {
            "manager_project_ids": manager_ids,
            "is_super_admin": bool(data["is_super_admin"]),
        }
    except (ValueError, TypeError, KeyError) as exc:  # 反序列化失败 → 当作 miss
        log.warning("permission_cache.ppm_scope_read_corrupt", key=key, error=str(exc))
        return None


async def set_cached_ppm_scope(user_id: uuid.UUID, scope: dict) -> None:
    """回填 PPM 数据范围;Redis 故障静默吞错(D-004 降级)。

    scope 期望结构:``{manager_project_ids: set[uuid.UUID], is_super_admin: bool}``。
    序列化为 ``{manager_project_ids: [uuid-str...], is_super_admin: bool}`` 存 Redis;
    TTL 读 ``settings.permission_cache_ttl``,``ttl<=0`` 跳过。
    """
    key = f"ppm-scope:{user_id}"
    ttl = get_settings().permission_cache_ttl
    if ttl <= 0:
        return
    if _breaker_is_open():  # 熔断:直接跳过,不写 Redis
        return
    payload = {
        "manager_project_ids": [str(u) for u in scope["manager_project_ids"]],
        "is_super_admin": bool(scope["is_super_admin"]),
    }
    value = json.dumps(payload)
    try:
        await get_redis().set(key, value, ex=ttl)
    except Exception as exc:  # D-004 缓存层降级
        _record_failure()
        log.warning("permission_cache.ppm_scope_write_failed", key=key, error=str(exc))
        return
    _record_success()


async def invalidate_all_permissions() -> None:
    """清空 ``perm:*`` + ``ppm-scope:*`` 全部 key(D-002@v2 整体清空)。

    所有权限写 service commit 后调用。失败升 **ERROR** 级日志(structlog 可监控告警),
    不静默、不向上抛、不阻断业务 commit——失效失败是安全事件,可能留下最长 TTL
    (默认 300s)的越权窗口,必须告警;但业务已 commit 的数据不能回滚,故吞异常只记 ERROR。
    """
    try:
        redis = get_redis()
        perm_keys: list[str] = []
        async for cached_key in redis.scan_iter(match="perm:*", count=100):
            perm_keys.append(cached_key)
        ppm_keys: list[str] = []
        async for cached_key in redis.scan_iter(match="ppm-scope:*", count=100):
            ppm_keys.append(cached_key)
        if perm_keys:
            await redis.delete(*perm_keys)
        if ppm_keys:
            await redis.delete(*ppm_keys)
        log.info(
            "permission_cache.invalidated",
            perm_keys=len(perm_keys),
            ppm_keys=len(ppm_keys),
        )
    except Exception as exc:  # D-002@v2:失效失败升 ERROR(安全事件),不向上抛
        log.error("permission_cache.invalidate_failed", error=str(exc))
