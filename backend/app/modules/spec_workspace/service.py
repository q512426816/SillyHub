"""Spec workspace use cases.

This module handles CRUD and sync-status management for the ``spec_workspaces``
table. It does not touch the filesystem (that responsibility belongs to the
sync / import flows in future tasks).

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import tarfile
import tempfile
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session_factory
from app.core.errors import AppError, SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.modules.daemon.model import DaemonChangeWrite
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.schema import (
    FileOp,
    SpecWorkspaceCreate,
    SpecWorkspaceUpdate,
    SyncStatusUpdate,
)

log = get_logger(__name__)

# Error code for invalid sync tar payloads (path traversal, corrupt tar, etc.).
# Reused via AppError instances to avoid extending errors.py (task allowed_paths).
SPEC_BUNDLE_INVALID_CODE = "HTTP_422_SPEC_BUNDLE_INVALID"

# 软删备份区（change 2026-08-13-platform-managed-file-sync / R-06）：
#   - BACKUP_TS_FORMAT：timestamped 备份子目录名（可排序、可 strptime 解析）。
#   - SPEC_BACKUP_RETENTION_DAYS：默认保留 30 天，软删时机会式修剪早于该天数的旧目录。
BACKUP_TS_FORMAT = "%Y%m%d%H%M%S%f"
SPEC_BACKUP_RETENTION_DAYS = 30

# 批量进度回写（perf-remediation task-03 / D-002@v1）：内存计数 + 批量 UPDATE，
# 消除每文件一次独立 session+commit 的回写开销。粒度 50 文件 / 500ms（先到者，
# design 兼容策略授权），流程结束 finally 终态回写保证数值最终准确（R-02）。
BATCH_FLUSH_FILES = 50
BATCH_FLUSH_INTERVAL_S = 0.5


def _spec_bundle_invalid(message: str, **details: object) -> AppError:
    """Build a 422 AppError for an invalid sync tar payload."""
    return AppError(
        message,
        code=SPEC_BUNDLE_INVALID_CODE,
        http_status=422,
        details=details or None,
    )


class _BatchProgressWriter:
    """批量进度回写器（perf-remediation task-03 / D-002@v1）。

    替代原「每文件一次独立 session+UPDATE+commit」的逐文件回写：调用方每处理
    一个文件调一次 ``bump()``（仅内存计数），累计到 ``_FLUSH_FILES`` 个或距上次
    回写超过 ``_FLUSH_INTERVAL_S``（先到者）时单次原子自增 UPDATE
    ``files_processed = files_processed + batch``。``flush()`` 在流程结束
    （finally）兜底调用，保证终态数值准确（R-02：批量粒度只影响中途展示，
    不影响最终值）。

    守卫与幂等语义与原逐文件回写一致：
    - ``status == 'claimed'`` WHERE 守卫（BL-3 对齐）保留——终态回写仍只对
      claimed 行生效，daemon 抢先 complete 后的尾批是 no-op。
    - 原子自增（非绝对值覆盖）——并发写者（progress 端点）不会被覆盖。
    - best-effort：失败仅 warn 不阻塞 apply 主流程（每批独立 try/except，
      单批失败不丢后续批）。
    - ``files_processed IS NULL`` 的行（daemon 尚未上报过计数）以 COALESCE
      视作 0 起步（原逐文件裸 ``NULL + 1`` 永远 NULL，进度从不落地；批量终态
      回写要求数值最终准确，此处修正该缺陷——正向变化，不改已非 NULL 行为）。

    每个同步流程（``_write_spec_root`` / ``apply_ops``）各建一个实例，
    不跨方法共享状态。
    """

    _FLUSH_FILES = BATCH_FLUSH_FILES
    _FLUSH_INTERVAL_S = BATCH_FLUSH_INTERVAL_S

    def __init__(self, change_write_id: str | None) -> None:
        self._change_write_id = change_write_id
        self._pending = 0
        self._last_flush = time.monotonic()

    async def bump(self) -> None:
        """记一个文件已处理（内存计数；达到批量阈值/时间窗时回写一次）。"""
        if not self._change_write_id:
            return
        self._pending += 1
        if (
            self._pending >= self._FLUSH_FILES
            or time.monotonic() - self._last_flush >= self._FLUSH_INTERVAL_S
        ):
            await self.flush()

    async def flush(self) -> None:
        """把累计计数回写 DB（终态兜底也走这里；pending=0 时空操作）。"""
        batch, self._pending = self._pending, 0
        self._last_flush = time.monotonic()
        if not self._change_write_id or batch <= 0:
            return
        try:
            async with get_session_factory()() as progress_session:
                await progress_session.execute(
                    update(DaemonChangeWrite)
                    .where(
                        DaemonChangeWrite.id == uuid.UUID(self._change_write_id),
                        DaemonChangeWrite.status == "claimed",
                    )
                    # COALESCE 初始化：daemon 尚未上报过计数的行 files_processed
                    # 为 NULL，裸 NULL + batch 仍 NULL（原逐文件 +1 同样如此，进度
                    # 永不落地）。终态回写要求「数值最终准确」→ NULL 视作 0 起步。
                    .values(
                        files_processed=func.coalesce(DaemonChangeWrite.files_processed, 0) + batch
                    )
                )
                await progress_session.commit()
        except Exception as e:
            log.warning("spec_workspace.progress_bump_failed", error=str(e))


class SpecWorkspaceService:
    """Coordinates persistence for spec workspace records."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── HostFsDelegate access ─────────────────────────────────────────────
    #
    # task-11：spec_workspace service 不持有 daemon facade，按需局部构造
    # HostFsDelegate（daemon-client 单一路径：走 get_spec_bundle 整树打包 RPC，task-01
    # 八方法契约不含该方法，本 service 保留 daemon-client 的 hub.send_rpc 直调）。
    # lazy + 复用进程级 ws_hub 单例，避免每次调用重建 RPC 客户端。
    def _host_fs_delegate(self):
        from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        return HostFsDelegate(self._session, hub, HostFsWsRpc(hub))

    # ── Create / get ───────────────────────────────────────────────────────

    async def create(
        self,
        workspace_id: uuid.UUID,
        payload: SpecWorkspaceCreate,
    ) -> SpecWorkspace:
        """Create a spec workspace linked to the given workspace.

        If ``spec_root`` is not provided in the payload a sensible default is
        generated. This keeps the caller simple while still allowing explicit
        overrides.
        """
        now = datetime.now(UTC)
        settings = get_settings()
        spec_root = payload.spec_root or f"{settings.spec_data_root}/{workspace_id}"

        spec_ws = SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            spec_root=spec_root,
            strategy=payload.strategy,
            repo_sillyspec_path=payload.repo_sillyspec_path,
            profile_version=payload.profile_version,
            sync_status="pending",
            last_synced_at=None,
            created_at=now,
            updated_at=now,
        )
        self._session.add(spec_ws)

        # Ensure the spec root directory exists on disk.
        spec_root_path = Path(spec_root)
        spec_root_path.mkdir(parents=True, exist_ok=True)
        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.created",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            strategy=spec_ws.strategy,
        )
        return spec_ws

    async def get(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Return the spec workspace for the given workspace, or raise."""
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        return result

    async def ensure_spec_workspace(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Ensure a SpecWorkspace exists for the given workspace_id (D-009).

        Returns the existing row if found; otherwise creates one with default
        strategy='platform-managed' and sensible defaults.  This is the
        automatic spec container bootstrap step used by init dispatch — it
        replaces the old explicit ``bootstrapSpecWorkspace`` button path
        (2026-07-02-workspace-config-flow D-002 / D-009).
        """
        from app.modules.spec_workspace.schema import SpecWorkspaceCreate

        try:
            return await self.get(workspace_id)
        except SpecWorkspaceNotFound:
            try:
                return await self.create(
                    workspace_id,
                    SpecWorkspaceCreate(strategy="platform-managed"),
                )
            except IntegrityError:
                # R10（并发修复，2026-07-24）：并发 init-dispatch 对同一 workspace 都
                # NotFound→都 create，第二个撞 ix_spec_workspaces_workspace_id 唯一约束。
                # rollback 后重查拿对方建好的行（幂等收口），而非未处理 500。
                await self._session.rollback()
                return await self.get(workspace_id)

    # ── Update ─────────────────────────────────────────────────────────────

    async def update(
        self,
        workspace_id: uuid.UUID,
        payload: SpecWorkspaceUpdate,
    ) -> SpecWorkspace:
        """Partial-update mutable fields on the spec workspace."""
        spec_ws = await self.get(workspace_id)
        now = datetime.now(UTC)

        if payload.strategy is not None:
            spec_ws.strategy = payload.strategy
        if payload.repo_sillyspec_path is not None:
            spec_ws.repo_sillyspec_path = payload.repo_sillyspec_path
        if payload.profile_version is not None:
            spec_ws.profile_version = payload.profile_version

        spec_ws.updated_at = now
        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.updated",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
        )
        return spec_ws

    # ── Import / Sync (stub implementations) ────────────────────────────────

    async def import_from_repo(
        self,
        workspace_id: uuid.UUID,
        *,
        daemon_id: uuid.UUID | None = None,
        root_path: str | None = None,
    ) -> SpecWorkspace:
        """Import spec files from the client ``.sillyspec`` directory into the
        platform-managed spec workspace.

        workspace 的 root_path 在成员宿主机，backend 容器读不到 → 通过 daemon WS RPC
        ``get_spec_bundle`` 让 daemon 打包 rootPath/.sillyspec 整树为 tar（base64），
        backend apply_sync 写入 spec_root。

        Args:
            workspace_id: workspace UUID。
            daemon_id: daemon_instance UUID（必填，路由 RPC；由调用方经 binding 解析）。
            root_path: workspace root_path（daemon-client 宿主机路径）。

        Change 2026-07-03-daemon-entity-binding task-09: parameter ``runtime_id``
        replaced by ``daemon_id`` — ``hub.send_rpc`` now routes by daemon entity.
        """
        spec_ws = await self.get(workspace_id)

        ws_root_path = root_path or ""

        if not ws_root_path:
            raise AppError(
                "导入失败：该工作区未配置代码根目录（root_path），请先在工作区设置中配置后再导入。",
                code="SPEC_IMPORT_NO_ROOT_PATH",
                http_status=400,
            )
        if daemon_id is None:
            # daemon_id 必须由调用方经 binding 解析传入（router 层 MemberBindingResolver）；
            # 无 binding → 路由层已抛 DaemonClientNoActiveSession，此处兜底防御。
            raise AppError(
                "导入失败：未能解析该工作区绑定的 daemon，请确认 daemon 绑定后重试。",
                code="SPEC_IMPORT_NO_DAEMON_ID",
                http_status=400,
            )

        # daemon-client：经 WS RPC 让 daemon 打包 → 回传 → apply_sync
        tar_bytes = await self._fetch_spec_bundle_via_rpc(daemon_id, ws_root_path)
        reparsed = await self.apply_sync(workspace_id, tar_bytes)
        log.info(
            "spec_workspace.import_from_repo",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            tar_bytes=len(tar_bytes),
            reparsed=reparsed,
        )
        return spec_ws

    async def import_from_repo_sse(
        self,
        workspace_id: uuid.UUID,
        *,
        daemon_id: uuid.UUID | None = None,
        root_path: str | None = None,
    ) -> AsyncIterator[str]:
        """SSE event generator for import（D-001 流式，2026-07-01-spec-import-...）。

        Yields SSE 事件：``packing`` → ``packed`` → ``applying`` → ``reparsing_docs``
        → ``reparsing_changes`` → ``done``。daemon 离线/超时/remote 错误 → ``error`` 事件
        （透传 ql-001 错误码）+ return（流正常关闭）。``packing`` 阶段（daemon 打包 ~16.8s）
        每 5s yield ``: keepalive`` 注释行，防 Next.js rewrite proxy idle timeout。

        与 ``import_from_repo`` 共用前置（workspace 解析 / RPC / 打包）+ 落盘 reparse
        （``_write_spec_root`` + ``_reparse_phase``），但把 apply_sync 拆成可分阶段 yield。
        """

        def _evt(event: str, **data: object) -> str:
            return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        spec_ws = await self.get(workspace_id)
        ws_root_path = root_path or ""
        if not ws_root_path:
            yield _evt(
                "error",
                code="SPEC_IMPORT_NO_ROOT_PATH",
                message="导入失败：未配置代码根目录（root_path），请先在工作区设置中配置",
            )
            return
        if daemon_id is None:
            # daemon_id 必须由调用方经 binding 解析传入（router 层 MemberBindingResolver）；
            # 无 binding → 路由层已抛 DaemonClientNoActiveSession，此处兜底防御。
            yield _evt(
                "error",
                code="SPEC_IMPORT_NO_DAEMON_ID",
                message="导入失败：未解析到 daemon，请确认 daemon 绑定后重试",
            )
            return

        yield _evt("packing", phase="packing")
        rpc_task = asyncio.ensure_future(self._fetch_spec_bundle_via_rpc(daemon_id, ws_root_path))
        # 心跳：每 5s 未完成就 yield keepalive，防止 proxy idle timeout 断连。
        while True:
            done, _ = await asyncio.wait({rpc_task}, timeout=5.0)
            if done:
                break
            yield ": keepalive\n\n"
        try:
            tar_bytes = rpc_task.result()
        except AppError as exc:
            # helper 把 daemon-client RPC 全部错误封装为 AppError 子类（透传既有
            # code/message：DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcConflict
            # 自带 504/504/409，DaemonRpcForbiddenError/DemonRpcRemoteGatewayError
            # 自带 403/502，SPEC_IMPORT_EMPTY_BUNDLE 422，SPEC_IMPORT_RPC_FAILED 502）。
            yield _evt("error", code=exc.code, message=exc.message)
            return
        except Exception as exc:
            yield _evt("error", code="SPEC_IMPORT_RPC_FAILED", message=str(exc))
            return
        yield _evt("packed", phase="packed", tar_bytes=len(tar_bytes))

        # 落盘 + 两阶段 reparse（D-003 各自容错；_reparse_phase 失败已设 dirty 不抛）。
        # 三阶段都是慢操作（写 1545+ 文件入伙 + reparse docs/changes），SSE 流必须周期
        # yield keepalive，否则单阶段静默超过 Next.js rewrite 代理 undici bodyTimeout
        # 会被砍断（CancelledError）——与 packing 阶段同模式（见上 387-400）。
        yield _evt("applying", phase="applying")
        write_task = asyncio.ensure_future(self._write_spec_root(workspace_id, tar_bytes))
        while True:
            done, _ = await asyncio.wait({write_task}, timeout=5.0)
            if done:
                break
            yield ": keepalive\n\n"
        spec_ws = write_task.result()

        yield _evt("reparsing_docs", phase="reparsing_docs")
        reparse_docs_task = asyncio.ensure_future(
            self._reparse_phase(workspace_id, spec_ws, "scan_docs")
        )
        while True:
            done, _ = await asyncio.wait({reparse_docs_task}, timeout=5.0)
            if done:
                break
            yield ": keepalive\n\n"
        docs = reparse_docs_task.result()
        yield _evt("reparsing_docs", phase="reparsing_docs", parsed=docs)

        yield _evt("reparsing_changes", phase="reparsing_changes")
        reparse_changes_task = asyncio.ensure_future(
            self._reparse_phase(workspace_id, spec_ws, "change")
        )
        while True:
            done, _ = await asyncio.wait({reparse_changes_task}, timeout=5.0)
            if done:
                break
            yield ": keepalive\n\n"
        changes = reparse_changes_task.result()
        yield _evt("reparsing_changes", phase="reparsing_changes", parsed=changes)

        yield _evt(
            "done",
            phase="done",
            spec_workspace_id=str(spec_ws.id),
            sync_status=spec_ws.sync_status,
        )

    # ── import helpers（task-11：分流内聚，import_from_repo 与 _sse 共用）─────
    #
    # import_from_repo / _sse 共用 daemon-client 整树打包 RPC（task-01 八方法契约不
    # 含 get_spec_bundle，service.py 保留 hub.send_rpc 直调）。

    async def _fetch_spec_bundle_via_rpc(
        self,
        ws_daemon_id: uuid.UUID,
        ws_root_path: str,
    ) -> bytes:
        """daemon-client：hub.send_rpc(get_spec_bundle) → tar_bytes。

        错误码透传链与原 import_from_repo 一致（ql-20260701-001）：
        DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcConflict 已是 AppError 子类直接
        透传；DaemonRpcRemoteError 重映射 forbidden→403 / 其他→502；其余异常包成
        SPEC_IMPORT_RPC_FAILED(502)；空 bundle 抛 SPEC_IMPORT_EMPTY_BUNDLE(422)。
        """
        from app.modules.daemon.runtime.service import (
            DaemonRpcConflict,
            DaemonRpcForbiddenError,
            DaemonRpcRemoteError,
            DaemonRpcRemoteGatewayError,
            DaemonRpcTimeout,
            DaemonRuntimeOffline,
        )
        from app.modules.daemon.ws_hub import get_daemon_ws_hub
        from app.modules.workspace.service import resolve_root_path_for_daemon

        hub = get_daemon_ws_hub()
        daemon_root = resolve_root_path_for_daemon(ws_root_path)
        try:
            result = await hub.send_rpc(
                ws_daemon_id,
                "get_spec_bundle",
                {"root_path": daemon_root},
                timeout=60.0,
            )
        except (DaemonRuntimeOffline, DaemonRpcTimeout, DaemonRpcConflict):
            raise
        except DaemonRpcRemoteError as exc:
            if exc.code == "forbidden":
                raise DaemonRpcForbiddenError(
                    f"同步失败：daemon 拒绝访问代码目录，请检查 daemon 权限后重试（get_spec_bundle: {exc.message}）",
                    details={"daemon_id": str(ws_daemon_id), "daemon_code": exc.code},
                ) from exc
            raise DaemonRpcRemoteGatewayError(
                f"同步失败：daemon 打包 spec 目录出错，请确认 daemon 在线后重试（get_spec_bundle: {exc.message}）",
                details={"daemon_id": str(ws_daemon_id), "daemon_code": exc.code},
            ) from exc
        except Exception as exc:
            raise AppError(
                "同步失败：与 daemon 的通信中断，请确认 daemon 在线后重试。",
                code="SPEC_IMPORT_RPC_FAILED",
                http_status=502,
                details={"reason": str(exc)},
            ) from exc
        tar_b64 = result.get("tar_base64", "") if isinstance(result, dict) else ""
        if not tar_b64:
            raise AppError(
                "导入失败：daemon 返回的 spec 包为空，请确认代码根目录下存在 .sillyspec 后重试。",
                code="SPEC_IMPORT_EMPTY_BUNDLE",
                http_status=422,
            )
        return base64.b64decode(tar_b64)

    # ── Manual sync (D-012，task-13：daemon-client outbox 分发) ────────────
    #
    # 「同步到服务器」手动按钮：把成员宿主机的 spec 改动回灌到服务器权威 spec_root。
    # 复用 DaemonChangeWrite outbox（kind="spec-sync"）共享 change-detail-file-tree-editor
    # 基础设施，不另起表。
    #
    # 唯一路径：root_path 在成员宿主机，backend 读不到 → 建 kind="spec-sync" 的
    # DaemonChangeWrite 行，daemon 拉到后调 postSpecSync 整树回灌（D-012）。

    async def sync_manual_get_pending(
        self,
        workspace_id: uuid.UUID,
    ) -> list[dict[str, object]]:
        """查询 workspace 下所有 kind="spec-sync" 的 DaemonChangeWrite 行状态。

        前端轮询用：返回 pending/claimed/done/failed 行清单（按 created_at 排序），
        前端取最新一条判定「同步到服务器」的进度。
        """
        from app.modules.daemon.model import DaemonChangeWrite

        stmt = (
            select(DaemonChangeWrite)
            .where(DaemonChangeWrite.workspace_id == workspace_id)
            .where(DaemonChangeWrite.kind == "spec-sync")
            .order_by(DaemonChangeWrite.created_at.desc())
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [
            {
                "task_id": str(rw.id),
                "status": rw.status,
                "runtime_id": str(rw.runtime_id),
                "error": rw.error,
                "created_at": rw.created_at,
                "completed_at": rw.completed_at,
                # FR-05/FR-06（ql-20260813-spec-sync-visibility）：同步进度计数。
                "files_total": rw.files_total,
                "files_processed": rw.files_processed,
            }
            for rw in rows
        ]

    # ── Sync status ────────────────────────────────────────────────────────

    async def update_sync_status(
        self,
        workspace_id: uuid.UUID,
        payload: SyncStatusUpdate,
    ) -> SpecWorkspace:
        """Update the ``sync_status`` and optionally ``last_synced_at``.

        When the new status is ``clean`` we also stamp ``last_synced_at`` to
        ``now``, which is the natural semantic for "sync just completed".
        """
        spec_ws = await self.get(workspace_id)
        now = datetime.now(UTC)

        spec_ws.sync_status = payload.sync_status
        if payload.sync_status == "clean":
            spec_ws.last_synced_at = now
        spec_ws.updated_at = now

        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.sync_status_updated",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            sync_status=payload.sync_status,
        )
        return spec_ws

    # ── Bundle / Sync (daemon-client spec transport) ───────────────────────
    #
    # FR-05 / D-003@v1 / D-006@v1: spec 真理源在服务器，daemon 按需借阅 (bundle)
    # 与整树回传 (sync)。无同步引擎，整树覆盖。

    async def build_bundle(
        self,
        workspace_id: uuid.UUID,
    ) -> tuple[str, Iterator[bytes]]:
        """Stream the server ``spec_root`` as a tar stream.

        Excludes any ``.runtime/`` directory (top-level or nested) — that is
        daemon runtime cache, not spec data (R-02 / design §7.2).

        Returns ``(spec_root_abs, tar_byte_chunks)``. The generator yields the
        tar in chunks so the caller can feed it directly to ``StreamingResponse``
        without buffering the whole tree in memory.
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)

        # An absent spec_root is a legal empty bundle (daemon unpacks into an
        # empty dir). Materialise it so rglob has something to walk.
        spec_root.mkdir(parents=True, exist_ok=True)

        spec_root_abs = str(spec_root)

        def _stream() -> Iterator[bytes]:
            buf = io.BytesIO()
            # ``w|`` is a streaming (non-seekable) tar; we buffer the whole tar
            # in memory here for simplicity. Spec trees are small (R-02); a
            # future task can swap to a real chunked pipe if needed.
            with tarfile.open(fileobj=buf, mode="w") as tar:
                for path in sorted(spec_root.rglob("*")):
                    rel = path.relative_to(spec_root)
                    # Exclude .runtime/ at any depth.
                    if any(part == ".runtime" for part in rel.parts):
                        continue
                    tar.add(path, arcname=str(rel), recursive=False)
            buf.seek(0)
            while True:
                chunk = buf.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

        return spec_root_abs, _stream()

    @staticmethod
    def _extract_spec_tar_to_staging(
        tar_bytes: bytes,
        spec_root: Path,
        spec_root_resolved: Path,
    ) -> tuple[tarfile.TarFile, Path]:
        """tar 校验 + 整包解包到 staging（Wave C 续：移出事件循环）。

        返回 ``(tf, staging)``。tar 无效 / 路径越界 → 抛 ``_spec_bundle_invalid``
        （异常经 ``asyncio.to_thread`` 透传回 loop）。staging 由本函数创建，调用方
        负责 finally 里 ``tf.close()`` + ``shutil.rmtree(staging)``。
        """
        try:
            tf = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")  # noqa: SIM115
        except tarfile.TarError as e:
            raise _spec_bundle_invalid(
                "同步包无效：tar 数据损坏或格式不对，请重新打包上传。", reason=str(e)
            ) from e

        staging = Path(tempfile.mkdtemp(prefix="spec-sync-"))
        for m in tf.getmembers():
            name = m.name.replace("\\", "/")
            if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
                raise _spec_bundle_invalid(
                    "同步包无效：不允许使用绝对路径的成员。",
                    member=m.name,
                )
            target = (spec_root / name).resolve()
            try:
                target.relative_to(spec_root_resolved)
            except ValueError:
                raise _spec_bundle_invalid(
                    "同步包无效：包含越界路径的成员，已拒绝落盘。",
                    member=m.name,
                ) from None

        tf.extractall(staging, filter="fully_trusted")
        return tf, staging

    async def _write_spec_root(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
        change_write_id: str | None = None,
    ) -> SpecWorkspace:
        """Validate + overwrite spec_root with tar (D-006 whole-tree), commit clean.

        D-001（2026-07-01-spec-import-async-and-change-reparse）：从 apply_sync 提取，
        供 apply_sync（sync 端点）与 import_from_repo_sse（import SSE）共用——SSE 需在
        写盘 / reparse_docs / reparse_changes 之间分阶段 yield 事件。Returns refreshed
        spec_ws（sync_status=clean，尚未 reparse）。
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)
        spec_root.mkdir(parents=True, exist_ok=True)
        spec_root_resolved = spec_root.resolve()

        # Wave C 续 + task-02：tar 校验 + 整包解包到 staging、以及循环体内 per-file
        # 纯 FS 段（read_bytes/sha256/move）均移出事件循环（asyncio.to_thread）；
        # DB await（预取 SELECT / conflict archive / bump）留在 loop。
        tf, staging = await asyncio.to_thread(
            self._extract_spec_tar_to_staging, tar_bytes, spec_root, spec_root_resolved
        )
        try:
            # 3. Per-file merge (D-006@v2): walk staging files, compare content_hash
            # / source_mtime against existing scan_documents.  Files in spec_root
            # but NOT in staging are kept (preserve other members' exclusive docs).
            from app.modules.scan_docs.conflict_service import ScanDocConflictService
            from app.modules.scan_docs.model import ScanDocument

            conflict_svc = ScanDocConflictService(self._session)
            now = datetime.now(UTC)
            # task-03 / D-002@v1：逐文件 _bump 改批量回写器——循环内仅内存计数，
            # 50 文件/500ms 粒度回写；finally 终态 flush 保证 files_processed 最终准确。
            progress = _BatchProgressWriter(change_write_id)
            # 性能优化（2026-07-27）：循环前一次 IN 查询预取既有 ScanDocument，
            # 消除原逐 tar 成员 SELECT 的 N+1（活跃 spec 树数十~百文件）。
            # ux_scan_docs_workspace_path 唯一约束 + SQLAlchemy identity map 保证
            # 预取对象与原循环内 SELECT 同一 Python 对象，原地改写语义不变。
            rel_paths = [m.name.replace("\\", "/") for m in tf.getmembers() if m.isfile()]
            existing_by_path: dict[str, ScanDocument] = {}
            if rel_paths:
                existing_rows = (
                    await self._session.execute(
                        select(ScanDocument).where(
                            ScanDocument.workspace_id == workspace_id,
                            ScanDocument.path.in_(rel_paths),
                        )
                    )
                ).scalars()
                existing_by_path = {d.path: d for d in existing_rows}
            for m in tf.getmembers():
                if not m.isfile():
                    continue
                rel_path = m.name.replace("\\", "/")
                # ql-20260813-007：`.runtime/`（任意深度）不入表/不落盘。daemon 运行时产物
                # （sillyspec.db 进度库含 NUL 字节 / audit.log / 扫描历史等）无一是 spec 文档；
                # sillyspec.db 的 NUL 写进 scan_documents 文本列曾触发 asyncpg `0x00` 整批回滚
                # 500。此处与 build_bundle（pull 方向，service.py:520）任意深度排除对称。纵深防御：
                # daemon packSpecDir 已默认排除 `.runtime`，此分支兜底防历史 tar / 其它打包源。
                if any(part == ".runtime" for part in rel_path.split("/")):
                    continue
                src_file = staging / m.name
                target = spec_root / rel_path

                # task-02 / D-002：per-file 纯 FS 段（read_bytes → sha256 → mtime 计算
                # + mkdir）抽成同步内函数整体入线程，DB 相关段（conflict archive /
                # ScanDocument 改写 / session.add）留在事件循环。线程内只产出
                # (content, ch, src_mtime) 回 loop 再改对象；shutil.move 同样入线程，
                # 与 doc 行写入的相对顺序（先落盘后写行）不变。
                def _load_member(
                    src: Path = src_file, tgt: Path = target, tar_mtime: float = m.mtime
                ) -> tuple[bytes, str, datetime | None]:
                    tgt.parent.mkdir(parents=True, exist_ok=True)
                    data = src.read_bytes()
                    digest = hashlib.sha256(data).hexdigest()
                    src_mtime = datetime.fromtimestamp(tar_mtime, tz=UTC) if tar_mtime > 0 else None
                    return data, digest, src_mtime

                # ql-20260813-004：staging 成员缺失（tar name 被旧打包方截断 / 解包竞态等）
                # → 跳过 + warn，不抛 500 致整次同步失败。daemon 侧 buildLongLinkHeader +
                # 排除 runtime(无点) 已根治超长 name，此为纵深防御兜底。
                try:
                    content, ch, src_mtime = await asyncio.to_thread(_load_member)
                except FileNotFoundError:
                    log.warning(
                        "spec_workspace.sync_member_missing_in_staging",
                        workspace_id=str(workspace_id),
                        member=m.name,
                    )
                    continue

                cur = existing_by_path.get(rel_path)

                if cur:
                    if cur.content_hash == ch:
                        continue
                    # Normalize naive datetimes (SQLite returns naive) to UTC-aware.
                    cur_raw = cur.source_mtime
                    if cur_raw is not None and cur_raw.tzinfo is None:
                        cur_raw = cur_raw.replace(tzinfo=UTC)
                    cur_mtime = cur_raw or datetime.min.replace(tzinfo=UTC)
                    inc_raw = src_mtime
                    if inc_raw is not None and inc_raw.tzinfo is None:
                        inc_raw = inc_raw.replace(tzinfo=UTC)
                    inc_mtime = inc_raw or datetime.min.replace(tzinfo=UTC)
                    if inc_mtime > cur_mtime:
                        await conflict_svc.archive_conflict(
                            workspace_id,
                            rel_path,
                            old_content=cur.content,
                            old_source_member_id=cur.source_member_id,
                            old_source_runtime_id=cur.source_runtime_id,
                            old_mtime=cur.source_mtime,
                            new_source_member_id=None,
                            new_mtime=src_mtime,
                        )
                        # ql-20260813-007：strip NUL 字节兜底——scan_documents.content 是 PG
                        # 文本列，asyncpg 拒绝 0x00；errors="replace" 不替换 NUL（合法 UTF-8）。
                        # daemon packSpecDir 已排除 .runtime，此分支防其它二进制文件漏入炸整批。
                        cur.content = content.decode("utf-8", errors="replace").replace("\x00", "")
                        cur.content_hash = ch
                        cur.source_mtime = src_mtime
                        cur.source_synced_at = now
                        cur.last_modified_at = src_mtime or now
                        await asyncio.to_thread(shutil.move, str(src_file), str(target))
                        await progress.bump()
                else:
                    doc = ScanDocument(
                        workspace_id=workspace_id,
                        path=rel_path,
                        doc_type=rel_path.rsplit(".", 1)[-1] if "." in rel_path else "md",
                        title=rel_path.rsplit("/", 1)[-1] if "/" in rel_path else rel_path,
                        content=content.decode("utf-8", errors="replace").replace("\x00", ""),
                        content_hash=ch,
                        source_mtime=src_mtime,
                        source_synced_at=now,
                        source_member_id=None,
                        exists=True,
                    )
                    self._session.add(doc)
                    await asyncio.to_thread(shutil.move, str(src_file), str(target))
                    await progress.bump()
        finally:
            # task-03 / R-02：终态回写兜底——无论循环正常走完还是中途抛错，
            # 已处理文件的计数都最终落库（数值最终准确，design 兼容策略）。
            await progress.flush()
            tf.close()
            # Wave C 续：staging 整树删除移出事件循环
            await asyncio.to_thread(shutil.rmtree, staging, ignore_errors=True)

        now = datetime.now(UTC)
        spec_ws.sync_status = "clean"
        spec_ws.last_synced_at = now
        # task-09 / D-010: spec tree just rewritten server-side → bump the
        # authoritative version so daemon clients see a newer value on their
        # next lease and pull a fresh bundle. Incremented here (the single
        # landing point for apply_sync / import_from_repo / SSE import) rather
        # than in scan_generate, because scan_generate only dispatches a lease;
        # the actual tree write happens through _write_spec_root.
        spec_ws.spec_version = (spec_ws.spec_version or 0) + 1
        spec_ws.updated_at = now
        await self._session.commit()

        # Q7 / R-01（change 2026-08-13-platform-managed-file-sync task-03）：旧 tar 全量
        # 落盘后失效该 workspace 的文件级清单——整树覆盖后旧的 per-file version 无意义，
        # 删行强制下一次增量走 R-07 兜底全量重算，避免「旧 tar push 后 version 漂移」。
        await self._session.execute(
            delete(SpecFileManifest).where(
                SpecFileManifest.workspace_id == workspace_id,
            )
        )
        await self._session.commit()
        return spec_ws

    async def _bump_files_processed(self, change_write_id: str | None) -> None:
        """单批进度回写（+1）。签名不变（design 接口定义），内部走批量回写器。

        task-03 / D-002@v1 后同步循环不再逐文件调本方法（改用
        ``_BatchProgressWriter.bump()`` 内存计数 + 批量 UPDATE）；本方法保留
        供零散单文件场景与既有测试锚点（守卫语义不变）：独立 session
        （不动主 apply 事务）UPDATE daemon_change_writes SET
        files_processed = files_processed + 1 WHERE id = change_write_id AND
        status = 'claimed'（守卫对齐 BL-3）。best-effort：失败仅 warn。
        """
        if not change_write_id:
            return
        try:
            async with get_session_factory()() as progress_session:
                await progress_session.execute(
                    update(DaemonChangeWrite)
                    .where(
                        DaemonChangeWrite.id == uuid.UUID(change_write_id),
                        DaemonChangeWrite.status == "claimed",
                    )
                    .values(files_processed=DaemonChangeWrite.files_processed + 1)
                )
                await progress_session.commit()
        except Exception as e:
            log.warning("spec_workspace.progress_bump_failed", error=str(e))

    async def apply_sync(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
        change_write_id: str | None = None,
    ) -> dict[str, int]:
        """Overwrite spec_root with tar, then reparse docs + changes (D-003).

        D-006 whole-tree overwrite. D-003 docs/changes 两阶段独立 try/except（单阶段
        失败 dirty 不阻断另一阶段）。Returns ``{reparsed_docs, reparsed_changes}``。
        ``change_write_id``（可选）让 ``_write_spec_root`` 循环内回写进度
        （task-03 起批量：50 文件/500ms 粒度，终态准确）。
        """
        spec_ws = await self._write_spec_root(
            workspace_id, tar_bytes, change_write_id=change_write_id
        )
        reparsed_docs = await self._reparse_phase(workspace_id, spec_ws, "scan_docs")
        reparsed_changes = await self._reparse_phase(workspace_id, spec_ws, "change")
        log.info(
            "spec_workspace.sync_applied",
            workspace_id=str(workspace_id),
            reparsed_docs=reparsed_docs,
            reparsed_changes=reparsed_changes,
        )
        return {"reparsed_docs": reparsed_docs, "reparsed_changes": reparsed_changes}

    async def _reparse_phase(
        self,
        workspace_id: uuid.UUID,
        spec_ws: SpecWorkspace,
        phase: str,
    ) -> int:
        """Run one reparse phase (scan_docs or change) with dirty-on-failure.

        D-003: each phase is independent. On exception, flip sync_status to
        dirty, log, and return 0 — the caller continues to the next phase
        rather than aborting the whole import.
        """
        try:
            if phase == "scan_docs":
                from app.modules.scan_docs.service import ScanDocsService

                stats, _ = await ScanDocsService(self._session).reparse(workspace_id)
            else:
                from app.modules.change.service import ChangeService

                stats, _ = await ChangeService(self._session).reparse(workspace_id)
        except Exception as e:
            log.warning(
                "spec_workspace.sync_reparse_phase_failed",
                workspace_id=str(workspace_id),
                phase=phase,
                error=str(e),
            )
            spec_ws.sync_status = "dirty"
            spec_ws.updated_at = datetime.now(UTC)
            await self._session.commit()
            return 0
        return int(stats.get("parsed", 0)) if stats else 0

    # ── Incremental sync（change 2026-08-13-platform-managed-file-sync）────────
    #
    # D-001（乐观锁）/ D-002（软删）/ D-004（文件级 version）/ D-005（rename op）/
    # D-008（备份区）/ D-010（软删=move）/ D-011（独立 spec_file_manifest 表）：
    # 文件级增量 ops 的唯一写者=apply_ops；scan_docs reparse 不碰此表（BL-1 解）。

    @staticmethod
    def _validate_op_path(
        name: str,
        spec_root: Path,
        spec_root_resolved: Path,
        *,
        field: str,
    ) -> str:
        """containment 校验单个 op 路径（对齐旧 tar ``_extract_spec_tar_to_staging``）。

        返回 POSIX 化路径。绝对路径 / 盘符 / ``..`` 逃逸 / symlink 逃逸 →
        ``_spec_bundle_invalid`` 422（对齐 service.py:544-556 校验机制，R-09）。
        ``.runtime`` 首段拒绝（D-006：增量范围排除 daemon 运行时产物）。
        """
        name = name.replace("\\", "/")
        if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
            raise _spec_bundle_invalid(
                "同步包无效：不允许使用绝对路径。",
                field=field,
                path=name,
            )
        if name.split("/", 1)[0] == ".runtime":
            raise _spec_bundle_invalid(
                "同步包无效：不允许操作 .runtime 目录。",
                field=field,
                path=name,
            )
        try:
            target = (spec_root / name).resolve()
            target.relative_to(spec_root_resolved)
        except ValueError:
            raise _spec_bundle_invalid(
                "同步包无效：路径越界，已拒绝落盘。",
                field=field,
                path=name,
            ) from None
        return name

    def _backup_root(self, settings: Settings, workspace_id: uuid.UUID) -> Path:
        """软删备份区根：``{settings.spec_data_root}/spec-backups/{workspace_id}``。

        是 spec_root（``spec_data_root/{ws}``）的**兄弟**目录 → ``build_bundle`` 只
        rglob spec_root 拉不到（BL-2 / D-008）。
        """
        return Path(settings.spec_data_root) / "spec-backups" / str(workspace_id)

    @staticmethod
    def _apply_file_mtime(target: Path, mtime: float | None) -> None:
        """ql-20260813-008：把 daemon 宿主真实 mtime（Unix 秒）应用到落盘文件。

        落盘的镜像文件 mtime 真实，后续 change reparse 扫 mtime max 填
        changes.updated_at 才能反映变更活动（而非同步时刻）。非法/None/缺失 → 不动
        （保持 write_bytes 的 now）。失败静默（mtime 是展示增强，不阻断同步主流程）。

        防御（ql-008 毫秒 bug 修复）：旧 daemon 发毫秒（~1.78e12），os.utime 要秒
        （~1.78e9）→ ts > 1e11 视为毫秒除以 1000。防 30828 年 mtime 炸 reparse。
        """
        if mtime is None or mtime <= 0:
            return
        try:
            ts = float(mtime)
            if ts > 1e11:  # 毫秒启发式（当前 epoch 秒 ≈1.78e9，毫秒 ≈1.78e12）
                ts /= 1000.0
            os.utime(target, (ts, ts))
        except (OSError, ValueError, TypeError):
            pass

    @staticmethod
    def _prune_spec_backups(backup_root: Path) -> None:
        """R-06：机会式修剪备份区早于 30 天的旧 timestamp 目录。

        只删能解析为 ``BACKUP_TS_FORMAT`` 时间戳的目录；解析失败/非目录跳过（保守
        不误删）。软删时调用，无独立清理任务/定时器（P2 落盘决策）。
        """
        cutoff = datetime.now(UTC) - timedelta(days=SPEC_BACKUP_RETENTION_DAYS)
        try:
            names = [n for n in os.listdir(backup_root) if (backup_root / n).is_dir()]
        except FileNotFoundError:
            return
        for name in names:
            try:
                ts = datetime.strptime(name, BACKUP_TS_FORMAT).replace(tzinfo=UTC)
            except ValueError:
                continue
            if ts < cutoff:
                try:
                    shutil.rmtree(backup_root / name)
                except OSError:
                    log.warning(
                        "spec_workspace.backup_prune_failed",
                        backup_dir=str(backup_root / name),
                    )

    async def apply_ops(
        self,
        workspace_id: uuid.UUID,
        ops: list[FileOp],
        change_write_id: str | None = None,
        change_dirs: list[str] | None = None,
    ) -> dict[str, object]:
        """Apply incremental file ops to the workspace spec_root.

        返回 ``{"new_versions": {path: version}, "conflict": bool,
        "server_versions": {path: version} | None}``。

        语义（design §7 / 关键落盘决策 P2 R-07）：
        - **预校验**：所有 op 的 path/new_path 先做 containment + ``.runtime`` 校验，
          任一越界 → 422 ``_spec_bundle_invalid``，整体不落盘（对齐 tar 先验后解）。
        - **有清单行**：``row.version != op.base_version`` → 先查同内容豁免
          （D-008@v2）：``op.hash`` 非空且 == ``row.content_hash`` → 同内容
          no-op（跳过落盘、不置 conflict、``new_versions[path]=row.version``，
          daemon manifest 对齐）；否则 conflict（收集
          server_versions[path]=row.version，跳过该 op 不落盘）；匹配 → 应用。
        - **无清单行**（首推 / 旧 tar 失效后）→ R-07 hash 兜底：add/update 视为新建
          version=1；delete 无行 → no-op 成功（幂等）；rename 无行 → 按 add new_path 处理。
        - add/update：content(base64) 解码写 spec_root + upsert 清单
          （content_hash=sha256(解码内容)，version+1，exists=True）。
        - delete：软删 move 出 spec_root 到 ``spec_data_root/spec-backups/{ws}/{ts}/{path}``
          （D-010 move 非 copy），清单 exists=False + version+1；机会式修剪该 ws 备份区
          早于 30 天的旧目录（R-06）。
        - rename：``shutil.move`` 旧→新 + 清单 path 迁移（version+1，hash 相同可保留内容）。
        冲突 op 跳过、其余照常 apply，整体返回 conflict=True；校验失败整体 422 不落盘。

        ``change_dirs``（change 2026-08-14-change-center-conversation-driven / D-005@v1）：
        daemon 增量同步标注的本次涉及变更目录名集合。**落盘提交成功后**（事务外
        best-effort，R-04）触发 change reparse：有标注 → scoped（非归档 name）；
        无标注 → ops 路径 ``changes/`` 前缀检测兜底；含 ``changes/archive/`` 路径 →
        全量 reparse。reparse 失败仅告警不阻断同步主流程；同步失败（校验 422 / 提交
        异常）不重复触发（幂等，触发器在 commit 之后）。
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)
        spec_root.mkdir(parents=True, exist_ok=True)
        spec_root_resolved = spec_root.resolve()
        settings = get_settings()

        # 1. 预校验全部 op 路径（containment + .runtime），任一越界 422 整体不落盘。
        for op in ops:
            self._validate_op_path(op.path, spec_root, spec_root_resolved, field="path")
            if op.new_path is not None:
                self._validate_op_path(op.new_path, spec_root, spec_root_resolved, field="new_path")

        now = datetime.now(UTC)
        new_versions: dict[str, int] = {}
        server_versions: dict[str, int] | None = None
        conflict = False

        # task-03 / D-002@v1：循环前一次 IN 预取全部 op 涉及路径（path ∪ new_path）
        # 的清单行，消除原 per-op SELECT 的 N+1（照抄上文 _write_spec_root 的
        # ScanDocument 预取范式）。ux_spec_manifest_ws_path 唯一约束 + SQLAlchemy
        # identity map 保证预取对象与原 per-op SELECT 同一 Python 对象，原地改写
        # 语义不变。循环体内 add/rename 写入的新行同步回写 dict（镜像维护）——
        # 原语义下同请求后一个 op 经 autoflush 能看到前一个 op 的写入，镜像
        # 保证该语义不漂移；rename 迁移路径时 dict 同步换 key。
        prefetch_paths: set[str] = set()
        for op in ops:
            prefetch_paths.add(op.path)
            if op.new_path is not None:
                prefetch_paths.add(op.new_path)
        manifest_by_path: dict[str, SpecFileManifest] = {}
        if prefetch_paths:
            manifest_rows = (
                await self._session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == workspace_id,
                        SpecFileManifest.path.in_(prefetch_paths),
                    )
                )
            ).scalars()
            manifest_by_path = {r.path: r for r in manifest_rows}

        # task-03 / D-002@v1：逐文件回写改批量回写器（内存计数 + 50 文件/500ms
        # 批量 UPDATE）；finally 终态 flush 保证 files_processed 最终准确。
        progress = _BatchProgressWriter(change_write_id)
        try:
            for op in ops:
                # 查清单行（workspace_id+path）——task-03 起查预取 dict（miss 即 None）
                row = manifest_by_path.get(op.path)

                # base_version 乐观锁（D-001）：有行且版本不匹配 → conflict，跳过不落盘。
                # D-008@v2 同内容豁免（FR-05）：init 第二成员推 add(base_version=0)
                # 骨架文件时服务器已有同名行（第一成员 init 建过），内容相同则
                # op.hash == row.content_hash（sha256 不可伪造，R-07）→ 视为 no-op：
                # 不落盘、不置 conflict，new_versions 回服务器版本（daemon 据此对齐
                # 本地 manifest 缓存）。op.hash 缺失（旧 daemon 契约）或与
                # content_hash 不符 → 维持 conflict。
                if row is not None and row.version != op.base_version:
                    if op.hash is not None and op.hash == row.content_hash:
                        new_versions[op.path] = row.version
                        continue
                    conflict = True
                    if server_versions is None:
                        server_versions = {}
                    server_versions[op.path] = row.version
                    continue

                if op.op in ("add", "update"):
                    if op.content is None:
                        raise _spec_bundle_invalid(
                            "同步包无效：新增/更新操作缺少文件内容。",
                            path=op.path,
                        )
                    content = base64.b64decode(op.content)
                    target = spec_root / op.path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                    # ql-20260813-008：应用宿主真实 mtime，让镜像文件 mtime 真实 → reparse
                    # 填的 changes.updated_at 反映变更活动（而非同步时刻）。
                    self._apply_file_mtime(target, op.mtime)
                    ch = hashlib.sha256(content).hexdigest()
                    if row is None:
                        # R-07：无行 → 视为新建，version=1
                        new_row = SpecFileManifest(
                            workspace_id=workspace_id,
                            path=op.path,
                            content_hash=ch,
                            version=1,
                            exists=True,
                            updated_at=now,
                        )
                        self._session.add(new_row)
                        manifest_by_path[op.path] = new_row
                        new_versions[op.path] = 1
                    else:
                        new_version = row.version + 1
                        row.content_hash = ch
                        row.version = new_version
                        row.exists = True
                        row.updated_at = now
                        new_versions[op.path] = new_version

                elif op.op == "delete":
                    # R-07：无行 → no-op 成功（幂等），不写 new_versions。
                    if row is not None:
                        backup_root = self._backup_root(settings, workspace_id)
                        ts = datetime.now(UTC).strftime(BACKUP_TS_FORMAT)
                        dest = backup_root / ts / op.path
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        src = spec_root / op.path
                        try:
                            shutil.move(str(src), str(dest))
                        except FileNotFoundError:
                            # 磁盘文件已不存在（并发删/从未落盘）→ 仅推进状态，软删语义仍成立
                            pass
                        row.version = row.version + 1
                        row.exists = False
                        row.updated_at = now
                        new_versions[op.path] = row.version
                        # task-02：修剪（os.listdir + rmtree，同步 FS）移出事件循环
                        await asyncio.to_thread(self._prune_spec_backups, backup_root)

                elif op.op == "rename":
                    if op.new_path is None:
                        raise _spec_bundle_invalid(
                            "同步包无效：重命名操作缺少目标路径。",
                            path=op.path,
                        )
                    # 目标路径已被占用 → conflict（乐观锁对目标也成立）——
                    # task-03 起查预取 dict
                    target_row = manifest_by_path.get(op.new_path)
                    if target_row is not None:
                        conflict = True
                        if server_versions is None:
                            server_versions = {}
                        server_versions[op.new_path] = target_row.version
                        continue
                    # R-07：无旧行 → 按 add new_path 处理
                    if row is None:
                        if op.content is None:
                            raise _spec_bundle_invalid(
                                "同步包无效：源文件缺失的重命名操作必须携带文件内容。",
                                path=op.path,
                            )
                        content = base64.b64decode(op.content)
                        target = spec_root / op.new_path
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(content)
                        self._apply_file_mtime(target, op.mtime)
                        ch = hashlib.sha256(content).hexdigest()
                        added_row = SpecFileManifest(
                            workspace_id=workspace_id,
                            path=op.new_path,
                            content_hash=ch,
                            version=1,
                            exists=True,
                            updated_at=now,
                        )
                        self._session.add(added_row)
                        manifest_by_path[op.new_path] = added_row
                        new_versions[op.new_path] = 1
                        continue
                    # 常规 rename：move 文件 + 清单 path 迁移（删旧行 + 插新行）
                    new_version = row.version + 1
                    new_hash = row.content_hash
                    src = spec_root / op.path
                    dest = spec_root / op.new_path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    # rename 语义：旧路径文件**消失**（无论是否重传 content）——先 move，
                    # 若带 content 再覆写目标为新内容（避免 src 残留孤儿文件，QA 揪出）。
                    try:
                        shutil.move(str(src), str(dest))
                    except FileNotFoundError:
                        pass  # 源文件不存在 → 仅推进清单状态
                    if op.content is not None:
                        content = base64.b64decode(op.content)
                        new_hash = hashlib.sha256(content).hexdigest()
                        dest.write_bytes(content)
                    # ql-20260813-008：rename 后 dest 用宿主真实 mtime（move 沿用源 mtime，
                    # 此处按 op.mtime 覆盖为最新宿主态，保持与 add/update 一致）。
                    self._apply_file_mtime(dest, op.mtime)
                    await self._session.delete(row)
                    renamed_row = SpecFileManifest(
                        workspace_id=workspace_id,
                        path=op.new_path,
                        content_hash=new_hash,
                        version=new_version,
                        exists=True,
                        updated_at=now,
                    )
                    self._session.add(renamed_row)
                    # 镜像换 key：旧 path 删、新 path 指向新行
                    manifest_by_path.pop(op.path, None)
                    manifest_by_path[op.new_path] = renamed_row
                    new_versions[op.new_path] = new_version

                # D-004@V2 + task-03：每个成功处理的 op 后记一次进度（conflict op
                # 已 continue 跳过）——批量回写器内存计数，不再逐 op UPDATE。
                await progress.bump()

            await self._session.commit()
        finally:
            # task-03 / R-02：终态回写兜底（含 422 中断路径——已处理计数最终准确）。
            await progress.flush()

        # R-04 / D-005（change 2026-08-14-change-center-conversation-driven task-02）：
        # 落盘提交成功后，事务外 best-effort 触发 change reparse（独立 session），
        # 使 agent 会话新建的变更自动出现在 ux_changes 列表（命门链路）。
        # 失败仅告警不阻断同步主流程；同步失败（上文抛错）不会走到这里 → 不重复触发。
        try:
            await self._trigger_change_reparse(workspace_id, change_dirs or [], ops)
        except Exception as exc:
            log.warning(
                "spec_workspace.reparse_trigger_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

        return {
            "new_versions": new_versions,
            "conflict": conflict,
            "server_versions": server_versions,
        }

    @staticmethod
    def _compute_reparse_scope(
        change_dirs: list[str],
        ops: list[FileOp],
    ) -> tuple[list[str] | None, bool]:
        """计算 change reparse 范围 → ``(scope, archive_hit)``。

        （change 2026-08-14-change-center-conversation-driven / D-005@v1）：
        - 有标注（``change_dirs`` 非空）：取非归档 name 进 scoped 集；其中含
          ``changes/archive/`` 前缀的 name → ``archive_hit``（并入全量重扫集）。
        - 无标注（旧 daemon）：扫本次 ops 路径中 ``changes/`` 前缀者取 name 兜底。
        - 任一 ops 路径含 ``changes/archive/`` 前缀 → ``archive_hit``（归档=目录跨根
          移动，scoped 零删除语义处理不了，走全量 reparse，design §9 / R-08）。

        返回语义：
        - ``(None, True)``：全量 reparse（scope=None 含 delete）。
        - ``(scope, False)``：scoped reparse（scope 非空，零 delete）。
        - ``(None, False)``：无 changes 相关路径，**零触发**（R-01）。
        """
        names: list[str] = []
        archive_hit = False

        for cd in change_dirs:
            norm = str(cd).replace("\\", "/")
            if not norm:
                continue
            if norm.startswith("changes/archive/") or norm == "changes/archive":
                archive_hit = True
            elif norm.startswith("changes/"):
                rest = norm[len("changes/") :]
                if rest and not rest.startswith("archive/"):
                    first = rest.split("/", 1)[0]
                    if first:
                        names.append(first)
            else:
                # 纯 name 形式（daemon task-01 传 changes/<name>/ 分组的 key）
                names.append(norm)

        for op in ops:
            for path in (op.path, op.new_path):
                if not path:
                    continue
                norm = path.replace("\\", "/")
                if norm.startswith("changes/archive/") or norm == "changes/archive":
                    archive_hit = True
                elif norm.startswith("changes/"):
                    rest = norm[len("changes/") :]
                    if rest and not rest.startswith("archive/"):
                        first = rest.split("/", 1)[0]
                        if first:
                            names.append(first)

        # 去重保序
        dedup: list[str] = []
        for n in names:
            if n not in dedup:
                dedup.append(n)

        if archive_hit:
            return None, True
        return dedup, False

    async def _trigger_change_reparse(
        self,
        workspace_id: uuid.UUID,
        change_dirs: list[str],
        ops: list[FileOp],
    ) -> None:
        """事务外 best-effort 触发 change reparse（R-04 / D-005）。

        独立 ``get_session_factory()`` 短生命周期 session（不动 apply 主事务，对齐
        ``_bump_files_processed`` 范式）。scope 计算见 ``_compute_reparse_scope``。
        无 changes 相关路径 → 零触发（R-01：避免增量同步频繁空转 reparse）。
        """
        scope, archive_hit = self._compute_reparse_scope(change_dirs, ops)
        if not archive_hit and not scope:
            return  # 零触发

        from app.core.db import get_session_factory
        from app.modules.change.service import ChangeService

        async with get_session_factory()() as reparse_session:
            stats, _ = await ChangeService(reparse_session).reparse(
                workspace_id,
                scope=None if archive_hit else scope,
            )
        log.info(
            "spec_workspace.reparse_triggered",
            workspace_id=str(workspace_id),
            scoped=not archive_hit,
            scope=scope,
            stats=stats,
        )
