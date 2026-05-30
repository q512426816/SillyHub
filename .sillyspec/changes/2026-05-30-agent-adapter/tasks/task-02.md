---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-02
title: 进程注册表 + Kill 机制
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-03, task-05, task-07]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/adapters/claude_code.py
---

# task-02: 进程注册表 + Kill 机制

## 修改文件（必填）

- `backend/app/modules/agent/service.py` — 新增 `_proc_registry` 类属性、`kill_run()` 方法
- `backend/app/modules/agent/adapters/claude_code.py` — `_exec_stream` 中注册/注销子进程

## 实现要求

### 总体目标

在 `AgentService` 中建立进程注册表（`_proc_registry`），使每个正在运行的 Agent 子进程可被外部通过 `run_id` 查找到并终止。`ClaudeCodeAdapter._exec_stream` 在创建子进程后立即注册，在子进程结束后（无论成功/失败/超时）立即注销。

### 要求 1：进程注册表

在 `AgentService` 上新增**类属性** `_proc_registry`，类型为 `dict[uuid.UUID, asyncio.subprocess.Process]`，初始值为空 dict。所有 `AgentService` 实例共享同一个注册表（类属性而非实例属性）。

### 要求 2：注册/注销 Hook

修改 `ClaudeCodeAdapter._exec_stream` 方法：

- **注册时机**：在 `asyncio.create_subprocess_exec` 成功返回 `proc` 之后、写 stdin 之前，将 `proc` 注册到 `AgentService._proc_registry[run_id]`。
- **注销时机**：在 `_exec_stream` 的**所有返回路径**（正常完成、超时、FileNotFoundError、任何异常）中，从 `_proc_registry` 中 `pop(run_id, None)` 确保清理。
- 使用 `try/finally` 保证注销不遗漏。

### 要求 3：kill_run() 方法

在 `AgentService` 中新增 `kill_run()` 方法，实现 SIGTERM → 5s wait → SIGKILL 的终止策略：

1. 从数据库加载 `AgentRun` 记录
2. 校验状态为 `running`（否则抛异常）
3. 从 `_proc_registry` 查找进程
4. 发送 SIGTERM
5. 等待最多 5 秒
6. 如果进程未退出，发送 SIGKILL
7. 更新数据库记录状态为 `killed`
8. 返回更新后的 `AgentRun`

### 要求 4：AgentRunNotRunning 错误类型

在 `backend/app/core/errors.py` 中新增 `AgentRunNotRunning(AppError)` 错误类，code 为 `HTTP_409_AGENT_RUN_NOT_RUNNING`，http_status 为 409。用于 `kill_run()` 中 run 状态不是 running 时的拒绝响应。

## 接口定义（代码类任务必填）

### 1. `_proc_registry` 类型定义和初始化

```python
# backend/app/modules/agent/service.py

class AgentService:
    # 进程注册表 — 类属性，所有实例共享
    # key: run_id (UUID), value: asyncio.subprocess.Process
    _proc_registry: dict[uuid.UUID, asyncio.subprocess.Process] = {}

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
    # ... 现有方法不变 ...
```

### 2. `kill_run()` 方法签名

```python
async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
    """Terminate a running agent execution.

    Sends SIGTERM, waits up to 5 seconds, then sends SIGKILL if
    the process has not exited.

    Args:
        run_id: UUID of the AgentRun to terminate.

    Returns:
        The updated AgentRun with status='killed'.

    Raises:
        AgentRunNotFound: run_id 不存在于数据库。
        AgentRunNotRunning: run 存在但状态不是 'running'。
    """
```

### 3. `kill_run()` 控制流伪代码

```python
async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
    # 1. 加载 run 记录
    run = await self._session.get(AgentRun, run_id)
    if run is None:
        raise AgentRunNotFound(...)

    # 2. 状态校验
    if run.status != "running":
        raise AgentRunNotRunning(
            f"Run '{run_id}' is not running (status={run.status}).",
            details={"run_id": str(run_id), "status": run.status},
        )

    # 3. 从注册表查找进程
    proc = self._proc_registry.get(run_id)

    if proc is not None and proc.returncode is None:
        # 3a. 进程仍在运行 → 发 SIGTERM
        import signal
        try:
            proc.send_signal(signal.SIGTERM)
        except ProcessLookupError:
            # 进程已在发送信号前退出，忽略
            pass

        # 3b. 等待最多 5 秒
        try:
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            # 3c. 超时 → SIGKILL
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()

    # 4. 从注册表移除（无论 proc 是否存在）
    self._proc_registry.pop(run_id, None)

    # 5. 更新数据库记录
    run.status = "killed"
    run.finished_at = datetime.utcnow()
    run.exit_code = run.exit_code if run.exit_code is not None else -9
    self._session.add(run)
    await self._session.commit()
    await self._session.refresh(run)

    # 6. 日志
    log.info("run_killed", run_id=str(run_id))

    return run
```

### 4. `AgentRunNotRunning` 错误类型

```python
# backend/app/core/errors.py — 追加到 "Agent errors" 区域

class AgentRunNotRunning(AppError):
    code = "HTTP_409_AGENT_RUN_NOT_RUNNING"
    http_status = status.HTTP_409_CONFLICT
```

### 5. ClaudeCodeAdapter._exec_stream 中注册/注销的 hook 点

```python
# backend/app/modules/agent/adapters/claude_code.py

# 新增 import（文件顶部）
from app.modules.agent.service import AgentService  # 用于访问 _proc_registry

async def _exec_stream(self, run_id, cmd, prompt, cwd, env_vars, timeout):
    # ... 现有代码 ...
    channel = f"agent_run:{run_id}"

    try:
        proc = await asyncio.create_subprocess_exec(...)
    except FileNotFoundError:
        # 进程未创建，无需注册/注销
        return AgentRunResult(...)

    # ===== 注册 HOOK（proc 创建成功后立即注册）=====
    AgentService._proc_registry[run_id] = proc

    try:
        # ... 现有的 stdin 写入、stdout/stderr 读取、wait 逻辑 ...
        # 注意：所有 return 语句保留，因为 finally 会处理注销
    finally:
        # ===== 注销 HOOK（无论成功/失败/超时都执行）=====
        AgentService._proc_registry.pop(run_id, None)
```

**重要**：`_exec_stream` 方法当前有两个 return 路径需要保留：
1. `except FileNotFoundError` 分支中的 return — 此路径 proc 未创建，不注册，不注销
2. 正常完成后的 return（在 try 块中）
3. 超时的 return（在 try 块中）

改造方式：用 `try/finally` 包裹从注册点到方法结尾的所有代码，确保 `finally` 中执行注销。`FileNotFoundError` 分支在注册之前，不受影响。

具体结构：

```python
async def _exec_stream(self, run_id, cmd, prompt, cwd, env_vars, timeout):
    child_env = {**os.environ, **env_vars}
    channel = f"agent_run:{run_id}"

    try:
        proc = await asyncio.create_subprocess_exec(...)
    except FileNotFoundError:
        log.error("agent_cli_not_found", cli=_CLAUDE_CLI)
        return AgentRunResult(...)  # 未注册，无需注销

    # ---- 注册 ----
    AgentService._proc_registry[run_id] = proc

    try:
        # stdin 写入
        stdin_data = _build_stream_input(prompt)
        try:
            proc.stdin.write(stdin_data)
            await proc.stdin.drain()
            proc.stdin.close()
        except Exception:
            pass

        redis = get_redis()
        stdout_lines = []
        all_events = []

        # _read_stdout / _read_stderr 定义不变 ...

        # 主执行逻辑（正常 / 超时）
        try:
            stdout_task = asyncio.create_task(_read_stdout())
            await proc.wait()
            await asyncio.wait_for(stdout_task, timeout=5)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            log.warning("agent_timeout", run_id=str(run_id))
            # ... publish done event ...
            return AgentRunResult(...)  # finally 会注销

        # 正常完成
        stderr_raw = await _read_stderr()
        stdout_raw = "\n".join(stdout_lines)

        # ... publish done event ...
        # ... format conversation log ...

        return AgentRunResult(...)  # finally 会注销

    finally:
        # ---- 注销（保证执行）----
        AgentService._proc_registry.pop(run_id, None)
```

## 边界处理（必填）

1. **run 不存在**：`kill_run()` 中 `self._session.get(AgentRun, run_id)` 返回 None 时，抛出 `AgentRunNotFound`，不静默返回。

2. **run 状态不是 running**：`kill_run()` 中检查 `run.status != "running"` 时，抛出 `AgentRunNotRunning`（409），明确告知调用方当前状态。status 为 `pending` / `completed` / `failed` / `killed` 时都走此路径。

3. **进程已自行退出**：`kill_run()` 从注册表找到 proc 但 `proc.returncode is not None` 时，跳过信号发送，直接进入数据库更新流程。不抛异常，正常返回 `killed` 状态。

4. **进程不在注册表中**：`kill_run()` 中 `_proc_registry.get(run_id)` 返回 None（例如服务重启后注册表丢失），仍更新数据库状态为 `killed`，不抛异常。因为即使进程已不在注册表中，数据库状态仍需一致。

5. **SIGTERM 后进程已退出（ProcessLookupError）**：`proc.send_signal(signal.SIGTERM)` 可能抛 `ProcessLookupError`（进程在获取和发送信号之间退出），捕获后 pass，继续后续流程。

6. **SIGKILL 也抛 ProcessLookupError**：`proc.kill()` 同样可能抛出，捕获后 pass，然后 `await proc.wait()` 确保 proc 被回收。

7. **_exec_stream 中 proc 创建失败（FileNotFoundError）**：此分支不注册进程，不触发注销。return 后注册表不受影响。

8. **并发 kill 同一 run_id**：`dict.pop(run_id, None)` 是原子操作（CPython GIL），不会引发竞争。第二次 kill 会因为 `run.status == "killed"`（不再是 running）而抛 `AgentRunNotRunning`。

9. **不修改传入参数**：`kill_run()` 不修改 `run_id` 参数本身。更新 `AgentRun` 记录时只修改自身的 status/finished_at/exit_code 字段。

10. **_proc_registry 类属性的 import 循环**：`claude_code.py` 中从 `app.modules.agent.service` import `AgentService` 来访问 `_proc_registry`。当前 `service.py` 已经 import `claude_code.py`（`from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter`），如果直接在模块级 import 会导致循环。解决方案：在 `_exec_stream` 方法内部做局部 import（`from app.modules.agent.service import AgentService`），避免模块级循环依赖。

## 非目标（本任务不做的事）

- 不实现 Kill API 端点（task-03 的职责）
- 不实现 diff 收集（task-01 的职责）
- 不实现 stale run 清理（task-04 的职责）
- 不实现前端 Kill 按钮（task-10 的职责）
- 不修改 `AgentRun` 模型的表结构（status 字段已支持 `killed` 值）
- 不引入分布式进程注册表（当前单机部署，YAGNI）
- 不修改 `AgentRunLog` 相关逻辑

## 参考

- **design.md AD-1**：进程注册表策略 — `dict[UUID, asyncio.subprocess.Process]` 类属性
- **design.md AD-2**：SIGTERM → 5s wait → SIGKILL 信号策略
- **现有模式**：`AgentRunNotFound` 在 `app/core/errors.py` 中定义（第 119 行），新增的 `AgentRunNotRunning` 遵循同一模式
- **现有模式**：`AgentRun.status` 字段已包含 `killed` 值（`model.py` 第 47 行注释）
- **现有模式**：`AgentKillResponse` schema 已在 `schema.py` 第 44-47 行定义

## TDD 步骤

### 步骤 1：写测试（RED）

文件：`backend/app/modules/agent/tests/test_kill.py`

```python
"""Tests for process registry and kill mechanism — task-02."""
import asyncio
import signal
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.errors import AgentRunNotRunning, AgentRunNotFound
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
    async def test_registry_starts_empty(self, agent_service):
        assert AgentService._proc_registry == {}

    async def test_shared_across_instances(self, mock_session):
        svc1 = AgentService(mock_session)
        svc2 = AgentService(mock_session)
        fake_proc = MagicMock()
        run_id = uuid.uuid4()
        svc1._proc_registry[run_id] = fake_proc
        assert svc2._proc_registry[run_id] is fake_proc


# ---- Test: kill_run 正常终止 ----

class TestKillRun:
    async def test_kill_running_process(self, agent_service, mock_session):
        """正常场景：running run → SIGTERM → 进程退出 → status=killed"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.utcnow(),
        )

        # mock session.get 返回 run
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        # mock 进程
        fake_proc = AsyncMock()
        fake_proc.returncode = None  # 进程仍在运行
        fake_proc.wait = AsyncMock(return_value=0)
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert result.finished_at is not None
        fake_proc.send_signal.assert_called_once_with(signal.SIGTERM)
        # 从注册表中移除
        assert run_id not in AgentService._proc_registry

    async def test_kill_run_not_found(self, agent_service, mock_session):
        """run_id 不存在于数据库 → AgentRunNotFound"""
        mock_session.get = AsyncMock(return_value=None)
        with pytest.raises(AgentRunNotFound):
            await agent_service.kill_run(uuid.uuid4())

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

        # 注册表中无此 run_id
        assert run_id not in AgentService._proc_registry

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        assert result.finished_at is not None

    async def test_kill_sigterm_timeout_then_sigkill(self, agent_service, mock_session):
        """SIGTERM 后 5 秒超时 → SIGKILL"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.utcnow(),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = AsyncMock()
        fake_proc.returncode = None
        # wait 第一次超时，第二次立即返回
        fake_proc.wait = AsyncMock(
            side_effect=[asyncio.TimeoutError(), None]
        )
        fake_proc.kill = MagicMock()
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        fake_proc.send_signal.assert_called_once_with(signal.SIGTERM)
        fake_proc.kill.assert_called_once()
        assert run_id not in AgentService._proc_registry

    async def test_kill_process_already_exited(self, agent_service, mock_session):
        """进程已在注册表中但 returncode 不为 None → 跳过信号"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.utcnow(),
        )
        mock_session.get = AsyncMock(return_value=run)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        fake_proc = MagicMock()
        fake_proc.returncode = 0  # 进程已退出
        AgentService._proc_registry[run_id] = fake_proc

        result = await agent_service.kill_run(run_id)

        assert result.status == "killed"
        # send_signal 不应被调用
        fake_proc.send_signal.assert_not_called()
        assert run_id not in AgentService._proc_registry

    async def test_kill_sigterm_process_lookup_error(self, agent_service, mock_session):
        """发送 SIGTERM 时进程刚好退出（ProcessLookupError）→ 不崩溃"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.utcnow(),
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

    async def test_double_kill_raises_not_running(self, agent_service, mock_session):
        """kill 两次同一 run → 第二次抛 AgentRunNotRunning"""
        run_id = uuid.uuid4()
        run = AgentRun(
            id=run_id,
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            started_at=datetime.utcnow(),
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

        # 第二次：run.status 已变为 "killed"
        with pytest.raises(AgentRunNotRunning):
            await agent_service.kill_run(run_id)


# ---- Test: _exec_stream 注册/注销 ----

class TestExecStreamRegistry:
    async def test_process_registered_during_exec(self):
        """_exec_stream 执行期间进程在注册表中"""
        from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter
        from app.modules.agent.base import AgentSpecBundle

        # 需要 mock create_subprocess_exec
        # 验证注册表在 proc 创建后非空
        # 验证注册表在 _exec_stream 返回后为空
        pass  # 具体实现依赖 mock asyncio.create_subprocess_exec

    async def test_process_unregistered_on_normal_exit(self):
        """正常退出后注册表清理"""
        pass

    async def test_process_unregistered_on_timeout(self):
        """超时退出后注册表清理"""
        pass

    async def test_process_not_registered_on_file_not_found(self):
        """CLI 不存在时不注册"""
        pass
```

### 步骤 2：确认失败

运行 `pytest backend/app/modules/agent/tests/test_kill.py -v`，预期全部 FAIL（`AgentRunNotRunning` 不存在、`kill_run` 方法不存在等）。

### 步骤 3：写代码

按「接口定义」中的规格实现：
1. 在 `errors.py` 新增 `AgentRunNotRunning`
2. 在 `service.py` 新增 `_proc_registry` + `kill_run()`
3. 在 `claude_code.py` 修改 `_exec_stream` 添加注册/注销

### 步骤 4：确认通过

运行 `pytest backend/app/modules/agent/tests/test_kill.py -v`，全部 PASS。

### 步骤 5：回归

运行 `pytest backend/ -v --tb=short`，确保现有 63 个测试无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `AgentService._proc_registry` 是 `dict[UUID, asyncio.subprocess.Process]` 类属性，初始为空 dict | 类型正确，`clear()` 后为空，多实例共享 |
| AC-02 | `AgentRunNotRunning` 在 `app/core/errors.py` 中定义 | code=`HTTP_409_AGENT_RUN_NOT_RUNNING`，http_status=409 |
| AC-03 | `kill_run(run_id)` 对 status=running 的 run 发送 SIGTERM 并等待 | `proc.send_signal(SIGTERM)` 被调用，run.status 变为 `killed`，finished_at 非空 |
| AC-04 | SIGTERM 后 5 秒进程未退出 → SIGKILL | `proc.kill()` 被调用，run.status 变为 `killed` |
| AC-05 | `kill_run()` 对不存在 run 抛 `AgentRunNotFound` | pytest.raises(AgentRunNotFound) 通过 |
| AC-06 | `kill_run()` 对非 running 状态抛 `AgentRunNotRunning` | status 为 completed/failed/killed/pending 时均抛异常 |
| AC-07 | `kill_run()` 对注册表中不存在的进程（服务重启场景）正常更新 DB | 不抛异常，run.status 变为 `killed` |
| AC-08 | `_exec_stream` 成功创建 proc 后注册到 `_proc_registry` | 注册表包含该 run_id |
| AC-09 | `_exec_stream` 正常返回后从注册表注销 | `run_id not in _proc_registry` |
| AC-10 | `_exec_stream` 超时退出后从注册表注销 | 即使超时，`run_id not in _proc_registry` |
| AC-11 | `_exec_stream` FileNotFoundError 分支不注册不注销 | 注册表不含该 run_id，无异常 |
| AC-12 | ProcessLookupError 在 send_signal/kill 时被捕获不崩溃 | 测试通过，kill_run 正常返回 |
| AC-13 | 全套现有测试无回归 | `pytest backend/ -v` 全部 PASS（63 现有 + 新增） |
