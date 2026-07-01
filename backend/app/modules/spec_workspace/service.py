"""Spec workspace use cases.

This module handles CRUD and sync-status management for the ``spec_workspaces``
table. It does not touch the filesystem (that responsibility belongs to the
sync / import flows in future tasks).

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import base64
import io
import shutil
import tarfile
import tempfile
import uuid
from collections.abc import Iterator
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
        runtime_id: uuid.UUID | None = None,
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
            runtime_id: daemon runtime UUID（daemon-client workspace 必填，路由 RPC）。
            root_path: workspace root_path（容器路径或 daemon-client 宿主机路径）。
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
        ws_runtime_id = runtime_id or ws.daemon_runtime_id

        if not ws_root_path:
            raise AppError(
                "Workspace has no root_path; cannot import .sillyspec.",
                code="SPEC_IMPORT_NO_ROOT_PATH",
                http_status=400,
            )

        # ── daemon-client：经 WS RPC 让 daemon 打包 → 回传 → apply_sync ──
        if ws_path_source == "daemon-client" and ws_runtime_id:
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
                    ws_runtime_id,
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
                        details={"runtime_id": str(ws_runtime_id), "daemon_code": exc.code},
                    ) from exc
                raise DaemonRpcRemoteGatewayError(
                    f"Daemon get_spec_bundle failed: {exc.message}",
                    details={"runtime_id": str(ws_runtime_id), "daemon_code": exc.code},
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

    async def apply_sync(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
    ) -> int:
        """Overwrite the server ``spec_root`` with the uploaded tar, then reparse.

        D-006@v1: whole-tree overwrite, no diff/merge. 接收 tar 内 daemon 的
        ``.runtime/``（daemon 是 daemon-client 唯一 sillyspec 执行方，``.runtime``
        权威）；随整树覆盖落盘，不再保留 backend 旧的 ``.runtime``。

        D-003@v1 非对称契约：push（本方法）包含 ``.runtime/``、pull（``build_bundle``）
        仍排除 ``.runtime/``。Returns the ``reparse`` ``parsed`` count.

        Rollback (D-005@v1, 2026-06-23-spec-transport-tar-sync): tar 模式出问题时，
        清空 ``SPEC_TRANSPORT`` 回退 shared 默认 + 重新 scan 即可；数据可清，无迁移逻辑。
        本方法对 shared/tar 两种 transport 均适用（端点 ``/spec-workspace/sync`` 权限
        WORKSPACE_WRITE 不读 strategy，platform-managed/repo-* 天然放行）。
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)
        spec_root.mkdir(parents=True, exist_ok=True)
        spec_root_resolved = spec_root.resolve()

        # 1. Open + fully validate every member BEFORE touching disk.
        # tf is used across the try/finally below; closing in finally is
        # equivalent to a with-block.
        try:
            tf = tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*")  # noqa: SIM115
        except tarfile.TarError as e:
            raise _spec_bundle_invalid("Invalid tar payload.", reason=str(e)) from e

        staging = Path(tempfile.mkdtemp(prefix="spec-sync-"))
        try:
            for m in tf.getmembers():
                name = m.name.replace("\\", "/")
                # Reject absolute paths and Windows drive letters.
                if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
                    raise _spec_bundle_invalid(
                        "Absolute path in tar is not allowed.",
                        member=m.name,
                    )
                # Reject anything that resolves outside spec_root (Zip/Tar Slip).
                target = (spec_root / name).resolve()
                try:
                    target.relative_to(spec_root_resolved)
                except ValueError:
                    raise _spec_bundle_invalid(
                        "Tar member escapes spec_root.",
                        member=m.name,
                    ) from None

            # 2. Materialise the new tree into staging first; only once that
            # succeeds do we clear the old spec_root (atomic-ish swap).
            # filter="fully_trusted" is safe here because every member path has
            # already been validated to stay inside spec_root above.
            tf.extractall(staging, filter="fully_trusted")

            # Clear old spec_root (whole-tree overwrite, D-006@v1).
            for child in spec_root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()

            # Move new tree in (daemon tar 内的 .runtime/ 随整树覆盖落盘, D-003@v1).
            for child in staging.iterdir():
                shutil.move(str(child), str(spec_root / child.name))
        finally:
            tf.close()
            shutil.rmtree(staging, ignore_errors=True)

        # 3. Stamp sync_status clean + reparse. Reparse failures leave the file
        # overwrite in place (files are the source of truth) but flip
        # sync_status back to dirty so the UI shows a refresh is needed.
        now = datetime.now(UTC)
        spec_ws.sync_status = "clean"
        spec_ws.last_synced_at = now
        spec_ws.updated_at = now
        await self._session.commit()

        from app.modules.scan_docs.service import ScanDocsService

        scan_svc = ScanDocsService(self._session)
        try:
            stats, _ = await scan_svc.reparse(workspace_id)
        except Exception as e:
            log.warning(
                "spec_workspace.sync_reparse_failed",
                workspace_id=str(workspace_id),
                error=str(e),
            )
            spec_ws.sync_status = "dirty"
            spec_ws.updated_at = datetime.now(UTC)
            await self._session.commit()
            raise

        reparsed = int(stats.get("parsed", 0))
        log.info(
            "spec_workspace.sync_applied",
            workspace_id=str(workspace_id),
            reparsed=reparsed,
        )
        return reparsed
