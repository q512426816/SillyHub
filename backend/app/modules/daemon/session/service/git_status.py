"""会话级 git 状态 service（2026-10-21-session-git-branch / FR-01..03）。

会话维度的**当前** git 分支实时查询（FR-02：每请求现场采集，非创建快照）：

- root 决策链：``AgentSession.cwd``（SessionManager working dir，daemon 宿主
  路径，``resolve_root_path_for_daemon`` 做 container→host 改写）优先；cwd
  为空回退所属工作区的成员绑定根（``MemberBindingResolver``，只看本人绑定
  行——git_log ``_resolve_binding`` 同语义）。两者皆无、或 cwd 有值但无
  workspace 可解析 daemon → 200 ``no_root`` 空态（不报错，FR-03）。
- 采集：既有平名 RPC ``git_status``（``ws_hub.send_rpc`` 直连 + 显式 30s
  超时，照 ``git_log/service.py:_send_git_rpc`` 模式）——daemon 内建 fetch
  降级（no_remote/fetch_failed/fetch_timeout 不阻断分支采集），零 daemon
  契约变更。
- 错误面（design「接口契约」）：daemon error 含 "not a git repository"（git
  标准文案，git_gateway/tests 已依赖同形态）→ 200 ``no_git`` 空态；其余
  error → 502；RPC forbidden（root 越界 allowed_roots，如 worktree 未入
  白名单）→ 403；offline/mid-rpc 断连 → 502；timeout → 504。

设计依据：``.sillyspec/changes/2026-10-21-session-git-branch/design.md``。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Final, Literal

from app.core.errors import AppError
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.schema import SessionGitStatusResponse
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver
from app.modules.workspace.service import resolve_root_path_for_daemon

# git_status RPC 超时（git_log STATUS_RPC_TIMEOUT_SECONDS 同档：daemon 侧整体
# 兜底 30s，内含 fetch 15s 局部超时）。
SESSION_GIT_RPC_TIMEOUT_SECONDS: Final[float] = 30.0

# 非 git 仓库判据：git 标准错误文案（git_gateway/tests/test_router.py 已依赖
# 同形态），daemon porcelain 失败时经 error 字段回传。
_NOT_A_GIT_REPO_MARKER: Final[str] = "not a git repository"


class SessionGitNotBound(AppError):
    """会话所属工作区成员未绑定 daemon（或绑定行 daemon_id IS NULL）→ 404 引导。"""

    code = "HTTP_404_SESSION_GIT_NOT_BOUND"
    http_status = 404


class SessionGitDaemonForbidden(AppError):
    """daemon forbidden（root 越界 allowed_roots，如 worktree 未入白名单）→ 403。"""

    code = "HTTP_403_SESSION_GIT_DAEMON_FORBIDDEN"
    http_status = 403


class SessionGitDaemonOffline(AppError):
    """daemon 离线 / mid-rpc 断连 → 502。"""

    code = "HTTP_502_SESSION_GIT_DAEMON_OFFLINE"
    http_status = 502


class SessionGitDaemonTimeout(AppError):
    """RPC 超时 → 504。"""

    code = "HTTP_504_SESSION_GIT_DAEMON_TIMEOUT"
    http_status = 504


class SessionGitDaemonRemoteError(AppError):
    """daemon 采集真失败（error 非空且非 not-a-git-repo）→ 502。"""

    code = "HTTP_502_SESSION_GIT_DAEMON_REMOTE_ERROR"
    http_status = 502


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _empty(
    git_mode: Literal["no_git", "no_root"], root: str | None = None
) -> SessionGitStatusResponse:
    """空态响应（no_root / no_git）：branch 等字段全 None（FR-03）。"""
    return SessionGitStatusResponse(
        git_mode=git_mode,
        root=root,
        branch=None,
        detached=False,
        head_short=None,
        files_changed=None,
        untracked_count=None,
        synced_at=_now_iso(),
    )


async def get_session_git_status(
    svc: Any,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionGitStatusResponse:
    """会话当前 git 状态（FR-01 主路径；错误面见模块 docstring）。

    ``svc`` 为 DaemonService——复用 ``get_agent_session`` 属主校验（缺失/跨
    用户统一 404 不泄露存在性），DB 会话经 ``svc._session`` 取。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    agent_session = await svc.get_agent_session(session_id, user_id)

    # ── root 决策链（design「做法概述」）────────────────────────────────────
    # cwd 优先（daemon 宿主路径快照）；cwd 有值但无 workspace → 无法解析
    # daemon_id（AgentSession 无 daemon 直连列）→ no_root 空态守护。
    daemon_id: uuid.UUID | None = None
    if agent_session.cwd:
        if agent_session.workspace_id is None:
            return _empty("no_root")
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            svc._session,
            agent_session.workspace_id,
            user_id,
            log_tag="session_git_resolve_member_binding_unexpected_error",
        )
        if binding is None or binding.daemon_id is None:
            raise SessionGitNotBound(
                "当前账号未绑定本机工作区，无法查询会话 Git 状态。",
                details={
                    "session_id": str(session_id),
                    "workspace_id": str(agent_session.workspace_id),
                },
            )
        daemon_id = binding.daemon_id
        root = resolve_root_path_for_daemon(agent_session.cwd)
    elif agent_session.workspace_id is not None:
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            svc._session,
            agent_session.workspace_id,
            user_id,
            log_tag="session_git_resolve_member_binding_unexpected_error",
        )
        if binding is None or binding.daemon_id is None:
            raise SessionGitNotBound(
                "当前账号未绑定本机工作区，无法查询会话 Git 状态。",
                details={
                    "session_id": str(session_id),
                    "workspace_id": str(agent_session.workspace_id),
                },
            )
        daemon_id = binding.daemon_id
        root = resolve_root_path_for_daemon(binding.root_path)
    else:
        return _empty("no_root")

    # ── 平名 RPC 直连（git_log _send_git_rpc 同模式：显式超时 + 全量错误映射）──
    context: dict[str, Any] = {"session_id": str(session_id)}
    hub = get_daemon_ws_hub()
    try:
        result: dict[str, Any] = await hub.send_rpc(
            daemon_id,
            "git_status",
            {"root": root},
            timeout=SESSION_GIT_RPC_TIMEOUT_SECONDS,
        )
    except DaemonRuntimeOffline as exc:
        # mid-rpc 在途断连 vs 离线，判据同 git_log（ws_hub 文案变更须同步）。
        details: dict[str, Any] = {
            "daemon_id": str(daemon_id),
            "method": "git_status",
            **(exc.details or {}),
            **context,
        }
        if "mid-rpc" in str(exc):
            raise SessionGitDaemonOffline(
                "与守护进程的传输中断，请稍后重试。",
                details={**details, "reason": "disconnected_mid_rpc"},
            ) from exc
        raise SessionGitDaemonOffline(
            "本机守护进程当前离线，无法查询会话 Git 状态；请确认守护进程在线后重试。",
            details={**details, "reason": "offline_or_send_failed"},
        ) from exc
    except DaemonRpcTimeout as exc:
        raise SessionGitDaemonTimeout(
            "会话 Git 状态查询超时，请稍后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": "git_status",
                **(exc.details or {}),
                **context,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        # daemon 平名 git 方法只主动抛 forbidden（root 越界）/ method_not_found
        # （旧 daemon）——forbidden → 403，其余统一 502（git_log _map_remote_error
        # 同骨架，文案会话语境）。
        remote_details: dict[str, Any] = {
            "daemon_id": str(daemon_id),
            "method": "git_status",
            "daemon_code": exc.code,
            "daemon_message": exc.message,
            **context,
        }
        if exc.code == "forbidden":
            raise SessionGitDaemonForbidden(
                "守护进程拒绝访问该会话工作目录：不在允许的访问范围内。",
                details=remote_details,
            ) from exc
        raise SessionGitDaemonRemoteError(
            "守护进程查询会话 Git 状态失败，请稍后重试。",
            details=remote_details,
        ) from exc

    # daemon git_status 失败不抛（结构化 error 回传）：非 git 仓库 → no_git
    # 空态；其余采集失败 → 502（不静默成空态，防错数据）。
    error = result.get("error")
    if error:
        if _NOT_A_GIT_REPO_MARKER in str(error):
            return _empty("no_git", root=root)
        raise SessionGitDaemonRemoteError(
            "守护进程查询会话 Git 状态失败，请稍后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": "git_status",
                "daemon_message": str(error),
                **context,
            },
        )

    return SessionGitStatusResponse(
        git_mode="git",
        root=root,
        branch=result.get("branch"),
        detached=bool(result.get("detached")),
        head_short=result.get("head_short"),
        files_changed=result.get("files_changed"),
        untracked_count=result.get("untracked_count"),
        synced_at=_now_iso(),
    )
