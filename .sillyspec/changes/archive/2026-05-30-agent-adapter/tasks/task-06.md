---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-06
title: Diff Collector 测试
priority: P0
estimated_hours: 1.5
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/agent/tests/test_diff_collector.py
---

# task-06: Diff Collector 测试

## 修改文件（必填）

- **新增** `backend/app/modules/agent/tests/test_diff_collector.py` — diff_collector 模块测试

## 实现要求

编写 `diff_collector.py` 模块的完整单元测试，覆盖 `DiffResult` dataclass、`collect_diff()` 函数和 `_parse_stat_numbers()` 辅助函数。所有外部依赖（git subprocess、文件系统）通过 mock 模拟。

## 接口定义

### 测试用例清单

| 测试函数 | 场景 | 预期 |
|---|---|---|
| `test_parse_stat_numbers_normal` | `"3 files changed, 10 insertions(+), 2 deletions(-)"` | `(3, 10, 2)` |
| `test_parse_stat_numbers_only_insertions` | `"1 file changed, 5 insertions(+)"` | `(1, 5, 0)` |
| `test_parse_stat_numbers_only_deletions` | `"1 file changed, 3 deletions(-)"` | `(1, 0, 3)` |
| `test_parse_stat_numbers_no_changes` | `"0 files changed"` | `(0, 0, 0)` |
| `test_parse_stat_numbers_empty` | `""` | `(0, 0, 0)` |
| `test_parse_stat_numbers_multiline` | 多行 stat 输出 | 正确解析最后一行 |
| `test_collect_diff_no_git_dir` | `repo_dir/.git` 不存在 | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_no_changes` | `.git` 存在，git diff 输出空 | `stat_summary=""`, `files_changed=0` |
| `test_collect_diff_with_changes` | mock 两个 subprocess 返回正常输出 | 正确解析数字 + 脱敏 |
| `test_collect_diff_large_truncation` | diff 超过 `max_diff_size` | 截断 + `"...[truncated]"` 后缀 |
| `test_collect_diff_stat_succeeds_diff_fails` | stat returncode=0，diff returncode=1 | 保留 stat，`full_diff=""` |
| `test_collect_diff_git_not_found` | `create_subprocess_exec` 抛 `FileNotFoundError` | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_timeout` | `communicate` 抛 `TimeoutError` | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_redaction` | diff 包含 `ghp_xxx...` PAT | PAT 被 `***REDACTED***` 替换 |
| `test_collect_diff_zero_result_is_zero` | `ZERO_DIFF_RESULT` 常量 | 所有字段为零值 |
| `test_collect_diff_oserror` | `create_subprocess_exec` 抛 `OSError` | 返回 `ZERO_DIFF_RESULT` |

## 边界处理（必填）

1. **不依赖真实 git**：所有 `asyncio.create_subprocess_exec` 调用通过 `patch` mock，不创建真实子进程
2. **不依赖文件系统**：`Path.exists()` 通过 `patch` mock，不创建真实目录结构
3. **脱敏验证**：验证 `redact_output` 被正确调用且返回值被使用
4. **截断精度**：验证截断后的长度在预期范围内（`max_diff_size + len("\n...[truncated]")`）
5. **超时设置**：验证 `asyncio.wait_for` 的 timeout 参数值正确（stat=15, diff=30）

## 非目标（本任务不做的事）

- 不测试 `_execute_run_background` 中的 diff 集成（由 task-05 中的集成测试覆盖）
- 不测试 kill 逻辑
- 不测试前端
- 不创建真实的 git 仓库进行测试

## 参考

- task-01 蓝图：`diff_collector.py` 完整接口定义和控制流伪代码
- `app.modules.git_gateway.service.redact_output` — 脱敏函数的已知行为（PAT 替换为 `***REDACTED***`）
- 现有测试模式：`backend/app/modules/agent/tests/test_base.py`

## TDD 步骤

### 步骤 1：写测试

```python
"""Tests for diff_collector module — task-06."""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.modules.agent.diff_collector import (
    DiffResult,
    ZERO_DIFF_RESULT,
    collect_diff,
    _parse_stat_numbers,
)
```

### 步骤 2：确认通过

```bash
cd backend
python -m pytest app/modules/agent/tests/test_diff_collector.py -v
```

### 步骤 3：回归

```bash
python -m pytest app/modules/agent/tests/ -v
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `_parse_stat_numbers` 测试全通过 | 6 个解析场景正确 |
| AC-02 | `collect_diff` 无 git 目录场景正确 | 返回 `ZERO_DIFF_RESULT` |
| AC-03 | `collect_diff` 有变更场景正确 | 数字解析 + 脱敏 + 截断均正确 |
| AC-04 | `collect_diff` 大 diff 截断正确 | `full_diff` 长度在预期范围内 |
| AC-05 | `collect_diff` 错误场景全覆盖 | git 不存在 / timeout / OSError 均返回 `ZERO_DIFF_RESULT` |
| AC-06 | `collect_diff` 脱敏验证正确 | PAT 被替换为 `***REDACTED***` |
| AC-07 | 全部测试通过 | ≥16 个测试用例全绿 |
| AC-08 | 现有测试无回归 | `pytest app/modules/agent/tests/ -v` 全绿 |
