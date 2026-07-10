"""Tests for RunSyncService background-task lifecycle helpers (task-03 / H4 / R5).

Verifies the helper extracted from ``AgentService`` (agent/service.py:347-386)
is verbatim-equivalent on ``RunSyncService``:

- ``_fire_background_task`` 创建 task 并放入 ``_background_tasks`` 强引用集（防 GC）。
- ``_on_background_task_done`` 执行后从集合 discard 移除。
- task 抛异常时 ``log.exception`` 捕获、不静默。
- CancelledError / InvalidStateError 早返回、不误报。

本 task 只提供 helper 能力，不接通 gate 业务（gate 派发留给 task-07）。
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from unittest.mock import patch

import pytest

from app.modules.agent.service import AgentService
from app.modules.daemon.run_sync import service as rs_module
from app.modules.daemon.run_sync.service import RunSyncService


def _make_service() -> RunSyncService:
    """构造一个 RunSyncService（session 用占位对象即可，helper 不触 DB）。"""
    # __init__ 仅赋值 self._session / self._facade，不查 DB。
    return RunSyncService(session=object())


@pytest.mark.asyncio
async def test_fire_background_task_holds_strong_reference_in_set() -> None:
    """fire 后 task 必须存在于 _background_tasks set（强引用防 GC）。"""
    svc = _make_service()
    RunSyncService._background_tasks.clear()
    try:

        async def _coro() -> str:
            return "done"

        task = svc._fire_background_task(_coro(), workspace_id=uuid.uuid4(), run_id=uuid.uuid4())
        # 强引用集含该 task
        assert task in RunSyncService._background_tasks
        # 让 task 跑完，触发 done callback
        await task
        # allow callback to run
        await asyncio.sleep(0)
    finally:
        RunSyncService._background_tasks.discard(task)


@pytest.mark.asyncio
async def test_on_background_task_done_discards_from_set() -> None:
    """done callback 执行后 task 从 _background_tasks 移除（discard）。"""
    svc = _make_service()
    RunSyncService._background_tasks.clear()

    async def _coro() -> int:
        return 42

    task = svc._fire_background_task(_coro())
    assert task in RunSyncService._background_tasks
    await task
    # done callback 在事件循环下一轮执行
    for _ in range(10):
        if task not in RunSyncService._background_tasks:
            break
        await asyncio.sleep(0)
    assert task not in RunSyncService._background_tasks


@pytest.mark.asyncio
async def test_on_background_task_done_logs_exception_not_silent() -> None:
    """task 抛异常时被 log.exception 捕获，不静默（patch logger 直接断言调用）。"""
    svc = _make_service()
    RunSyncService._background_tasks.clear()

    class _Boom(Exception):
        pass

    async def _coro() -> None:
        raise _Boom("kaboom")

    with patch.object(rs_module.log, "exception") as mock_exc:
        task = svc._fire_background_task(_coro())
        # 等待 task 完成（异常会被 done callback 记录而非向上冒泡）
        with pytest.raises(_Boom):
            await task
        # 让 done callback 跑
        for _ in range(10):
            await asyncio.sleep(0)
        # 异常不静默：log.exception 被调用，event 名 = background_task_failed
        assert mock_exc.called
        args, kwargs = mock_exc.call_args
        assert args[0] == "background_task_failed"
        assert kwargs["exc_info"] is not None
    RunSyncService._background_tasks.discard(task)


@pytest.mark.asyncio
async def test_on_background_task_done_swallows_cancelled_without_error() -> None:
    """CancelledError 早返回、不误报为失败。"""
    svc = _make_service()
    RunSyncService._background_tasks.clear()

    async def _coro() -> None:
        await asyncio.sleep(100)

    with patch.object(rs_module.log, "exception") as mock_exc:
        task = svc._fire_background_task(_coro())
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        for _ in range(10):
            await asyncio.sleep(0)
        # CancelledError 早返回，不触发 log.exception
        assert not mock_exc.called
    assert task not in RunSyncService._background_tasks


@pytest.mark.asyncio
async def test_fire_background_task_logs_info_with_context() -> None:
    """fire 时记录 background_task_fired + workspace_id / run_id 上下文。"""
    svc = _make_service()
    RunSyncService._background_tasks.clear()

    async def _coro() -> None:
        pass

    ws = uuid.uuid4()
    rid = uuid.uuid4()
    with patch.object(rs_module.log, "info") as mock_info:
        task = svc._fire_background_task(_coro(), workspace_id=ws, run_id=rid)
    try:
        assert mock_info.called
        args, kwargs = mock_info.call_args
        assert args[0] == "background_task_fired"
        assert kwargs["workspace_id"] == str(ws)
        assert kwargs["run_id"] == str(rid)
    finally:
        RunSyncService._background_tasks.discard(task)
        task.cancel()


def test_fire_background_task_signature_matches_agent_service() -> None:
    """签名与 AgentService._fire_background_task 一致：关键字参数 workspace_id / run_id 可选。"""
    agent_sig = inspect.signature(AgentService._fire_background_task)
    rs_sig = inspect.signature(RunSyncService._fire_background_task)
    assert list(agent_sig.parameters) == list(rs_sig.parameters)
    # 返回注解名一致（RunSyncService 模块有 from __future__ import annotations，
    # 注解为字符串 'asyncio.Task'；AgentService 无该 future 为类对象 —— 运行时等价）
    assert str(rs_sig.return_annotation).removeprefix("'").removesuffix("'") in {
        "asyncio.Task",
        str(AgentService._fire_background_task.__annotations__.get("return")),
    }

    # done callback 同为 staticmethod 且参数一致
    assert isinstance(
        inspect.getattr_static(RunSyncService, "_on_background_task_done"), staticmethod
    )
    done_sig = inspect.signature(RunSyncService._on_background_task_done)
    agent_done_sig = inspect.signature(AgentService._on_background_task_done)
    assert list(done_sig.parameters) == list(agent_done_sig.parameters)
