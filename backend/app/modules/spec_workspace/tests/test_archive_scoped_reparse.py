"""归档 scoped 定向重扫 + 双通道调度测试（2026-10-27-archive-reparse-oom-governance
task-07 / FR-01..05）。

生产背景（2026-10-27 六会话同窗归档 OOM）：旧口径归档移动 → archive_hit 全量
reparse（遍历 ~470 变更树），并行叠加顶爆 2500m memcg。本文件锁定新语义：

- FR-01 归档 op → scoped（非全量）+ structural；归档后行 location 经 scoped
  reparse 原地翻转（active→archive），scope 外行零动作；
- FR-01/D-007 双通道：structural 绕过 120s 节流窗立即执行；非结构维持节流
  + 尾随合并（既有语义零回归）；
- D-010 structural 撞在途 reparse：完成回调即时补发（不等满 120s 窗）；
- FR-03/D-009/D-011 bundle gzip 同版本并发只构建一次；构建方断连失败传播，
  等待者降级自建不悬挂；
- FR-04/D-008 漂移探针只读只告警（不触发 reparse）；水位无 cgroup 环境静默。

author: qinyi
created_at: 2026-10-27
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.spec_workspace.service as sw_service
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import (
    SpecWorkspaceService,
    drain_reparse_workers,
)
from app.modules.workspace.model import Workspace


def _op(op: str, path: str, new_path: str | None = None) -> FileOp:
    return FileOp(op=op, path=path, new_path=new_path, base_version=0)


@pytest.fixture()
def bg_reparse(monkeypatch: pytest.MonkeyPatch) -> None:
    """后台调度模式（覆盖 conftest inline 直通）+ 清模块级调度状态。"""
    monkeypatch.setattr(sw_service, "_REPARSE_INLINE", False)
    sw_service.reset_reparse_scheduler()


# ── FR-01：scope 计算（纯函数，无 IO）────────────────────────────────────


class TestComputeReparseScope:
    def test_archive_rename_is_scoped_structural_not_full(self) -> None:
        """归档移动（跨根 rename）→ scoped=[name] + structural，不再全量。"""
        svc = SpecWorkspaceService(None)
        scope, archive_hit, structural = svc._compute_reparse_scope(
            [],
            [_op("rename", "changes/x/design.md", "changes/archive/x/design.md")],
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is True

    def test_archive_delete_is_scoped_structural(self) -> None:
        scope, archive_hit, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("delete", "changes/archive/x/tasks.md")]
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is True

    def test_archive_add_update_scoped_non_structural(self) -> None:
        """归档区 add/update（daemon 陈旧缓存重推）→ scoped 非结构（旧语义）。"""
        scope, archive_hit, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("add", "changes/archive/x/new-file.md")]
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is False

    def test_active_delete_is_structural(self) -> None:
        """活跃区 delete（平台删除/目录消失）→ scoped + structural。"""
        scope, archive_hit, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("delete", "changes/x/requirements.md")]
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is True

    def test_plain_update_scoped_non_structural(self) -> None:
        """普通文档推送 → scoped 非结构（维持 120s 合并窗口径）。"""
        scope, archive_hit, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("update", "changes/x/design.md")]
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is False

    def test_same_root_rename_non_structural(self) -> None:
        """同根文件 rename（变更目录内文件改名）→ 非结构。"""
        scope, _, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("rename", "changes/x/a.md", "changes/x/b.md")]
        )
        assert scope == ["x"]
        assert structural is False

    def test_archive_root_op_keeps_full_fallback(self) -> None:
        """恰命中 changes/archive 根（无名可解析）→ 保留全量兜底。"""
        scope, archive_hit, _ = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("delete", "changes/archive")]
        )
        assert archive_hit is True
        assert scope is None

    def test_unarchive_rename_structural(self) -> None:
        """un-archive（归档区 → 活跃区跨根 rename）→ scoped + structural。"""
        scope, archive_hit, structural = SpecWorkspaceService(None)._compute_reparse_scope(
            [], [_op("rename", "changes/archive/x/design.md", "changes/x/design.md")]
        )
        assert archive_hit is False
        assert scope == ["x"]
        assert structural is True


# ── FR-01/D-007：双通道调度（真实 reparse 打桩计数）─────────────────────


async def _trigger_ops(ws: uuid.UUID, ops: list[FileOp]) -> None:
    await SpecWorkspaceService(None)._trigger_change_reparse(ws, [], ops)


async def test_structural_bypasses_throttle_window(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, bg_reparse: None
) -> None:
    """节流窗内（设超大窗）structural 触发仍立即执行；非结构维持跳过。"""
    monkeypatch.setattr(sw_service, "_REPARSE_MIN_INTERVAL_SECONDS", 3600.0)
    scopes: list[list[str] | None] = []

    async def fake_reparse(self, workspace_id, scope=None):
        scopes.append(scope)
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", fake_reparse)
    ws = uuid.uuid4()

    # 窗基线：一次普通触发跑掉首额
    await _trigger_ops(ws, [_op("update", "changes/x/design.md")])
    await drain_reparse_workers()
    assert len(scopes) == 1

    # 巨窗内：非结构触发被节流（不执行）
    await _trigger_ops(ws, [_op("update", "changes/y/design.md")])
    await asyncio.sleep(0)
    assert len(scopes) == 1

    # 巨窗内：结构触发（归档移动）绕窗立即执行——FR-01 ≤60s 承诺的调度面
    await _trigger_ops(ws, [_op("rename", "changes/x/design.md", "changes/archive/x/design.md")])
    await drain_reparse_workers()
    assert len(scopes) == 2
    assert scopes[1] == ["x"]


async def test_structural_inflight_completes_via_callback_not_window(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, bg_reparse: None
) -> None:
    """D-010：structural 撞在途 reparse → 完成回调即时补发（不等 120s 窗）。"""
    monkeypatch.setattr(sw_service, "_REPARSE_MIN_INTERVAL_SECONDS", 3600.0)
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[list[str] | None] = []

    async def slow_reparse(self, workspace_id, scope=None):
        calls.append(scope)
        started.set()
        await release.wait()
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", slow_reparse)
    ws = uuid.uuid4()

    # 首发普通触发占住 inflight
    await _trigger_ops(ws, [_op("update", "changes/x/design.md")])
    await started.wait()

    # 在途期间 structural 触发到达（巨窗下非结构会睡满窗，structural 不该）
    await _trigger_ops(ws, [_op("rename", "changes/x/design.md", "changes/archive/x/design.md")])
    await asyncio.sleep(0)
    assert len(calls) == 1  # single-flight：未并发
    assert ws in sw_service._reparse_structural_pending  # 登记待补发

    # 在途完成 → 回调即时补发（drain 排空即达，无需 sleep 满窗）
    release.set()
    await drain_reparse_workers()
    assert len(calls) == 2
    assert calls[1] == ["x"]
    assert ws not in sw_service._reparse_structural_pending


async def test_non_structural_inflight_keeps_trailing_timer(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, bg_reparse: None
) -> None:
    """非结构撞在途：维持 120s 尾随定时器语义（不进 structural 回调通道）。"""
    monkeypatch.setattr(sw_service, "_REPARSE_MIN_INTERVAL_SECONDS", 0.05)
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_reparse(self, workspace_id, scope=None):
        started.set()
        await release.wait()
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", slow_reparse)
    ws = uuid.uuid4()
    await _trigger_ops(ws, [_op("update", "changes/x/design.md")])
    await started.wait()

    await _trigger_ops(ws, [_op("update", "changes/y/design.md")])
    await asyncio.sleep(0)
    assert ws not in sw_service._reparse_structural_pending  # 未走结构通道
    assert ws in sw_service._reparse_pending  # 走既有尾随合并

    release.set()
    await drain_reparse_workers()
    assert ws not in sw_service._reparse_pending


# ── FR-01 主路径：scoped reparse 翻转归档行（真解析器 + 真库）───────────


async def _make_ws_with_spec_root(db_session: AsyncSession, tmp_path: Path) -> uuid.UUID:
    from app.modules.spec_workspace.model import SpecWorkspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="archive-scoped ws",
        slug=f"as-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
        component_key=None,
    )
    db_session.add(ws)
    await db_session.flush()
    spec_root = tmp_path / "spec"
    spec_root.mkdir(parents=True, exist_ok=True)
    (spec_root / "changes" / "archive").mkdir(parents=True, exist_ok=True)
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()
    return ws.id


async def test_scoped_reparse_flips_row_location_on_archive(
    db_session: AsyncSession, tmp_path: Path
) -> None:
    """归档目录在场 + 行 location=active → scoped reparse 原地翻 archive；
    scope 外行零动作（R-08 零删除红线同源语义）。"""
    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService

    ws_id = await _make_ws_with_spec_root(db_session, tmp_path)
    spec_root = tmp_path / "spec"

    def _row(key: str, location: str) -> Change:
        return Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=key,
            title=key,
            location=location,
            path=f"changes/{key}",
            status="draft",
        )

    archived_key, bystander_key = "2026-10-27-x", "2026-10-27-bystander"
    # 磁盘：x 已在归档区（目录级移动后形态）；bystander 在活跃区。
    x_dir = spec_root / "changes" / "archive" / archived_key
    x_dir.mkdir(parents=True)
    (x_dir / "tasks.md").write_text("# t\n- [ ] a\n", encoding="utf-8")
    (x_dir / "design.md").write_text("# d\n", encoding="utf-8")
    b_dir = spec_root / "changes" / bystander_key
    b_dir.mkdir(parents=True)
    (b_dir / "tasks.md").write_text("# t\n- [ ] b\n", encoding="utf-8")

    db_session.add(_row(archived_key, "active"))
    db_session.add(_row(bystander_key, "active"))
    await db_session.commit()

    await ChangeService(db_session).reparse(ws_id, scope=[archived_key])

    from sqlalchemy import select

    rows = {
        r.change_key: r
        for r in (
            await db_session.execute(select(Change).where(Change.workspace_id == ws_id))
        ).scalars()
    }
    assert rows[archived_key].location == "archive"  # 原地翻转（非删重建）
    assert rows[bystander_key].location == "active"  # scope 外零动作


# ── FR-03/D-009/D-011：bundle gzip 同版本 single-flight───────────────────


def _consume(stream) -> bytes:
    buf = bytearray()
    for chunk in stream:
        buf.extend(chunk)
    return bytes(buf)


async def test_bundle_same_version_single_flight_builds_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """同 (ws, version) 并发两请求：只产生一次底层构建，等待者复用同产物。"""
    from app.modules.spec_workspace.service import _bundle_gzip_inflight

    builds: list[int] = []
    real_stream = sw_service._BundleTarStream

    class CountingStream(real_stream):  # type: ignore[misc, valid-type]
        def __init__(self, produce):
            builds.append(1)
            super().__init__(produce)

    monkeypatch.setattr(sw_service, "_BundleTarStream", CountingStream)
    sw_service._bundle_gzip_cache.clear()
    _bundle_gzip_inflight.clear()

    produce_calls: list[int] = []

    def _produce(writer) -> None:
        produce_calls.append(1)
        import io as _io
        import tarfile as _tarfile

        with _tarfile.open(fileobj=writer, mode="w|gz", bufsize=64 * 1024) as tar:
            info = _tarfile.TarInfo(name="a.txt")
            payload = b"hello-bundle"
            info.size = len(payload)
            tar.addfile(info, _io.BytesIO(payload))

    key = (uuid.uuid4(), 1)
    entry = sw_service._BundleInflightEntry()
    _bundle_gzip_inflight[key] = entry
    builder = sw_service._CachingBundleIterator(CountingStream(_produce), key, entry=entry)
    waiter = sw_service._WaitingBundleStream(entry, _produce, key)

    data_builder: bytes = b""
    data_waiter: bytes = b""

    def _run_builder():
        nonlocal data_builder
        data_builder = _consume(builder)

    import threading

    t = threading.Thread(target=_run_builder)
    t.start()
    # 等待方在另一线程消费（重放构建方产物）。
    t.join(timeout=30)
    data_waiter = _consume(waiter)

    assert data_builder and data_waiter == data_builder  # 等待者复用同产物
    assert len(builds) == 1  # 底层构建只发生一次（D-009）
    assert entry.data is not None and not entry.failed
    _bundle_gzip_inflight.clear()


def test_bundle_waiter_degrades_on_builder_abort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-011：构建方半途关闭（断连）→ entry 失败传播，等待者降级自建不悬挂。"""
    from app.modules.spec_workspace.service import _bundle_gzip_inflight

    monkeypatch.setattr(sw_service, "_BUNDLE_INFLIGHT_WAIT_SECONDS", 2.0)
    sw_service._bundle_gzip_cache.clear()
    _bundle_gzip_inflight.clear()

    def _produce(writer) -> None:
        import io as _io
        import tarfile as _tarfile

        with _tarfile.open(fileobj=writer, mode="w|gz", bufsize=64 * 1024) as tar:
            info = _tarfile.TarInfo(name="a.txt")
            payload = b"degraded-build"
            info.size = len(payload)
            tar.addfile(info, _io.BytesIO(payload))

    key = (uuid.uuid4(), 2)
    entry = sw_service._BundleInflightEntry()
    _bundle_gzip_inflight[key] = entry
    builder = sw_service._CachingBundleIterator(
        sw_service._BundleTarStream(_produce), key, entry=entry
    )
    it = iter(builder)
    next(it)  # 拉一块（进入生成器）
    builder.close()  # 构建方断连：close 未完成 → 失败传播

    assert entry.failed is True
    assert entry.event.is_set()

    waiter = sw_service._WaitingBundleStream(entry, _produce, key)
    data = _consume(waiter)  # 降级自建：能拿到完整产物，不悬挂
    assert data
    _bundle_gzip_inflight.clear()


# ── FR-04/D-008：探针只读只告警─────────────────────────────────────────


async def test_drift_probe_readonly_warns_never_reparses(
    db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """行 location 与磁盘不一致 → 探针仅告警计数；ChangeService.reparse 禁止被调。"""
    from app.modules.change.model import Change
    from app.modules.spec_workspace.drift_probe import check_drift_once

    ws_id = await _make_ws_with_spec_root(db_session, tmp_path)
    spec_root = tmp_path / "spec"
    # 磁盘：active 行的目录不在场（漂移）；archive 行的归档目录在场（一致）。
    ok_dir = spec_root / "changes" / "archive" / "ok-archived"
    ok_dir.mkdir(parents=True)

    db_session.add_all(
        [
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key="drifted-active",
                title="d",
                location="active",
                path="changes/drifted-active",
                status="draft",
            ),
            Change(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                change_key="ok-archived",
                title="o",
                location="archive",
                path="changes/archive/ok-archived",
                status="draft",
            ),
        ]
    )
    await db_session.commit()

    reparse_called = []

    async def _must_not_run(self, workspace_id, scope=None):
        reparse_called.append(scope)
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", _must_not_run)

    drifts = await check_drift_once(db_session)
    assert drifts == 1  # 仅 drifted-active 告警
    assert reparse_called == []  # D-008：探针零写零 reparse


def test_watermark_silent_without_cgroup(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """无 cgroup 环境（本地 dev/Windows）：返回 None 不抛错（R-05）。"""
    from app.modules.spec_workspace import drift_probe

    monkeypatch.setattr(drift_probe, "_CGROUP_CURRENT_FILES", ("/nonexistent/current",))
    monkeypatch.setattr(drift_probe, "_CGROUP_LIMIT_FILES", ("/nonexistent/limit",))
    assert drift_probe.log_memory_watermark() is None
