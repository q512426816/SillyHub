"""soft_delete_change_dir 镜像目录软删测试。

Change 2026-08-29-change-delete-closure-and-spec-pull task-06（design §6.1 步骤① /
FR-05b / D-002@v1）：

- 活跃区前缀 ``changes/{name}/``：现存文件逐个移入 ``spec-backups/{ws}/{ts}/<rel>``
  （move 软删），manifest 行三标记（``exists=False`` / ``version+1`` /
  ``platform_deleted=True``），变更目录链自底向上 rmdir；
- 归档区前缀 ``changes/archive/{name}/`` 同理可删（location='archive'）；
- 前缀精确性：变更名含 ``_``（my_change）不误伤相似名（myXchange，未转义 LIKE 的
  ``_`` 通配恰会匹配 X）与前缀延长名（my_change_extra）；
- 既有 ``exists=False`` 行只补 ``platform_deleted=True``（前缀级墓碑完整性），
  不 move 不 version+1；
- 零文件幂等（file_count=0 不抛）；
- CLI 墓碑写路径接线（platform_sync ``_apply_cli_tombstone`` 后置调用）触发本方法
  收敛镜像（design §5.5 / §6）。

直接调 service 级方法（对齐 test_platform_deleted_guard.py / test_full_sync_
convergence.py 范式），断言真实磁盘副作用（备份区文件 / 目录消失）+ manifest 行状态。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import (
    BACKUP_TS_FORMAT,
    SPEC_BACKUP_RETENTION_DAYS,
    SpecWorkspaceService,
    _reset_prune_throttle,
)
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_platform_deleted_guard.py 范式）
# ---------------------------------------------------------------------------


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> FileOp:
    return FileOp(op=op, path=path, base_version=base_version, **extra)


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"soft-del-{uuid.uuid4().hex[:8]}",
        slug=f"sd-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/soft-del-{uuid.uuid4().hex[:8]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(db_session, workspace: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


async def _manifest_rows(db_session, ws_id: uuid.UUID) -> dict[str, SpecFileManifest]:
    return {
        r.path: r
        for r in (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws_id)
                )
            )
            .scalars()
            .all()
        )
    }


def _progress(name: str, *, status: str = "in_progress") -> dict:
    """serializeForSync 六表 body（changes[0] 同名条目，供墓碑检测取值）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": name, "current_stage": "execute", "status": status, "title": name}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


# ===========================================================================
# ① 活跃区：文件移入备份区 + manifest 三标记 + 空目录清理
# ===========================================================================


class TestSoftDeleteActiveChange:
    async def test_moves_files_marks_manifest_cleans_dir(self, db_session, tmp_path) -> None:
        """现存文件移备份区、行置三标记、变更目录消失；无关目录零触碰。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/my_change/proposal.md", "p"),
            ("changes/my_change/tasks/task-01.md", "t"),
            ("changes/other_change/keep.md", "keep"),
            ("docs/readme.md", "docs"),
        ):
            result = await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])
            assert result["conflict"] is False, result

        result = await svc.soft_delete_change_dir(ws.id, "my_change")

        assert result["file_count"] == 2
        backup_dir = Path(str(result["backup_dir"]))
        assert (backup_dir / "changes" / "my_change" / "proposal.md").read_text(
            encoding="utf-8"
        ) == "p"
        assert (backup_dir / "changes" / "my_change" / "tasks" / "task-01.md").read_text(
            encoding="utf-8"
        ) == "t"

        rows = await _manifest_rows(db_session, ws.id)
        for p in ("changes/my_change/proposal.md", "changes/my_change/tasks/task-01.md"):
            assert rows[p].exists is False
            assert rows[p].platform_deleted is True
            assert rows[p].version == 2  # add=1 → 软删 +1
        # 无关目录零触碰
        assert rows["changes/other_change/keep.md"].exists is True
        assert rows["changes/other_change/keep.md"].platform_deleted is False
        assert rows["docs/readme.md"].platform_deleted is False

        # 变更目录（含子目录）从镜像消失；同根其它变更目录保留
        assert not (spec_root / "changes" / "my_change").exists()
        assert (spec_root / "changes" / "other_change" / "keep.md").exists()
        assert (spec_root / "docs" / "readme.md").exists()

    async def test_soft_delete_bumps_spec_version(self, db_session, tmp_path) -> None:
        """ql-20260905-001：镜像树已变（文件移出 + 墓碑）→ bump spec_version。

        不 bump 则 gzip bundle 缓存键 (ws, spec_version) 不变，恒吐软删前的
        旧树；lease latest_spec_version 不变，他机也不重拉。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_ws = await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        await svc.apply_ops(ws.id, [_op("add", "changes/gone/proposal.md", content=_b64("p"))])
        base_version = int(spec_ws.spec_version or 0)

        await svc.soft_delete_change_dir(ws.id, "gone")

        await db_session.refresh(spec_ws)
        assert int(spec_ws.spec_version or 0) == base_version + 1

    async def test_pre_existing_soft_deleted_row_only_strengthened(
        self, db_session, tmp_path
    ) -> None:
        """前缀内既有 exists=False 行（增量协议软删过）只补 platform_deleted=True，
        不 move 不 version+1（前缀级墓碑完整性，防行缺失时兜底锚点漏判）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        await svc.apply_ops(ws.id, [_op("add", "changes/mixed/a.md", content=_b64("a"))])
        await svc.apply_ops(ws.id, [_op("add", "changes/mixed/stale.md", content=_b64("s"))])
        # 增量 delete：stale.md → exists=False（platform_deleted=False）
        await svc.apply_ops(ws.id, [_op("delete", "changes/mixed/stale.md", base_version=1)])

        result = await svc.soft_delete_change_dir(ws.id, "mixed")

        assert result["file_count"] == 1  # 只搬现存 a.md
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/mixed/a.md"].exists is False
        assert rows["changes/mixed/a.md"].platform_deleted is True
        assert rows["changes/mixed/a.md"].version == 2
        # stale.md：既有软删行——补墓碑标记、version 不动（无 op 应用）
        assert rows["changes/mixed/stale.md"].exists is False
        assert rows["changes/mixed/stale.md"].platform_deleted is True
        assert rows["changes/mixed/stale.md"].version == 2
        assert not (spec_root / "changes" / "mixed").exists()


# ===========================================================================
# ② 前缀精确性（含下划线变更名不漏不误伤）
# ===========================================================================


class TestPrefixPrecision:
    async def test_underscore_name_no_false_match(self, db_session, tmp_path) -> None:
        """删 my_change：myXchange（未转义 LIKE ``_`` 通配会误配）与前缀延长名
        my_change_extra 均零触碰。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/my_change/a.md", "a"),
            ("changes/myXchange/b.md", "b"),
            ("changes/my_change_extra/c.md", "c"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.soft_delete_change_dir(ws.id, "my_change")

        assert result["file_count"] == 1
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/my_change/a.md"].platform_deleted is True
        for untouched in ("changes/myXchange/b.md", "changes/my_change_extra/c.md"):
            assert rows[untouched].platform_deleted is False
            assert rows[untouched].exists is True
        assert (spec_root / "changes" / "myXchange" / "b.md").exists()
        assert (spec_root / "changes" / "my_change_extra" / "c.md").exists()


# ===========================================================================
# ③ 归档区：location='archive' → changes/archive/{name}/ 前缀
# ===========================================================================


class TestSoftDeleteArchivedChange:
    async def test_archive_prefix_deleted(self, db_session, tmp_path) -> None:
        """归档区行删除走三段前缀，同样落三标记 + 清目录；活跃区同名变更不受牵连。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/archive/gone_change/x.md", "x"),
            ("changes/archive/live_change/y.md", "y"),
            ("changes/gone_change/z.md", "z"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.soft_delete_change_dir(ws.id, "gone_change", location="archive")

        assert result["file_count"] == 1
        backup_dir = Path(str(result["backup_dir"]))
        assert (backup_dir / "changes" / "archive" / "gone_change" / "x.md").read_text(
            encoding="utf-8"
        ) == "x"

        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/archive/gone_change/x.md"].exists is False
        assert rows["changes/archive/gone_change/x.md"].platform_deleted is True
        assert rows["changes/archive/gone_change/x.md"].version == 2
        # 归档区其它变更 + 活跃区同名变更零触碰
        assert rows["changes/archive/live_change/y.md"].platform_deleted is False
        assert rows["changes/gone_change/z.md"].platform_deleted is False
        assert rows["changes/gone_change/z.md"].exists is True

        assert not (spec_root / "changes" / "archive" / "gone_change").exists()
        assert (spec_root / "changes" / "archive" / "live_change" / "y.md").exists()
        assert (spec_root / "changes" / "gone_change" / "z.md").exists()


# ===========================================================================
# ④ 零文件幂等
# ===========================================================================


class TestZeroFileIdempotent:
    async def test_no_manifest_rows_returns_zero(self, db_session, tmp_path) -> None:
        """前缀下无任何 manifest 行 → file_count=0 不抛（幂等）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        await svc.apply_ops(ws.id, [_op("add", "changes/live/a.md", content=_b64("a"))])

        result = await svc.soft_delete_change_dir(ws.id, "never_existed")

        assert result["file_count"] == 0
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/live/a.md"].platform_deleted is False
        assert (spec_root / "changes" / "live" / "a.md").exists()


# ===========================================================================
# ⑤ CLI 墓碑写路径接线（platform_sync _apply_cli_tombstone → 本方法收敛镜像）
# ===========================================================================


class TestCliTombstoneWiring:
    async def test_tombstone_upsert_converges_mirror(self, db_session, tmp_path) -> None:
        """progress 上行 status='deleted'（task-04 墓碑）→ 镜像被 soft_delete_change_dir
        同步收敛：Change.location='deleted' + 文件入备份区 + manifest 三标记。"""
        from app.modules.change.model import Change
        from app.modules.platform_sync.service import PlatformSyncService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        for path, text in (
            ("changes/tomb_change/proposal.md", "p"),
            ("changes/tomb_change/tasks/task-01.md", "t"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        # ql-20260909-021：apply_ops 自动触发的后台 reparse 先排空——防与下方墓碑
        # 收敛（soft_delete_change_dir）并发互踩（并行跑下偶发 flaky）。
        from app.modules.spec_workspace.service import drain_reparse_workers

        await drain_reparse_workers()

        result = await PlatformSyncService(db_session).upsert_progress(
            ws.id,
            "tomb_change",
            _progress("tomb_change", status="deleted"),
            base_ts=None,
            pushed_at="2026-08-29T09:00:00.000Z",
            user="cli-user",
        )
        assert result.change_deleted is False

        change = (
            (
                await db_session.execute(
                    select(Change).where(
                        Change.workspace_id == ws.id,
                        Change.change_key == "tomb_change",
                    )
                )
            )
            .scalars()
            .one_or_none()
        )
        assert change is not None
        assert change.location == "deleted"

        rows = await _manifest_rows(db_session, ws.id)
        for p in ("changes/tomb_change/proposal.md", "changes/tomb_change/tasks/task-01.md"):
            assert rows[p].exists is False
            assert rows[p].platform_deleted is True
        assert not (spec_root / "changes" / "tomb_change").exists()
        # 备份区有文件（收敛真实发生，非仅置位）——备份区根与 spec_root 是兄弟
        # 目录：{spec_data_root}/spec-backups/{ws}（_backup_root，D-008）。
        from app.core.config import get_settings

        backup_parent = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        moved = [p for p in backup_parent.rglob("proposal.md")]
        assert moved and moved[0].read_text(encoding="utf-8") == "p"


# ===========================================================================
# ⑥ apply_ops 备份批次化（ql-20260924 备份扫描风暴修复）
# ===========================================================================


class TestApplyOpsBatchBackup:
    """apply_ops 增量 delete：备份时间戳目录批次共享 + 修剪移出 op 循环。

    2026-09-24 生产 OOM：``ts`` 生成写在 delete 分支内（每 op 一个微秒目录）+
    ``_prune_spec_backups`` 每 op 全量扫描备份区（线上堆积 3.5 万目录），delete
    重放风暴下二者互相喂养——CPU/GIL/内存三重压力，event_loop.blocked 达 5.7s，
    RSS 涨至 mem_limit 被 oom-kill（137），Docker 自动拉起成 40 分钟一轮循环。
    本组锁死两个结构性修复：单次 apply_ops 共享一个 ts 目录、修剪每批至多一次。
    """

    async def test_multiple_deletes_share_one_backup_ts_dir(self, db_session, tmp_path) -> None:
        """单次 apply_ops 删 N 个文件 → 备份区只落 **一个** ts 目录（N 个则回退）。

        旧实现 ts 在 delete 分支内按 op 生成（``%f`` 微秒永不重名），批量删 N 个
        文件造 N 个时间戳目录，实测堆积 34975+15450 个、单次重放 3021 个。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        paths = [f"changes/batch/f{i}.md" for i in range(5)]
        for p in paths:
            result = await svc.apply_ops(ws.id, [_op("add", p, content=_b64("x"))])
            assert result["conflict"] is False, result

        result = await svc.apply_ops(
            ws.id,
            [_op("delete", p, base_version=1) for p in paths],
        )

        assert result["conflict"] is False, result
        from app.core.config import get_settings

        backup_parent = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        ts_dirs = [d for d in backup_parent.iterdir() if d.is_dir()]
        assert len(ts_dirs) == 1, f"批次应共享一个 ts 目录，实得 {len(ts_dirs)}: {ts_dirs}"
        # 五个文件都落在同一批次目录下，路径层级与原 op.path 一致
        for p in paths:
            assert (ts_dirs[0] / p).exists(), f"{p} 未落备份区"

    async def test_prune_called_once_per_batch_not_per_op(
        self, db_session, tmp_path, monkeypatch
    ) -> None:
        """单次 apply_ops 删 N 个文件 → ``_prune_spec_backups`` 至多调一次（非 N 次）。

        旧实现每 delete op 调一次全量扫描（N op × 3.5 万目录 = 扫描风暴）。
        以 spy 计数锁定调用次数；阈值 >1 即回退。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        paths = [f"changes/prune/f{i}.md" for i in range(4)]
        for p in paths:
            await svc.apply_ops(ws.id, [_op("add", p, content=_b64("x"))])

        calls: list[Path] = []
        original = SpecWorkspaceService._prune_spec_backups

        def _spy(backup_root: Path) -> None:
            calls.append(backup_root)
            return original(backup_root)

        # 原方法是 @staticmethod；monkeypatch 换上的普通函数会经实例访问被当作
        # 绑定方法（多收一个 self），须包回 staticmethod 才与原调用形态一致。
        monkeypatch.setattr(SpecWorkspaceService, "_prune_spec_backups", staticmethod(_spy))

        await svc.apply_ops(
            ws.id,
            [_op("delete", p, base_version=1) for p in paths],
        )

        assert len(calls) <= 1, f"每批至多修剪一次，实调 {len(calls)} 次"


# ===========================================================================
# ⑦ _prune_spec_backups 行为：只删过期目录 / 非时间戳跳过 / 节流
# ===========================================================================


class TestPruneSpecBackups:
    def test_deletes_only_dirs_older_than_retention(self, tmp_path) -> None:
        """只 rmtree 早于 30 天的可解析时间戳目录；新鲜的与非时间戳目录零触碰。"""
        old_ts = (datetime.now(UTC) - timedelta(days=SPEC_BACKUP_RETENTION_DAYS + 1)).strftime(
            BACKUP_TS_FORMAT
        )
        fresh_ts = datetime.now(UTC).strftime(BACKUP_TS_FORMAT)
        (tmp_path / old_ts).mkdir()
        (tmp_path / old_ts / "file.md").write_text("old", encoding="utf-8")
        (tmp_path / fresh_ts).mkdir()
        (tmp_path / "not-a-timestamp").mkdir()
        (tmp_path / "not-a-timestamp" / "file.md").write_text("keep", encoding="utf-8")

        SpecWorkspaceService._prune_spec_backups(tmp_path)

        assert not (tmp_path / old_ts).exists(), "过期目录应被删"
        assert (tmp_path / fresh_ts).exists(), "新鲜目录必须保留"
        assert (tmp_path / "not-a-timestamp" / "file.md").exists(), "非时间戳目录必须保留"

    def test_throttled_second_call_is_noop(self, tmp_path, monkeypatch) -> None:
        """节流：同一 backup_root 在冷却窗口内二次调用直接返回（不重扫目录）。

        锁死 ql-20260924 修复的第三层防护——即便上游仍高频触发，扫描频率也被
        冷却窗口封顶（线上 delete 重放 ~5 次/秒，不节流则每批仍触发全量扫）。
        """
        old_ts = (datetime.now(UTC) - timedelta(days=SPEC_BACKUP_RETENTION_DAYS + 1)).strftime(
            BACKUP_TS_FORMAT
        )
        (tmp_path / old_ts).mkdir()
        (tmp_path / old_ts / "first.md").write_text("1", encoding="utf-8")

        scans: list[Path] = []
        real_scandir = os.scandir

        def _counting_scandir(path):
            # 只统计对 backup_root 本级的扫描：rmtree 内部也会 scandir 子目录，
            # 那些不是「全量列举备份区」的那一次。
            if Path(path) == tmp_path:
                scans.append(Path(path))
            return real_scandir(path)

        monkeypatch.setattr(os, "scandir", _counting_scandir)
        _reset_prune_throttle()  # 隔离上一用例的进程级节流态

        SpecWorkspaceService._prune_spec_backups(tmp_path)
        assert len(scans) == 1, "首次调用应执行一次扫描"
        assert not (tmp_path / old_ts).exists()

        # 冷却窗口内二次调用：不再扫描（即使又冒出新的过期目录）
        newer_old_ts = (
            datetime.now(UTC) - timedelta(days=SPEC_BACKUP_RETENTION_DAYS + 2)
        ).strftime(BACKUP_TS_FORMAT)
        (tmp_path / newer_old_ts).mkdir()
        SpecWorkspaceService._prune_spec_backups(tmp_path)

        assert len(scans) == 1, f"冷却窗口内不应重复扫描，实扫 {len(scans)} 次"
        assert (tmp_path / newer_old_ts).exists(), "冷却窗口内保留是预期（机会式修剪）"

    def test_missing_backup_root_is_noop(self, tmp_path) -> None:
        """备份区目录不存在（首次软删前）→ FileNotFound 容错静默返回，不抛。"""
        _reset_prune_throttle()
        SpecWorkspaceService._prune_spec_backups(tmp_path / "does-not-exist")  # 不抛即通过


# Suppress unused-import warning for pytest (fixture discovery).
# 模块级 asyncio 标记：本文件绝大多数用例是 async（走 db_session fixture）；
# ``TestPruneSpecBackups`` 三个纯同步用例（直调静态方法）会被此标记覆盖成
# 「非 async 函数」告警——显式过滤该告警，保留 async 默认。
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.filterwarnings("ignore:.*marked with.*but it is not an async function.*"),
]
