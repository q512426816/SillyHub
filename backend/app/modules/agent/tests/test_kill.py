"""Tests for process registry and kill mechanism — task-02."""

import signal
import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService

# ---- Fixtures ----


@pytest.fixture
def mock_session():
    session = AsyncMock()
    return session


@pytest.fixture
def agent_service(mock_session):
    return AgentService(mock_session)


@pytest.fixture(autouse=True)
def clear_registry():
    """确保每个测试开始时注册表为空。"""
    AgentService._proc_registry.clear()
    yield
    AgentService._proc_registry.clear()


# ---- Test: _proc_registry 基础行为 ----


class TestProcRegistry:
    @pytest.mark.asyncio
    async def test_registry_starts_empty(self, agent_service):
        assert AgentService._proc_registry == {}

    @pytest.mark.asyncio
    async def test_shared_across_instances(self, mock_session):
        svc1 = AgentService(mock_session)
        svc2 = AgentService(mock_session)
        fake_proc = MagicMock()
        run_id = uuid.uuid4()
        svc1._proc_registry[run_id] = fake_proc
        assert svc2._proc_registry[run_id] is fake_proc


# ---- Test: kill_run 正常终止 ----


class TestKillRun:
    @pytest.mark.asyncio
    async def test_kill_running_process(self, agent_service, mock_session):
        """正常场景：running run → SIGTERM → 进程退出 → status=killed"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.now(UTC),
        )

        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = AsyncMock()
        fake_proc.returncode = None
        fake_proc.wait = AsyncMock(return_value=0)
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert result.finished_at is not None
        fake_proc.send_signal.assert_called_once_with(signal.SIGTERM)
        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_kill_run_not_found(self, agent_service, mock_session):
        """run_id 不存在于数据库 → AgentRunNotFound"""
        mock_session.get = AsyncMock(return_value=None)
        with pytest.raises(AgentRunNotFound):
            await agent_service.kill_run(uuid.uuid4())

    @pytest.mark.asyncio
    async def test_kill_run_not_running(self, agent_service, mock_session):
        """run 存在但 status 不是 running → AgentRunNotRunning"""
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="completed",
        )
        mock_session.get = AsyncMock(return_value=run)

        with pytest.raises(AgentRunNotRunning):
            await agent_service.kill_run(run.id)

    @pytest.mark.asyncio
    async def test_kill_process_not_in_registry(self, agent_service, mock_session):
        """进程不在注册表中（如服务重启后）→ 仍更新 DB 状态为 killed"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        assert run_id not in AgentService._proc_registry

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert result.finished_at is not None

    @pytest.mark.asyncio
    async def test_kill_backfills_usage_from_claude_session(self, agent_service, mock_session):
        """kill_run reads persisted Claude session metadata before finalizing."""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            session_id="sess-live",
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        with patch(
            "app.modules.agent.service._read_claude_session_events",
            return_value=[
                {
                    "type": "result",
                    "total_cost_usd": 0.25,
                    "duration_ms": 1200,
                    "usage": {"input_tokens": 1500, "output_tokens": 300},
                }
            ],
        ):
            result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert result.total_cost_usd == 0.25
        assert result.duration_ms == 1200
        assert result.input_tokens == 1500
        assert result.output_tokens == 300

    @pytest.mark.asyncio
    async def test_kill_sigterm_timeout_then_sigkill(self, agent_service, mock_session):
        """SIGTERM 后 5 秒超时 → SIGKILL"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.now(UTC),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = AsyncMock()
        fake_proc.returncode = None
        fake_proc.wait = AsyncMock(side_effect=[TimeoutError(), None])
        fake_proc.kill = MagicMock()
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        fake_proc.send_signal.assert_called_once_with(signal.SIGTERM)
        fake_proc.kill.assert_called_once()
        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_kill_process_already_exited(self, agent_service, mock_session):
        """进程已在注册表中但 returncode 不为 None → 跳过信号"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.now(UTC),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = MagicMock()
        fake_proc.returncode = 0
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        fake_proc.send_signal.assert_not_called()
        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_kill_sigterm_process_lookup_error(self, agent_service, mock_session):
        """发送 SIGTERM 时进程刚好退出（ProcessLookupError）→ 不崩溃"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.now(UTC),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = MagicMock()
        fake_proc.returncode = None
        fake_proc.send_signal = MagicMock(side_effect=ProcessLookupError)
        fake_proc.wait = AsyncMock(return_value=0)
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_double_kill_raises_not_running(self, agent_service, mock_session):
        """kill 两次同一 run → 第二次抛 AgentRunNotRunning"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.now(UTC),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = MagicMock()
        fake_proc.returncode = None
        fake_proc.send_signal = MagicMock()
        fake_proc.wait = AsyncMock(return_value=0)
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)
        assert result.status == "killed"

        with pytest.raises(AgentRunNotRunning):
            await agent_service.kill_run(run_id)


# ---- Test: _exec_stream 注册/注销 ----


class TestExecStreamRegistry:
    @pytest.mark.asyncio
    async def test_process_registered_during_exec(self):
        """_exec_stream 执行期间进程在注册表中，退出后清理"""
        from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter

        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        fake_proc = AsyncMock()
        fake_proc.returncode = 0
        fake_proc.wait = AsyncMock(return_value=0)
        fake_proc.stdin = AsyncMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.readline = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")

        async def _fake_create(*args, **kwargs):
            return fake_proc

        with patch("asyncio.create_subprocess_exec", side_effect=_fake_create):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mock_redis:
                mock_redis_instance = AsyncMock()
                mock_redis_instance.publish = AsyncMock()
                mock_redis.return_value = mock_redis_instance

                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["echo", "test"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_process_unregistered_on_normal_exit(self):
        """正常退出后注册表清理"""
        from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter

        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        fake_proc = AsyncMock()
        fake_proc.returncode = 0
        fake_proc.wait = AsyncMock(return_value=0)
        fake_proc.stdin = AsyncMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.readline = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")

        async def _fake_create(*args, **kwargs):
            return fake_proc

        with patch("asyncio.create_subprocess_exec", side_effect=_fake_create):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mock_redis:
                mock_redis_instance = AsyncMock()
                mock_redis_instance.publish = AsyncMock()
                mock_redis.return_value = mock_redis_instance

                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["echo", "test"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_process_unregistered_on_timeout(self):
        """超时退出后注册表清理"""
        from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter

        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        fake_proc = AsyncMock()
        fake_proc.returncode = None
        fake_proc.wait = AsyncMock(return_value=0)
        fake_proc.stdin = AsyncMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.readline = AsyncMock(side_effect=TimeoutError())
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.kill = MagicMock()

        async def _fake_create(*args, **kwargs):
            return fake_proc

        with patch("asyncio.create_subprocess_exec", side_effect=_fake_create):
            with patch("app.modules.agent.adapters.claude_code.get_redis") as mock_redis:
                mock_redis_instance = AsyncMock()
                mock_redis_instance.publish = AsyncMock()
                mock_redis.return_value = mock_redis_instance

                await adapter._exec_stream(
                    run_id=run_id,
                    cmd=["echo", "test"],
                    prompt="test",
                    cwd=Path("/tmp"),
                    env_vars={},
                    timeout=5,
                )

        assert run_id not in AgentService._proc_registry

    @pytest.mark.asyncio
    async def test_process_not_registered_on_file_not_found(self):
        """CLI 不存在时不注册"""
        from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter

        adapter = ClaudeCodeAdapter()
        run_id = uuid.uuid4()

        async def _fake_create_not_found(*args, **kwargs):
            raise FileNotFoundError("claude not found")

        with patch("asyncio.create_subprocess_exec", side_effect=_fake_create_not_found):
            result = await adapter._exec_stream(
                run_id=run_id,
                cmd=["claude"],
                prompt="test",
                cwd=Path("/tmp"),
                env_vars={},
                timeout=5,
            )

        assert result.exit_code == 127
        assert run_id not in AgentService._proc_registry
