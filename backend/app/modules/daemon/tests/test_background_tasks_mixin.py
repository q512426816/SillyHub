"""task-11 轻重构③定向测试：后台任务生命周期共享 mixin。

收敛等价性证法（不改既有测试的前提下补 mixin 视角）：

- 单源：两个宿主 Service 的 ``_fire_background_task`` 均解析到 mixin 同一
  函数对象（原两份逐字节相同实现已删除）；
- 多态：fire 后 task 落在**各自宿主类**的 ``_background_tasks``（两集合独立
  不串扰），done callback 经宿主 staticmethod 壳 discard 本类集合；
- 日志身份：``background_task_fired`` / ``background_task_failed`` 经宿主
  模块命名空间的 ``log`` 记录（patch 宿主模块 log 对象可拦截——D-007 面）；
- staticmethod 表面：``_on_background_task_done`` 在两个宿主上仍为
  staticmethod 且签名为 ``(task)``（既有测试 test_run_sync_fire_background_
  task 的契约，本文件对 SessionService 侧补同款断言）；
- 异常路径：task 抛异常 → ``log.exception`` 不静默；CancelledError → 早返回
  不误报。
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from unittest.mock import patch

import pytest

import app.modules.daemon.run_sync.service as rs_module
import app.modules.daemon.session.service as session_module
from app.modules.daemon._background_tasks import (
    BackgroundTaskMixin,
    on_background_task_done,
)
from app.modules.daemon.run_sync.service import RunSyncService
from app.modules.daemon.session.service import SessionService


def _make_session_service() -> SessionService:
    """构造 SessionService（session 用占位对象即可，helper 不触 DB）。"""
    return SessionService(session=object())


def _make_run_sync_service() -> RunSyncService:
    """构造 RunSyncService（同上，__init__ 仅赋值不查库）。"""
    return RunSyncService(session=object())


class TestSingleSourceMixin:
    def test_both_hosts_inherit_mixin_and_share_fire_implementation(self) -> None:
        """两个宿主都继承 mixin，``_fire_background_task`` 解析到同一函数对象。"""
        assert issubclass(SessionService, BackgroundTaskMixin)
        assert issubclass(RunSyncService, BackgroundTaskMixin)
        assert SessionService._fire_background_task is BackgroundTaskMixin._fire_background_task
        assert RunSyncService._fire_background_task is BackgroundTaskMixin._fire_background_task

    def test_hosts_own_independent_background_task_sets(self) -> None:
        """各宿主类持独立集合：mixin 本体无共享默认值，两集合不是同一对象。"""
        assert SessionService._background_tasks is not RunSyncService._background_tasks
        # mixin 只声明注解，不携带可共享的 set 默认值。
        assert "_background_tasks" not in BackgroundTaskMixin.__dict__ or not isinstance(
            BackgroundTaskMixin.__dict__.get("_background_tasks"), set
        )

    def test_fire_signature_matches_on_both_hosts(self) -> None:
        """宿主经 MRO 解析到的方法签名与收敛前逐一相同（self/coro/两个 kw-only）。"""
        for host in (SessionService, RunSyncService):
            params = list(inspect.signature(host._fire_background_task).parameters)
            assert params == ["self", "coro", "workspace_id", "run_id"]

    def test_on_background_task_done_remains_staticmethod_on_both_hosts(self) -> None:
        """staticmethod 表面契约：两宿主的 done callback 均为 staticmethod 且 (task) 签名。"""
        for host in (SessionService, RunSyncService):
            static_val = inspect.getattr_static(host, "_on_background_task_done")
            assert isinstance(static_val, staticmethod)
            assert list(inspect.signature(host._on_background_task_done).parameters) == ["task"]


class TestPolymorphicFire:
    @pytest.mark.asyncio
    async def test_session_host_task_lands_in_own_set_and_discards_on_done(self) -> None:
        """SessionService fire → task 进 SessionService 集合（非 RunSync），完成后移除。"""
        svc = _make_session_service()
        SessionService._background_tasks.clear()
        RunSyncService._background_tasks.clear()
        try:

            async def _coro() -> str:
                return "done"

            task = svc._fire_background_task(_coro(), workspace_id=uuid.uuid4())
            assert task in SessionService._background_tasks
            assert task not in RunSyncService._background_tasks
            await task
            for _ in range(10):
                if task not in SessionService._background_tasks:
                    break
                await asyncio.sleep(0)
            assert task not in SessionService._background_tasks
        finally:
            SessionService._background_tasks.discard(task)
            SessionService._background_tasks.clear()
            RunSyncService._background_tasks.clear()

    @pytest.mark.asyncio
    async def test_run_sync_host_task_lands_in_own_set(self) -> None:
        """RunSyncService fire → task 进 RunSyncService 集合（非 Session）。"""
        svc = _make_run_sync_service()
        SessionService._background_tasks.clear()
        RunSyncService._background_tasks.clear()
        try:

            async def _coro() -> int:
                return 42

            task = svc._fire_background_task(_coro())
            assert task in RunSyncService._background_tasks
            assert task not in SessionService._background_tasks
            await task
        finally:
            RunSyncService._background_tasks.discard(task)
            SessionService._background_tasks.clear()
            RunSyncService._background_tasks.clear()

    @pytest.mark.asyncio
    async def test_fire_logs_via_host_module_log_session(self) -> None:
        """session 宿主 fire 日志经 session.service 模块 log（D-007 拦截面）。"""
        svc = _make_session_service()
        ws, rid = uuid.uuid4(), uuid.uuid4()
        with patch.object(session_module.log, "info") as mock_info:

            async def _coro() -> None:
                pass

            task = svc._fire_background_task(_coro(), workspace_id=ws, run_id=rid)
        try:
            assert mock_info.called
            args, kwargs = mock_info.call_args
            assert args[0] == "background_task_fired"
            assert kwargs["workspace_id"] == str(ws)
            assert kwargs["run_id"] == str(rid)
            assert kwargs["task_id"] == id(task)
        finally:
            SessionService._background_tasks.discard(task)
            task.cancel()

    @pytest.mark.asyncio
    async def test_fire_logs_via_host_module_log_run_sync(self) -> None:
        """run_sync 宿主 fire 日志经 run_sync.service 模块 log（两宿主各回各家）。"""
        svc = _make_run_sync_service()
        with (
            patch.object(rs_module.log, "info") as mock_info,
            patch.object(session_module.log, "info") as session_info,
        ):

            async def _coro() -> None:
                pass

            task = svc._fire_background_task(_coro(), workspace_id=uuid.uuid4())
        try:
            assert mock_info.called
            assert mock_info.call_args.args[0] == "background_task_fired"
            assert not session_info.called  # 不串到 session 模块 logger
        finally:
            RunSyncService._background_tasks.discard(task)
            task.cancel()


class TestDoneCallbackPaths:
    @pytest.mark.asyncio
    async def test_failed_task_logs_exception_via_host_module_log(self) -> None:
        """task 抛异常 → 宿主模块 log.exception 记 background_task_failed（不静默）。"""
        svc = _make_run_sync_service()
        RunSyncService._background_tasks.clear()

        class _Boom(Exception):
            pass

        async def _coro() -> None:
            raise _Boom("kaboom")

        with patch.object(rs_module.log, "exception") as mock_exc:
            task = svc._fire_background_task(_coro())
            with pytest.raises(_Boom):
                await task
            for _ in range(10):
                await asyncio.sleep(0)
            assert mock_exc.called
            args, kwargs = mock_exc.call_args
            assert args[0] == "background_task_failed"
            assert kwargs["exc_info"] is not None
        RunSyncService._background_tasks.discard(task)

    @pytest.mark.asyncio
    async def test_cancelled_task_returns_early_without_error_log(self) -> None:
        """CancelledError 早返回：discard 集合、不触发 log.exception。"""
        svc = _make_session_service()
        SessionService._background_tasks.clear()

        async def _coro() -> None:
            await asyncio.sleep(100)

        with patch.object(session_module.log, "exception") as mock_exc:
            task = svc._fire_background_task(_coro())
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            for _ in range(10):
                await asyncio.sleep(0)
            assert not mock_exc.called
        assert task not in SessionService._background_tasks

    @pytest.mark.asyncio
    async def test_shared_done_core_discards_from_passed_host_class(self) -> None:
        """共享核心按传入宿主类 discard（多态证法：两个类各自集合独立生效）。"""
        SessionService._background_tasks.clear()
        RunSyncService._background_tasks.clear()
        try:
            loop = asyncio.get_running_loop()
            task_a = loop.create_task(asyncio.sleep(0))
            task_b = loop.create_task(asyncio.sleep(0))
            SessionService._background_tasks.add(task_a)
            RunSyncService._background_tasks.add(task_b)
            await asyncio.gather(task_a, task_b)
            on_background_task_done(SessionService, task_a)
            assert task_a not in SessionService._background_tasks
            assert task_b in RunSyncService._background_tasks  # 未被误伤
            on_background_task_done(RunSyncService, task_b)
            assert task_b not in RunSyncService._background_tasks
        finally:
            SessionService._background_tasks.clear()
            RunSyncService._background_tasks.clear()
