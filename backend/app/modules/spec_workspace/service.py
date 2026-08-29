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
from pathlib import Path, PurePosixPath

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session_factory
from app.core.errors import AppError, SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.modules.change.quicklog_parser import parse_quicklog_directory
from app.modules.daemon.model import DaemonChangeWrite
from app.modules.platform_sync.model import QuicklogEntryORM
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

# ql-20260818-002：local.yaml（机器本地连接配置，platform/mcp 段含 shpsync_/shmcp_
# token）不是平台管理的 spec 内容——落服务器 landing 树会被 build_bundle 原样分发到
# 其他成员机器（token 跨机泄漏）。服务器侧三处统一过滤（apply_ops ① /
# _extract_spec_tar_to_staging ② / build_bundle ③），按文件名任意深度命中，覆盖
# 任意生产者版本（旧 daemon 整包 tar / CLI 增量 ops / 未来新端点）；delete 放行
# 用于清存量 landing 树的历史 local.yaml 行（软删入备份区，不入浏览树/导出包）。
# 生产端（CLI spec-sync.js / daemon）同步排除属优化非必需，daemon 侧留遗留。
SERVER_EXCLUDED_FILENAMES = frozenset({"local.yaml"})

# task-08（2026-08-29-change-delete-closure-and-spec-pull / FR-08 / design §7.3）：
# bundle tar 顶层的快照元数据成员名。内容 ``{spec_version, strategy, generated_at,
# server}`` 由 build_bundle 内存生成（不落 spec_root 磁盘，镜像树/manifest 零污染），
# 用户/CLI 离线可辨快照新旧。
BUNDLE_METADATA_MEMBER = "PLATFORM-BUNDLE.json"

# task-05（2026-08-29-change-delete-closure-and-spec-pull / FR-03b / design §5.3）：
# quicklog 镜像目录在 spec 树内的固定前缀——apply_ops 的 ops 含此前缀路径才触发
# pushed 行对账（R-03：不含时零触发零额外查询，不新增整树扫描）。
QUICKLOG_DIR_PREFIX = "quicklog/"


def _is_server_excluded_write(op: "FileOp") -> bool:
    """op 是否为被排除文件名的**写入**（add/update 看 path / rename 看 new_path）。

    delete 不算写入——放行以清理存量行；rename FROM 被排除名（path 命中）等效移走
    旧文件，同样放行。
    """
    if op.op == "delete":
        return False
    target = op.new_path if op.op == "rename" else op.path
    return PurePosixPath(target).name in SERVER_EXCLUDED_FILENAMES


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
                    # ql-20260816-002：同步置 claimed_at=now 给 claim 续期——全量
                    # spec-sync apply 可达 90s+，后端 GC 60s 会中途回收 claimed 行，
                    # 进度批量回写恰好是「活跃」心跳，防误杀（NFR-03 语义对齐 lease）。
                    .values(
                        files_processed=func.coalesce(DaemonChangeWrite.files_processed, 0) + batch,
                        claimed_at=func.now(),
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

    async def get_manifest(self, workspace_id: uuid.UUID) -> dict[str, dict[str, str | int | bool]]:
        """读服务器权威 per-file 清单（Change 2026-08-17-spec-file-incremental-sync task-01，design §5.3）。

        查询该 workspace 的 ``SpecFileManifest`` 全部行（**含 ``exists=False`` 的软删
        行**——CLI diff 据此识别服务器侧已删文件并下发 delete 对齐），返回
        ``{path: {"hash": content_hash, "version": version, "exists": exists}}``。
        按 path 排序保证响应确定性（便于 CLI diff / 人工核对）。纯读方法，不触碰
        清单行——唯一写者仍是 ``apply_ops``（D-011 单写者语义不变）。
        """
        stmt = (
            select(SpecFileManifest)
            .where(SpecFileManifest.workspace_id == workspace_id)
            .order_by(SpecFileManifest.path)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return {
            row.path: {
                "hash": row.content_hash,
                "version": row.version,
                "exists": row.exists,
            }
            for row in rows
        }

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
        spec_ws, converged_files, converged_dirs = write_task.result()

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
            converged_files=converged_files,
            converged_dirs=converged_dirs,
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
    ) -> tuple[str, int, Iterator[bytes]]:
        """Stream the server ``spec_root`` as a tar stream.

        Excludes any ``.runtime/`` directory (top-level or nested) — that is
        daemon runtime cache, not spec data (R-02 / design §7.2) — plus
        ``SERVER_EXCLUDED_FILENAMES`` (local.yaml, ql-20260818-002).

        Change 2026-08-29-change-delete-closure-and-spec-pull task-08（FR-08 /
        design §7.3）：tar 顶层新增内存生成的 ``PLATFORM-BUNDLE.json`` 快照元数据
        ``{spec_version, strategy, generated_at, server}``——用户/CLI 离线可辨快照
        新旧。成员由内存构造（不经 rglob、不落 spec_root 磁盘），镜像树与
        manifest 对账零污染。返回值扩展为 ``(spec_root_abs, spec_version,
        tar_byte_chunks)``——路由侧据此回 ``X-Spec-Version`` 响应头。

        The generator yields the tar in chunks so the caller can feed it
        directly to ``StreamingResponse`` without buffering the whole tree in
        memory.
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)

        # An absent spec_root is a legal empty bundle (daemon unpacks into an
        # empty dir). Materialise it so rglob has something to walk.
        spec_root.mkdir(parents=True, exist_ok=True)

        spec_root_abs = str(spec_root)
        spec_version = int(spec_ws.spec_version or 0)
        strategy = spec_ws.strategy

        def _stream() -> Iterator[bytes]:
            buf = io.BytesIO()
            # ``w|`` is a streaming (non-seekable) tar; we buffer the whole tar
            # in memory here for simplicity. Spec trees are small (R-02); a
            # future task can swap to a real chunked pipe if needed.
            with tarfile.open(fileobj=buf, mode="w") as tar:
                # 快照元数据成员（task-08）：generated_at 取打包时刻 UTC ISO；
                # server 取 hub 对外 origin（多平台实例部署下可辨快照来源）。
                meta = {
                    "spec_version": spec_version,
                    "strategy": strategy,
                    "generated_at": datetime.now(UTC).isoformat(),
                    "server": get_settings().hub_proxy_base_url,
                }
                meta_bytes = json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8")
                meta_info = tarfile.TarInfo(name=BUNDLE_METADATA_MEMBER)
                meta_info.size = len(meta_bytes)
                tar.addfile(meta_info, io.BytesIO(meta_bytes))
                for path in sorted(spec_root.rglob("*")):
                    rel = path.relative_to(spec_root)
                    # Exclude .runtime/ at any depth.
                    if any(part == ".runtime" for part in rel.parts):
                        continue
                    # ql-20260818-002 过滤点③：local.yaml 不随 bundle 下发（token
                    # 不跨机分发）；landing 树存量文件即使残留也不出服务器。
                    if path.name in SERVER_EXCLUDED_FILENAMES:
                        continue
                    # 磁盘上顶层同名残留（daemon 回灌带旧元数据的整树等）不随包
                    # 下发——与内存成员重名时整包解压「后写覆盖前写」，旧快照
                    # 元数据会冒充本次快照；嵌套同名文件不冲突，照常分发。
                    if str(rel) == BUNDLE_METADATA_MEMBER:
                        continue
                    tar.add(path, arcname=str(rel), recursive=False)
            buf.seek(0)
            while True:
                chunk = buf.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

        return spec_root_abs, spec_version, _stream()

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
        members: list[tarfile.TarInfo] = []
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
            # 2026-08-20 审计 BS-2：符号/硬链接成员一律拒绝。词法预检发生在解包前
            # （链接尚未落盘，resolve 识不破），「先链接成员→再经其写文件」可逃逸
            # staging 实现任意文件写；spec 树同步语义本就只需普通文件/目录。
            if m.issym() or m.islnk():
                raise _spec_bundle_invalid(
                    "同步包无效：不允许包含符号链接或硬链接成员。",
                    member=m.name,
                )
            # ql-20260818-002 过滤点②：local.yaml 成员不落 staging（整包覆盖语义下
            # 即从服务器树移除）；越界校验仍全量跑（坏成员照旧 422 拒整体）。
            if PurePosixPath(name).name in SERVER_EXCLUDED_FILENAMES:
                continue
            members.append(m)

        # filter="data"：拒绝链接/设备/绝对路径等危险成员（与上方预检双保险）。
        tf.extractall(staging, members=members, filter="data")
        return tf, staging

    async def _load_platform_deleted_prefixes(self, workspace_id: uuid.UUID) -> tuple[str, ...]:
        """task-02（design §5.4 B-2 加固）：workspace manifest 中 platform_deleted=True
        行 → 已平台删除目录前缀集。

        活跃区 ``changes/{name}/``（两段）、归档区 ``changes/archive/{name}/``（三段），
        尾缀带 ``/`` 保证前缀边界（``changes/foo/`` 不误吞 ``changes/foobar/...``）。
        非 ``changes/`` 前缀的墓碑行不参与（平台删除入口只作用于变更目录，task-06）。
        返回 tuple 供 ``str.startswith`` 前缀探测（一次命中即跳过，整目录排除）。
        """
        rows = (
            (
                await self._session.execute(
                    select(SpecFileManifest.path).where(
                        SpecFileManifest.workspace_id == workspace_id,
                        SpecFileManifest.platform_deleted.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        prefixes: set[str] = set()
        for p in rows:
            p = p.replace("\\", "/")
            if p.startswith("changes/archive/"):
                segs = p.split("/")[:3]  # changes/archive/{name}
                if len(segs) == 3 and segs[2]:
                    prefixes.add("/".join(segs) + "/")
            elif p.startswith("changes/"):
                segs = p.split("/")[:2]  # changes/{name}
                if len(segs) == 2 and segs[1]:
                    prefixes.add("/".join(segs) + "/")
        return tuple(prefixes)

    async def _write_spec_root(
        self,
        workspace_id: uuid.UUID,
        tar_bytes: bytes,
        change_write_id: str | None = None,
    ) -> tuple[SpecWorkspace, int, int]:
        """Validate + overwrite spec_root with tar (D-006 whole-tree), commit clean.

        D-001（2026-07-01-spec-import-async-and-change-reparse）：从 apply_sync 提取，
        供 apply_sync（sync 端点）与 import_from_repo_sse（import SSE）共用——SSE 需在
        写盘 / reparse_docs / reparse_changes 之间分阶段 yield 事件。Returns refreshed
        spec_ws（sync_status=clean，尚未 reparse）+ 对账统计
        ``(converged_files, converged_dirs)``（2026-08-19-spec-mirror-tombstone-sync
        task-03：供 SSE done 事件与结构化日志消费）。
        """
        spec_ws = await self.get(workspace_id)
        # ql-20260817-005：事务释放点①——get() 的 SELECT 打开事务后，紧跟的「tar
        # 解包到 staging」是纯 FS 长段（大 spec 树秒级），期间主连接零 SQL，PG
        # idle_in_transaction_session_timeout（db.py 后端自设 120s）会杀空闲事务
        # 连接，最终 commit 撞死连接 → sync 恒 500（2026-08-17 生产实例：3560 文件
        # bind mount 同步 FS 段 2.5min）。对齐 delegate.py release_transaction 模式：
        # 长 FS 段前 commit 释放事务。此处无未落盘写，commit 仅释放读事务；
        # expire_on_commit=False（db.py）保证对象仍 attached 可用。
        await self._session.commit()
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
            # ql-20260817-005：循环内禁止 session.add / session.delete——SQLAlchemy 2.0
            # 的 add/delete 会 autobegin 立即打开事务，事务横跨后续全部 FS 段会撞
            # idle-in-transaction 超时（见下②）。新 doc / 冲突行改为构造后收集到
            # pending 列表，循环结束统一 add + 最终 commit（一个短事务）。
            pending_new_docs: list[ScanDocument] = []
            from app.modules.scan_docs.conflict_model import ScanDocConflictHistory

            pending_conflicts: list[ScanDocConflictHistory] = []
            # 2026-08-19-spec-mirror-tombstone-sync task-01：实际落盘集（rel_path →
            # 内容 hash）。收集点在 _load_member 成功之后——local.yaml（staging 解包
            # 层不 extract）与 staging 缺失成员走 FileNotFoundError continue，不会进
            # 集合；同内容 skip 分支的文件磁盘已有且内容一致，同样属于落盘集。该
            # 集合是对账删除（_converge_stale_files）与 manifest 逐行对齐的基准。
            landed_paths: set[str] = set()
            landed_hashes: dict[str, str] = {}
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
            # task-02（design §5.4 B-2 / 通道 3）：平台已删除目录前缀集——落盘集
            # 计算阶段整目录排除（见循环内 continue）。查询与 ScanDocument 预取同批，
            # 不在 FS 循环期间重开读事务（见下方②注释）。
            platform_deleted_prefixes = await self._load_platform_deleted_prefixes(workspace_id)
            # ql-20260817-005：事务释放点②——下方逐文件循环（read/sha256/move 全
            # FS；冲突行/新 doc 收集进 pending 不 add；既有行改写是纯属性赋值；
            # 进度回写走独立 session）主连接零 SQL、零事务。若循环内 add/delete
            # 会 autobegin 重开事务横跨全部 FS 段，同①被 idle-in-transaction 超时
            # 杀连接。此 commit 释放 prefetch 的读事务；全部写集中在循环后的
            # 最终 commit——写原子性不变，语义零变更。
            await self._session.commit()
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
                # task-02（design §5.4 B-2 / 通道 3）：daemon 增量失败回退整树 tar /
                # 手动全量同步时，已平台删除目录的成员不落盘——前缀级排除优先于逐
                # 路径精确匹配（顺带闭合成员本地「新增从未见路径」绕过精确匹配的
                # P2 边角）。跳过点在 _load_member 之前（其 mkdir 会凭空建出幽灵父
                # 目录）；不 move、不入 landed_paths/landed_hashes（对账环与 manifest
                # 对齐环因此不触达这些行，墓碑维持；文件留 staging 随 finally rmtree
                # 消失）——仅挡 manifest 对齐环不够，文件一旦回磁盘 reparse 即翻回
                # active（R-10）。
                if platform_deleted_prefixes and rel_path.startswith(platform_deleted_prefixes):
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
                landed_paths.add(rel_path)
                landed_hashes[rel_path] = ch

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
                        # ql-20260817-005：add_to_session=False——构造冲突行收集到
                        # pending，循环外统一 add（循环内 add 会 autobegin 开事务）。
                        pending_conflicts.append(
                            await conflict_svc.archive_conflict(
                                workspace_id,
                                rel_path,
                                old_content=cur.content,
                                old_source_member_id=cur.source_member_id,
                                old_source_runtime_id=cur.source_runtime_id,
                                old_mtime=cur.source_mtime,
                                new_source_member_id=None,
                                new_mtime=src_mtime,
                                add_to_session=False,
                            )
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
                    # ql-20260817-005：收集，循环外统一 add（见 pending_new_docs 注释）。
                    pending_new_docs.append(doc)
                    await asyncio.to_thread(shutil.move, str(src_file), str(target))
                    await progress.bump()
        finally:
            # task-03 / R-02：终态回写兜底——无论循环正常走完还是中途抛错，
            # 已处理文件的计数都最终落库（数值最终准确，design 兼容策略）。
            await progress.flush()
            tf.close()
            # Wave C 续：staging 整树删除移出事件循环
            await asyncio.to_thread(shutil.rmtree, staging, ignore_errors=True)

        # 2026-08-19-spec-mirror-tombstone-sync task-01：对账删除——镜像里不在
        # 落盘集的文件软删 move 到备份区、清理空目录（FR-01）。tar 是整树权威快照
        # （§1.2 语义论证：全表 wipe 早已宣告整树语义，per-file 保留策略无法区分
        # 「他人独有文档」与「改名/删除产生的幽灵残留」）。整体入线程（对齐
        # ql-20260818-009 范式：rglob/move/rmdir 全 FS 段）；发生在 reparse 之前
        # → 幽灵目录消失后 reparse 删除环自然清掉对应 changes 行（design §4.4）。
        settings = get_settings()
        backup_root = self._backup_root(settings, workspace_id)
        converged_paths, converged_dirs = await asyncio.to_thread(
            self._converge_stale_files, spec_root, landed_paths, backup_root
        )
        log.info(
            "spec_workspace.converged",
            workspace_id=str(workspace_id),
            converged_files=len(converged_paths),
            converged_dirs=converged_dirs,
        )

        # ql-20260817-005：循环外统一入 session（add 的 autobegin 事务在此刻才
        # 打开，紧接最终 commit，事务窗口毫秒级）+ 属性改写（既有行 / spec_ws）
        # 一并在最终 commit 落库——全部写仍是单事务，原子性与原实现一致。
        for conflict in pending_conflicts:
            self._session.add(conflict)
        for doc in pending_new_docs:
            self._session.add(doc)

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

        # 2026-08-19-spec-mirror-tombstone-sync task-02：manifest 逐行对齐（墓碑
        # 替代全表 wipe）。原 Q7/R-01 全表 DELETE 的意图「整树覆盖后旧 per-file
        # version 无意义、强制下一次增量对齐」在逐行对齐下语义等价——落盘文件
        # version 全体 +1（daemon 缓存必落后 → 拉新 manifest 对齐），被对账删除的
        # 文件置 exists=False 墓碑（保留乐观锁谱系：daemon 缓存持旧 version 上行
        # 命中墓碑行不再判 conflict 死锁，对齐 ql-20260819-004 软删行复活语义）。
        # 位置沿用原 wipe 点（最终 commit 后的独立短事务），与 design §4.1 时序
        # 字面不同但功能等价。
        manifest_rows = (
            (
                await self._session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == workspace_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        manifest_by_path = {r.path: r for r in manifest_rows}
        for rel, ch in landed_hashes.items():
            row = manifest_by_path.get(rel)
            if row is None:
                self._session.add(
                    SpecFileManifest(
                        workspace_id=workspace_id,
                        path=rel,
                        content_hash=ch,
                        version=1,
                        exists=True,
                        updated_at=now,
                    )
                )
            else:
                row.content_hash = ch
                row.version = row.version + 1
                row.exists = True
                row.updated_at = now
        for rel in converged_paths:
            row = manifest_by_path.get(rel)
            if row is not None:
                row.exists = False
                row.version = row.version + 1
                row.updated_at = now
        await self._session.commit()
        return spec_ws, len(converged_paths), converged_dirs

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
        spec_ws, converged_files, converged_dirs = await self._write_spec_root(
            workspace_id, tar_bytes, change_write_id=change_write_id
        )
        reparsed_docs = await self._reparse_phase(workspace_id, spec_ws, "scan_docs")
        reparsed_changes = await self._reparse_phase(workspace_id, spec_ws, "change")
        log.info(
            "spec_workspace.sync_applied",
            workspace_id=str(workspace_id),
            reparsed_docs=reparsed_docs,
            reparsed_changes=reparsed_changes,
            converged_files=converged_files,
            converged_dirs=converged_dirs,
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
    def _write_op_file(target: Path, content: bytes, mtime: float | None) -> None:
        """同步落盘一个 op 文件（mkdir + write_bytes + utime），整体入线程用。

        ql-20260818-009：apply_ops 的 FS 段（mkdir/write_bytes/os.utime）原先在
        事件循环上同步执行——Windows bind mount 上单文件写可达数十 ms，N 文件
        连写把循环卡死数十秒（2026-08-18 03:01Z spec-sync 93s/82s 超 CLI 30s
        超时根因①）。本 helper 供 ``asyncio.to_thread`` 整体调度，语义与原
        三连调用逐条等价。
        """
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        # ql-20260813-008：应用宿主真实 mtime，让镜像文件 mtime 真实 → reparse
        # 填的 changes.updated_at 反映变更活动（而非同步时刻）。
        SpecWorkspaceService._apply_file_mtime(target, mtime)

    @staticmethod
    def _move_op_file(src: Path, dest: Path) -> None:
        """同步移动文件（delete 软删备份 / rename 共用），整体入线程用（ql-20260818-009）。"""
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))

    @staticmethod
    def _converge_stale_files(
        spec_root: Path,
        landed_paths: set[str],
        backup_root: Path,
    ) -> tuple[set[str], int]:
        """2026-08-19-spec-mirror-tombstone-sync FR-01/FR-04：全量同步对账删除。

        镜像 spec_root 与 tar 落盘集对账：不在落盘集的文件视为改名/删除/归档产生
        的幽灵残留，软删 move 到 ``backup_root/{收敛批时间戳}/<rel>``（与增量路径
        apply_ops 的 delete 语义同构：备份区 + 后续 manifest 墓碑）。删除后自底向
        上清理空目录（幽灵变更目录整目录消失），并机会式修剪备份区（复用
        ``_prune_spec_backups``）。

        双护栏（坏包保护，FR-04）：
        - 落盘集为空 → 跳过对账（空 tar 异常，维持镜像现状不删任何东西）；
        - 磁盘文件数 > 2 × max(落盘集大小, 200) → 中止 + warn（防坏 tar / 半截包
          清空镜像；本仓实测正常比例 ≈1.005，阈值 2 足够宽松，200 起步防小树误伤）。

        全同步 FS 段（rglob/move/rmdir），调用方需整体入 ``asyncio.to_thread``。
        返回 ``(converged_rel_paths, converged_dirs)``——路径集合供 manifest 墓碑
        对齐（task-02），目录数供 SSE done 事件 / 日志（task-03）。
        """
        if not landed_paths:
            log.warning(
                "spec_workspace.converge_skipped_empty_landing",
                spec_root=str(spec_root),
            )
            return set(), 0
        disk_rels: list[str] = []
        for p in spec_root.rglob("*"):
            # .runtime/（任意深度）是 daemon 运行时产物，永不参与对账（与 merge
            # 循环的排除对称——异构/历史 tar 解进 staging 的 .runtime 已被落盘集
            # 基准天然排除，此处防的是磁盘侧独立存在的 .runtime 残留）。
            if ".runtime" in p.relative_to(spec_root).parts:
                continue
            if p.is_file():
                disk_rels.append(p.relative_to(spec_root).as_posix())
        if len(disk_rels) > 2 * max(len(landed_paths), 200):
            log.warning(
                "spec_workspace.converge_aborted_ratio",
                spec_root=str(spec_root),
                disk_files=len(disk_rels),
                landed_files=len(landed_paths),
            )
            return set(), 0
        stale_rels = [rel for rel in disk_rels if rel not in landed_paths]
        if not stale_rels:
            return set(), 0
        converged: set[str] = set()
        ts = datetime.now(UTC).strftime(BACKUP_TS_FORMAT)
        for rel in stale_rels:
            src = spec_root / rel
            dest = backup_root / ts / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dest))
            converged.add(rel)
        # 自底向上清理空目录：目录已空且非 spec_root 本身 → rmdir。os.listdir 实时
        # 探空（topdown=False 的 dirnames 快照不含刚被 rmdir 的子目录状态）。
        converged_dirs = 0
        for dirpath, _dirnames, _filenames in os.walk(spec_root, topdown=False):
            dir_path = Path(dirpath)
            if dir_path == spec_root:
                continue
            try:
                if not os.listdir(dirpath):
                    os.rmdir(dirpath)
                    converged_dirs += 1
            except OSError:
                continue
        SpecWorkspaceService._prune_spec_backups(backup_root)
        return converged, converged_dirs

    @staticmethod
    def _cleanup_empty_dirs(spec_root: Path, rel_dirs: set[str]) -> int:
        """task-02（design §5.1 / FR-02 幽灵目录）：清理 ops 涉及目录链上的空目录。

        ``rel_dirs`` 为本次 ops 涉及的父目录（delete 的 op.path / rename 的源与目标
        路径的父目录，spec_root 相对 POSIX 路径）。对每个涉及目录沿父链收集到
        spec_root（不含根本身），按路径深度降序**自底向上** rmdir：目录空
        （``os.listdir`` 实时探空，复用 ``_converge_stale_files`` 范式）则删、非空即
        跳过（父目录因含非空子目录自然探非空，等效「非空即停」）、OSError 一律忽略
        （目录不存在 / 并发写入 / Windows 句柄滞留等）。**仅触碰 ops 涉及目录链，
        禁止 rglob 整树**（R-03：Windows bind mount stat 性能断崖）。全同步 FS 段，
        调用方需整体入 ``asyncio.to_thread``。返回清理的目录数。
        """
        chain: set[Path] = set()
        for rel in rel_dirs:
            rel = rel.replace("\\", "/").strip("/")
            if not rel:
                continue
            cur = spec_root / rel
            # cur.parent == cur 即文件系统根，防 spec_root 异常形态下的死循环
            while cur != spec_root and cur.parent != cur:
                chain.add(cur)
                cur = cur.parent
        removed = 0
        for dir_path in sorted(chain, key=lambda p: len(p.parts), reverse=True):
            try:
                if not os.listdir(dir_path):
                    os.rmdir(dir_path)
                    removed += 1
            except OSError:
                continue
        return removed

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

    async def soft_delete_change_dir(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        location: str = "active",
    ) -> dict[str, object]:
        """平台删除入口的镜像目录软删（task-06 / design §6.1 步骤①，FR-05b）。

        按 ``location`` 选镜像前缀（``archive`` → ``changes/archive/{name}/``，其余 →
        ``changes/{name}/``——归档区行同样可删），manifest 前缀枚举现存文件
        （``exists=True``）逐文件 ``_move_op_file`` 移入 30 天备份区
        ``backup_root/{BACKUP_TS_FORMAT 时间戳}/<rel>``（与增量 delete op 同构的 move
        软删，D-010），manifest 行置 ``exists=False`` / ``version+1`` /
        ``platform_deleted=True``（base_version 直读 manifest 现值、不经上行乐观锁，
        零 409 冲突）；目录空后自底向上 rmdir（task-02 ``_cleanup_empty_dirs`` 范式：
        仅触碰该变更目录链，禁整树扫描，R-03），末尾机会式修剪备份区
        （``_prune_spec_backups``，R-06）。

        - 前缀匹配：取回 workspace manifest 行后 Python ``startswith`` 逐字符过滤
          （卡内二法择一）：变更名含 ``_`` 常见，SQL LIKE 未转义时 ``_`` 是单字符
          通配符（与 platform_sync ``_change_key_deleted`` 同口径）。
        - 前缀内既有 ``exists=False`` 行（增量协议软删过）只补
          ``platform_deleted=True``（前缀级墓碑完整性——保证 task-02
          ``_load_platform_deleted_prefixes`` 落盘排除与 task-04 拒收兜底锚点对整
          目录生效），不 move 不 version+1（无 op 应用，乐观锁谱系不动）。
        - 磁盘文件已缺失（并发删 / 从未落盘）→ ``FileNotFoundError`` 容错，标记
          照落（对齐 apply_ops delete 分支）。
        - 零文件幂等：返回 ``file_count=0`` 不抛。

        返回 ``{"backup_dir": str, "file_count": int}``（task-06 审计 detail 消费）。
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)
        prefix = (
            f"changes/archive/{change_key}/" if location == "archive" else f"changes/{change_key}/"
        )
        rows = (
            (
                await self._session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == workspace_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        touched = [r for r in rows if r.path.replace("\\", "/").startswith(prefix)]
        # ql-20260817-005：事务释放点——下方 FS 循环（move）前 commit 释放枚举读事务
        # （见 apply_ops 同注释）；行改写是纯属性赋值，集中在最终 commit 单事务落库。
        await self._session.commit()

        settings = get_settings()
        backup_root = self._backup_root(settings, workspace_id)
        ts = datetime.now(UTC).strftime(BACKUP_TS_FORMAT)
        now = datetime.now(UTC)
        file_count = 0
        # task-02 范式：涉及目录 = 变更目录本身 + 各被移文件的父目录链（自底向上
        # 非空即停；changes/ 根因其它变更存在天然保留）。
        cleanup_dirs: set[str] = {prefix.rstrip("/")}
        for row in touched:
            if row.exists:
                src = spec_root / row.path
                dest = backup_root / ts / row.path
                try:
                    # ql-20260818-009：mkdir+move 整体入线程（见 _move_op_file）。
                    await asyncio.to_thread(self._move_op_file, src, dest)
                except FileNotFoundError:
                    # 磁盘文件已不存在（并发删/从未落盘）→ 仅推进状态，软删语义仍成立
                    pass
                row.exists = False
                row.version = row.version + 1
                row.updated_at = now
                file_count += 1
                parent = str(PurePosixPath(row.path).parent)
                if parent != ".":
                    cleanup_dirs.add(parent)
            if not row.platform_deleted:
                row.platform_deleted = True
                row.updated_at = now

        await asyncio.to_thread(self._cleanup_empty_dirs, spec_root, cleanup_dirs)
        await asyncio.to_thread(self._prune_spec_backups, backup_root)
        await self._session.commit()
        log.info(
            "spec_workspace.change_dir_soft_deleted",
            workspace_id=str(workspace_id),
            change_key=change_key,
            location=location,
            file_count=file_count,
        )
        return {"backup_dir": str(backup_root / ts), "file_count": file_count}

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
        - 软删行复活（ql-20260819-004）：add 落在 exists=False 行上 → 写盘 + 原地复活
          （version+1）；rename 目标是软删墓碑 → 不算占用，rename 结果原地复活墓碑
          （un-archive 愈合方向不再永久 conflict）。
        冲突 op 跳过、其余照常 apply，整体返回 conflict=True；校验失败整体 422 不落盘。

        ``change_dirs``（change 2026-08-14-change-center-conversation-driven / D-005@v1）：
        daemon 增量同步标注的本次涉及变更目录名集合。**落盘提交成功后**（事务外
        best-effort，R-04）触发 change reparse：有标注 → scoped（非归档 name）；
        无标注 → ops 路径 ``changes/`` 前缀检测兜底；**仅 archive 路径的 op 为
        delete/rename（目录跨根移动）→ 全量 reparse**，纯 add/update archive
        文件走 scoped（ql-20260818-009 收窄）。reparse 失败仅告警不阻断同步
        主流程；同步失败（校验 422 / 提交异常）不重复触发（幂等，触发器在
        commit 之后）。
        """
        spec_ws = await self.get(workspace_id)
        spec_root = Path(spec_ws.spec_root)
        # ql-20260818-009：mkdir 同为阻塞 FS 调用，入线程（bind mount 上 stat 慢）
        await asyncio.to_thread(spec_root.mkdir, parents=True, exist_ok=True)
        spec_root_resolved = spec_root.resolve()
        settings = get_settings()

        # 1. 预校验全部 op 路径（containment + .runtime），任一越界 422 整体不落盘。
        for op in ops:
            self._validate_op_path(op.path, spec_root, spec_root_resolved, field="path")
            if op.new_path is not None:
                self._validate_op_path(op.new_path, spec_root, spec_root_resolved, field="new_path")

        # ql-20260818-002 过滤点①：local.yaml 写 op 静默丢弃（不落盘 / 不进
        # new_versions / 不置 conflict，生产者据此幂等重推也无副作用）；delete
        # 放行清存量行。过滤在预校验后：路径合法性照验，仅拒内容落盘。
        ops = [op for op in ops if not _is_server_excluded_write(op)]

        now = datetime.now(UTC)
        new_versions: dict[str, int] = {}
        server_versions: dict[str, int] | None = None
        conflict = False
        # task-02（design §5.4/§11）：被 platform_deleted 墓碑拒绝的 add/rename 路径
        # （返回 dict 新增键，conflict 语义的显式回告——CLI 可感知被拒路径）。
        platform_deleted_paths: list[str] = []
        # task-02（design §5.1 / FR-02）：本次 ops 涉及目录（delete 的 op.path /
        # rename 的源与目标路径的父目录）——循环后统一自底向上清理空目录（仅涉及
        # 目录链，R-03 禁整树扫描）。
        cleanup_dirs: set[str] = set()

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
        # 审计 A1（2026-08-29 合入后修复轮）：apply_ops 增量通道（CLI spec-sync /
        # daemon 增量）补前缀级防复活拦截——平台删除 changes/{name}/ 后，成员本地
        # 新增的**从未推送文件**（manifest 无行）发 add 时 row=None，原实现只做
        # 精确行拦截（row.platform_deleted）挡不住，走普通 add 落盘即复活已删
        # 目录（reparse 随之翻回 active）。与 _write_spec_root 通道 3 的 B-2 前缀
        # 排除（:885/:912）同构：加载时机与 manifest 预取同批（保持 :1601 注释的
        # 「ops 循环主连接零事务」性质——commit 在循环前释放读事务）。
        platform_deleted_prefixes = await self._load_platform_deleted_prefixes(workspace_id)
        # ql-20260817-005：事务释放点——ops 循环（write_bytes/move 全 FS）主连接
        # 需保持零事务：SQLAlchemy 2.0 的 add/delete 会 autobegin 立即开事务，
        # 横跨后续全部 FS 段会撞 idle-in-transaction 超时（同 _write_spec_root②，
        # init 首成员推全套骨架文件到 bind mount 即触发）。此处 commit 释放
        # prefetch 读事务；循环内新行/删除改为收集 pending，循环后统一入
        # session + 最终 commit——写仍单事务，原子性不变。
        await self._session.commit()
        pending_adds: list[SpecFileManifest] = []
        pending_deletes: list[SpecFileManifest] = []

        # task-03 / D-002@v1：逐文件回写改批量回写器（内存计数 + 50 文件/500ms
        # 批量 UPDATE）；finally 终态 flush 保证 files_processed 最终准确。
        progress = _BatchProgressWriter(change_write_id)
        try:
            for op in ops:
                # task-02（design §5.1）：收集 ops 涉及目录（delete / rename 才会改变
                # 目录占用形态；update/add 只增不空）。conflict 被跳过的 op 同样收集——
                # 其文件未搬走，目录探空自然不通过，零副作用（见 _cleanup_empty_dirs）。
                if op.op == "delete":
                    parent = str(PurePosixPath(op.path).parent)
                    if parent != ".":
                        cleanup_dirs.add(parent)
                elif op.op == "rename" and op.new_path is not None:
                    for involved in (op.path, op.new_path):
                        parent = str(PurePosixPath(involved).parent)
                        if parent != ".":
                            cleanup_dirs.add(parent)

                # 查清单行（workspace_id+path）——task-03 起查预取 dict（miss 即 None）
                row = manifest_by_path.get(op.path)

                # 审计 A1：add 命中已平台删除目录前缀（含「从未推送文件」row=None
                # 的边角）→ 与下方精确行拦截同构处理：不落盘、conflict=True、
                # server_versions[path]（若行存在）+ platform_deleted 列表项。
                # 前缀探测优先于软删复活分支——目录级墓碑语义下该目录内任何 add
                # 都是复活企图（含普通软删行，平台删除是目录级动作）。
                if (
                    op.op == "add"
                    and platform_deleted_prefixes
                    and op.path.replace("\\", "/").startswith(platform_deleted_prefixes)
                ):
                    conflict = True
                    if row is not None:
                        if server_versions is None:
                            server_versions = {}
                        server_versions[op.path] = row.version
                    platform_deleted_paths.append(op.path)
                    continue

                # ql-20260819-004：软删行复活（add）。CLI diff 把 exists=False 行从
                # serverPaths 过滤（spec-sync.js computeSpecOps），本地文件在即发
                # add(base_version=0)——原实现落进下方乐观锁分支：同内容豁免 no-op
                # 提前返回（行永久停在 exists=f 僵尸态，2026-08-19-quick-done-
                # autoarchive-misfire 实证）或 hash 不符判 conflict。软删行的 version
                # 对客户端不可见，add 即「客户端树里该文件存在」的权威声明：写盘 +
                # 原地复活（version+1、exists=True），不进冲突路径。
                if op.op == "add" and row is not None and row.exists is False:
                    # task-02（design §5.4 通道 1）：平台删除墓碑（platform_deleted=
                    # True，仅平台删除动作置位）不可被 add 复活——多用户下另一成员
                    # CLI 以 manifest 为锚 diff 本地残留文件会发 add。拒绝落盘：
                    # conflict + server_versions + platform_deleted 列表显式回告
                    # （design §11），行维持墓碑不翻 exists。
                    if row.platform_deleted:
                        conflict = True
                        if server_versions is None:
                            server_versions = {}
                        server_versions[op.path] = row.version
                        platform_deleted_paths.append(op.path)
                        continue
                    if op.content is None:
                        raise _spec_bundle_invalid(
                            "同步包无效：新增/更新操作缺少文件内容。",
                            path=op.path,
                        )
                    content = base64.b64decode(op.content)
                    target = spec_root / op.path
                    await asyncio.to_thread(self._write_op_file, target, content, op.mtime)
                    ch = hashlib.sha256(content).hexdigest()
                    row.content_hash = ch
                    row.version = row.version + 1
                    row.exists = True
                    row.updated_at = now
                    new_versions[op.path] = row.version
                    await progress.bump()
                    continue

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
                    # ql-20260818-009：mkdir+write+utime 整体入线程（根因①，见 _write_op_file）
                    await asyncio.to_thread(self._write_op_file, target, content, op.mtime)
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
                        # ql-20260817-005：收集，循环外统一 add（见上方释放点注释）。
                        pending_adds.append(new_row)
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
                        src = spec_root / op.path
                        try:
                            # ql-20260818-009：mkdir+move 整体入线程（根因①，见 _move_op_file）
                            await asyncio.to_thread(self._move_op_file, src, dest)
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
                    # task-03 起查预取 dict。
                    # ql-20260819-004：目标行是 exists=False 软删墓碑不算占用——
                    # un-archive 方向的 rename（archive→active，CLI 对哈希相同的搬回
                    # 恒发 rename）会命中活跃路径的软删行，原实现判 conflict 跳过 →
                    # 愈合同步永久卡死（2026-08-19-quick-done-autoarchive-misfire
                    # 缺陷②）。墓碑的磁盘文件已在备份区，rename 结果原地复活墓碑。
                    target_row = manifest_by_path.get(op.new_path)
                    # 审计 A1：rename 目标命中已平台删除目录前缀（含目标「从未推送
                    # 路径」target_row=None 的边角）→ 与下方精确行拦截同构处理：
                    # 不落盘、conflict=True、server_versions[new_path]（若行存在）+
                    # platform_deleted 列表项。源文件不动、目标目录不建。
                    if platform_deleted_prefixes and op.new_path.replace("\\", "/").startswith(
                        platform_deleted_prefixes
                    ):
                        conflict = True
                        if target_row is not None:
                            if server_versions is None:
                                server_versions = {}
                            server_versions[op.new_path] = target_row.version
                        platform_deleted_paths.append(op.new_path)
                        continue
                    # task-02（design §5.4 通道 2）：rename 目标命中 platform_deleted
                    # 墓碑 → 拒绝复活（daemon 增量把本地残留搬进平台已删目录）。与下方
                    # exists 占用判断同构回告：conflict + server_versions +
                    # platform_deleted 项，不落盘不复活（区别于普通软删墓碑的放行复活）。
                    if target_row is not None and target_row.platform_deleted:
                        conflict = True
                        if server_versions is None:
                            server_versions = {}
                        server_versions[op.new_path] = target_row.version
                        platform_deleted_paths.append(op.new_path)
                        continue
                    if target_row is not None and target_row.exists:
                        conflict = True
                        if server_versions is None:
                            server_versions = {}
                        server_versions[op.new_path] = target_row.version
                        continue
                    # R-07：无旧行 → 按 add new_path 处理（目标有墓碑则原地复活，
                    # 不走 INSERT——SQLAlchemy flush 先 INSERT 后 DELETE/UPDATE，
                    # 同 path 新行会撞 ux_spec_manifest_ws_path 唯一约束）
                    if row is None:
                        if op.content is None:
                            raise _spec_bundle_invalid(
                                "同步包无效：源文件缺失的重命名操作必须携带文件内容。",
                                path=op.path,
                            )
                        content = base64.b64decode(op.content)
                        target = spec_root / op.new_path
                        await asyncio.to_thread(self._write_op_file, target, content, op.mtime)
                        ch = hashlib.sha256(content).hexdigest()
                        if target_row is not None:
                            target_row.content_hash = ch
                            target_row.version = target_row.version + 1
                            target_row.exists = True
                            target_row.updated_at = now
                            new_versions[op.new_path] = target_row.version
                        else:
                            added_row = SpecFileManifest(
                                workspace_id=workspace_id,
                                path=op.new_path,
                                content_hash=ch,
                                version=1,
                                exists=True,
                                updated_at=now,
                            )
                            pending_adds.append(added_row)  # ql-20260817-005：循环外统一 add
                            new_versions[op.new_path] = 1
                        manifest_by_path[op.new_path] = target_row
                        continue
                    # 常规 rename：move 文件 + 清单 path 迁移（删旧行 + 插新行）
                    new_version = row.version + 1
                    new_hash = row.content_hash
                    src = spec_root / op.path
                    dest = spec_root / op.new_path
                    # rename 语义：旧路径文件**消失**（无论是否重传 content）——先 move，
                    # 若带 content 再覆写目标为新内容（避免 src 残留孤儿文件，QA 揪出）。
                    try:
                        # ql-20260818-009：mkdir+move 整体入线程（根因①，见 _move_op_file）
                        await asyncio.to_thread(self._move_op_file, src, dest)
                    except FileNotFoundError:
                        pass  # 源文件不存在 → 仅推进清单状态
                    if op.content is not None:
                        content = base64.b64decode(op.content)
                        new_hash = hashlib.sha256(content).hexdigest()
                        # ql-20260818-009：覆写 + mtime 整体入线程（含 utime）
                        await asyncio.to_thread(self._write_op_file, dest, content, op.mtime)
                    else:
                        # ql-20260813-008：rename 后 dest 用宿主真实 mtime（move 沿用源 mtime，
                        # 此处按 op.mtime 覆盖为最新宿主态，保持与 add/update 一致）。
                        await asyncio.to_thread(self._apply_file_mtime, dest, op.mtime)
                    # ql-20260817-005：delete 同样会 autobegin——收集循环外统一删。
                    pending_deletes.append(row)
                    # ql-20260819-004：目标有软删墓碑 → 原地复活（version 沿目标路径
                    # 自身谱系 +1），不 INSERT 新行（flush 先 INSERT 后 DELETE，同
                    # path 撞唯一约束）；无墓碑 → 照旧插迁移行（旧路径行 version+1）。
                    if target_row is not None:
                        target_row.content_hash = new_hash
                        target_row.version = target_row.version + 1
                        target_row.exists = True
                        target_row.updated_at = now
                        renamed_row = target_row
                    else:
                        renamed_row = SpecFileManifest(
                            workspace_id=workspace_id,
                            path=op.new_path,
                            content_hash=new_hash,
                            version=new_version,
                            exists=True,
                            updated_at=now,
                        )
                        pending_adds.append(renamed_row)
                    # 镜像换 key：旧 path 删、新 path 指向新行
                    manifest_by_path.pop(op.path, None)
                    manifest_by_path[op.new_path] = renamed_row
                    new_versions[op.new_path] = renamed_row.version

                # D-004@V2 + task-03：每个成功处理的 op 后记一次进度（conflict op
                # 已 continue 跳过）——批量回写器内存计数，不再逐 op UPDATE。
                await progress.bump()

            # ql-20260817-005：循环外统一入 session（add/delete 的 autobegin 事务
            # 此刻才打开，紧接 commit，事务窗口毫秒级）——全部写仍是单事务。
            for stale in pending_deletes:
                await self._session.delete(stale)
            for new_row in pending_adds:
                self._session.add(new_row)
            await self._session.commit()
        finally:
            # task-03 / R-02：终态回写兜底（含 422 中断路径——已处理计数最终准确）。
            await progress.flush()

        # task-02（design §5.1 / FR-02 幽灵目录堵点）：ops 涉及目录链的空目录清理。
        # delete/rename 逐文件软删不动目录，parser 对空目录照常产出 key → 即使全量
        # reparse 该 key 仍在 seen_keys，DB 行连全量都删不掉（§1.1 堵点）；目录真
        # 消失后删除判据才生效。发生在 reparse 触发之前（parser 枚举不到已消失目录）；
        # 仅涉及目录链、自底向上非空即停、OSError 忽略（见 _cleanup_empty_dirs）；
        # FS 段入线程（R-03 / ql-20260818-009 范式）。
        if cleanup_dirs:
            removed_dirs = await asyncio.to_thread(
                self._cleanup_empty_dirs, spec_root, cleanup_dirs
            )
            if removed_dirs:
                log.info(
                    "spec_workspace.apply_ops_dirs_cleaned",
                    workspace_id=str(workspace_id),
                    removed_dirs=removed_dirs,
                )

        # task-05（design §5.3 / FR-03b）：quicklog pushed 行 apply 期对账。ops 含
        # quicklog/ 前缀路径时重解析镜像 quicklog/ 目录，文件集合中缺失 ql_id 的
        # pushed 行置 hidden=True（本地删除的 QUICKLOG 条目软隐藏，推送留底可回滚），
        # 文件重现的 hidden 行回翻 False。放在空目录清理之后（目录被清 → 重解析得
        # 空集合 → 全量隐藏，与磁盘终态一致）；异常仅告警不阻断同步主流程（对齐
        # 下方 reparse 触发容错范式，best-effort）。
        try:
            await self._reconcile_quicklog_hidden(workspace_id, ops, spec_root)
        except Exception as exc:
            log.warning(
                "spec_workspace.quicklog_reconcile_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

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
            # task-02（design §5.4/§11）：被 platform_deleted 墓碑拒绝的 add/rename
            # 路径（空列表=无拦截）。HTTP 响应模型暂不透出（task 约束：不改端点
            # 签名），service 层契约先行，供后续 CLI 感知接线。
            "platform_deleted": platform_deleted_paths,
        }

    async def _reconcile_quicklog_hidden(
        self,
        workspace_id: uuid.UUID,
        ops: list[FileOp],
        spec_root: Path,
    ) -> None:
        """quicklog pushed 行 apply 期对账（task-05 / design §5.3 / FR-03b）。

        仅当本次 ops 含 ``quicklog/`` 前缀路径时触发（R-03：不含时零触发零额外
        查询）；复用 ``parse_quicklog_directory`` 重解析**镜像 quicklog/ 目录**
        （自带 name+mtime 指纹缓存，不做整树扫描）取文件侧 ql_id 集合，与该
        workspace 的 ``QuicklogEntryORM`` pushed 行对账：

        - ql_id 不在文件集合 → ``hidden=True``（软隐藏不硬删——推送留底可回滚，
          design §15 Non-Goal；读侧 ``merge_entries`` 过滤，读改在本类之外）；
        - ql_id 回到文件集合且当前 ``hidden=True`` → 回翻 ``hidden=False``（文件
          重现即恢复）。

        apply 时点文件刚落镜像（CLI 推送条目与文件 ops 同拍到达），不存在合并期
        过滤方案的「文件同步滞后误杀刚推送条目」问题（design §5.3 方案 B 取舍）。
        调用方（apply_ops commit 后 best-effort 段）包 try/except，异常仅告警。
        """
        touched = any(
            p.replace("\\", "/").startswith(QUICKLOG_DIR_PREFIX)
            for op in ops
            for p in (op.path, op.new_path)
            if p
        )
        if not touched:
            return

        # ql-20260818-009 范式：FS stat/读段入线程（bind mount 上同步扫描卡循环）。
        entries = await asyncio.to_thread(parse_quicklog_directory, spec_root / "quicklog")
        file_ql_ids = {e.ql_id for e in entries}

        rows = (
            await self._session.execute(
                select(QuicklogEntryORM.ql_id, QuicklogEntryORM.hidden).where(
                    QuicklogEntryORM.workspace_id == workspace_id
                )
            )
        ).all()
        # 审计 A4（2026-08-29 合入后修复轮）：对账读改轻量列——原 SELECT 全
        # workspace QuicklogEntryORM 整实体（payload 裸存 CLI 六表结构化 JSON 的
        # 肥列），对账判定只需 ``ql_id``（集合差）与 ``hidden`` 当前值（是否要
        # 置位/回翻）。回写改两条按 ql_id IN 的批量 UPDATE（collect-then-update，
        # 不再依赖 ORM 实体脏标记），置位/回翻集合逻辑与原逐行判定逐字等价。
        now = datetime.now(UTC)
        to_hide = [ql_id for ql_id, hidden in rows if ql_id not in file_ql_ids and not hidden]
        to_restore = [ql_id for ql_id, hidden in rows if ql_id in file_ql_ids and hidden]
        hidden_count = len(to_hide)
        restored_count = len(to_restore)
        if to_hide:
            await self._session.execute(
                update(QuicklogEntryORM)
                .where(
                    QuicklogEntryORM.workspace_id == workspace_id,
                    QuicklogEntryORM.ql_id.in_(to_hide),
                )
                .values(hidden=True, updated_at=now)
            )
        if to_restore:
            await self._session.execute(
                update(QuicklogEntryORM)
                .where(
                    QuicklogEntryORM.workspace_id == workspace_id,
                    QuicklogEntryORM.ql_id.in_(to_restore),
                )
                .values(hidden=False, updated_at=now)
            )
        if hidden_count or restored_count:
            await self._session.commit()
            log.info(
                "spec_workspace.quicklog_reconciled",
                workspace_id=str(workspace_id),
                hidden=hidden_count,
                restored=restored_count,
                file_entries=len(file_ql_ids),
            )

    @staticmethod
    def _compute_reparse_scope(
        change_dirs: list[str],
        ops: list[FileOp],
    ) -> tuple[list[str] | None, bool]:
        """计算 change reparse 范围 → ``(scope, archive_hit)``。

        （change 2026-08-14-change-center-conversation-driven / D-005@v1；
        ql-20260818-009 收窄 archive_hit）：
        - 有标注（``change_dirs`` 非空）：取非归档 name 进 scoped 集；归档前缀
          （``changes/archive/<name>``）剥前缀取 name 同样进 scoped——标注不带
          op 类型，是否需要全量由下方 ops 扫描裁决。
        - 无标注（旧 daemon）：扫本次 ops 路径中 ``changes/`` 前缀者取 name 兜底。
        - **archive_hit 仅在 archive 路径的 op 是 delete/rename 时置位**
          （ql-20260818-009）：归档=目录跨根移动，只有 delete/rename 会改变磁盘
          变更树形状（scoped 零删除语义处理不了 → 全量 reparse，design §9 /
          R-08）；纯 add/update archive 文件（daemon 陈旧缓存重推已归档文件）
          不改树形状 → 走 scoped（parser 三区按 name 统一匹配，archive 区条目
          同样 create/update），不再触发全量重扫（2026-08-18 03:01Z spec-sync
          93s/82s 超 CLI 30s 超时根因②）。daemon 侧归档移动 hash 不变 → 恒发
          rename op（spec-sync.js rename 检测），真归档仍走全量；残余风险仅
          「归档同时改内容 → rename 退化为 delete+add」的陈旧行残留，留待下次
          全量/手动重扫收敛（与 scoped 零删除红线同哲学）。

        返回语义：
        - ``(None, True)``：全量 reparse（scope=None 含 delete）。
        - ``(scope, False)``：scoped reparse（scope 非空，零 delete）。
        - ``(None, False)``：无 changes 相关路径，**零触发**（R-01）。
        """

        def _archive_name(norm: str) -> str | None:
            """``changes/archive/<name>/…`` → name；恰为 ``changes/archive`` → ""；非归档 → None。"""
            if norm.startswith("changes/archive/"):
                return norm[len("changes/archive/") :].split("/", 1)[0]
            if norm == "changes/archive":
                return ""
            return None

        names: list[str] = []
        archive_hit = False

        for cd in change_dirs:
            norm = str(cd).replace("\\", "/")
            if not norm:
                continue
            seg = _archive_name(norm)
            if seg is not None:
                # 归档前缀标注：剥前缀取 name 进 scoped（是否全量由 ops 扫描裁决）
                if seg:
                    names.append(seg)
                continue
            if norm.startswith("changes/"):
                rest = norm[len("changes/") :]
                if rest:
                    first = rest.split("/", 1)[0]
                    if first:
                        names.append(first)
            else:
                # 纯 name 形式（daemon task-01 传 changes/<name>/ 分组的 key）
                names.append(norm)

        for op in ops:
            # ql-20260818-009：仅 delete/rename（改变磁盘变更树形状）命中 archive
            # 路径才要求全量；add/update 一律 scoped。
            tree_shape_op = op.op in ("delete", "rename")
            for path in (op.path, op.new_path):
                if not path:
                    continue
                norm = path.replace("\\", "/")
                seg = _archive_name(norm)
                if seg is not None:
                    if not seg or tree_shape_op:
                        # 无名字段（恰为 changes/archive 根，理论不可达）或跨根移动 → 全量
                        archive_hit = True
                    else:
                        names.append(seg)
                    continue
                if norm.startswith("changes/"):
                    rest = norm[len("changes/") :]
                    if rest:
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
