"""Patch service — applies unified diff patches to agent run worktrees.

Extracted from DaemonService (2026-06-22-daemon-service-split task-03).
Behavior is byte-for-byte identical to the original DaemonService._apply_patch_to_worktree
/ _run_git_apply methods.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun  # noqa: F401  (对齐原 import 风格)
from app.modules.workspace.model import AgentRunWorkspace, Workspace
from app.modules.workspace.service import is_daemon_client_path_source

if TYPE_CHECKING:
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)


# ── Domain errors (task-07 迁入；原 facade service.py:85/90 字符级搬入) ───────


class PatchApplyError(AppError):
    code = "HTTP_422_PATCH_APPLY_ERROR"
    http_status = 422


class PatchConflictError(AppError):
    code = "HTTP_409_PATCH_CONFLICT"
    http_status = 409


class PatchService:
    """Applies unified diff patches to the workspace associated with an agent run.

    子域归位判据（design §5.1）：操作对象 = worktree patch 应用 → 归 patch 子域。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # task-06：facade 反向注入（D-006@v1，仿 lease/run_sync 子域），由
        # DaemonService.__init__ 设置。daemon-client 分支经
        # ``self._facade.host_fs_delegate`` 访问 HostFsDelegate.git_apply。
        self._facade: "DaemonService | None" = None

    async def apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
        path_source: str | None = None,
    ) -> None:
        """Apply a unified diff patch to the workspace associated with *agent_run_id*.

        task-06（FR-03 / D-002@V1）：按 *path_source* 分流。

        * ``daemon-client``：经 ``self._facade.host_fs_delegate.git_apply`` 委托
          daemon 在宿主 apply（WS RPC，D-005）。无容器内 ``git apply`` / 无
          ``Path(workspace.root_path)`` 容器访问（NFR-03，解 design §1 第 5 bug
          FileNotFoundError 500）。``skipped=True``（D-008 patch_id 去重 / daemon
          ``--check`` 预检命中）直接 return；``ok=False`` 抛 :class:`PatchConflictError`
          （零回归 lease/service.py PatchConflictError 捕获路径）。RPC 失败已被
          HostFsDelegate 兜底为 ``{ok:False, conflict_detail:'rpc unavailable'}``
          （task-04 D-006），按冲突处理——lease 路径 warn 不抛。
        * ``server-local``（default，含 None / 未知值）：保留原 ``git apply --check``
          → ``git apply`` / ``--3way`` 容器内流程（D-004 零回归）。

        Steps (server-local 分支保留原注释):
        1. Resolve the workspace root_path via the AgentRunWorkspace M:N table.
        2. Run ``git apply --check`` to validate the patch.
        3. If the check fails and *use_3way* is True, retry with ``--3way``.
        4. If 3way also fails raise :class:`PatchConflictError`.
        5. If the check succeeds, apply the patch normally.
        """
        # 1. Resolve workspace root_path（M:N，task-05 §12 核实结论）
        ws_stmt = (
            select(AgentRunWorkspace.workspace_id)
            .where(col(AgentRunWorkspace.agent_run_id) == agent_run_id)
            .limit(1)
        )
        ws_row = (await self._session.execute(ws_stmt)).first()
        if ws_row is None:
            raise PatchApplyError(
                f"No workspace associated with agent_run '{agent_run_id}'.",
                details={"agent_run_id": str(agent_run_id)},
            )

        workspace = await self._session.get(Workspace, ws_row[0])
        if workspace is None:
            raise PatchApplyError(
                f"Workspace '{ws_row[0]}' not found.",
                details={"workspace_id": str(ws_row[0])},
            )

        # task-06 分流：daemon-client 走 HostFsDelegate（WS RPC 委托 daemon 在宿主 apply）。
        if is_daemon_client_path_source(path_source):
            await self._apply_via_host_fs_delegate(
                workspace=workspace,
                agent_run_id=agent_run_id,
                patch_data=patch_data,
                use_3way=use_3way,
            )
            return

        # server-local 分支（D-004）：保留原容器内 git apply 流程，零改动。
        workdir = Path(workspace.root_path)

        # 2. git apply --check
        check_ok, check_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--check"],
            patch_data=patch_data,
        )

        if check_ok:
            # 5. Apply normally
            apply_ok, apply_stderr = await self._run_git_apply(
                workdir=workdir,
                args=["git", "apply"],
                patch_data=patch_data,
            )
            if not apply_ok:
                raise PatchApplyError(
                    f"git apply failed after successful check: {apply_stderr}",
                    details={
                        "agent_run_id": str(agent_run_id),
                        "workspace_id": str(workspace.id),
                        "stderr": apply_stderr,
                    },
                )
            return

        # Check failed
        if not use_3way:
            raise PatchApplyError(
                f"Patch does not apply cleanly: {check_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "stderr": check_stderr,
                },
            )

        # 3. Try --3way
        log.info(
            "daemon_patch_check_failed_trying_3way",
            agent_run_id=str(agent_run_id),
            check_stderr=check_stderr,
        )
        merge_ok, merge_stderr = await self._run_git_apply(
            workdir=workdir,
            args=["git", "apply", "--3way"],
            patch_data=patch_data,
        )
        if not merge_ok:
            # 4. Conflict
            raise PatchConflictError(
                f"Patch conflict (3way merge failed): {merge_stderr}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "check_stderr": check_stderr,
                    "merge_stderr": merge_stderr,
                },
            )

    async def _apply_via_host_fs_delegate(
        self,
        *,
        workspace: Workspace,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool,
    ) -> None:
        """task-06 daemon-client 分支：经 HostFsDelegate.git_apply 委托 daemon 在宿主 apply。

        - ``skipped=True``（D-008 backend patch_id 去重 / daemon 侧 ``--check`` 预检命中）
          → 直接 return，不报冲突（重复 complete_lease 幂等）。
        - ``ok=False``（含 RPC 失败兜底 ``conflict_detail='rpc unavailable'``、daemon 侧
          真实冲突）→ 抛 :class:`PatchConflictError`，复用 lease/service.py:483 捕获路径
          写 metadata patch_conflict（零回归 PatchConflictError 语义，NFR-02）。
        - ``ok=True`` → 正常 return。

        HostFsDelegate 已兜底所有 RPC 传输失败（task-04 D-006：DaemonRuntimeOffline /
        Timeout / RemoteError / Conflict → warn + degraded dict），本方法不捕获 RPC 异常。
        """
        if self._facade is None:
            # facade 未注入（独立 PatchService 单测场景）→ 不可委托，抛冲突让上层处理。
            # 生产路径 DaemonService.__init__ 必注入（见 self._patch._facade = self）。
            raise PatchConflictError(
                "HostFsDelegate unavailable (facade not wired)",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                },
            )

        delegate = self._facade.host_fs_delegate
        result = await delegate.git_apply(
            workspace=workspace,
            patch_data=patch_data,
            use_3way=use_3way,
            agent_run_id=str(agent_run_id),
        )

        if not isinstance(result, dict):
            # 防御：delegate 契约保证返回 dict，异常情况按冲突处理。
            raise PatchConflictError(
                "HostFsDelegate.git_apply returned non-dict",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "result_type": type(result).__name__,
                },
            )

        if result.get("skipped"):
            # D-008 幂等命中：已 applied / daemon --check 判定已包含，不报冲突。
            log.info(
                "daemon_patch_skipped_idempotent",
                agent_run_id=str(agent_run_id),
                workspace_id=str(workspace.id),
                patch_id=result.get("patch_id"),
            )
            return

        if not result.get("ok"):
            # 含 RPC 失败兜底（conflict_detail='rpc unavailable'）与真实 git 冲突，
            # 统一抛 PatchConflictError，lease 路径 warn + metadata patch_conflict。
            raise PatchConflictError(
                f"Patch conflict (host_fs.git_apply): {result.get('conflict_detail')}",
                details={
                    "agent_run_id": str(agent_run_id),
                    "workspace_id": str(workspace.id),
                    "conflict_detail": result.get("conflict_detail"),
                },
            )

        # ok=True：apply 成功，正常 return（lease.service.py:477 写 daemon_patch_applied log）。

    @staticmethod
    async def _run_git_apply(
        *,
        workdir: Path,
        args: list[str],
        patch_data: str,
    ) -> tuple[bool, str]:
        """Run a ``git apply`` sub-command and return ``(ok, stderr)``."""
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(workdir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate(input=patch_data.encode())
        stderr = stderr_bytes.decode(errors="replace").strip()
        return proc.returncode == 0, stderr
