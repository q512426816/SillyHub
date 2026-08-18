"""Explorer service — 绑定解析 + containment 预检 + WS RPC 转发 + 错误映射。

只读工作区文件浏览链路（浏览器 → backend → daemon → 宿主机磁盘）的 service 层：

- 绑定解析一律复用 ``MemberBindingResolver.resolve_member_binding_or_none``，
  只看当前用户自己的绑定行（design §5.4 / D-003@v1 / R-05；不借
  ``resolve_daemon_instance_for_workspace``——其无 user 门控属已知坑）；
- rel 路径 containment **预检**按 ``root_path`` 形态分发 PureWindowsPath /
  PurePosixPath 纯字符串语义（design §5.2——backend 跑 Linux 容器时
  ``os.path.normpath`` 折不动 ``..\\`` 也不认盘符，不能用）；预检仅尽早拒
  明显恶意输入，安全裁决以 daemon 侧 realpath 落点 + allowed_roots 双重
  校验为准（主防线）；
- ``ws_hub.send_rpc`` 显式超时转发 ``explorer_list_dir`` /
  ``explorer_read_file`` / ``explorer_search``（design §7.1；默认
  ``RPC_DEFAULT_TIMEOUT=10s`` 不够用，四链路全部显式传值）；
- 全量错误映射（design §7.2）：未绑定→404 / daemon not_found→404 /
  forbidden→403 / offline→502 / WS 断连→502 传输中断 / timeout→504 /
  method_not_found→422 版本过旧 / 越界→422，模块本地 AppError 子类承载。

设计依据：``.sillyspec/changes/2026-08-18-workspace-file-browser/design.md``
（§5 安全设计四条 / §7.1 RPC 契约 / §7.2 错误映射）。
"""

from __future__ import annotations

import uuid
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any, Final, NamedTuple

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.explorer.schema import (
    ExplorerFileResponse,
    ExplorerSearchResponse,
    ExplorerTreeResponse,
)
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

log = get_logger(__name__)

# 显式超时（design §5 / R-04）：send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 不够用。
TREE_RPC_TIMEOUT_SECONDS: Final[float] = 30.0
READ_FILE_RPC_TIMEOUT_SECONDS: Final[float] = 30.0
SEARCH_RPC_TIMEOUT_SECONDS: Final[float] = 60.0
DOWNLOAD_RPC_TIMEOUT_SECONDS: Final[float] = 60.0

# explorer_search 结果上限默认值（design §7.1）。
SEARCH_DEFAULT_MAX_RESULTS: Final[int] = 100

# ── 模块本地错误（AppError 惯例：类属性 code/http_status + 中文文案，design §7.2）──


class ExplorerNotBound(AppError):
    """当前账号无本机绑定（或绑定行 daemon_id IS NULL 过渡形态）→ 404 引导。"""

    code = "HTTP_404_EXPLORER_NOT_BOUND"
    http_status = 404


class ExplorerPathOutsideRoot(AppError):
    """containment 预检拒绝（绝对路径 / .. 逃逸 / 控制字符）→ 422「路径越界」。"""

    code = "HTTP_422_EXPLORER_PATH_OUTSIDE_ROOT"
    http_status = 422


class ExplorerDaemonOffline(AppError):
    """目标 daemon 无活动 WS 连接（或发送失败）→ 502。"""

    code = "HTTP_502_EXPLORER_DAEMON_OFFLINE"
    http_status = 502


class ExplorerTransferInterrupted(AppError):
    """WS 在 RPC 在途时断连（如 1009 消息超限，R-04）→ 502「传输中断」。"""

    code = "HTTP_502_EXPLORER_TRANSFER_INTERRUPTED"
    http_status = 502


class ExplorerRpcTimeout(AppError):
    """RPC 往返超时 → 504。"""

    code = "HTTP_504_EXPLORER_RPC_TIMEOUT"
    http_status = 504


class ExplorerDaemonForbidden(AppError):
    """daemon 返回 code=forbidden（realpath 逃逸 / allowed_roots 拒绝）→ 403。"""

    code = "HTTP_403_EXPLORER_DAEMON_FORBIDDEN"
    http_status = 403


class ExplorerPathNotFound(AppError):
    """daemon 返回 code=not_found（路径不存在或 root 已删）→ 404。"""

    code = "HTTP_404_EXPLORER_PATH_NOT_FOUND"
    http_status = 404


class ExplorerDaemonTooOld(AppError):
    """旧 daemon 未注册 explorer_*（method_not_found）→ 422 版本过旧引导。"""

    code = "HTTP_422_EXPLORER_DAEMON_TOO_OLD"
    http_status = 422


class ExplorerDaemonRemoteError(AppError):
    """daemon 返回其余业务错误 → 502。"""

    code = "HTTP_502_EXPLORER_DAEMON_REMOTE"
    http_status = 502


class ExplorerContractGap(AppError):
    """daemon explorer_* 返回结构与契约不符（provider 漏字段）→ 502。

    缺字段说明 daemon 侧漏实现（CONTRACT_GAP），显式上报、禁止 ``.get()``
    默认值掩盖（task-02 契约纪律）。
    """

    code = "HTTP_502_EXPLORER_CONTRACT_GAP"
    http_status = 502


# ── containment 预检（design §5.2；跨平台纯字符串语义）──────────────────────


def _is_windows_style_root(root_path: str) -> bool:
    """按 ``root_path`` 形态判断路径语义：Windows / POSIX。

    含 UNC 前缀（``\\\\`` 或 ``//``）、反斜杠或盘符（``X:``）→ Windows 语义，
    否则 POSIX。backend 跑在 Linux 容器而 root_path 通常是 Windows 路径，
    因此必须用 ``Pure*Path`` 纯字符串语义，不能用 ``os.path.*``（跟随宿主
    平台，Linux 上不折叠 ``..\\``、不认盘符）。
    """
    if root_path.startswith(("\\\\", "//")):
        return True
    if "\\" in root_path:
        return True
    return len(root_path) >= 2 and root_path[0].isalpha() and root_path[1] == ":"


def _has_control_chars(text: str) -> bool:
    """C0 控制字符（<0x20）或 DEL（0x7F）。空串自然不含（空路径=根，放行）。"""
    return any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text)


def _join_within_root(root_path: str, rel_path: str, workspace_id: uuid.UUID) -> str:
    """containment 预检：校验 rel_path 后拼出 root 内的绝对路径。

    仅预检（design §5.2）——尽早拒明显恶意/错误输入；真正的安全裁决在
    daemon 侧（realpath 落点必须在 realpath(root) 内 + allowed_roots 双重
    校验，design §5.1 主防线）。拒绝矩阵：

    - 控制字符（含 NUL——pathlib 解析本身也会拒，这里先拒给 422 而非 500）；
    - 绝对路径 / 盘符 / 根斜杠 / UNC：join 语义会整体替换 base，必须拒；
    - 任何 ``..`` 段（保守拒绝：浏览路径里的 ``..`` 至多是冗余，至坏是逃逸）。

    返回值用与 root 同形态的连接符（PureWindowsPath 输出反斜杠、
    PurePosixPath 输出 ``/``），空 rel_path 归一为 root 本身。
    """
    if _has_control_chars(rel_path):
        raise ExplorerPathOutsideRoot(
            "路径越界：请求的路径包含非法控制字符，已拒绝。",
            details={
                "workspace_id": str(workspace_id),
                "rel_path": rel_path,
                "reason": "control_chars",
            },
        )
    pure = PureWindowsPath if _is_windows_style_root(root_path) else PurePosixPath
    parsed = pure(rel_path)
    if parsed.drive or parsed.root:
        # 绝对路径 / 盘符 / 根斜杠 / UNC——join 会替换 base，属越界输入。
        raise ExplorerPathOutsideRoot(
            "路径越界：仅允许工作区目录内的相对路径。",
            details={
                "workspace_id": str(workspace_id),
                "rel_path": rel_path,
                "reason": "absolute_path",
            },
        )
    if ".." in parsed.parts:
        raise ExplorerPathOutsideRoot(
            "路径越界：路径中不允许出现「..」。",
            details={
                "workspace_id": str(workspace_id),
                "rel_path": rel_path,
                "reason": "parent_escape",
            },
        )
    # 以原始字符串 join（同 flavour 解析，等价于 base / parsed），避免跨
    # flavour PurePath 相加的 TypeError。
    return str(pure(root_path) / rel_path)


def _validate_result[ModelT: BaseModel](
    result: Any,
    model: type[ModelT],
    *,
    method: str,
    daemon_id: uuid.UUID,
) -> ModelT:
    """严格校验 daemon 返回结构——契约字段一个不能少。

    缺字段 / 类型不符 = daemon provider 漏实现（CONTRACT_GAP），映射为
    ExplorerContractGap（502）显式上报，禁止 ``x || default`` 式掩盖。
    """
    try:
        return model.model_validate(result)
    except ValidationError as exc:
        raise ExplorerContractGap(
            "守护进程返回的数据结构不符合文件浏览契约，请升级 daemon 后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": method,
                "contract": model.__name__,
                "validation_error": str(exc),
            },
        ) from exc


class ExplorerDownload(NamedTuple):
    """download() 返回值——router 据此组 StreamingResponse + Content-Disposition。"""

    filename: str
    content_b64: str
    size: int
    truncated: bool


class ExplorerService:
    """只读文件浏览 service（design §5 方案 B；HTTP 端点见 router.py，task-04）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 内部：绑定解析 / RPC 转发 / 错误映射 ──────────────────────────────────

    async def _resolve_binding(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[uuid.UUID, str]:
        """解析当前用户自己的绑定行 → ``(daemon_id, root_path)``。

        绑定行不存在（resolver miss/异常均收敛为 None），或合法过渡形态
        ``daemon_id IS NULL`` → 一律按未绑定处理，404 引导到成员页
        （design §5.4 / D-003@v1）。log_tag 区分 explorer 来源，便于排障。
        """
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session,
            workspace_id,
            user_id,
            log_tag="explorer_resolve_member_binding_unexpected_error",
        )
        if binding is None or binding.daemon_id is None:
            raise ExplorerNotBound(
                "当前账号未绑定本机工作区，请先到成员页完成绑定。",
                details={"workspace_id": str(workspace_id)},
            )
        return binding.daemon_id, binding.root_path

    async def _send_explorer_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """转发 explorer_* RPC 并统一映射错误（design §7.2 全表）。

        ``timeout`` 必须显式传——send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 不够用
        （tree/file 30s，search/download 60s）。``get_daemon_ws_hub`` 懒导入
        （daemon/router.py:1429 同款理由：测试按 ``ws_hub.get_daemon_ws_hub``
        patch 单例访问器，模块顶层 import 会绑死陈旧引用）。
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        try:
            return await hub.send_rpc(daemon_id, method, params, timeout=timeout)
        except DaemonRuntimeOffline as exc:
            # ws_hub 三处抛 DaemonRuntimeOffline：无连接 / WS send 失败 /
            # RPC 在途断连（CancelledError 转 raise）。前两类按「离线」、
            # 在途断连按「传输中断」区分文案与 code（HTTP 状态均 502，
            # design §7.2）。判据是 ws_hub 的异常文案「mid-rpc」——ws_hub
            # 属本仓代码，其文案变更须同步此处。
            details: dict[str, Any] = {
                "daemon_id": str(daemon_id),
                "method": method,
                **(exc.details or {}),
                **context,
            }
            if "mid-rpc" in str(exc):
                raise ExplorerTransferInterrupted(
                    "与守护进程的传输中断（文件可能过大），请稍后重试。",
                    details={**details, "reason": "disconnected_mid_rpc"},
                ) from exc
            raise ExplorerDaemonOffline(
                "本机守护进程当前离线，无法浏览文件；请确认守护进程在线后重试。",
                details={**details, "reason": "offline_or_send_failed"},
            ) from exc
        except DaemonRpcTimeout as exc:
            raise ExplorerRpcTimeout(
                "文件浏览请求超时，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": method,
                    **(exc.details or {}),
                    **context,
                },
            ) from exc
        except DaemonRpcRemoteError as exc:
            raise _map_remote_error(
                exc, daemon_id=daemon_id, method=method, context=context
            ) from exc

    # ── 四个服务方法（task-04 router 的端点逐一对齐 design §7.2）─────────────

    async def list_tree(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        rel_path: str,
    ) -> ExplorerTreeResponse:
        """列目录（懒加载逐层；rel_path 空 = 根；design §7.1 explorer_list_dir）。"""
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        abs_path = _join_within_root(root_path, rel_path, workspace_id=workspace_id)
        result = await self._send_explorer_rpc(
            daemon_id,
            "explorer_list_dir",
            {"path": abs_path, "root": root_path},
            timeout=TREE_RPC_TIMEOUT_SECONDS,
            context={"workspace_id": str(workspace_id), "path": rel_path},
        )
        return _validate_result(
            result, ExplorerTreeResponse, method="explorer_list_dir", daemon_id=daemon_id
        )

    async def read_file(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        rel_path: str,
    ) -> ExplorerFileResponse:
        """读文件预览（encoding=utf8；design §7.1 explorer_read_file）。"""
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        abs_path = _join_within_root(root_path, rel_path, workspace_id=workspace_id)
        result = await self._send_explorer_rpc(
            daemon_id,
            "explorer_read_file",
            {"path": abs_path, "root": root_path, "encoding": "utf8"},
            timeout=READ_FILE_RPC_TIMEOUT_SECONDS,
            context={"workspace_id": str(workspace_id), "path": rel_path},
        )
        return _validate_result(
            result, ExplorerFileResponse, method="explorer_read_file", daemon_id=daemon_id
        )

    async def download(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        rel_path: str,
    ) -> ExplorerDownload:
        """下载文件（encoding=base64 强制，避免非 utf8 文件被文本往返损坏，§7.2）。"""
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        abs_path = _join_within_root(root_path, rel_path, workspace_id=workspace_id)
        result = await self._send_explorer_rpc(
            daemon_id,
            "explorer_read_file",
            {"path": abs_path, "root": root_path, "encoding": "base64"},
            timeout=DOWNLOAD_RPC_TIMEOUT_SECONDS,
            context={"workspace_id": str(workspace_id), "path": rel_path},
        )
        validated = _validate_result(
            result, ExplorerFileResponse, method="explorer_read_file", daemon_id=daemon_id
        )
        return ExplorerDownload(
            filename=validated.name,
            content_b64=validated.content,
            size=validated.size,
            truncated=validated.truncated,
        )

    async def search(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        query: str,
        *,
        max_results: int = SEARCH_DEFAULT_MAX_RESULTS,
    ) -> ExplorerSearchResponse:
        """按文件名全树搜索（design §7.1 explorer_search；无 rel 路径，免预检）。"""
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        result = await self._send_explorer_rpc(
            daemon_id,
            "explorer_search",
            {"root": root_path, "query": query, "max_results": max_results},
            timeout=SEARCH_RPC_TIMEOUT_SECONDS,
            context={"workspace_id": str(workspace_id), "query": query},
        )
        return _validate_result(
            result, ExplorerSearchResponse, method="explorer_search", daemon_id=daemon_id
        )


def _map_remote_error(
    exc: DaemonRpcRemoteError,
    *,
    daemon_id: uuid.UUID,
    method: str,
    context: dict[str, Any],
) -> AppError:
    """daemon 业务错误按 code 分派（design §7.1 RpcError 体系 / §7.2 映射表）。

    由 ``_send_explorer_rpc`` 以 ``raise ... from exc`` 抛出，原始 code /
    message 保留在 details，不直接外泄到 HTTP status。
    """
    details: dict[str, Any] = {
        "daemon_id": str(daemon_id),
        "method": method,
        "daemon_code": exc.code,
        "daemon_message": exc.message,
        **context,
    }
    if exc.code == "not_found":
        return ExplorerPathNotFound(
            "文件或目录不存在，工作区目录可能已被移动或删除。",
            details=details,
        )
    if exc.code == "forbidden":
        return ExplorerDaemonForbidden(
            "守护进程拒绝访问该路径：不在允许的访问范围内。",
            details=details,
        )
    if exc.code == "method_not_found":
        return ExplorerDaemonTooOld(
            "本机 daemon 版本过旧，不支持文件浏览，请升级 daemon。",
            details=details,
        )
    return ExplorerDaemonRemoteError(
        "守护进程执行文件浏览失败，请稍后重试。",
        details=details,
    )
