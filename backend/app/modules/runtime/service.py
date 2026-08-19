"""Runtime service — 经绑定 daemon 实时读取运行时状态。

2026-08-19-runtime-live-daemon-read：``RuntimeLiveService`` 经 WS RPC 读当前
用户绑定 daemon 的实时数据（进度 / 用户输入 / 步骤产物）。旧 ``RuntimeService``
容器直读 ``spec_ws.spec_root`` 快照路径已删除（design §1：spec 增量同步排除
``.runtime/``，平台侧只有历史快照，语义不诚实）。
"""

from __future__ import annotations

import uuid
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.runtime.schema import ArtifactEntry, RuntimeProgress
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

log = get_logger(__name__)


# =====================================================================
# RuntimeLiveService — 经绑定 daemon WS RPC 实时读取（2026-08-19-runtime-live-daemon-read）
# =====================================================================
#
# 替代旧 ``RuntimeService`` 的容器直读快照路径（design §1：平台侧 sillyspec.db
# 只是历史快照，spec 增量同步排除 ``.runtime/``，真实状态在 daemon 宿主）：
#
# - 绑定解析复用 ``MemberBindingResolver.resolve_member_binding_or_none``
#   （D-004@v1，与 explorer 同构：只看当前用户自己的绑定行）；
# - 四个只读方法经 ``ws_hub.send_rpc`` 转发 ``runtime.*`` RPC（D-005@v1：独立
#   命名空间，不污染 host_fs 九方法契约）；
# - 错误映射复用 explorer 的逻辑骨架，但暴露 ``Runtime*`` 错误子类（design §6.3：
#   避免 HTTP body 泄漏内部 Explorer* 模块名）；
# - daemon 离线/失败不回退平台快照（D-001@v1），直接按映射表抛错。
#
# 设计依据：``.sillyspec/changes/2026-08-19-runtime-live-daemon-read/design.md``
# （§4.1 链路总览 / §6.1 RPC 契约 / §6.3 错误映射 / §7 只读语义）。


class RuntimeNotBound(AppError):
    """当前账号无本机绑定（或绑定行 daemon_id IS NULL）→ 404 引导到成员页。"""

    code = "HTTP_404_RUNTIME_NOT_BOUND"
    http_status = 404


class RuntimeDaemonOffline(AppError):
    """目标 daemon 无活动 WS 连接（或发送失败）→ 502。"""

    code = "HTTP_502_RUNTIME_DAEMON_OFFLINE"
    http_status = 502


class RuntimeTransferInterrupted(AppError):
    """WS 在 RPC 在途时断连 → 502「传输中断」。"""

    code = "HTTP_502_RUNTIME_TRANSFER_INTERRUPTED"
    http_status = 502


class RuntimeRpcTimeout(AppError):
    """RPC 往返超时 → 504。"""

    code = "HTTP_504_RUNTIME_RPC_TIMEOUT"
    http_status = 504


class RuntimeDaemonForbidden(AppError):
    """daemon 返回 code=forbidden → 403。"""

    code = "HTTP_403_RUNTIME_DAEMON_FORBIDDEN"
    http_status = 403


class RuntimePathNotFound(AppError):
    """daemon 返回 code=not_found（路径不存在），或 filename 预检拒绝 → 404/422。"""

    code = "HTTP_404_RUNTIME_PATH_NOT_FOUND"
    http_status = 404


class RuntimeDaemonTooOld(AppError):
    """旧 daemon 未注册 runtime.*（method_not_found）→ 422 版本过旧引导。"""

    code = "HTTP_422_RUNTIME_DAEMON_TOO_OLD"
    http_status = 422


class RuntimeArtifactTooLarge(AppError):
    """产物文件超过 1MB RPC 传输上限（design §8 R-04）→ 413。"""

    code = "HTTP_413_RUNTIME_ARTIFACT_TOO_LARGE"
    http_status = 413


class RuntimeDaemonRemoteError(AppError):
    """daemon 返回其余业务错误 → 502。"""

    code = "HTTP_502_RUNTIME_DAEMON_REMOTE"
    http_status = 502


# 显式超时（design §8 R-04）：进度读 daemon 会 spawn sillyspec 子进程（子进程
# timeout 30s），产物读取单文件限 1MB，统一给足 35s（send_rpc 默认 10s 不够）。
RUNTIME_RPC_TIMEOUT_SECONDS: Final[float] = 35.0


class RuntimeLiveService:
    """经绑定 daemon 实时读取运行时状态的只读 service（design §4.1 方案 A）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 内部：绑定解析 / RPC 转发 / 错误映射 ──────────────────────────────────

    async def _resolve_binding(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
        """解析当前用户自己的绑定行 → daemon_id（design §6.1 鉴权与 user_id 来源）。

        resolver miss / 异常均收敛为 None，或 ``daemon_id IS NULL`` 过渡形态，
        一律按未绑定处理 404（D-004@v1，与 explorer._resolve_binding 同语义）。
        """
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session,
            workspace_id,
            user_id,
            log_tag="runtime_live_resolve_member_binding_unexpected_error",
        )
        if binding is None or binding.daemon_id is None:
            raise RuntimeNotBound(
                "当前账号未绑定本机工作区，请先到成员页完成绑定。",
                details={"workspace_id": str(workspace_id)},
            )
        return binding.daemon_id

    async def _send_runtime_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """转发 runtime.* RPC 并统一映射错误（design §6.3 全表）。

        ``get_daemon_ws_hub`` 懒导入（explorer/service.py 同款理由：测试按
        ``ws_hub.get_daemon_ws_hub`` patch 单例访问器，模块顶层 import 会绑死
        陈旧引用）。
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        try:
            return await hub.send_rpc(
                daemon_id, method, params, timeout=RUNTIME_RPC_TIMEOUT_SECONDS
            )
        except DaemonRuntimeOffline as exc:
            # 与 explorer 同判据：「mid-rpc」文案区分在途断连 vs 离线（HTTP 均 502）。
            details: dict[str, Any] = {
                "daemon_id": str(daemon_id),
                "method": method,
                **(exc.details or {}),
                **context,
            }
            if "mid-rpc" in str(exc):
                raise RuntimeTransferInterrupted(
                    "与守护进程的传输中断，请稍后重试。",
                    details={**details, "reason": "disconnected_mid_rpc"},
                ) from exc
            raise RuntimeDaemonOffline(
                "守护进程当前离线，无法读取运行时状态；请确认守护进程在线后重试。",
                details={**details, "reason": "offline_or_send_failed"},
            ) from exc
        except DaemonRpcTimeout as exc:
            raise RuntimeRpcTimeout(
                "读取运行时状态超时，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": method,
                    **(exc.details or {}),
                    **context,
                },
            ) from exc
        except DaemonRpcRemoteError as exc:
            raise _map_runtime_remote_error(
                exc, daemon_id=daemon_id, method=method, context=context
            ) from exc

    # ── 四个服务方法（对齐 design §6.1 RPC 契约表）────────────────────────────

    async def get_progress(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> RuntimeProgress | None:
        """实时读取流水线进度（daemon 调 sillyspec progress dump --json）。"""
        daemon_id = await self._resolve_binding(workspace_id, user_id)
        result = await self._send_runtime_rpc(
            daemon_id,
            "runtime.read_progress",
            {"workspace_id": str(workspace_id)},
            context={"workspace_id": str(workspace_id)},
        )
        progress_data = result.get("progress")
        if progress_data is None:
            return None
        return RuntimeProgress.model_validate(progress_data)

    async def get_user_inputs(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
        """实时读取用户输入记录原文（.runtime/user-inputs.md）。"""
        daemon_id = await self._resolve_binding(workspace_id, user_id)
        result = await self._send_runtime_rpc(
            daemon_id,
            "runtime.read_user_inputs",
            {"workspace_id": str(workspace_id)},
            context={"workspace_id": str(workspace_id)},
        )
        return result.get("content")

    async def get_artifacts(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> list[ArtifactEntry]:
        """实时列步骤产物（.runtime/artifacts）。"""
        daemon_id = await self._resolve_binding(workspace_id, user_id)
        result = await self._send_runtime_rpc(
            daemon_id,
            "runtime.list_artifacts",
            {"workspace_id": str(workspace_id)},
            context={"workspace_id": str(workspace_id)},
        )
        return [ArtifactEntry.model_validate(a) for a in result.get("artifacts", [])]

    async def get_artifact_content(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, filename: str
    ) -> str | None:
        """实时读单个产物内容；filename 做 ``..``/绝对路径/控制字符预检（design §5）。"""
        _validate_artifact_filename(filename, workspace_id=workspace_id)
        daemon_id = await self._resolve_binding(workspace_id, user_id)
        result = await self._send_runtime_rpc(
            daemon_id,
            "runtime.read_artifact",
            {"workspace_id": str(workspace_id), "filename": filename},
            context={"workspace_id": str(workspace_id), "filename": filename},
        )
        return result.get("content")


# ── filename 预检（design §5 关键实现点；daemon 侧仍有 realpath 主防线）────────


def _validate_artifact_filename(filename: str, *, workspace_id: uuid.UUID) -> None:
    """backend 层 filename 预检：空名 / 控制字符 / 绝对路径 / ``..`` 段 / 子路径 → 422。

    与 explorer._join_within_root 同语义但不拼路径——runtime.read_artifact 的
    落点由 daemon 侧在 specCacheRoot/.runtime/artifacts 下拼接并做 containment
    主校验；backend 只做尽早拒明显恶意输入的预检。artifacts 只接受平文件名
    （子路径无语义且增大逃逸面，一并拒）。
    """
    reason: str | None = None
    if not filename:
        reason = "empty"
    elif any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in filename):
        reason = "control_chars"
    elif filename.startswith(("/", "\\")) or (
        len(filename) >= 2 and filename[0].isalpha() and filename[1] == ":"
    ):
        reason = "absolute_path"
    elif ".." in filename.replace("\\", "/").split("/"):
        reason = "parent_escape"
    elif "/" in filename or "\\" in filename:
        reason = "nested_path"
    if reason is not None:
        raise RuntimePathNotFound(
            "产物文件名非法：仅允许 artifacts 目录下的平文件名。",
            details={
                "workspace_id": str(workspace_id),
                "filename": filename,
                "reason": reason,
            },
        )


def _map_runtime_remote_error(
    exc: DaemonRpcRemoteError,
    *,
    daemon_id: uuid.UUID,
    method: str,
    context: dict[str, Any],
) -> AppError:
    """daemon 业务错误按 code 分派（design §6.3 映射表，explorer 同骨架）。"""
    details: dict[str, Any] = {
        "daemon_id": str(daemon_id),
        "method": method,
        "daemon_code": exc.code,
        "daemon_message": exc.message,
        **context,
    }
    if exc.code == "not_found":
        return RuntimePathNotFound(
            "文件或目录不存在，可能已被移动或删除。",
            details=details,
        )
    if exc.code == "forbidden":
        return RuntimeDaemonForbidden(
            "守护进程拒绝访问：不在允许的访问范围内。",
            details=details,
        )
    if exc.code == "method_not_found":
        return RuntimeDaemonTooOld(
            "本机 daemon 版本过旧，不支持运行时状态读取，请升级 daemon。",
            details=details,
        )
    if exc.code == "artifact_too_large":
        return RuntimeArtifactTooLarge(
            "产物过大，请用文件浏览器下载查看。",
            details=details,
        )
    return RuntimeDaemonRemoteError(
        "守护进程执行运行时读取失败，请稍后重试。",
        details=details,
    )
