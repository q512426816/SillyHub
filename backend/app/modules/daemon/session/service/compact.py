"""上下文压缩服务（2026-09-14-session-ctx-compact task-02 / FR-02 / FR-03）。

统一压缩入口 ``compact_session``：三校验后按引擎双分路（D-003@v3）——

- 三校验（D-001/D-002 backend 层，照 inject.py / interrupt_session 先例）：
  ① 会话归属 + 活跃（``_get_owned_session_for_update``，404 不泄露存在性；
  status≠active 拒——reconnecting/ended/failed/pending 全覆盖）；② provider
  caps ``get_provider_caps(provider)["compact"]`` 为 false 拒（cursor/未知
  引擎）；③ turn 空闲守卫（``_get_current_run`` 活跃轮拒，对齐 inject
  turn-control.ts:157 三态先例）。校验持锁完成、commit 释放行锁后再派发
  （照 interrupt_session「先 commit 再发 WS」模式，RPC 最长 15s 不拖行锁）。
- claude 分路（FR-03）：调既有 :meth:`inject_session` 发 ``"/compact"`` 文本
  轮——daemon 零改动、原生建 run 入会话流；锁释放后到 inject 重新取锁间新
  轮进入的竞态（复审 P1-1）由 inject 抛 DaemonSessionTurnConflict，本层捕获
  映射结构化 error，不抛 500。
- pi/codex 分路（D-003@v3）：``ws_hub.send_rpc(daemon_id, "session_compact",
  {"session_id"}, timeout=15)`` 拿 daemon 回传 CompactResult dict（camelCase
  ok/tokensBefore/estimatedTokensAfter/error）映射响应；三异常实名映射——
  DaemonRuntimeOffline → 「daemon 离线」、DaemonRpcTimeout → 「daemon 未响应
  压缩命令」、DaemonRpcRemoteError → 远端 error 原文（旧 daemon 无 handler
  的 method_not_found → 「daemon 未支持压缩，请升级 daemon」）；DaemonRpcConflict
  （rpc_id 碰撞实务不可能）不捕获，走既有 AppError 兜底。

D-007：本文件不消费包 ``__init__`` patch 绑定符号（经 ``svc._get_current_run``
间接取 ACTIVE_TURN_STATUSES）；ws_hub 延迟 import（照 control.py 先例，patch
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
from app.modules.daemon.schema import SessionCompactResponse

from .errors import (
    DaemonSessionInvariantViolation,
    DaemonSessionNotActive,
    DaemonSessionTurnConflict,
)
from .helpers import _resolve_daemon_id_for_runtime

# claude 分路下发的 slash 文本（SDK 原生 /compact 通道，daemon 侧零改动）。
COMPACT_PROMPT = "/compact"
# pi/codex 分路 RPC method（daemon 侧 registerRpcHandler('session_compact')，
# task-03 落地；旧 daemon 无该 handler → method_not_found → 升级提示文案）。
COMPACT_RPC_METHOD = "session_compact"
# RPC 显式超时（秒）——send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 对压缩命令偏紧
# （daemon 侧 driver 等引擎回执），对齐 sillyspec_compare SNAPSHOT_RPC_TIMEOUT 15s 先例。
COMPACT_RPC_TIMEOUT_SECONDS = 15

# 三异常 → 结构化 error 文案（design §兼容策略；中文口径）。
_ERROR_DAEMON_OFFLINE = "daemon 离线"
_ERROR_DAEMON_TIMEOUT = "daemon 未响应压缩命令"
_ERROR_DAEMON_UPGRADE = "daemon 未支持压缩，请升级 daemon"
# claude 分路锁内竞态（TurnConflict）文案——与 inject 忙轮 409 同语义，转结构化。
_ERROR_TURN_RUNNING = "本轮对话仍在进行，请等待本轮结束后再压缩。"


class DaemonSessionCompactUnsupported(AppError):
    """会话引擎不支持上下文压缩（provider caps ``compact=false``，D-001）。

    cursor / 未知引擎（get_provider_caps 未知 provider 默认拒绝）走本 409；
    不落 errors.py 家族文件（本变更 allowed_paths 约束），随 compact 子域
    落点（调用方仅本模块，无跨模块导入需求）。
    """

    code = "HTTP_409_DAEMON_SESSION_COMPACT_UNSUPPORTED"
    http_status = 409


async def compact_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionCompactResponse:
    """三校验 + 双分路压缩入口（FR-02，端点唯一调用方 session_crud）。

    校验语义见模块 docstring；成功路径返回 ``accepted=True`` + 分路字段，
    竞态/RPC 异常路径返回 ``accepted=False`` + ``error``（HTTP 200），真正的
    调用方错误（归属 404 / 非活跃 409 / caps 409 / 忙轮 409）仍以 AppError
    抛出由全局 handler 映射。
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
        if not get_provider_caps(provider)["compact"]:
            raise DaemonSessionCompactUnsupported(
                f"会话引擎 '{provider}' 不支持上下文压缩。",
                details={"session_id": str(session_id), "provider": provider},
            )
        current = await svc._get_current_run(session.id)
        if current is not None:
            raise DaemonSessionTurnConflict(
                f"Session '{session_id}' already has an active run '{current.id}'.",
                details={
                    "session_id": str(session_id),
                    "current_run_id": str(current.id),
                },
            )
        # 释放行锁再派发（照 interrupt_session 先例）：claude 路 inject 自行
        # 重新取锁，pi/codex 路 RPC 最长挂 15s，都不该拖住会话行锁。
        await svc._session.commit()
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    if provider == "claude":
        return await _compact_via_inject(svc, session_id, user_id, provider=provider)
    return await _compact_via_rpc(svc, session, provider=provider)


async def _compact_via_inject(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    provider: str,
) -> SessionCompactResponse:
    """claude 分路（FR-03 / D-003@v3）：复用既有 inject_session 发 "/compact" 轮。

    经 ``svc.inject_session(...)`` 方法面调用（而非 inject.py 自由函数）——
    端点传入的 DaemonService facade 不暴露 ``_preassemble_inject_attachments``
    等私有 helper，方法面委托（facade → SessionService → 共享核心）两种 svc
    形态都成立。queue_when_busy 缺省 False——上方空闲守卫放行后仍可能在锁
    释放窗口撞上新轮（P1-1 竞态），inject 抛 DaemonSessionTurnConflict 时
    映射结构化 error（不抛 500、不入队——压缩不是用户消息，排队迟到的
    /compact 轮无意义）。
    """
    try:
        result = await svc.inject_session(session_id, user_id, prompt=COMPACT_PROMPT)
    except DaemonSessionTurnConflict:
        return SessionCompactResponse(
            accepted=False,
            provider=provider,
            error=_ERROR_TURN_RUNNING,
        )
    return SessionCompactResponse(
        accepted=True,
        provider=provider,
        run_id=(str(result.agent_run.id) if result.agent_run is not None else None),
        queued=result.queued,
    )


async def _compact_via_rpc(
    svc,
    session,
    *,
    provider: str,
) -> SessionCompactResponse:
    """pi/codex 分路（D-003@v3）：ws RPC ``session_compact`` 拿结构化回执。

    三异常映射结构化 error（见模块 docstring）；DaemonRpcConflict 不捕——
    rpc_id UUID4 碰撞实务不可能，留既有 AppError 兜底如实暴露代码缺陷。
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
        return SessionCompactResponse(
            accepted=False,
            provider=provider,
            error=_ERROR_DAEMON_OFFLINE,
        )
    hub = get_daemon_ws_hub()
    try:
        result = await hub.send_rpc(
            daemon_id,
            COMPACT_RPC_METHOD,
            {"session_id": str(session.id)},
            timeout=COMPACT_RPC_TIMEOUT_SECONDS,
        )
    except DaemonRuntimeOffline:
        return SessionCompactResponse(
            accepted=False,
            provider=provider,
            error=_ERROR_DAEMON_OFFLINE,
        )
    except DaemonRpcTimeout:
        return SessionCompactResponse(
            accepted=False,
            provider=provider,
            error=_ERROR_DAEMON_TIMEOUT,
        )
    except DaemonRpcRemoteError as exc:
        return SessionCompactResponse(
            accepted=False,
            provider=provider,
            error=_remote_compact_error(exc),
        )
    # DaemonRpcConflict 有意不捕获（见 docstring）。
    return _map_compact_result(result, provider=provider)


def _remote_compact_error(exc: DaemonRpcRemoteError) -> str:
    """RemoteError 文案映射：method_not_found → 升级提示，其余远端原文。

    旧 daemon 未注册 'session_compact' handler 时 ws-client 回
    ``error.code='method_not_found'``（ws-client.ts 分发边界）；新 daemon 的
    业务错误（如 pi "Nothing to compact"）按 design §兼容策略原文呈现。
    """
    if exc.code == "method_not_found":
        return _ERROR_DAEMON_UPGRADE
    return exc.message or f"daemon rpc error: {exc.code}"


def _coerce_int(value: object) -> int | None:
    """RPC 回执数值键防御性收敛（bool 是 int 子类，需排除；其余类型弃置 None）。"""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _map_compact_result(result: dict, *, provider: str) -> SessionCompactResponse:
    """daemon CompactResult dict（camelCase）→ SessionCompactResponse 映射。"""
    return SessionCompactResponse(
        accepted=bool(result.get("ok", False)),
        provider=provider,
        tokens_before=_coerce_int(result.get("tokensBefore")),
        estimated_tokens_after=_coerce_int(result.get("estimatedTokensAfter")),
        error=(result.get("error") if isinstance(result.get("error"), str) else None),
    )
