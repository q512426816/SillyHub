"""变更中心单文件变化比对 service（ql-20260910-017-2006）。

「浏览器 → backend → daemon RPC sillyspec_file_diff → 本机 sillyspec
scope-audit --file --json」只读查询链路：daemon 侧 spawn 本机 CLI 跑对账
同源锚点的单文件 git diff，backend 只做绑定解析 + RPC 转发 + 错误映射
（锚点/git 逻辑单一源在工具，本层零自研）。

编排范式复刻 git_log/service.py（design §5.3）：MemberBindingResolver 解析
成员自己绑定行 → ``ws_hub.send_rpc`` 显式超时转发平名 RPC
``sillyspec_file_diff``；offline/timeout/remote 错误族映射 AppError 中文文案。
权限在 router 层 ``require_permission(Permission.WORKSPACE_READ)``。
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.change.schema import ScopeFileDiffResponse
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

log = get_logger(__name__)

# RPC 显式超时（send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 不够用；scope-audit
# 需先算对账锚点再跑 git diff，daemon 侧命令超时 120s（sillyspec-manager
# SILLYSPEC_COMMAND_TIMEOUT_MS）——backend 必须 ≥ daemon 超时，否则后端已 504
# 而 daemon 子进程还在白跑（ql-20260911-003-355a P2：原 35s < 120s 写反了）。
_FILE_DIFF_RPC_TIMEOUT_SECONDS: float = 135.0


# ── 参数校验 helper（router 层调用；machines.py compare 端点/git_log 同款风格）──

# change 白名单：首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128（machines.py
# _validate_sillyspec_change_segment 同款正则——quick-<8hex> 与日期变更名都命中）。
_SCOPE_CHANGE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")


class ScopeFileDiffInvalidParam(AppError):
    """router 层参数静态校验拒绝（change 白名单 / file 路径形态）→ 422。"""

    code = "HTTP_422_SCOPE_FILE_DIFF_INVALID_PARAM"
    http_status = 422


def validate_scope_change(change: str) -> str:
    """change 段白名单校验（显式拒 ``..``——正则可过但语义是穿越，双保险）。"""
    if ".." in change or _SCOPE_CHANGE_RE.fullmatch(change) is None:
        raise ScopeFileDiffInvalidParam(
            "change 仅允许字母数字与 . _ - 组成（长度 1-128，首字符须为字母数字）。",
            details={"change": change[:50]},
        )
    return change


def normalize_scope_file_path(path: str) -> str:
    """file 路径静态预检 + 归一（git_log._validate_diff_path 同款拒 pathspec
    magic / 控制字符；另拒 ``..`` 段与绝对路径；反斜杠归一为 POSIX——工具侧
    quick 会话文件行可能是 Windows 形态，scope-audit --file 内部亦做同款归一）。
    """
    if not path:
        raise ScopeFileDiffInvalidParam(
            "缺少必填参数 file：请提供要查看变化的文件路径。",
            details={"file": path},
        )
    if len(path) > 512:
        raise ScopeFileDiffInvalidParam(
            "文件路径过长（上限 512 字符）。",
            details={"file": path[:50]},
        )
    if path.startswith(":("):
        raise ScopeFileDiffInvalidParam(
            "文件路径不允许使用 pathspec magic 语法（「:(」开头），已拒绝。",
            details={"file": path[:50]},
        )
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path):
        raise ScopeFileDiffInvalidParam(
            "文件路径包含非法控制字符，已拒绝。",
            details={"file": path[:50]},
        )
    posix = path.replace("\\", "/")
    segments = [seg for seg in posix.split("/") if seg not in ("", ".")]
    if not segments:
        raise ScopeFileDiffInvalidParam(
            "文件路径不能为空或仅由分隔符组成。",
            details={"file": path[:50]},
        )
    if any(seg == ".." for seg in segments) or posix.startswith("/"):
        raise ScopeFileDiffInvalidParam(
            "文件路径必须是仓库内相对路径（不允许绝对路径或 .. 上跳段）。",
            details={"file": path[:50]},
        )
    return "/".join(segments)


# ── 模块本地错误（AppError 惯例：类属性 code/http_status + 中文文案）────────


class ScopeFileDiffNotBound(AppError):
    """当前账号无本机绑定（或绑定行 daemon_id IS NULL 过渡形态）→ 404 引导。"""

    code = "HTTP_404_SCOPE_FILE_DIFF_NOT_BOUND"
    http_status = 404


class ScopeFileDiffDaemonTooOld(AppError):
    """旧 daemon 未注册 sillyspec_file_diff（method_not_found）→ 422 版本引导。"""

    code = "HTTP_422_SCOPE_FILE_DIFF_DAEMON_TOO_OLD"
    http_status = 422


class ScopeFileDiffSillySpecTooOld(AppError):
    """本机 sillyspec 版本无 scope-audit 子命令 → 422 升级引导（前端出提示）。"""

    code = "HTTP_422_SCOPE_FILE_DIFF_SILLYSPEC_TOO_OLD"
    http_status = 422


class ScopeFileDiffDaemonOffline(AppError):
    """目标 daemon 无活动 WS 连接 → 502。"""

    code = "HTTP_502_SCOPE_FILE_DIFF_DAEMON_OFFLINE"
    http_status = 502


class ScopeFileDiffDaemonRemoteError(AppError):
    """daemon 返回其余业务错误（变更不存在/执行失败等）→ 502。"""

    code = "HTTP_502_SCOPE_FILE_DIFF_DAEMON_REMOTE"
    http_status = 502


class ScopeFileDiffContractGap(AppError):
    """daemon 返回结构与契约不符（缺 change/ok 等键）→ 502。"""

    code = "HTTP_502_SCOPE_FILE_DIFF_CONTRACT_GAP"
    http_status = 502


class ScopeFileDiffTimeout(AppError):
    """RPC 往返超时 → 504。"""

    code = "HTTP_504_SCOPE_FILE_DIFF_RPC_TIMEOUT"
    http_status = 504


# daemon 侧 RpcError code → 业务错误映射（其余走 ScopeFileDiffDaemonRemoteError）
_REMOTE_ERROR_MAP: dict[str, tuple[type[AppError], str]] = {
    "sillyspec_capability_missing": (
        ScopeFileDiffSillySpecTooOld,
        "本机 sillyspec 版本不支持 scope-audit 命令，请升级 sillyspec 后重试。",
    ),
    "invalid_params": (
        ScopeFileDiffDaemonRemoteError,
        "单文件比对参数被守护进程拒绝（change / file 非空校验失败）。",
    ),
    "no_spec_root": (
        ScopeFileDiffDaemonRemoteError,
        "该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。",
    ),
    "sillyspec_bin_missing": (
        ScopeFileDiffDaemonRemoteError,
        "本机未安装 sillyspec CLI，无法执行单文件比对。",
    ),
    "scope_audit_timeout": (
        ScopeFileDiffTimeout,
        "单文件比对执行超时，请稍后重试。",
    ),
    "scope_audit_failed": (
        ScopeFileDiffDaemonRemoteError,
        "守护进程执行 scope-audit --file 失败，请稍后重试。",
    ),
}


class ScopeFileDiffService:
    """单文件变化比对 service（端点见 router.py ``/sillyspec/file-diff``）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _resolve_binding(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
        """解析当前用户自己的绑定行 → daemon_id（git_log._resolve_binding 同构）。

        绑定行不存在（resolver miss/异常均收敛 None）或 daemon_id IS NULL
        过渡形态 → 404 引导到成员页。root 不需要——RPC 传 workspace_id，
        daemon 侧按认领映射取根（conflict_snapshot 同款）。
        """
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session, workspace_id, user_id
        )
        daemon_id = getattr(binding, "daemon_id", None) if binding is not None else None
        if daemon_id is None:
            log.info(
                "scope_file_diff_not_bound",
                workspace_id=str(workspace_id),
                user_id=str(user_id),
            )
            raise ScopeFileDiffNotBound("当前账号未绑定本机守护进程，请先在成员页完成绑定。")
        return daemon_id

    async def get_file_diff(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change: str,
        file: str,
    ) -> ScopeFileDiffResponse:
        """单文件 unified diff（daemon 侧锚点同源解析，本层零 git 逻辑）。"""
        daemon_id = await self._resolve_binding(workspace_id, user_id)
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        context: dict[str, Any] = {
            "workspace_id": str(workspace_id),
            "change": change,
            "file": file,
        }
        try:
            result = await hub.send_rpc(
                daemon_id,
                "sillyspec_file_diff",
                {
                    "workspace_id": str(workspace_id),
                    "change": change,
                    "file": file,
                },
                timeout=_FILE_DIFF_RPC_TIMEOUT_SECONDS,
            )
        except DaemonRuntimeOffline as exc:
            details: dict[str, Any] = {
                "daemon_id": str(daemon_id),
                "method": "sillyspec_file_diff",
                **(exc.details or {}),
                **context,
            }
            if "mid-rpc" in str(exc):
                raise ScopeFileDiffDaemonOffline(
                    "与守护进程的传输中断，请稍后重试。",
                    details={**details, "reason": "disconnected_mid_rpc"},
                ) from exc
            raise ScopeFileDiffDaemonOffline(
                "本机守护进程当前离线，无法执行单文件比对；请确认守护进程在线后重试。",
                details={**details, "reason": "offline_or_send_failed"},
            ) from exc
        except DaemonRpcTimeout as exc:
            raise ScopeFileDiffTimeout(
                "单文件比对查询超时，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": "sillyspec_file_diff",
                    **(exc.details or {}),
                    **context,
                },
            ) from exc
        except DaemonRpcRemoteError as exc:
            mapped = _REMOTE_ERROR_MAP.get(str(exc.code))
            if mapped is not None:
                cls, message = mapped
                raise cls(
                    message,
                    details={"daemon_id": str(daemon_id), **context},
                ) from exc
            if str(exc.code) == "method_not_found":
                raise ScopeFileDiffDaemonTooOld(
                    "守护进程版本过旧，不支持单文件比对；请升级 daemon 后重试。",
                    details={"daemon_id": str(daemon_id), **context},
                ) from exc
            # P2（ql-20260911-003-355a）：daemon 原始消息可含 stderr 尾段/本机
            # 路径——只进服务端结构化日志（排障可查），不随 details 下发客户端。
            log.warning(
                "scope_file_diff_unmapped_remote_error",
                daemon_id=str(daemon_id),
                remote_code=str(exc.code),
                remote_message=str(exc.message)[:200],
                **context,
            )
            raise ScopeFileDiffDaemonRemoteError(
                "守护进程执行单文件比对失败，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "remote_code": str(exc.code),
                    **context,
                },
            ) from exc

        # 契约校验：daemon 投影必有 change/file/ok/truncated（git_log
        # _validate_result 同款防御——畸形结构 502 契约缺口而非 500）。
        if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
            log.warning(
                "scope_file_diff_contract_gap",
                daemon_id=str(daemon_id),
                **context,
            )
            raise ScopeFileDiffContractGap(
                "守护进程返回结构异常（缺 ok 字段），请升级 daemon 后重试。",
                details={"daemon_id": str(daemon_id), **context},
            )
        return ScopeFileDiffResponse(
            change=str(result.get("change") or change),
            file=str(result.get("file") or file),
            ok=result["ok"],
            mode=str(result.get("mode") or "full-flow"),
            base_ref=result.get("base_ref"),
            anchor_label=result.get("anchor_label"),
            diff=result.get("diff"),
            note=result.get("note"),
            truncated=result.get("truncated") is True,
        )
