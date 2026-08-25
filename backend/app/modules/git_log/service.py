"""GitLog service — 绑定解析 + probe 三态映射 + 平名 RPC 直连 + refs/lane 合并。

只读 Git 日志查询链路（浏览器 → backend → daemon → 宿主机 git）的 service 层
（design §5.3；链路形态照抄 explorer/service.py 与 runtime/service.py 先例）：

- 绑定解析一律复用 ``MemberBindingResolver.resolve_member_binding_or_none``，
  只看当前用户自己的绑定行（design §5.3；不借
  ``resolve_daemon_instance_for_workspace``——其无 user 门控属已知坑）；
- ``probe_workspace_git_mode`` 三态在 service 收口映射（design §5.3 / D-006
  CC-01）：git→继续查询 / direct→``git_mode=no_git`` 空态响应（非报错，前端
  渲染空态卡）/ unknown（传输失败）→按 offline 502 处理、不入枚举；
- 平名 RPC 直连（design §5.2 CC-02）：``ws_hub.send_rpc`` 显式超时转发
  ``git_log`` / ``git_refs`` / ``git_show`` / ``git_diff_file`` 四方法，不经
  ``HostFsDelegate`` 的 ``host_fs.`` 前缀降级通道、不走静默降级（offline/timeout
  显式 502/504；probe 是 delegate 的独立 helper、异常自持归 unknown，例外）；
- refs 合并（design §7.4）：git_refs 结果按 sha 映射进各 commit 的 refs[]
  （annotated tag 的 sha 已由 daemon 用 peeled 值回退，CC-04，backend 直接
  映射无需再回退）；HEAD 同时写入对应 commit 的 kind=head 条目与顶层 head
  字段；branches[] 取 refs 全量（branch/remote 类，CC-07）；
- 跨页 lane 一致性（design §5.3 / D-004）：daemon 不用 --skip，backend 每页
  以 count=skip+limit+lookahead(50) 拉全前缀，``compute_lanes`` 对全前缀做
  确定性计算后只返回 [skip, skip+limit) 窗口；seq 为全局绝对序（CC-10）；
- 全量错误映射（design §5.3）：未绑定→404 / daemon not_found→404 /
  forbidden→403 / offline 与 mid-rpc 断连→502 / timeout→504 /
  method_not_found→422（daemon 版本过旧）/ 契约缺口→502 显式上报。

设计依据：``.sillyspec/changes/2026-08-25-workspace-git-log/design.md``
（§5.2 安全约束 / §5.3 模块形态与错误映射 / §7.2 RPC 契约 / §7.4 数据结构）。
"""

from __future__ import annotations

import re
import uuid
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any, Final, Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.git_log.graph_layout import CommitRef, compute_lanes
from app.modules.git_log.schema import (
    GitLogBranchItem,
    GitLogCommitDetailResponse,
    GitLogCommitItem,
    GitLogCommitsResponse,
    GitLogDiffResponse,
    GitLogEdgeItem,
    GitLogFileStatItem,
    GitLogRefItem,
)
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

# 显式超时（design §5.3）：log/show/diff 三档各 30s，常量风格对齐
# explorer/service.py（send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 不够用）。
LOG_RPC_TIMEOUT_SECONDS: Final[float] = 30.0
SHOW_RPC_TIMEOUT_SECONDS: Final[float] = 30.0
DIFF_RPC_TIMEOUT_SECONDS: Final[float] = 30.0

# 参数校验上限（design §7.1 / R-02 / §5.2 安全约束）。
MAX_SKIP: Final[int] = 2000
MAX_LIMIT: Final[int] = 200
MAX_BRANCH_LENGTH: Final[int] = 200
MAX_AUTHOR_LENGTH: Final[int] = 120

# 分页 lookahead（design §5.3 / D-004）：daemon 不用 --skip，backend 每页拉
# skip+limit+lookahead 全前缀做确定性 lane 计算，保证任意页 lane 与全量一致。
LOOKAHEAD: Final[int] = 50

# sha 白名单（design §5.2 / R-01）：4..40 位十六进制。
_SHA_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9a-fA-F]{4,40}$")
# branch 白名单（design §5.2 / CC-09）：首字符禁「-」（防 git 把 -n/-O 当
# 选项劫持语义），其余允许字母/数字/「.」「_」「-」「/」。
_BRANCH_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")

# ── 模块本地错误（AppError 惯例：类属性 code/http_status + 中文文案，design §5.3）──


class GitLogNotBound(AppError):
    """当前账号无本机绑定（或绑定行 daemon_id IS NULL 过渡形态）→ 404 引导。"""

    code = "HTTP_404_GIT_LOG_NOT_BOUND"
    http_status = 404


class GitLogCommitNotFound(AppError):
    """daemon 返回 code=not_found（提交/文件不存在或 root 已删）→ 404。"""

    code = "HTTP_404_GIT_LOG_COMMIT_NOT_FOUND"
    http_status = 404


class GitLogDaemonForbidden(AppError):
    """daemon 返回 code=forbidden（realpath 逃逸 / allowed_roots 拒绝）→ 403。"""

    code = "HTTP_403_GIT_LOG_DAEMON_FORBIDDEN"
    http_status = 403


class GitLogInvalidParam(AppError):
    """router 层参数静态校验拒绝（skip/limit 超限、sha/branch/author/path 非法）→ 422。"""

    code = "HTTP_422_GIT_LOG_INVALID_PARAM"
    http_status = 422


class GitLogPathOutsideRoot(AppError):
    """containment 预检拒绝（root+path join 逃逸工作区根）→ 422「路径越界」。"""

    code = "HTTP_422_GIT_LOG_PATH_OUTSIDE_ROOT"
    http_status = 422


class GitLogDaemonTooOld(AppError):
    """旧 daemon 未注册 git_log 系平名方法（method_not_found）→ 422 版本过旧引导。"""

    code = "HTTP_422_GIT_LOG_DAEMON_TOO_OLD"
    http_status = 422


class GitLogDaemonOffline(AppError):
    """目标 daemon 无活动 WS 连接（或 probe unknown 传输失败）→ 502。"""

    code = "HTTP_502_GIT_LOG_DAEMON_OFFLINE"
    http_status = 502


class GitLogDaemonRemoteError(AppError):
    """daemon 返回其余业务错误 → 502。"""

    code = "HTTP_502_GIT_LOG_DAEMON_REMOTE"
    http_status = 502


class GitLogContractGap(AppError):
    """daemon git_log 系方法返回结构与契约不符（provider 漏字段）→ 502。"""

    code = "HTTP_502_GIT_LOG_CONTRACT_GAP"
    http_status = 502


class GitLogDaemonTimeout(AppError):
    """RPC 往返超时 → 504。"""

    code = "HTTP_504_GIT_LOG_RPC_TIMEOUT"
    http_status = 504


# ── 参数校验 helper（router 层共享；design §5.2 安全约束 / §7.1 参数表）────────


def _has_control_chars(text: str) -> bool:
    """C0 控制字符（<0x20）或 DEL（0x7F）；空串自然不含（explorer 同款）。"""
    return any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text)


def _validate_pagination(skip: int, limit: int) -> None:
    """skip/limit 窗口校验（design §7.1：skip 0..2000、limit 1..200，超限 422）。"""
    if not 0 <= skip <= MAX_SKIP:
        raise GitLogInvalidParam(
            f"分页参数 skip 超出范围：仅允许 0 到 {MAX_SKIP}。",
            details={"skip": skip, "max": MAX_SKIP},
        )
    if not 1 <= limit <= MAX_LIMIT:
        raise GitLogInvalidParam(
            f"分页参数 limit 超出范围：仅允许 1 到 {MAX_LIMIT}。",
            details={"limit": limit, "max": MAX_LIMIT},
        )


def _validate_sha(sha: str) -> str:
    """sha 白名单校验（design §5.2 / R-01：4..40 位十六进制，防注入）。"""
    if not _SHA_RE.fullmatch(sha):
        raise GitLogInvalidParam(
            "提交哈希格式不合法：仅允许 4 到 40 位十六进制字符。",
            details={"sha": sha},
        )
    return sha


def _validate_branch(branch: str) -> str:
    """branch 过滤值校验（design §5.2 / CC-09：首字符禁「-」防选项劫持，≤200 字符）。"""
    if len(branch) > MAX_BRANCH_LENGTH:
        raise GitLogInvalidParam(
            f"分支名过长：最多 {MAX_BRANCH_LENGTH} 字符。",
            details={"length": len(branch), "max": MAX_BRANCH_LENGTH},
        )
    if branch and not _BRANCH_RE.fullmatch(branch):
        raise GitLogInvalidParam(
            "分支名格式不合法：仅允许字母、数字与「.」「_」「-」「/」，且首字符须为字母或数字。",
            details={"branch": branch},
        )
    return branch


def _validate_author(author: str) -> str:
    """author 过滤值校验（design §5.2：≤120 字符且不含控制字符）。"""
    if len(author) > MAX_AUTHOR_LENGTH:
        raise GitLogInvalidParam(
            f"作者过滤词过长：最多 {MAX_AUTHOR_LENGTH} 字符。",
            details={"length": len(author), "max": MAX_AUTHOR_LENGTH},
        )
    if _has_control_chars(author):
        raise GitLogInvalidParam(
            "作者过滤词包含非法控制字符，已拒绝。",
            details={"author": author[:50]},
        )
    return author


def _validate_diff_path(path: str) -> str:
    """diff path 静态预检（design §5.2 / CC-09：非空 + 拒 pathspec magic + 控制字符）。"""
    if not path:
        raise GitLogInvalidParam(
            "缺少必填参数 path：请提供要查看差异的文件路径。",
            details={"path": path},
        )
    if path.startswith(":("):
        raise GitLogInvalidParam(
            "文件路径不允许使用 pathspec magic 语法（「:(」开头），已拒绝。",
            details={"path": path},
        )
    if _has_control_chars(path):
        raise GitLogInvalidParam(
            "文件路径包含非法控制字符，已拒绝。",
            details={"path": path[:50]},
        )
    return path


# ── containment 预检（design §5.2 / R-01；跨平台纯字符串语义，explorer 同款）──


def _is_windows_style_root(root_path: str) -> bool:
    """按 ``root_path`` 形态判断路径语义：Windows / POSIX（explorer 同款判定）。

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


def _check_repo_rel_path(path: str, root_path: str, workspace_id: uuid.UUID) -> None:
    """diff path containment 预检（design §5.2 / R-01：越界输入尽早拒、先于 RPC）。

    与 explorer ``_join_within_root`` 同语义但不拼绝对路径——git_diff_file 的
    path 是仓库内相对 pathspec（daemon 侧 ``git -C <root> ... -- <path>`` 以
    root 为基准解析），backend 只做拒绝面：绝对路径 / 盘符 / 根斜杠 / UNC
    （pathspec 语义下无意义且扩大攻击面）与任何 ``..`` 段。pathspec magic
    （``:(`` 开头）与控制字符已在 router 层静态预检拒绝（``_validate_diff_path``）；
    主防线仍是 daemon 侧 ``assertWithinAllowedRoots`` + ``assertGitPathspec``。
    """
    pure = PureWindowsPath if _is_windows_style_root(root_path) else PurePosixPath
    parsed = pure(path)
    if parsed.drive or parsed.root:
        raise GitLogPathOutsideRoot(
            "路径越界：仅允许仓库目录内的相对路径。",
            details={
                "workspace_id": str(workspace_id),
                "path": path,
                "reason": "absolute_path",
            },
        )
    if ".." in parsed.parts:
        raise GitLogPathOutsideRoot(
            "路径越界：路径中不允许出现「..」。",
            details={
                "workspace_id": str(workspace_id),
                "path": path,
                "reason": "parent_escape",
            },
        )


# ── daemon RPC 结果模型（design §7.2 契约的 backend 侧严格校验面）────────────
#
# 与 explorer 的「响应模型即 daemon 结果」不同：git_log 系四方法的结果结构与
# HTTP 响应（§7.4）不同形（含 error 文案、add/del 二进制可空等），故在 service
# 内私有建模；缺字段 / 类型不符一律 ValidationError → GitLogContractGap 502
# 显式上报（explorer 同纪律，禁止 ``.get()`` 默认值掩盖契约缺口）。


class _DaemonCommit(BaseModel):
    """git_log / git_show 共用的单条提交记录（daemon pretty 解析产物，§7.2）。"""

    hash: str
    short: str
    parents: list[str]
    author_name: str
    author_email: str
    author_date: str
    committer_date: str
    message: str


class _DaemonGitLogResult(BaseModel):
    """git_log 结果：``{commits, truncated, error}``（空仓库空态 error=null，CC-17）。"""

    commits: list[_DaemonCommit]
    truncated: bool
    error: str | None


class _DaemonRef(BaseModel):
    """git_refs 单条 ref（annotated tag 的 sha 已由 daemon peeled 回退，CC-04）。"""

    name: str
    short: str
    sha: str
    kind: Literal["branch", "remote", "tag"]


class _DaemonGitRefsResult(BaseModel):
    """git_refs 结果：``{refs, head, error}``（空仓库 refs=[] / head=null，CC-17）。"""

    refs: list[_DaemonRef]
    head: str | None
    error: str | None


class _DaemonShowFile(BaseModel):
    """git_show 单个变更文件（numstat「-」行 add/del 为 null + binary=true）。"""

    path: str
    add: int | None
    del_: int | None = Field(..., alias="del")
    binary: bool


class _DaemonShowResult(BaseModel):
    """git_show 结果：``{commit, files, error}``（sha 不存在时 commit=null）。"""

    commit: _DaemonCommit | None
    files: list[_DaemonShowFile]
    error: str | None


class _DaemonDiffResult(BaseModel):
    """git_diff_file 结果：``{diff, truncated, binary, error}``（64KB 截断，CC-05）。"""

    diff: str
    truncated: bool
    binary: bool
    error: str | None


def _validate_result[ModelT: BaseModel](
    result: Any,
    model: type[ModelT],
    *,
    method: str,
    daemon_id: uuid.UUID,
) -> ModelT:
    """严格校验 daemon 返回结构——契约字段一个不能少（explorer 同款纪律）。

    缺字段 / 类型不符 = daemon provider 漏实现（CONTRACT_GAP），映射为
    GitLogContractGap（502）显式上报，禁止 ``x || default`` 式掩盖。
    """
    try:
        return model.model_validate(result)
    except ValidationError as exc:
        raise GitLogContractGap(
            "守护进程返回的数据结构不符合 Git 日志契约，请升级 daemon 后重试。",
            details={
                "daemon_id": str(daemon_id),
                "method": method,
                "contract": model.__name__,
                "validation_error": str(exc),
            },
        ) from exc


def _map_remote_error(
    exc: DaemonRpcRemoteError,
    *,
    daemon_id: uuid.UUID,
    method: str,
    context: dict[str, Any],
) -> AppError:
    """daemon 业务错误按 code 分派（design §5.3 映射全表，explorer 同骨架）。

    由 ``_send_git_rpc`` 以 ``raise ... from exc`` 抛出，原始 code / message
    保留在 details，不直接外泄到 HTTP body。git_log 系平名方法的 daemon 侧
    当前只主动抛 forbidden（入参非法 / root 越界）与 method_not_found（旧
    daemon 未注册）；not_found 分支保留以对齐映射全表（daemon 未来语义化
    not_found 时无需改这里）。
    """
    details: dict[str, Any] = {
        "daemon_id": str(daemon_id),
        "method": method,
        "daemon_code": exc.code,
        "daemon_message": exc.message,
        **context,
    }
    if exc.code == "not_found":
        return GitLogCommitNotFound(
            "提交不存在，工作区目录可能已被移动或删除。",
            details=details,
        )
    if exc.code == "forbidden":
        return GitLogDaemonForbidden(
            "守护进程拒绝访问该路径：不在允许的访问范围内。",
            details=details,
        )
    if exc.code == "method_not_found":
        return GitLogDaemonTooOld(
            "本机 daemon 版本过旧，不支持 Git 日志查询，请升级 daemon。",
            details=details,
        )
    return GitLogDaemonRemoteError(
        "守护进程执行 Git 查询失败，请稍后重试。",
        details=details,
    )


class GitLogService:
    """Git 日志只读查询 service（design §5.3 完整数据链路；端点见 router.py）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 内部：绑定解析 / probe 映射 / RPC 转发与错误映射 ──────────────────────

    async def _resolve_binding(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[uuid.UUID, str]:
        """解析当前用户自己的绑定行 → ``(daemon_id, root_path)``（explorer 同构）。

        绑定行不存在（resolver miss/异常均收敛为 None）或合法过渡形态
        ``daemon_id IS NULL`` → 一律按未绑定处理，404 引导到成员页
        （design §5.3）。root_path 取成员自己绑定行的值——daemon-client 模式
        下每个成员读自己本机的工作区副本。log_tag 区分 git_log 来源。
        """
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session,
            workspace_id,
            user_id,
            log_tag="git_log_resolve_member_binding_unexpected_error",
        )
        if binding is None or binding.daemon_id is None:
            raise GitLogNotBound(
                "当前账号未绑定本机工作区，请先到成员页完成绑定。",
                details={"workspace_id": str(workspace_id)},
            )
        return binding.daemon_id, binding.root_path

    async def _fetch_workspace(self, workspace_id: uuid.UUID) -> Workspace:
        """取工作区行（probe 需要 ``workspace.root_path``；权限门控后应恒存在）。

        WORKSPACE_READ 门控已保证成员语境下工作区存在；``None`` 仅在竞态删除
        等极端形态出现，按未绑定语义 404（不泄漏存在性）。
        """
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise GitLogNotBound(
                "工作区不存在或已删除。",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace

    async def _probe_git_mode(self, workspace: Workspace) -> Literal["git", "direct"]:
        """probe 三态 → 两态映射（design §5.3 / D-006 CC-01）。

        复用 ``HostFsDelegate.probe_workspace_git_mode``（delegate.py 现行契约，
        真实返回 git/direct/unknown）：direct→由 caller 映射 no_git 空态；
        unknown（传输失败，delegate 内部已捕获不抛）→按 offline 502 抛
        GitLogDaemonOffline，绝不静默降级（task-04 constraints）。delegate 经
        ``new_host_fs_delegate`` 工厂懒构造（进程 ws_hub 单例——测试按
        ``ws_hub.get_daemon_ws_hub`` patch 后此处自动取到假件）。
        """
        from app.modules.daemon.host_fs import new_host_fs_delegate

        mode = await new_host_fs_delegate(self._session).probe_workspace_git_mode(workspace)
        if mode == "unknown":
            raise GitLogDaemonOffline(
                "本机守护进程当前离线，无法探测 Git 仓库状态；请确认守护进程在线后重试。",
                details={
                    "workspace_id": str(getattr(workspace, "id", "")),
                    "reason": "probe_unknown",
                },
            )
        if mode == "direct":
            return "direct"
        return "git"

    async def _send_git_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """转发 git_log 系平名 RPC 并统一映射错误（design §5.3 全表）。

        平名直连（CC-02）：方法名不带 ``host_fs.`` 前缀、不经 HostFsDelegate
        降级通道——offline/timeout 显式 502/504 而非静默降级。``timeout`` 必须
        显式传（send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 不够用）；
        ``get_daemon_ws_hub`` 懒导入（explorer/service.py 同款理由：测试按
        ``ws_hub.get_daemon_ws_hub`` patch 单例访问器，模块顶层 import 会绑死
        陈旧引用）。
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        try:
            return await hub.send_rpc(daemon_id, method, params, timeout=timeout)
        except DaemonRuntimeOffline as exc:
            # 与 explorer 同判据：ws_hub 异常文案「mid-rpc」区分在途断连 vs
            # 离线（ws_hub 属本仓代码，其文案变更须同步此处）。git_log 错误族
            # 不单列 TransferInterrupted（task-02 已定九类），二者同为 502
            # GitLogDaemonOffline、以 reason 细分（design §5.3 offline 502）。
            details: dict[str, Any] = {
                "daemon_id": str(daemon_id),
                "method": method,
                **(exc.details or {}),
                **context,
            }
            if "mid-rpc" in str(exc):
                raise GitLogDaemonOffline(
                    "与守护进程的传输中断，请稍后重试。",
                    details={**details, "reason": "disconnected_mid_rpc"},
                ) from exc
            raise GitLogDaemonOffline(
                "本机守护进程当前离线，无法查询 Git 日志；请确认守护进程在线后重试。",
                details={**details, "reason": "offline_or_send_failed"},
            ) from exc
        except DaemonRpcTimeout as exc:
            raise GitLogDaemonTimeout(
                "Git 日志查询超时，请稍后重试。",
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

    # ── 三个查询方法（design §7.1 三端点逐一对齐）────────────────────────────

    async def list_commits(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        skip: int = 0,
        limit: int = 100,
        branch: str = "",
        author: str = "",
    ) -> GitLogCommitsResponse:
        """提交列表 + 泳道 lane/edges（design §7.1 端点 ①；git_log/git_refs 30s）。

        链路（design §5.3）：绑定解析 → probe 三态映射（direct→no_git 空态）→
        平名 RPC git_log + git_refs → refs 按 sha 合并（HEAD 双写 refs[]/顶层
        head；annotated tag sha 已由 daemon peeled 回退，CC-04）→ compute_lanes
        对 count=skip+limit+lookahead 全前缀确定性计算 → 截取 [skip, skip+limit)
        窗口（seq 为全局绝对序，CC-10）。
        """
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        workspace = await self._fetch_workspace(workspace_id)
        if await self._probe_git_mode(workspace) == "direct":
            # 非 git 工作区 → 空态响应（非报错，前端渲染空态卡，design §5.3）。
            return GitLogCommitsResponse(
                git_mode="no_git",
                commits=[],
                branches=[],
                head=None,
                has_more=False,
                total_in_window=0,
            )

        daemon_root = resolve_root_path_for_daemon(root_path)
        # daemon 不用 --skip（D-004）：一次拉 skip+limit+lookahead 全前缀，
        # lane 对全前缀计算后截取窗口——任意页 lane 与全量计算一致。
        count = skip + limit + LOOKAHEAD
        log_result = _validate_result(
            await self._send_git_rpc(
                daemon_id,
                "git_log",
                {
                    "root": daemon_root,
                    # branch 非空时 daemon 用 <branch> 替代 --all（互斥，D-005）；
                    # 空串 = 全部分支。
                    "branch": branch,
                    "author": author,
                    "count": count,
                },
                timeout=LOG_RPC_TIMEOUT_SECONDS,
                context={
                    "workspace_id": str(workspace_id),
                    "skip": skip,
                    "limit": limit,
                    "branch": branch,
                    "author": author,
                },
            ),
            _DaemonGitLogResult,
            method="git_log",
            daemon_id=daemon_id,
        )
        if log_result.error:
            # daemon 只在 git 命令真失败时置 error（非 git 目录已被 probe 挡住、
            # 分支不存在 / 内部超时等；空仓库空态 error=null 不进此分支，CC-17）
            # ——统一 502，原始 stderr 文案保 details 不外泄到 HTTP body。
            raise GitLogDaemonRemoteError(
                "守护进程执行 Git 查询失败，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": "git_log",
                    "daemon_message": log_result.error,
                    "workspace_id": str(workspace_id),
                },
            )

        refs_result = _validate_result(
            await self._send_git_rpc(
                daemon_id,
                "git_refs",
                {"root": daemon_root},
                timeout=LOG_RPC_TIMEOUT_SECONDS,
                context={"workspace_id": str(workspace_id)},
            ),
            _DaemonGitRefsResult,
            method="git_refs",
            daemon_id=daemon_id,
        )
        if refs_result.error:
            raise GitLogDaemonRemoteError(
                "守护进程读取分支列表失败，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": "git_refs",
                    "daemon_message": refs_result.error,
                    "workspace_id": str(workspace_id),
                },
            )

        # refs 合并（design §7.4）：按 sha 挂到各 commit；sha 已是 daemon peeled
        # 回退后的 commit sha（CC-04），backend 直接映射无需再回退。branches[]
        # 取全量 branch/remote 类（与窗口无关，CC-07 分支下拉数据源）。
        refs_by_sha: dict[str, list[GitLogRefItem]] = {}
        for ref in refs_result.refs:
            refs_by_sha.setdefault(ref.sha, []).append(GitLogRefItem(name=ref.short, kind=ref.kind))
        branches = [
            GitLogBranchItem(name=ref.short, kind=ref.kind)
            for ref in refs_result.refs
            if ref.kind in ("branch", "remote")
        ]
        head = refs_result.head

        all_commits = log_result.commits
        layouts = compute_lanes(
            [
                CommitRef(index=i, hash=commit.hash, parents=list(commit.parents))
                for i, commit in enumerate(all_commits)
            ]
        )

        # 窗口截取（D-004）：daemon 结果按新→旧自 HEAD 起，下标 i 即全局绝对序
        # （CC-10）；只返回 [skip, skip+limit)。
        window_end = min(skip + limit, len(all_commits))
        items: list[GitLogCommitItem] = []
        for i in range(skip, window_end):
            commit = all_commits[i]
            layout = layouts[i]
            refs = list(refs_by_sha.get(commit.hash, []))
            if head is not None and commit.hash == head:
                # HEAD 双写（design §7.4）：对应 commit 的 kind=head 条目（前置，
                # UI 优先展示）+ 顶层 head 字段。
                refs.insert(0, GitLogRefItem(name="HEAD", kind="head"))
            # 边目标须落在 daemon 结果集内（compute_lanes 已保证只产结果集内
            # 的边）且不早于窗口起点——父边只指向更旧提交（t>s≥skip 恒成立），
            # 判定属防御性保留；窗口外的目标即 CC-03 lookahead 退化：不绘制，
            # lane 编号不受影响。
            edges = [
                GitLogEdgeItem(to_seq=edge.to_index, to_lane=edge.to_lane, kind=edge.kind)
                for edge in layout.edges
                if skip <= edge.to_index < len(all_commits)
            ]
            items.append(
                GitLogCommitItem(
                    seq=i,
                    hash=commit.hash,
                    short=commit.short,
                    parents=list(commit.parents),
                    message=commit.message,
                    author_name=commit.author_name,
                    author_email=commit.author_email,
                    author_date=commit.author_date,
                    lane=layout.lane,
                    edges=edges,
                    refs=refs,
                )
            )
        return GitLogCommitsResponse(
            git_mode="git",
            commits=items,
            branches=branches,
            head=head,
            # 达到拉取上限（结果集外可能还有提交）或 daemon 标记 truncated
            # （-n 截断 / 存在解析跳过）→ 窗口之后可能还有更多。
            has_more=len(all_commits) >= count or log_result.truncated,
            total_in_window=len(items),
        )

    async def get_commit_detail(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        sha: str,
    ) -> GitLogCommitDetailResponse:
        """提交详情 + 变更文件列表（design §7.1 端点 ②；git_show/git_refs 30s）。

        链路：绑定解析 → probe（direct→404「该工作区不是 Git 仓库」——设计未
        细说此端点的 no_git 形态，列表端点用 no_git 空态响应，而详情/diff 面向
        具体提交、无提交可述，选 404 中文文案引导，偏离决定记 reviewer notes）→
        git_show → git_refs 合并 refs[]（HEAD 命中时含 kind=head 条目）。
        """
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        workspace = await self._fetch_workspace(workspace_id)
        if await self._probe_git_mode(workspace) == "direct":
            raise GitLogCommitNotFound(
                "该工作区不是 Git 仓库，无法查看提交详情。",
                details={"workspace_id": str(workspace_id)},
            )

        daemon_root = resolve_root_path_for_daemon(root_path)
        show_result = _validate_result(
            await self._send_git_rpc(
                daemon_id,
                "git_show",
                {"root": daemon_root, "sha": sha},
                timeout=SHOW_RPC_TIMEOUT_SECONDS,
                context={"workspace_id": str(workspace_id), "sha": sha},
            ),
            _DaemonShowResult,
            method="git_show",
            daemon_id=daemon_id,
        )
        commit = show_result.commit
        if commit is None or show_result.error:
            # daemon 命令失败（sha 不存在 / root 失效）时 commit=null + error
            # 文案（§7.2）→ 404；原始文案保 details。
            raise GitLogCommitNotFound(
                "提交不存在或已不可访问，请刷新后重试。",
                details={
                    "workspace_id": str(workspace_id),
                    "sha": sha,
                    "daemon_message": show_result.error,
                },
            )

        refs_result = _validate_result(
            await self._send_git_rpc(
                daemon_id,
                "git_refs",
                {"root": daemon_root},
                timeout=LOG_RPC_TIMEOUT_SECONDS,
                context={"workspace_id": str(workspace_id)},
            ),
            _DaemonGitRefsResult,
            method="git_refs",
            daemon_id=daemon_id,
        )
        if refs_result.error:
            # refs[] 是详情响应的契约字段（§7.4），降级空列表会掩盖 daemon 故障
            # ——按同一映射表 502 显式上报（契约纪律，不静默）。
            raise GitLogDaemonRemoteError(
                "守护进程读取分支列表失败，请稍后重试。",
                details={
                    "daemon_id": str(daemon_id),
                    "method": "git_refs",
                    "daemon_message": refs_result.error,
                    "workspace_id": str(workspace_id),
                },
            )

        refs = [
            GitLogRefItem(name=ref.short, kind=ref.kind)
            for ref in refs_result.refs
            if ref.sha == commit.hash
        ]
        if refs_result.head is not None and refs_result.head == commit.hash:
            refs.insert(0, GitLogRefItem(name="HEAD", kind="head"))

        return GitLogCommitDetailResponse(
            hash=commit.hash,
            short=commit.short,
            parents=list(commit.parents),
            message=commit.message,
            author_name=commit.author_name,
            author_email=commit.author_email,
            author_date=commit.author_date,
            committer_date=commit.committer_date,
            refs=refs,
            # numstat 二进制行 add/del=null（§7.2）→ 响应侧归 0（schema 约定
            # 「二进制文件为 0」，binary=true 时数值无意义）。
            files=[
                GitLogFileStatItem(
                    path=file.path,
                    add=file.add or 0,
                    del_=file.del_ or 0,
                    binary=file.binary,
                )
                for file in show_result.files
            ],
        )

    async def get_file_diff(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        sha: str,
        path: str,
    ) -> GitLogDiffResponse:
        """单文件 unified diff（design §7.1 端点 ③；git_diff_file 30s，64KB 截断）。

        链路：绑定解析 → containment 预检（先于 RPC，R-01）→ git_diff_file
        转发。本端点不做 probe（省一次 RPC 往返）——非 git / sha 不存在由
        daemon 命令失败的 error 文案映射 404 覆盖（任务链路定义）。
        """
        daemon_id, root_path = await self._resolve_binding(workspace_id, user_id)
        daemon_root = resolve_root_path_for_daemon(root_path)
        _check_repo_rel_path(path, root_path, workspace_id=workspace_id)
        diff_result = _validate_result(
            await self._send_git_rpc(
                daemon_id,
                "git_diff_file",
                {"root": daemon_root, "sha": sha, "path": path},
                timeout=DIFF_RPC_TIMEOUT_SECONDS,
                context={"workspace_id": str(workspace_id), "sha": sha, "path": path},
            ),
            _DaemonDiffResult,
            method="git_diff_file",
            daemon_id=daemon_id,
        )
        if diff_result.error:
            raise GitLogCommitNotFound(
                "文件差异不存在：提交或文件路径不存在，请刷新后重试。",
                details={
                    "workspace_id": str(workspace_id),
                    "sha": sha,
                    "path": path,
                    "daemon_message": diff_result.error,
                },
            )
        return GitLogDiffResponse(
            diff=diff_result.diff,
            truncated=diff_result.truncated,
            binary=diff_result.binary,
        )
