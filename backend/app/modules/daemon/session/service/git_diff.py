"""会话级单文件 diff service（2026-11-06-session-git-approval task-09 / FR-02）。

git 审批确认卡「单文件可查看 diff」的取数端：对会话命中工作区的**未提交**改动
（已暂存/未暂存/未跟踪，工作区 vs HEAD 口径）取统一 diff 文本。

- RPC 语义（源码对齐勘误，task-09 卡裁定）：design 文面写 ``git_diff_file``，但该
  RPC 是 ``git show <sha>`` 提交级 diff（sha 必填，sillyhub-daemon/src/host-fs-handler.ts
  gitDiffFile）；确认卡的文件是未提交工作区改动——实际调 daemon 平名 RPC
  ``git_worktree_diff``（host-fs-handler gitWorktreeDiff：porcelain 单文件判态 +
  ``git diff HEAD`` + untracked no-index 分流，返回 status/head_short/diff/truncated/
  binary/error；daemon 侧已带 assertGitPathspec 与 allowed_roots 白名单守卫）。
- root 决策链与错误面：**组件全部从 git_status.py 导入复用**（_probe_worktree 探测件、
  SessionGit* 异常族、not-a-repo 判定 marker）；三层 root 链（worktree 探测 → cwd 快照
  → 绑定根）为 get_session_git_status 同构序列镜像（卡约束「不修改 git_status.py、
  不复制探测实现」——组件复用 + 序列镜像，两处变更须同步）。
- 路径安全：path 参数原样透传 daemon（daemon 侧白名单与 pathspec 校验兜底），
  backend 不做绝对路径拼接；响应只含 diff 相关字段。

设计依据：``.sillyspec/changes/2026-11-06-session-git-approval/design.md``（W3 节 /
接口定义 get_session_git_diff / 数据模型「schema 在本文件定义」）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Final, Literal

from pydantic import BaseModel
from sqlalchemy import select

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.session.service.git_status import (
    _NOT_A_GIT_REPO_MARKER,
    SessionGitDaemonForbidden,
    SessionGitDaemonOffline,
    SessionGitDaemonRemoteError,
    SessionGitDaemonTimeout,
    SessionGitNotBound,
    _probe_worktree,
)
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver
from app.modules.workspace.service import resolve_root_path_for_daemon

# worktree-diff RPC 超时（单文件 diff 与 git_status 同档 30s；daemon 侧整体兜底内含
# no-index 分支，宽预算不改语义）。
SESSION_GIT_DIFF_RPC_TIMEOUT_SECONDS: Final[float] = 30.0


class SessionGitDiffResponse(BaseModel):
    """单文件 diff 响应（schema 在本文件定义——design 数据模型节）。"""

    git_mode: Literal["git", "no_git", "no_root"]
    root: str | None = None
    root_source: Literal["worktree", "cwd", "workspace_root", "none"] = "none"
    path: str | None = None
    status: str | None = None
    head_short: str | None = None
    diff: str | None = None
    truncated: bool = False
    binary: bool = False
    synced_at: str


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _empty(
    git_mode: Literal["no_git", "no_root"],
    path: str | None,
    root: str | None = None,
    root_source: Literal["worktree", "cwd", "workspace_root", "none"] = "none",
) -> SessionGitDiffResponse:
    """空态响应（no_root / no_git）：diff 相关字段全 None。"""
    return SessionGitDiffResponse(
        git_mode=git_mode,
        root=root,
        root_source=root_source,
        path=path,
        status=None,
        head_short=None,
        diff=None,
        truncated=False,
        binary=False,
        synced_at=_now_iso(),
    )


async def get_session_git_diff(
    svc: Any,
    session_id: uuid.UUID,
    path: str,
    user_id: uuid.UUID,
) -> SessionGitDiffResponse:
    """会话工作区单文件 diff（工作区 vs HEAD 口径；错误面见模块 docstring）。

    ``svc`` 为 DaemonService——复用 ``get_agent_session`` 属主校验（缺失/跨用户
    统一 404 不泄露存在性）。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    agent_session = await svc.get_agent_session(session_id, user_id)

    # ── binding 解析 + 三层 root 链（git_status.get_session_git_status 同构
    #    序列镜像：组件复用、两处变更须同步）──────────────────────────────────
    if agent_session.workspace_id is None:
        return _empty("no_root", path)
    binding = await MemberBindingResolver.resolve_member_binding_or_none(
        svc._session,
        agent_session.workspace_id,
        user_id,
        log_tag="session_git_diff_resolve_member_binding_unexpected_error",
    )
    if binding is None or binding.daemon_id is None:
        raise SessionGitNotBound(
            "当前账号未绑定本机工作区，无法查询会话文件差异。",
            details={
                "session_id": str(session_id),
                "workspace_id": str(agent_session.workspace_id),
            },
        )
    daemon_id = binding.daemon_id
    binding_root = resolve_root_path_for_daemon(binding.root_path)
    hub = get_daemon_ws_hub()

    root: str | None = None
    root_source: Literal["worktree", "cwd", "workspace_root", "none"] = "none"
    change_key: str | None = None
    if agent_session.current_change_id is not None:
        from app.modules.change.model import Change

        change_key = (
            await svc._session.execute(
                select(Change.change_key).where(Change.id == agent_session.current_change_id)
            )
        ).scalar_one_or_none()
    if change_key:
        worktree_root = await _probe_worktree(hub, daemon_id, binding_root, change_key)
        if worktree_root is not None:
            root = worktree_root
            root_source = "worktree"
    if root is None:
        if agent_session.cwd:
            root = resolve_root_path_for_daemon(agent_session.cwd)
            root_source = "cwd"
        else:
            root = binding_root
            root_source = "workspace_root"

    context: dict[str, Any] = {"session_id": str(session_id), "path": path}
    try:
        result: dict[str, Any] = await hub.send_rpc(
            daemon_id,
            "git_worktree_diff",
            {"root": root, "path": path},
            timeout=SESSION_GIT_DIFF_RPC_TIMEOUT_SECONDS,
        )
    except DaemonRuntimeOffline as exc:
        details: dict[str, Any] = {
            "daemon_id": str(daemon_id),
            "method": "git_worktree_diff",
            **(exc.details or {}),
            **context,
        }
        if "mid-rpc" in str(exc):
            raise SessionGitDaemonOffline(
                "与守护进程的传输中断，请稍后重试。",
                details={**details, "reason": "disconnected_mid_rpc"},
            ) from exc
        raise SessionGitDaemonOffline(
            "本机守护进程当前离线，无法查询会话文件差异；请确认守护进程在线后重试。",
            details={**details, "reason": "offline_or_send_failed"},
        ) from exc
    except DaemonRpcTimeout as exc:
        raise SessionGitDaemonTimeout(
            "会话文件差异查询超时，请稍后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": "git_worktree_diff",
                **(exc.details or {}),
                **context,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        remote_details: dict[str, Any] = {
            "daemon_id": str(daemon_id),
            "method": "git_worktree_diff",
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
            "守护进程查询会话文件差异失败，请稍后重试。",
            details=remote_details,
        ) from exc

    # 结构化 error：非 git 仓库 → no_git 空态；其余 → 502（不静默成空态，防错数据）。
    error = result.get("error")
    if error:
        if _NOT_A_GIT_REPO_MARKER in str(error):
            return _empty("no_git", path, root=root, root_source=root_source)
        raise SessionGitDaemonRemoteError(
            "守护进程查询会话文件差异失败，请稍后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": "git_worktree_diff",
                "daemon_message": str(error),
                **context,
            },
        )

    return SessionGitDiffResponse(
        git_mode="git",
        root=root,
        root_source=root_source,
        path=result.get("path", path),
        status=result.get("status"),
        head_short=result.get("head_short"),
        diff=result.get("diff"),
        truncated=bool(result.get("truncated")),
        binary=bool(result.get("binary")),
        synced_at=_now_iso(),
    )
