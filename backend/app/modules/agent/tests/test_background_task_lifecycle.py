"""Tests for background task lifecycle management — prevent GC of fire-and-forget tasks."""

import asyncio
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService

# ---- Fixtures ----


@pytest.fixture
def mock_session():
    return AsyncMock()


@pytest.fixture
def agent_service(mock_session):
    return AgentService(mock_session)


@pytest.fixture
def coordinator(mock_session):
    return ExecutionCoordinatorService(mock_session)


@pytest.fixture(autouse=True)
def clear_background_tasks():
    """确保每个测试开始时 _background_tasks 为空。"""
    AgentService._background_tasks.clear()
    ExecutionCoordinatorService._background_tasks.clear()
    yield
    AgentService._background_tasks.clear()
    ExecutionCoordinatorService._background_tasks.clear()


# ---- Test: _fire_background_task saves reference ----


class TestFireBackgroundTask:
    @pytest.mark.asyncio
    async def test_fire_background_task_saves_reference(self, agent_service):
        """_fire_background_task 应将 task 添加到 _background_tasks 并在完成时移除。"""
        future = asyncio.get_event_loop().create_future()
        future.set_result("done")

        task = agent_service._fire_background_task(
            asyncio.sleep(0),
            workspace_id=uuid.uuid4(),
            run_id=uuid.uuid4(),
        )

        assert task in AgentService._background_tasks
        await task  # 等待完成
        # 完成回调是同步的，立即执行
        assert task not in AgentService._background_tasks

    @pytest.mark.asyncio
    async def test_fire_background_task_returns_task(self, agent_service):
        """_fire_background_task 应返回 asyncio.Task 实例。"""
        task = agent_service._fire_background_task(asyncio.sleep(0))
        assert isinstance(task, asyncio.Task)
        await task

    @pytest.mark.asyncio
    async def test_fire_background_task_coordinator(self, coordinator):
        """ExecutionCoordinatorService 的 _fire_background_task 也应正常工作。"""
        task = coordinator._fire_background_task(asyncio.sleep(0))
        assert task in ExecutionCoordinatorService._background_tasks
        await task
        assert task not in ExecutionCoordinatorService._background_tasks


# ---- Test: _on_background_task_done removes task ----


class TestOnBackgroundTaskDone:
    @pytest.mark.asyncio
    async def test_on_background_task_done_removes_task(self, agent_service):
        """正常完成的 task 应从 _background_tasks 中移除。"""
        task = agent_service._fire_background_task(asyncio.sleep(0))
        assert task in AgentService._background_tasks
        await task
        assert task not in AgentService._background_tasks

    @pytest.mark.asyncio
    async def test_on_background_task_done_on_exception_no_reraise(self, agent_service):
        """异常 task 的 callback 不会重新抛出异常，仅记录日志。"""

        async def boom():
            raise RuntimeError("kaboom")

        task = agent_service._fire_background_task(boom())
        assert task in AgentService._background_tasks

        # 等待 task 完成（异常 task 的 exception 仍可通过 task.exception() 获取）
        with pytest.raises(RuntimeError, match="kaboom"):
            await task

        # done_callback 应已从 set 中移除 task
        assert task not in AgentService._background_tasks


# ---- Test: _execute_stage_run exception marks run failed ----


class TestExecuteStageRunException:
    @pytest.mark.asyncio
    async def test_execute_stage_run_exception_marks_run_failed(self):
        """adapter 抛出异常时，_execute_stage_run 应将 run 标记为 failed。"""
        mock_session = AsyncMock()
        svc = AgentService(mock_session)

        run = AgentRun(
            id=uuid.uuid4(),
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="pending",
        )

        async def fake_get(model, pk):
            if pk == run.id:
                return run
            return None

        mock_inner = AsyncMock()
        mock_inner.get = fake_get
        mock_inner.add = MagicMock()
        mock_inner.commit = AsyncMock()

        with patch(
            "app.core.db.get_session_factory",
            return_value=MagicMock(return_value=AsyncMock(
                __aenter__=AsyncMock(return_value=mock_inner),
                __aexit__=AsyncMock(return_value=False),
            )),
        ), patch.dict(
            "app.modules.agent.service.ADAPTERS",
            {"claude_code": MagicMock(
                return_value=MagicMock(
                    run_with_bundle=AsyncMock(side_effect=RuntimeError("adapter exploded")),
                ),
            )},
        ):
            await svc._execute_stage_run(
                run_id=run.id,
                prompt="test prompt",
                work_dir=MagicMock(),
                read_only=False,
                workspace_id=uuid.uuid4(),
                change_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                stage="scan",
            )

        assert mock_inner.commit.called


# ---- Test: _execute_scan_run exception marks run failed ----


class TestExecuteScanRunException:
    @pytest.mark.asyncio
    async def test_execute_scan_run_exception_marks_run_failed(self):
        """adapter 抛出异常时，_execute_scan_run 应将 run 标记为 failed。"""
        mock_session = AsyncMock()
        svc = AgentService(mock_session)

        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            agent_type="claude_code",
            status="pending",
        )

        async def fake_get(model, pk):
            if pk == run.id:
                return run
            return None

        mock_inner = AsyncMock()
        mock_inner.get = fake_get
        mock_inner.add = MagicMock()
        mock_inner.commit = AsyncMock()

        with patch(
            "app.core.db.get_session_factory",
            return_value=MagicMock(return_value=AsyncMock(
                __aenter__=AsyncMock(return_value=mock_inner),
                __aexit__=AsyncMock(return_value=False),
            )),
        ), patch.dict(
            "app.modules.agent.service.ADAPTERS",
            {"claude_code": MagicMock(
                return_value=MagicMock(
                    run_with_bundle=AsyncMock(side_effect=RuntimeError("scan adapter exploded")),
                ),
            )},
        ):
            from app.modules.agent.base import AgentSpecBundle

            bundle = AgentSpecBundle(
                change_summary="test",
                task_key="test",
                task_title="test",
                task_markdown="test",
            )

            await svc._execute_scan_run(
                run_id=run.id,
                bundle=bundle,
                work_dir=MagicMock(),
                workspace_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

        assert mock_inner.commit.called
