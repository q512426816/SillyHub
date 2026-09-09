"""reparse 调度器三件套行为测试（ql-20260909-021-3d99）。

生产实证（2026-09-09 阿里云 4 小时全站超时）：push 路径同步 await reparse +
无节流，agent 长会话 60-90s 一次 push 每次全跑 → 恶性循环。本测试锁定调度
语义（真实 reparse 不跑，monkeypatch ChangeService.reparse 计数）：

- 首次触发：立即后台执行一次；
- 节流窗内再次触发：跳过（不执行），登记尾随；
- 窗到点：尾随补发一次（合并的累积输入）；
- single-flight：上次未完成时新触发跳过并登记尾随；
- 不同 workspace 互不干扰。
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.spec_workspace.service as sw_service
from app.modules.spec_workspace.service import (
    SpecWorkspaceService,
    drain_reparse_workers,
)


@pytest.fixture()
def fast_throttle(monkeypatch: pytest.MonkeyPatch) -> float:
    """节流窗缩到 0.05s（测试可控）+ 清模块级调度状态。"""
    monkeypatch.setattr(sw_service, "_REPARSE_MIN_INTERVAL_SECONDS", 0.05)
    # 本文件专测后台调度语义：覆盖 conftest 的 inline 直通，恢复生产模式。
    monkeypatch.setattr(sw_service, "_REPARSE_INLINE", False)
    sw_service.reset_reparse_scheduler()
    return 0.05


async def _trigger(ws: uuid.UUID, change_dir: str) -> None:
    """走调度入口（scope 命中 changes/ 前缀）。"""
    await SpecWorkspaceService(None)._trigger_change_reparse(
        ws,
        [change_dir],
        [],
    )


async def test_first_trigger_runs_once_and_throttle_skips(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, fast_throttle: float
) -> None:
    calls: list[tuple[uuid.UUID, list[str] | None]] = []

    async def fake_reparse(self, workspace_id, scope=None):
        calls.append((workspace_id, scope))
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", fake_reparse)
    ws = uuid.uuid4()
    await _trigger(ws, "2026-09-09-a")
    await drain_reparse_workers()
    assert len(calls) == 1

    # 窗内再触发两次：均跳过（不新增执行），登记尾随
    await _trigger(ws, "2026-09-09-b")
    await _trigger(ws, "2026-09-09-c")
    await asyncio.sleep(0)  # 让跳过路径走完（无后台任务起）
    assert len(calls) == 1

    # 窗到点后尾随补发一发（合并输入，scope 含累积目录）
    await drain_reparse_workers()
    assert len(calls) == 2
    second_scope = calls[1][1]
    assert second_scope is not None
    assert "2026-09-09-b" in second_scope and "2026-09-09-c" in second_scope


async def test_single_flight_skips_while_inflight(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, fast_throttle: float
) -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[uuid.UUID] = []

    async def slow_reparse(self, workspace_id, scope=None):
        calls.append(workspace_id)
        started.set()
        await release.wait()  # 挂住模拟长跑
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", slow_reparse)
    ws = uuid.uuid4()
    await _trigger(ws, "2026-09-09-x")
    await started.wait()  # 第一次已在跑

    # inflight 中再触发：跳过（不并发执行）
    await _trigger(ws, "2026-09-09-y")
    await asyncio.sleep(0)
    assert len(calls) == 1

    release.set()
    await drain_reparse_workers()
    # inflight 跳过的触发走尾随：完成后补一发
    assert len(calls) == 2


async def test_workspaces_isolated(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, fast_throttle: float
) -> None:
    calls: list[uuid.UUID] = []

    async def fake_reparse(self, workspace_id, scope=None):
        calls.append(workspace_id)
        return {"parsed": 0}, None

    monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", fake_reparse)
    ws_a, ws_b = uuid.uuid4(), uuid.uuid4()
    await _trigger(ws_a, "2026-09-09-a")
    await _trigger(ws_b, "2026-09-09-b")  # 不同 workspace 不受 A 的节流影响
    await drain_reparse_workers()
    assert sorted(calls) == sorted([ws_a, ws_b])
