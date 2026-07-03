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
import shutil
import tarfile
import tempfile
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.schema import (
    SpecWorkspaceCreate,
    SpecWorkspaceUpdate,
    SyncStatusUpdate,
)

log = get_logger(__name__)

# Error code for invalid sync tar payloads (path traversal, corrupt tar, etc.).
# Reused via AppError instances to avoid extending errors.py (task allowed_paths).
SPEC_BUNDLE_INVALID_CODE = "HTTP_422_SPEC_BUNDLE_INVALID"


def _spec_bundle_invalid(message: str, **details: object) -> AppError:
    """Build a 422 AppError for an invalid sync tar payload."""
    return AppError(
        message,
        code=SPEC_BUNDLE_INVALID_CODE,
        http_status=422,
        details=details or None,
    )


class SpecWorkspaceService:
    """Coordinates persistence for spec workspace records."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
                "Spec workspace not found for the given workspace.",
                details={"workspace_id": str(workspace_id)},
            )
        return result

    async def get_by_id(self, spec_workspace_id: uuid.UUID) -> SpecWorkspace:
        """Return a spec workspace by its own primary key, or raise."""
        spec_ws = await self._session.get(SpecWorkspace, spec_workspace_id)
        if spec_ws is None:
            raise SpecWorkspaceNotFound(
                "Spec workspace not found.",
                details={"spec_workspace_id": str(spec_workspace_id)},
            )
        return spec_ws

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
            return await self.create(
                workspace_id,
                SpecWorkspaceCreate(strategy="platform-managed"),
            )

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

        2026-06-30：从 stub 变实现。daemon-client workspace 的 root_path 在宿主机，
        backend 容器读不到 → 通过 daemon WS RPC ``get_spec_bundle`` 让 daemon 打包
        rootPath/.sillyspec 整树为 tar（base64），backend apply_sync 写入 spec_root。

        server-local workspace：root_path 已在容器内，直接读 .sillyspec 打包。

        Args:
            workspace_id: workspace UUID。
            daemon_id: daemon_instance UUID（daemon-client workspace 必填，路由 RPC）。
            root_path: workspace root_path（容器路径或 daemon-client 宿主机路径）。

        Change 2026-07-03-daemon-entity-binding task-09: parameter ``runtime_id``
        replaced by ``daemon_id`` — ``hub.send_rpc`` now routes by daemon entity.
        """
        spec_ws = await self.get(workspace_id)

        # 获取 workspace 行（拿 root_path / path_source / daemon_runtime_id）
        from app.modules.workspace.model import Workspace

        ws = await self._session.get(Workspace, workspace_id)
        if ws is None:
            raise SpecWorkspaceNotFound(
                f"Workspace '{workspace_id}' not found for spec import.",
            )
        ws_root_path = root_path or ws.root_path or ""
        ws_path_source = ws.path_source or "server-local"
        # transitional fallback: use workspace's legacy daemon_runtime_id when
        # no daemon_id was provided (migration period; runtime_id used as WS
        # routing key, best-effort under daemon-entity-binding model).
        ws_daemon_id = daemon_id or ws.daemon_runtime_id

        if not ws_root_path:
            raise AppError(
                "Workspace has no root_path; cannot import .sillyspec.",
                code="SPEC_IMPORT_NO_ROOT_PATH",
                http_status=400,
            )

        # ── daemon-client：经 WS RPC 让 daemon 打包 → 回传 → apply_sync ──
        if ws_path_source == "daemon-client" and ws_daemon_id:
            # ql-20260701-001：daemon RPC 错误码语义透传。原实现用 except Exception 把
            # DaemonRuntimeOffline(504)/DaemonRpcTimeout(504)/DaemonRpcConflict(409)/
            # DaemonRpcRemoteError(403|502) 全吞成 502 SPEC_IMPORT_RPC_FAILED，破坏既有
            # 错误码体系，前端无法区分 "daemon 没开" 与 "真 RPC 失败"。改为透传/重映射。
            from app.modules.daemon.runtime.service import (
                DaemonRpcConflict,
                DaemonRpcForbiddenError,
                DaemonRpcRemoteError,
                DaemonRpcRemoteGatewayError,
                DaemonRpcTimeout,
                DaemonRuntimeOffline,
            )
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            from app.modules.workspace.service import resolve_root_path_for_daemon

            daemon_root = resolve_root_path_for_daemon(ws_root_path, ws_path_source)
            try:
                result = await hub.send_rpc(
                    ws_daemon_id,
                    "get_spec_bundle",
                    {"root_path": daemon_root},
                    timeout=60.0,
                )
            except (DaemonRuntimeOffline, DaemonRpcTimeout, DaemonRpcConflict):
                # 已是 AppError 子类，自带正确 code/http_status（504/504/409），透传。
                raise
            except DaemonRpcRemoteError as exc:
                # daemon 在线但打包业务失败 → 复用既有 re-map 约定
                # （forbidden→403 / 其他→502），避免裸 daemon 错误码直漏 HTTP 状态映射。
                if exc.code == "forbidden":
                    raise DaemonRpcForbiddenError(
                        f"Daemon get_spec_bundle forbidden: {exc.message}",
                        details={"daemon_id": str(ws_daemon_id), "daemon_code": exc.code},
                    ) from exc
                raise DaemonRpcRemoteGatewayError(
                    f"Daemon get_spec_bundle failed: {exc.message}",
                    details={"daemon_id": str(ws_daemon_id), "daemon_code": exc.code},
                ) from exc
            except Exception as exc:
                raise AppError(
                    f"Daemon RPC get_spec_bundle failed: {exc}",
                    code="SPEC_IMPORT_RPC_FAILED",
                    http_status=502,
                ) from exc
            tar_b64 = result.get("tar_base64", "") if isinstance(result, dict) else ""
            if not tar_b64:
                raise AppError(
                    "Daemon returned empty spec bundle.",
                    code="SPEC_IMPORT_EMPTY_BUNDLE",
                    http_status=422,
                )
            tar_bytes = base64.b64decode(tar_b64)
            reparsed = await self.apply_sync(workspace_id, tar_bytes)
            log.info(
                "spec_workspace.import_from_repo",
                spec_workspace_id=str(spec_ws.id),
                workspace_id=str(workspace_id),
                path_source=ws_path_source,
                tar_bytes=len(tar_bytes),
                reparsed=reparsed,
            )
            return spec_ws

        # ── server-local：容器内直接打包 .sillyspec → apply_sync ──
        from app.modules.workspace.service import resolve_root_path_for_server

        server_path = resolve_root_path_for_server(ws_root_path, ws_path_source)
        if server_path is None:
            raise AppError(
                "Cannot resolve server-local path for import.",
                code="SPEC_IMPORT_PATH_UNRESOLVED",
                http_status=400,
            )
        spec_source = Path(server_path) / ".sillyspec"
        if not spec_source.is_dir():
            raise AppError(
                f"No .sillyspec directory at {spec_source}",
                code="SPEC_IMPORT_NO_SILLYSPEC_DIR",
                http_status=404,
            )
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tar:
            for path in sorted(spec_source.rglob("*")):
                rel = path.relative_to(spec_source)
                if any(part == ".runtime" for part in rel.parts):
                    continue
                tar.add(str(path), arcname=str(rel), recursive=False)
        tar_bytes = buf.getvalue()
        reparsed = await self.apply_sync(workspace_id, tar_bytes)
        log.info(
            "spec_workspace.import_from_repo",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            path_source=ws_path_source,
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

        from app.modules.workspace.model import Workspace

        spec_ws = await self.get(workspace_id)
        ws = await self._session.get(Workspace, workspace_id)
        if ws is None:
            yield _evt(
                "error", code="HTTP_404_SPEC_WORKSPACE_NOT_FOUND", message="workspace not found"
            )
            return
        ws_root_path = root_path or ws.root_path or ""
        ws_path_source = ws.path_source or "server-local"
        # transitional fallback: use workspace's legacy daemon_runtime_id when
        # no daemon_id was provided (migration period; runtime_id used as WS
        # routing key, best-effort under daemon-entity-binding model).
        ws_daemon_id = daemon_id or ws.daemon_runtime_id
        if not ws_root_path:
            yield _evt("error", code="SPEC_IMPORT_NO_ROOT_PATH", message="no root_path")
            return

        tar_bytes: bytes
        if ws_path_source == "daemon-client" and ws_daemon_id:
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

            yield _evt("packing", phase="packing")
            hub = get_daemon_ws_hub()
            daemon_root = resolve_root_path_for_daemon(ws_root_path, ws_path_source)
            rpc_task = asyncio.ensure_future(
                hub.send_rpc(
                    ws_daemon_id,
                    "get_spec_bundle",
                    {"root_path": daemon_root},
                    timeout=60.0,
                )
            )
            # 心跳：每 5s 未完成就 yield keepalive，防止 proxy idle timeout 断连。
            while True:
                done, _ = await asyncio.wait({rpc_task}, timeout=5.0)
                if done:
                    break
                yield ": keepalive\n\n"
            try:
                result = rpc_task.result()
            except (DaemonRuntimeOffline, DaemonRpcTimeout, DaemonRpcConflict) as e:
                yield _evt(
                    "error",
                    code=getattr(e, "code", "HTTP_504_DAEMON_RUNTIME_OFFLINE"),
                    message=getattr(e, "message", str(e)),
                )
                return
            except DaemonRpcRemoteError as exc:
                code = (
                    DaemonRpcForbiddenError.code
                    if exc.code == "forbidden"
                    else DaemonRpcRemoteGatewayError.code
                )
                yield _evt("error", code=code, message=f"Daemon get_spec_bundle: {exc.message}")
                return
            except Exception as exc:
                yield _evt("error", code="SPEC_IMPORT_RPC_FAILED", message=str(exc))
                return
            tar_b64 = result.get("tar_base64", "") if isinstance(result, dict) else ""
            if not tar_b64:
                yield _evt("error", code="SPEC_IMPORT_EMPTY_BUNDLE", message="empty bundle")
                return
            tar_bytes = base64.b64decode(tar_b64)
            yield _evt("packed", phase="packed", tar_bytes=len(tar_bytes))
        else:
            from app.modules.workspace.service import resolve_root_path_for_server

            yield _evt("packing", phase="packing")
            server_path = resolve_root_path_for_server(ws_root_path, ws_path_source)
            if server_path is None:
                yield _evt(
                    "error",
                    code="SPEC_IMPORT_PATH_UNRESOLVED",
                    message="cannot resolve server path",
                )
                return
            spec_source = Path(server_path) / ".sillyspec"
            if not spec_source.is_dir():
                yield _evt(
                    "error",
                    code="SPEC_IMPORT_NO_SILLYSPEC_DIR",
                    message=f"no .sillyspec at {spec_source}",
                )
                return
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as tar:
                for path in sorted(spec_source.rglob("*")):
                    rel = path.relative_to(spec_source)
                    if any(part == ".runtime" for part in rel.parts):
                        continue
                    tar.add(str(path), arcname=str(rel), recursive=False)
            tar_bytes = buf.getvalue()
            yield _evt("packed", phase="packed", tar_bytes=len(tar_bytes))

        # 落盘 + 两阶段 reparse（D-003 各自容错；_reparse_phase 失败已设 dirty 不抛）
        yield _evt("applying", phase="applying")
        spec_ws = await self._write_spec_root(workspace_id, tar_bytes)
        yield _evt("reparsing_docs", phase="reparsing_docs")
        docs = await self._reparse_phase(workspace_id, spec_ws, "scan_docs")
        yield _evt("reparsing_docs", phase="reparsing_docs", parsed=docs)
        yield _evt("reparsing_changes", phase="reparsing_changes")
        changes = await self._reparse_phase(workspace_id, spec_ws, "change")
        yield _evt("reparsing_changes", phase="reparsing_changes", parsed=changes)
        yield _evt(
            "done",
            phase="done",
            spec_workspace_id=str(spec_ws.id),
            sync_status=spec_ws.sync_status,
        )

    # ── Manual sync (D-012，task-13：path_source 分流) ──────────────────────
    #
    # 「同步到服务器」手动按钮：把本地（或本机）spec 改动回灌到服务器权威 spec_root。
    # 复用 DaemonChangeWrite outbox（kind="spec-sync"）共享 change-detail-file-tree-editor
    # 基础设施，不另起表。
    #
    # 分流：
    #   - server-local：root_path 在容器/宿主机可读，直接打包 .sillyspec → apply_sync
    #     落盘返 done（与 import_from_repo 等价但同步语义：把本机 spec 整树覆盖服务器）。
    #   - daemon-client：root_path 在成员宿主机，backend 读不到 → 建 kind="spec-sync" 的
    #     DaemonChangeWrite 行，daemon 拉到后调 postSpecSync 整树回灌（D-012）。

    async def sync_manual_server_local(
        self,
        workspace_id: uuid.UUID,
        *,
        daemon_id: uuid.UUID | None = None,
        root_path: str | None = None,
    ) -> dict[str, str]:
        """server-local 手动同步：本机 .sillyspec 打包 → apply_sync 落盘返 done。

        复用 ``import_from_repo`` 的 server-local 分支（容器内打包 .sillyspec 整树 →
        apply_sync 覆盖 spec_root + reparse）。返回 ``{"status": "done"}``。
        """
        await self.import_from_repo(workspace_id, daemon_id=daemon_id, root_path=root_path)
        return {"status": "done"}

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
            .where(DaemonChangeWrite.workspace_id == workspace_id)  # type: ignore[arg-type]
            .where(DaemonChangeWrite.kind == "spec-sync")  # type: ignore[operator]
            .order_by(DaemonChangeWrite.created_at.desc())
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [
            {
                "task_id": str(rw.id),
                "status": rw.status,
                "runtime_id": str(rw.runtime_id),
                "error": rw.error,
                "created_at": rw.created_at,  # type: ignore[dict-item]
                "completed_at": rw.completed_at,  # type: ignore[dict-item]
            }
            for rw in rows
        ]

    async def sync(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        """Synchronise the platform spec workspace with the repo ``.sillyspec``
        directory.

        **Stub**: only updates ``sync_status`` to ``clean`` and stamps
        ``last_synced_at``. The actual bidirectional sync logic will be added
        in a later wave.
        """
        spec_ws = await self.get(workspace_id)
        now = datetime.now(UTC)

        spec_ws.sync_status = "clean"
        spec_ws.last_synced_at = now
        spec_ws.updated_at = now

        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_workspace.sync",
            spec_workspace_id=str(spec_ws.id),
            workspace_id=str(workspace_id),
            note="stub — no filesystem changes made",
        )
        return spec_ws

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

    async def _write_spec_root(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
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

        try:
            tf = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")  # noqa: SIM115
        except tarfile.TarError as e:
            raise _spec_bundle_invalid("Invalid tar payload.", reason=str(e)) from e

        staging = Path(tempfile.mkdtemp(prefix="spec-sync-"))
        try:
            for m in tf.getmembers():
                name = m.name.replace("\\", "/")
                if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
                    raise _spec_bundle_invalid(
                        "Absolute path in tar is not allowed.",
                        member=m.name,
                    )
                target = (spec_root / name).resolve()
                try:
                    target.relative_to(spec_root_resolved)
                except ValueError:
                    raise _spec_bundle_invalid(
                        "Tar member escapes spec_root.",
                        member=m.name,
                    ) from None

            tf.extractall(staging, filter="fully_trusted")

            # 3. Per-file merge (D-006@v2): walk staging files, compare content_hash
            # / source_mtime against existing scan_documents.  Files in spec_root
            # but NOT in staging are kept (preserve other members' exclusive docs).
            from app.modules.scan_docs.conflict_service import ScanDocConflictService
            from app.modules.scan_docs.model import ScanDocument

            conflict_svc = ScanDocConflictService(self._session)
            now = datetime.now(UTC)
            for m in tf.getmembers():
                if not m.isfile():
                    continue
                rel_path = m.name.replace("\\", "/")
                src_file = staging / m.name
                target = spec_root / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)

                content = src_file.read_bytes()
                ch = hashlib.sha256(content).hexdigest()
                src_mtime = datetime.fromtimestamp(m.mtime, tz=UTC) if m.mtime > 0 else None

                cur = (
                    (
                        await self._session.execute(
                            select(ScanDocument)
                            .where(
                                ScanDocument.workspace_id == workspace_id,
                                ScanDocument.path == rel_path,
                            )
                            .limit(1)
                        )
                    )
                    .scalars()
                    .first()
                )

                if cur:
                    if cur.content_hash == ch:
                        continue
                    # Normalize naive datetimes (SQLite returns naive) to UTC-aware.
                    cur_raw = cur.source_mtime
                    if cur_raw is not None and cur_raw.tzinfo is None:
                        cur_raw = cur_raw.replace(tzinfo=UTC)
                    cur_mtime = cur_raw or datetime.min.replace(tz=UTC)
                    inc_raw = src_mtime
                    if inc_raw is not None and inc_raw.tzinfo is None:
                        inc_raw = inc_raw.replace(tzinfo=UTC)
                    inc_mtime = inc_raw or datetime.min.replace(tz=UTC)
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
                        cur.content = content.decode("utf-8", errors="replace")
                        cur.content_hash = ch
                        cur.source_mtime = src_mtime
                        cur.source_synced_at = now
                        cur.last_modified_at = src_mtime or now
                        shutil.move(str(src_file), str(target))
                else:
                    doc = ScanDocument(
                        workspace_id=workspace_id,
                        path=rel_path,
                        doc_type=rel_path.rsplit(".", 1)[-1] if "." in rel_path else "md",
                        title=rel_path.rsplit("/", 1)[-1] if "/" in rel_path else rel_path,
                        content=content.decode("utf-8", errors="replace"),
                        content_hash=ch,
                        source_mtime=src_mtime,
                        source_synced_at=now,
                        source_member_id=None,
                        exists=True,
                    )
                    self._session.add(doc)
                    shutil.move(str(src_file), str(target))
        finally:
            tf.close()
            shutil.rmtree(staging, ignore_errors=True)

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
        return spec_ws

    async def apply_sync(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
    ) -> dict[str, int]:
        """Overwrite spec_root with tar, then reparse docs + changes (D-003).

        D-006 whole-tree overwrite. D-003 docs/changes 两阶段独立 try/except（单阶段
        失败 dirty 不阻断另一阶段）。Returns ``{reparsed_docs, reparsed_changes}``。
        """
        spec_ws = await self._write_spec_root(workspace_id, tar_bytes)
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
