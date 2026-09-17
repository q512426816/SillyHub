"""思考级别（thinking level）查询/切换服务（2026-09-14-session-thinking-level
task-05 / FR-04 / FR-05）。

统一入口 ``get_session_thinking_levels`` / ``set_session_thinking_level``——
照 compact.py 先例三件（三校验 + RPC 派发 + 异常映射）：

- 三校验（D-001/D-002 backend 层，照 compact.py / inject 先例）：① 会话归属 +
  活跃（``_get_owned_session_for_update``，404 不泄露存在性；status≠active 拒
  ——reconnecting/ended/failed/pending 全覆盖）；② lease/runtime 绑定不变量
  （RPC 寻址依赖 runtime_id）；③ provider caps
  ``get_provider_caps(provider)["thinking_level"]`` 为 false 拒（cursor/未知
  引擎，task-01 @generated 表）。校验持锁完成、commit 释放行锁后再派发（照
  interrupt_session「先 commit 再发 WS」模式，RPC 最长 15s 不拖行锁）。
- GET（FR-04）状态校验轻于 POST：查询不打断语义，只查归属/活跃/caps，不加
  忙轮守卫；POST（FR-05）额外做七档词表校验（400）。ql-20260917-008 起忙轮
  不再 409——覆盖式暂存 ``session.pending_thinking_level``（「最后一次为准」），
  run 终态钩子（close_run_steps）经本模块 ``apply_pending_thinking_level``
  应用到 daemon 后清列。
- RPC 派发（D-002 总体方案）：``ws_hub.send_rpc(daemon_id, "session_get_
  thinking_levels" / "session_set_thinking_level", {"session_id", ...},
  timeout=15)``（task-03 daemon 侧 registerRpcHandler 契约按名对接，跨 wave
  无类型依赖）。GET 响应无 error 字段——离线/超时走既有 504 AppError 上抛，
  RemoteError 统一 502（method_not_found → 升级提示文案）；POST 照 compact
  口径三异常映射结构化 ``{ok: False, error}``（HTTP 200，调用方可修复的失败
  不抛 5xx），DaemonRpcConflict（rpc_id 碰撞实务不可能）不捕获，走既有
  AppError 兜底。

D-007：ws_hub 延迟 import（照 compact.py / control.py 先例，patch
``app.modules.daemon.ws_hub.get_daemon_ws_hub`` 可拦截）。
"""

from __future__ import annotations

import uuid

from app.core.errors import AppError
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.schema import (
    SessionThinkingLevelResponse,
    SessionThinkingLevelsResponse,
)

from .errors import (
    DaemonSessionInvariantViolation,
    DaemonSessionNotActive,
)
from .helpers import _resolve_daemon_id_for_runtime

# 七档平台词表（FR-02 单源的 backend 镜像常量）。唯一维护源 =
# ``sillyhub-daemon/src/interactive/thinking-levels.ts`` 的 ``THINKING_LEVELS``
# （task-02 NEW；pi rpc.md 七档 off/minimal/low/medium/high/xhigh/max，xhigh/
# max 按模型条件）——无跨语言单源通道，**两侧注释互指钉死：改档位必须两侧
# 同步**（backend 不 import daemon 任何 TS 产物）。backend 消费点：POST 切换
# 词表校验（本文件）；frontend 消费点：预会话 picker 档位（task-06）。
VALID_THINKING_LEVELS: tuple[str, ...] = (
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
)

# 两 RPC method（daemon 侧 registerRpcHandler，task-03 落地；旧 daemon 无该
# handler → error.code='method_not_found' → 升级提示文案，brownfield 兼容）。
GET_THINKING_LEVELS_RPC_METHOD = "session_get_thinking_levels"
SET_THINKING_LEVEL_RPC_METHOD = "session_set_thinking_level"
# RPC 显式超时（秒）——对齐 compact.py COMPACT_RPC_TIMEOUT_SECONDS=15s 先例
# （daemon 侧 driver 等引擎回执，send_rpc 默认 10s 偏紧）。
THINKING_LEVEL_RPC_TIMEOUT_SECONDS = 15

# 三异常 → 结构化 error 文案（design §兼容策略；中文口径，照 compact 先例）。
_ERROR_DAEMON_OFFLINE = "daemon 离线"
_ERROR_DAEMON_TIMEOUT = "daemon 未响应思考级别切换命令"
_ERROR_DAEMON_UPGRADE = "daemon 未支持思考级别，请升级 daemon"


class DaemonSessionThinkingLevelUnsupported(AppError):
    """会话引擎不支持思考级别（provider caps ``thinking_level=false``，D-001）。

    cursor / 未知引擎（get_provider_caps 未知 provider 默认拒绝）走本 409；
    不落 errors.py 家族文件（本变更 allowed_paths 约束），随 thinking_level
    子域落点（调用方仅本模块，无跨模块导入需求——照 compact.py 同款取舍）。
    """

    code = "HTTP_409_DAEMON_SESSION_THINKING_LEVEL_UNSUPPORTED"
    http_status = 409


class DaemonSessionThinkingLevelInvalid(AppError):
    """POST 切换携带非法档位（不在七档平台词表内，FR-05）。

    400 而非 422：档位值是业务词表校验（非请求结构错误），design §兼容策略
    「backend 校验 400」钉定；文案带合法档位清单便于前端定位。
    """

    code = "HTTP_400_DAEMON_SESSION_THINKING_LEVEL_INVALID"
    http_status = 400


class DaemonSessionThinkingLevelsUnavailable(AppError):
    """GET 档位查询 RPC 远端失败（DaemonRpcRemoteError）→ 502。

    GET 响应 DTO（SessionThinkingLevelsResponse）无 error 字段（design
    §接口定义）——RemoteError 不降级 200 假数据，统一映射本 502 结构化上抛
    （method_not_found → 升级提示文案，业务错误 → 远端原文）。离线/超时
    （504 AppError）不经本类，走既有语义自然上抛。
    """

    code = "HTTP_502_DAEMON_SESSION_THINKING_LEVELS_UNAVAILABLE"
    http_status = 502


async def get_session_thinking_levels(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionThinkingLevelsResponse:
    """三校验 + ws RPC 档位查询入口（FR-04，端点唯一调用方 session_crud）。

    GET 状态校验轻于 POST（模块 docstring）——查询是无副作用动作，不加忙轮
    守卫。RPC 回执映射 ``{levels, current}``；levels/current 防御性收敛（非
    str 元素弃置、current 非 str 置 None）。
    """
    try:
        session = await svc._get_owned_session_for_update(session_id, user_id)
        if session.status != "active":
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session.status}).",
                details={"session_id": str(session_id), "status": session.status},
            )
        if session.lease_id is None or session.runtime_id is None:
            raise DaemonSessionInvariantViolation(
                f"Active session '{session_id}' has no lease/runtime binding.",
                details={"session_id": str(session_id)},
            )
        provider = session.provider or ""
        if not get_provider_caps(provider)["thinking_level"]:
            raise DaemonSessionThinkingLevelUnsupported(
                f"会话引擎 '{provider}' 不支持思考级别。",
                details={"session_id": str(session_id), "provider": provider},
            )
        # 释放行锁再派发（照 compact.py 先例）：RPC 最长挂 15s，不拖会话行锁。
        await svc._session.commit()
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    return await _levels_via_rpc(svc, session)


async def set_session_thinking_level(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    level: str,
) -> SessionThinkingLevelResponse:
    """三校验 + 词表/忙轮守卫 + ws RPC 档位切换入口（FR-05）。

    校验语义见模块 docstring；词表校验在最前（纯函数、无 DB 依赖）；成功
    路径返回 ``ok=True``，RPC 失败/旧 daemon 路径返回 ``ok=False`` + 结构化
    ``error``（HTTP 200），调用方错误（归属 404 / 非活跃 409 / caps 409 /
    非法档 400 / 忙轮 409）仍以 AppError 抛出由全局 handler 映射。
    """
    if level not in VALID_THINKING_LEVELS:
        raise DaemonSessionThinkingLevelInvalid(
            f"不支持的思考级别 '{level}'（合法档位：{'/'.join(VALID_THINKING_LEVELS)}）。",
            details={"session_id": str(session_id), "level": level},
        )

    try:
        session = await svc._get_owned_session_for_update(session_id, user_id)
        if session.status != "active":
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session.status}).",
                details={"session_id": str(session_id), "status": session.status},
            )
        if session.lease_id is None or session.runtime_id is None:
            raise DaemonSessionInvariantViolation(
                f"Active session '{session_id}' has no lease/runtime binding.",
                details={"session_id": str(session_id)},
            )
        provider = session.provider or ""
        if not get_provider_caps(provider)["thinking_level"]:
            raise DaemonSessionThinkingLevelUnsupported(
                f"会话引擎 '{provider}' 不支持思考级别。",
                details={"session_id": str(session_id), "provider": provider},
            )
        # ql-20260917-008：忙轮不再 409——覆盖式暂存 session.pending_thinking_level
        # （「最后一次为准」，连续切档后者盖前者），返回 queued=True 由前端提示
        # 「本轮结束后生效」；run 终态钩子（close_run_steps）取暂存档经 RPC 应用
        # 后清列。应用失败保留暂存（下一轮重试/用户重切覆盖），不丢用户意图。
        current = await svc._get_current_run(session.id)
        if current is not None:
            session.pending_thinking_level = level
            svc._session.add(session)
            await svc._session.commit()
            return SessionThinkingLevelResponse(ok=True, queued=True)
        # 释放行锁再派发（照 compact.py 先例）：RPC 最长挂 15s，不拖会话行锁。
        await svc._session.commit()
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    return await _set_via_rpc(svc, session, level=level)


async def _levels_via_rpc(
    svc,
    session,
) -> SessionThinkingLevelsResponse:
    """GET 分路：ws RPC ``session_get_thinking_levels`` → {levels, current}。

    离线/超时不捕获——既有 504 AppError 语义自然上抛（GET 响应无 error 字段，
    不降级 200 假数据）；RemoteError 统一映射 502（升级提示/远端原文）。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    runtime_id = session.runtime_id
    daemon_id = (
        await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
        if runtime_id is not None
        else None
    )
    if daemon_id is None or runtime_id is None:
        # runtime 行缺失/未绑定 daemon 实体——与 send_rpc 的离线判定同收敛
        # （compact.py docstring 先例）；GET 无结构化 error，走既有 504 上抛。
        raise DaemonRuntimeOffline(
            "daemon 离线",
            details={"session_id": str(session.id), "runtime_id": str(runtime_id)},
        )
    hub = get_daemon_ws_hub()
    try:
        result = await hub.send_rpc(
            daemon_id,
            GET_THINKING_LEVELS_RPC_METHOD,
            {"session_id": str(session.id)},
            timeout=THINKING_LEVEL_RPC_TIMEOUT_SECONDS,
        )
    except DaemonRpcRemoteError as exc:
        raise DaemonSessionThinkingLevelsUnavailable(_remote_thinking_error(exc)) from exc
    # DaemonRuntimeOffline / DaemonRpcTimeout 有意不捕获（模块 docstring）；
    # DaemonRpcConflict 同（rpc_id UUID4 碰撞实务不可能）。
    return _map_levels_result(result)


async def _set_via_rpc(
    svc,
    session,
    *,
    level: str,
) -> SessionThinkingLevelResponse:
    """POST 分路：ws RPC ``session_set_thinking_level`` → {ok, error}。

    三异常映射结构化 error（照 compact._compact_via_rpc 逐字同款）；
    DaemonRpcConflict 不捕——留既有 AppError 兜底如实暴露代码缺陷。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    runtime_id = session.runtime_id
    daemon_id = (
        await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
        if runtime_id is not None
        else None
    )
    if daemon_id is None or runtime_id is None:
        # runtime 行缺失/未绑定 daemon 实体——与 send_rpc 的离线判定同收敛。
        return SessionThinkingLevelResponse(ok=False, error=_ERROR_DAEMON_OFFLINE)
    hub = get_daemon_ws_hub()
    try:
        result = await hub.send_rpc(
            daemon_id,
            SET_THINKING_LEVEL_RPC_METHOD,
            {"session_id": str(session.id), "level": level},
            timeout=THINKING_LEVEL_RPC_TIMEOUT_SECONDS,
        )
    except DaemonRuntimeOffline:
        return SessionThinkingLevelResponse(ok=False, error=_ERROR_DAEMON_OFFLINE)
    except DaemonRpcTimeout:
        return SessionThinkingLevelResponse(ok=False, error=_ERROR_DAEMON_TIMEOUT)
    except DaemonRpcRemoteError as exc:
        return SessionThinkingLevelResponse(ok=False, error=_remote_thinking_error(exc))
    # DaemonRpcConflict 有意不捕获（见 docstring）。
    return _map_set_result(result)


def _remote_thinking_error(exc: DaemonRpcRemoteError) -> str:
    """RemoteError 文案映射：method_not_found → 升级提示，其余远端原文。

    旧 daemon 未注册两 handler 时 ws-client 回 ``error.code='method_not_found'``
    （ws-client.ts 分发边界，照 compact._remote_compact_error 先例）；新
    daemon 的业务错误（如 pi 模型不支持 xhigh）按 design §兼容策略原文呈现。
    """
    if exc.code == "method_not_found":
        return _ERROR_DAEMON_UPGRADE
    return exc.message or f"daemon rpc error: {exc.code}"


def _map_levels_result(result: dict) -> SessionThinkingLevelsResponse:
    """daemon ThinkingLevels dict → SessionThinkingLevelsResponse 映射。

    防御性收敛：levels 非 list / 元素非 str 弃置为 []，current 非 str 置 None
    （brownfield daemon 回执不信任边界，照 compact._coerce_int 口径）。
    """
    levels_raw = result.get("levels")
    levels = (
        [item for item in levels_raw if isinstance(item, str)]
        if isinstance(levels_raw, list)
        else []
    )
    current_raw = result.get("current")
    return SessionThinkingLevelsResponse(
        levels=levels,
        current=(current_raw if isinstance(current_raw, str) else None),
    )


def _map_set_result(result: dict) -> SessionThinkingLevelResponse:
    """daemon ThinkingLevelResult dict → SessionThinkingLevelResponse 映射。"""
    error_raw = result.get("error")
    return SessionThinkingLevelResponse(
        ok=bool(result.get("ok", False)),
        error=(error_raw if isinstance(error_raw, str) else None),
    )


async def apply_pending_thinking_level(session_id: uuid.UUID) -> None:
    """run 终态钩子入口（ql-20260917-008）：应用忙轮暂存的思考档位。

    独立 DB session（对齐 ``dispatch_next_queued_message`` H1 模式）——后台
    任务生命周期独立于触发它的 run 收尾事务。流程：取会话 → 无暂存/非
    active/有活跃 run（下一终态钩子会再触发）均直接返回 → 取暂存档走
    ``_set_via_rpc``（复用空闲切换全部分支语义）→ 成功清 ``pending_thinking_
    level`` 列，失败**保留暂存**（daemon 瞬态离线时下轮重试，或用户重切
    覆盖）仅记日志——不丢用户意图。

    异常 fail-loud 交 ``_fire_background_task`` 的 done_callback 记日志，
    不影响已提交的 run 终态（照 dispatch_next_queued_message 先例）。
    """
    from app.core.db import get_session_factory
    from app.modules.agent.model import AgentSession

    from .helpers import _get_current_run

    session_factory = get_session_factory()
    async with session_factory() as db:
        svc = _SessionServiceShim(db)
        session = await db.get(AgentSession, session_id)
        if session is None:
            return
        pending = session.pending_thinking_level
        if not pending:
            return
        if session.status != "active":
            return
        if await _get_current_run(svc, session.id) is not None:
            return
        result = await _set_via_rpc(svc, session, level=pending)
        if result.ok:
            fresh = await db.get(AgentSession, session_id)
            if fresh is not None:
                fresh.pending_thinking_level = None
                db.add(fresh)
                await db.commit()


class _SessionServiceShim:
    """``_set_via_rpc`` 的最小 svc 适配（只需 ``_session`` 属性）。

    独立 session 工厂路径没有 SessionService 实例（对齐
    ``dispatch_next_queued_message`` 的轻量用法；``_resolve_daemon_id_for_
    runtime`` 与 helpers ``_get_current_run`` 均只经 ``svc._session`` 取数）。
    """

    def __init__(self, db) -> None:
        self._session = db
