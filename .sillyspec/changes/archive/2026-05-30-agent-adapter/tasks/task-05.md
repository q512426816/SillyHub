---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-05
title: Kill 全流程测试
priority: P0
estimated_hours: 2
depends_on: [task-02, task-03]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/agent/tests/test_kill.py
  - backend/app/modules/agent/tests/test_kill_endpoint.py
---

# task-05: Kill 全流程测试

## 修改文件（必填）

- **新增** `backend/app/modules/agent/tests/test_kill.py` — 进程注册表 + kill_run() 单元测试
- **新增** `backend/app/modules/agent/tests/test_kill_endpoint.py` — Kill API 端点集成测试

## 实现要求

编写 Kill 功能的全流程测试，覆盖进程注册表、kill_run() 方法、API 端点三个层面。分为两个测试文件：

1. `test_kill.py`：测试 `AgentService._proc_registry` + `kill_run()` 的单元级行为
2. `test_kill_endpoint.py`：测试 `POST /workspaces/{workspace_id}/agent/runs/{run_id}/kill` 的 HTTP 行为

## 接口定义

### test_kill.py 测试用例

| 测试函数 | 场景 | 预期 |
|---|---|---|
| `test_registry_starts_empty` | `AgentService._proc_registry` 初始为空 | `{}` |
| `test_shared_across_instances` | 两个 service 实例共享注册表 | svc1 写入后 svc2 可读取 |
| `test_kill_running_process` | running run + 进程在注册表 | SIGTERM 发出，status=killed，注册表清空 |
| `test_kill_run_not_found` | run_id 不存在于数据库 | 抛 `AgentRunNotFound` |
| `test_kill_run_not_running` | run status=completed | 抛 `AgentRunNotRunning` |
| `test_kill_process_not_in_registry` | running run 但进程不在注册表（服务重启） | status=killed，不抛异常 |
| `test_kill_sigterm_timeout_then_sigkill` | SIGTERM 后 5s 超时 | `proc.kill()` 被调用 |
| `test_kill_process_already_exited` | proc.returncode != None | 跳过信号发送，status=killed |
| `test_kill_sigterm_process_lookup_error` | send_signal 抛 ProcessLookupError | 不崩溃，status=killed |
| `test_double_kill_raises_not_running` | kill 两次同一 run | 第二次抛 `AgentRunNotRunning` |
| `test_exec_stream_registers_proc` | _exec_stream 创建 proc 后 | 注册表包含该 run_id |
| `test_exec_stream_unregisters_on_normal_exit` | _exec_stream 正常完成 | 注册表为空 |
| `test_exec_stream_unregisters_on_timeout` | _exec_stream 超时退出 | 注册表为空 |
| `test_exec_stream_no_register_on_file_not_found` | CLI 不存在 | 注册表不受影响 |

### test_kill_endpoint.py 测试用例

| 测试函数 | 场景 | 预期 |
|---|---|---|
| `test_kill_running_run_returns_200` | kill running run | HTTP 200, `{id, status: "killed"}` |
| `test_kill_pending_run_returns_200` | kill pending run | HTTP 200, `{id, status: "killed"}` |
| `test_kill_nonexistent_run_returns_404` | run_id 不存在 | HTTP 404 |
| `test_kill_completed_run_returns_409` | run status=completed | HTTP 409, code=`HTTP_409_AGENT_RUN_NOT_RUNNING` |
| `test_kill_failed_run_returns_409` | run status=failed | HTTP 409 |
| `test_kill_killed_run_returns_409` | run status=killed | HTTP 409 |
| `test_kill_without_permission_returns_403` | 无 TASK_RUN_AGENT 权限 | HTTP 403 |

## 边界处理（必填）

1. **注册表隔离**：每个测试用例前后清理 `_proc_registry`（使用 `autouse` fixture），避免测试间泄漏
2. **Mock subprocess**：所有进程操作使用 `AsyncMock` / `MagicMock`，不创建真实子进程
3. **Mock session**：数据库操作使用 `AsyncMock`，不依赖真实数据库连接
4. **API 测试隔离**：使用现有的 `client` fixture（httpx AsyncClient），mock 掉 service 层
5. **并发 kill**：验证 kill 幂等性（第二次 kill 抛 409）

## 非目标（本任务不做的事）

- 不测试 diff_collector（task-06 职责）
- 不测试 adapter 隔离性（task-07 职责）
- 不创建新的 conftest.py（复用现有）
- 不测试前端行为

## 参考

- task-02 蓝图：`_proc_registry` + `kill_run()` 接口定义
- task-03 蓝图：Kill 端点签名和边界处理
- 现有测试模式：`backend/app/modules/agent/tests/test_router.py` — 端点测试模式
- 现有测试模式：`backend/app/modules/agent/tests/test_base.py` — 单元测试模式
- `conftest.py` 中已有的 fixture（`client`, `mock_session` 等）

## TDD 步骤

### 步骤 1：写 test_kill.py（进程注册表 + kill_run 单元测试）

```python
"""Tests for process registry and kill mechanism — task-05."""
import asyncio
import signal
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.errors import AgentRunNotRunning, AgentRunNotFound
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
```

### 步骤 2：写 test_kill_endpoint.py（端点集成测试）

参考 `test_router.py` 中的 fixture 和 mock 模式，使用 httpx AsyncClient 测试。

### 步骤 3：确认全部测试通过

```bash
cd backend
python -m pytest app/modules/agent/tests/test_kill.py app/modules/agent/tests/test_kill_endpoint.py -v
```

### 步骤 4：回归

```bash
python -m pytest app/modules/agent/tests/ -v
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | test_kill.py 全部测试通过 | ≥11 个测试用例全绿 |
| AC-02 | test_kill_endpoint.py 全部测试通过 | ≥7 个测试用例全绿 |
| AC-03 | 注册表 fixture 隔离正确 | 每个测试开始时注册表为空 |
| AC-04 | kill_run 单元测试覆盖所有边界场景 | not_found / not_running / no_registry / sigterm_timeout / already_exited / process_lookup / double_kill |
| AC-05 | API 测试覆盖所有 HTTP 状态码 | 200 / 404 / 409 / 403 |
| AC-06 | 现有测试无回归 | `pytest app/modules/agent/tests/ -v` 全绿 |
