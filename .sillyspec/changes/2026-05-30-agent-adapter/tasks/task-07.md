---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-07
title: Adapter 隔离 + 脱敏测试
priority: P0
estimated_hours: 1.5
depends_on: [task-01, task-02]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/agent/tests/test_adapter_isolation.py
---

# task-07: Adapter 隔离 + 脱敏测试

## 修改文件（必填）

- **新增** `backend/app/modules/agent/tests/test_adapter_isolation.py` — ClaudeCodeAdapter 隔离性与脱敏测试

## 实现要求

验证 `ClaudeCodeAdapter` 的安全隔离机制：`CLAUDE_ALLOWED_PATHS` 环境变量注入、PAT/Bearer token 脱敏、工作目录限制。这些机制已在现有代码中实现，本任务编写测试验证其正确性。

核心测试维度：

1. **allowed_paths 注入**：验证 `run_with_bundle` / `run` 方法在创建子进程时正确注入 `CLAUDE_ALLOWED_PATHS` 环境变量
2. **PAT 脱敏**：验证 `_exec_stream` 输出中的 PAT 和 Bearer token 被 `redact_output` 正确处理
3. **工作目录验证**：验证子进程的 `cwd` 参数指向 worktree lease 的 `repo` 子目录
4. **进程注册**：验证 `_exec_stream` 在 proc 创建后注册到 `_proc_registry`，退出后注销

## 接口定义

### 测试用例清单

| 测试函数 | 场景 | 预期 |
|---|---|---|
| `test_allowed_paths_injected` | `run_with_bundle` 构建的环境变量中包含 `CLAUDE_ALLOWED_PATHS` | 值为 lease_path/repo |
| `test_allowed_paths_empty_when_no_context` | 无 context 信息时 | `CLAUDE_ALLOWED_PATHS` 不在 env 中或为空 |
| `test_pat_redacted_in_output` | stdout 包含 `ghp_xxx...` | `redact_output` 被调用，输出中 PAT 被替换 |
| `test_bearer_redacted_in_output` | stdout 包含 `Bearer eyJ...` | Bearer token 被脱敏 |
| `test_cwd_set_to_repo_dir` | 子进程 cwd 参数 | 等于 `lease_path / "repo"` |
| `test_env_inherits_os_environ` | 子进程环境变量 | 包含 `os.environ` 的所有值 |
| `test_proc_registered_during_exec` | `_exec_stream` 执行中 | `_proc_registry[run_id]` 存在 |
| `test_proc_unregistered_after_exec` | `_exec_stream` 结束后 | `run_id not in _proc_registry` |
| `test_proc_not_registered_on_spawn_failure` | `create_subprocess_exec` 抛 `FileNotFoundError` | 注册表不受影响 |
| `test_context_build_generates_claude_md` | context builder 生成的 prompt | 包含 CLAUDE.md 内容 |
| `test_timeout_env_var_set` | timeout 参数传递到子进程 | 子进程有正确的超时行为 |

## 边界处理（必填）

1. **不启动真实子进程**：所有 `asyncio.create_subprocess_exec` 通过 `patch` mock
2. **不连接真实 Redis**：`get_redis` 返回 mock 对象
3. **不依赖文件系统**：`Path.exists()` 和文件读写通过 mock
4. **proc mock 的 returncode**：正常完成设为 0，超时设为 None 后被 kill
5. **stdout/stderr mock**：使用 `AsyncMock` 模拟异步读取

## 非目标（本任务不做的事）

- 不测试 diff_collector（task-06 职责）
- 不测试 kill API 端点（task-05 职责）
- 不测试前端
- 不创建真实的 Claude CLI 进程
- 不测试 context_builder 的细节（已有 `test_context_builder.py`）

## 参考

- `backend/app/modules/agent/adapters/claude_code.py` — `_exec_stream` 方法实现
- `backend/app/modules/agent/adapters/claude_code.py` — `run_with_bundle` 方法中的 env_vars 构建
- `app.modules.git_gateway.service.redact_output` — 脱敏函数
- `app.modules.worktree.exec_env.ExecEnvBuilder` — `repo_dir` 属性
- task-02 蓝图：进程注册/注销 hook 点
- 现有测试：`backend/app/modules/agent/tests/test_context_builder.py`

## TDD 步骤

### 步骤 1：写测试

```python
"""Tests for ClaudeCodeAdapter isolation and output sanitization — task-07."""
import asyncio
import os
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter
from app.modules.agent.service import AgentService
```

### 步骤 2：确认通过

```bash
cd backend
python -m pytest app/modules/agent/tests/test_adapter_isolation.py -v
```

### 步骤 3：回归

```bash
python -m pytest app/modules/agent/tests/ -v
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | allowed_paths 注入测试通过 | 环境变量包含正确的 lease_path/repo |
| AC-02 | PAT 脱敏测试通过 | 输出中 PAT 被 `***REDACTED***` 替换 |
| AC-03 | Bearer 脱敏测试通过 | Bearer token 被脱敏 |
| AC-04 | 工作目录测试通过 | cwd 等于 lease_path/repo |
| AC-05 | 进程注册/注销测试通过 | 执行中注册，结束后注销 |
| AC-06 | 全部测试通过 | ≥11 个测试用例全绿 |
| AC-07 | 现有测试无回归 | `pytest app/modules/agent/tests/ -v` 全绿 |
