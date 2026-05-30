---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-01
title: Diff Collector 模块
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-04, task-06, task-07]
allowed_paths:
  - backend/app/modules/agent/diff_collector.py
---

# task-01: Diff Collector 模块

## 修改文件（必填）

- **新增** `backend/app/modules/agent/diff_collector.py` — 整个模块只有这一个文件

无其他文件修改。task-04 负责在 `service.py` 中调用本模块。

## 实现要求

在 `backend/app/modules/agent/diff_collector.py` 中实现一个纯函数模块，负责在 Agent 执行完成后、进程已退出的时机，在 worktree lease 目录下执行 `git diff --stat` 和 `git diff`，收集文件变更统计和 diff 内容，经过脱敏后封装为 `DiffResult` dataclass 返回。

核心职责：

1. 定义 `DiffResult` dataclass
2. 实现 `collect_diff(lease_path: Path, *, max_diff_size: int = 50000) -> DiffResult` 函数
3. 复用 `app.modules.git_gateway.service.redact_output` 进行脱敏

## 接口定义（代码类任务必填）

### DiffResult dataclass

```python
from dataclasses import dataclass

@dataclass
class DiffResult:
    stat_summary: str        # git diff --stat 输出（完整，已脱敏）
    full_diff: str           # git diff 输出（截断 + 脱敏后）
    files_changed: int       # 变更文件数
    insertions: int          # 新增行数
    deletions: int           # 删除行数
```

### collect_diff 函数签名

```python
async def collect_diff(
    lease_path: Path,
    *,
    max_diff_size: int = 50_000,
) -> DiffResult:
    """在 lease_path 的 repo 子目录下收集 git diff。

    Args:
        lease_path: worktree lease 根目录，实际 git 仓库在 lease_path / "repo"
        max_diff_size: full_diff 截断阈值（字符数），默认 50000

    Returns:
        DiffResult 实例。如果无变更或异常，返回"零值" DiffResult（见边界处理）。
    """
```

### 控制流伪代码

```
collect_diff(lease_path, max_diff_size):
    repo_dir = lease_path / "repo"

    # 1. 检查 repo_dir/.git 是否存在
    if not (repo_dir / ".git").exists():
        log.warning("diff_collector_no_git", path=str(repo_dir))
        return ZERO_DIFF_RESULT  # (stat_summary="", full_diff="", files_changed=0, insertions=0, deletions=0)

    # 2. 执行 git diff --stat
    try:
        proc_stat = await asyncio.create_subprocess_exec(
            "git", "diff", "--stat",
            cwd=str(repo_dir),
            stdout=PIPE, stderr=PIPE,
        )
        stdout_stat, stderr_stat = await asyncio.wait_for(proc_stat.communicate(), timeout=15)
    except (TimeoutError, FileNotFoundError, OSError) as exc:
        log.warning("diff_collector_stat_failed", error=str(exc))
        return ZERO_DIFF_RESULT

    if proc_stat.returncode != 0:
        log.warning("diff_collector_stat_error", returncode=proc_stat.returncode)
        return ZERO_DIFF_RESULT

    stat_raw = stdout_stat.decode("utf-8", errors="replace")

    # 3. 执行 git diff
    try:
        proc_diff = await asyncio.create_subprocess_exec(
            "git", "diff",
            cwd=str(repo_dir),
            stdout=PIPE, stderr=PIPE,
        )
        stdout_diff, stderr_diff = await asyncio.wait_for(proc_diff.communicate(), timeout=30)
    except (TimeoutError, FileNotFoundError, OSError) as exc:
        log.warning("diff_collector_diff_failed", error=str(exc))
        return ZERO_DIFF_RESULT  # 统计也没了，因为可能是 git 本身坏了

    if proc_diff.returncode != 0:
        log.warning("diff_collector_diff_error", returncode=proc_diff.returncode)
        # stat 可以保留，但 diff 为空
        stat_redacted = redact_output(stat_raw)
        return DiffResult(stat_summary=stat_redacted, full_diff="", files_changed=0, insertions=0, deletions=0)

    diff_raw = stdout_diff.decode("utf-8", errors="replace")

    # 4. 截断
    diff_truncated = diff_raw[:max_diff_size]
    if len(diff_raw) > max_diff_size:
        diff_truncated += "\n...[truncated]"

    # 5. 脱敏（复用 git_gateway 的 redact_output）
    stat_redacted = redact_output(stat_raw)
    diff_redacted = redact_output(diff_truncated)

    # 6. 解析统计数字（files changed, insertions, deletions）
    files_changed, insertions, deletions = _parse_stat_numbers(stat_raw)

    # 7. 返回
    return DiffResult(
        stat_summary=stat_redacted,
        full_diff=diff_redacted,
        files_changed=files_changed,
        insertions=insertions,
        deletions=deletions,
    )
```

### _parse_stat_numbers 辅助函数

```python
import re

_STAT_PATTERN = re.compile(
    r"(\d+) files? changed(?:,\s+(\d+) insertions?\(\+\))?(?:,\s+(\d+) deletions?\(\-\))?"
)

def _parse_stat_numbers(stat_output: str) -> tuple[int, int, int]:
    """从 git diff --stat 的最后一行解析 files_changed, insertions, deletions。

    Returns:
        (files_changed, insertions, deletions)。解析失败返回 (0, 0, 0)。
    """
    # 取最后一行（统计摘要行）
    lines = stat_output.strip().splitlines()
    if not lines:
        return 0, 0, 0

    last_line = lines[-1].strip()
    match = _STAT_PATTERN.search(last_line)
    if not match:
        return 0, 0, 0

    files_changed = int(match.group(1))
    insertions = int(match.group(2) or "0")
    deletions = int(match.group(3) or "0")
    return files_changed, insertions, deletions
```

### 模块级常量

```python
# 零值 DiffResult，用于错误/无变更场景
ZERO_DIFF_RESULT = DiffResult(
    stat_summary="",
    full_diff="",
    files_changed=0,
    insertions=0,
    deletions=0,
)
```

### 导入列表

```python
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path

from app.core.logging import get_logger
from app.modules.git_gateway.service import redact_output

log = get_logger(__name__)
```

## 边界处理（必填）

1. **非 git 目录**：`repo_dir / ".git"` 不存在时，返回 `ZERO_DIFF_RESULT`，打印 warning 日志，不抛异常。因为某些 lease 可能尚未 clone 或已被清理。

2. **git 命令不存在 / 执行失败**：`FileNotFoundError`（git 未安装）、`OSError`（权限问题）、非零 returncode、`TimeoutError`（超时）均捕获，记录 warning 日志，返回 `ZERO_DIFF_RESULT`。不抛异常——调用方（`_execute_run_background`）不应因 diff 收集失败而中断后续审计日志写入。

3. **空 diff / 无变更**：`git diff --stat` 输出为空时，`_parse_stat_numbers` 返回 `(0, 0, 0)`，`stat_summary` 和 `full_diff` 均为空字符串。这是合法的正常结果。

4. **大 diff 截断**：`full_diff` 超过 `max_diff_size`（默认 50000 字符）时截断并追加 `"\n...[truncated]"`。截断发生在脱敏之前（先截断原始文本，再脱敏），避免脱敏后字符膨胀导致超过限制。`stat_summary` 不截断（`git diff --stat` 本身很紧凑）。

5. **脱敏**：所有输出经过 `redact_output` 处理（来自 `git_gateway.service`），移除 PAT、Bearer token 等敏感信息。该函数已处理截断（`MAX_OUTPUT_SIZE = 64000`），所以 diff 截断阈值 50000 在脱敏后有额外余量。

6. **不修改传入参数**：`lease_path` 仅用于构造子路径和 `cwd` 参数，不做任何修改。`max_diff_size` 为 int 类型，不存在可变性风险。

7. **stat 成功但 diff 失败**：如果 `git diff --stat` 成功但 `git diff` 执行失败（returncode != 0），返回保留 stat 信息但 `full_diff=""` 的 `DiffResult`，数字统计保持 0（因为解析 stat 的数字可能不准确，保守处理）。

8. **超时设置**：`git diff --stat` 超时 15 秒，`git diff` 超时 30 秒。这个差异是因为 `--stat` 只扫描文件头，而完整 diff 可能涉及大文件内容。

## 非目标（本任务不做的事）

- **不修改** `service.py`、`model.py`、`schema.py` 或任何其他现有文件
- **不实现** `DiffResult` 的持久化逻辑（写入 `AgentRun.diff_summary` 字段由 task-04 完成）
- **不实现** `DiffResult` 的 JSON 序列化（task-04 调用方自行序列化）
- **不处理** staged diff（`git diff --cached`），只收集 unstaged diff
- **不处理** untracked files（`git ls-files --others`），只收集已 tracked 的变更
- **不实现** 二进制 diff 内容的过滤（`git diff` 默认对二进制文件只显示 `Binary files differ`，无需特殊处理）
- **不添加** API 端点或 schema
- **不实现** 进程注册或 kill 逻辑（task-02 的职责）

## 参考

- `app.modules.git_gateway.service.redact_output` — 脱敏函数，处理 PAT/Bearer token 和截断
- `app.modules.git_gateway.service.GitGatewayService.execute` — 同样使用 `asyncio.create_subprocess_exec` + `wait_for` + timeout 模式执行 git 命令，可作为 subprocess 调用模式的参考
- `app.modules.agent.service._execute_run_background` — 调用方，在第 4 步（更新 run record）之后、第 6 步（审计日志）之前调用 `collect_diff`
- `app.modules.worktree.exec_env.ExecEnvBuilder.repo_dir` — `lease_path / "repo"` 是实际 git 仓库路径的确认依据

## TDD 步骤

测试文件路径：`backend/app/modules/agent/tests/test_diff_collector.py`

### 步骤 1: 写测试 — 基本结构

```python
# test_diff_collector.py
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

### 步骤 2: 测试用例清单（先写测试，确认失败，再写实现）

| 测试函数 | 场景 | 预期 |
|---|---|---|
| `test_parse_stat_numbers_normal` | `"3 files changed, 10 insertions(+), 2 deletions(-)"` | `(3, 10, 2)` |
| `test_parse_stat_numbers_only_insertions` | `"1 file changed, 5 insertions(+)"` | `(1, 5, 0)` |
| `test_parse_stat_numbers_only_deletions` | `"1 file changed, 3 deletions(-)"` | `(1, 0, 3)` |
| `test_parse_stat_numbers_no_changes` | `"0 files changed"` | `(0, 0, 0)` |
| `test_parse_stat_numbers_empty` | `""` | `(0, 0, 0)` |
| `test_parse_stat_numbers_multiline` | 多行 stat + 最后一行是统计 | 正确解析最后一行 |
| `test_collect_diff_no_git_dir` | `repo_dir/.git` 不存在 | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_no_changes` | `.git` 存在，`git diff --stat` 输出空 | `stat_summary=""`, `files_changed=0` |
| `test_collect_diff_with_changes` | mock 两个 subprocess 返回正常输出 | 正确解析数字、脱敏、截断 |
| `test_collect_diff_large_truncation` | diff 超过 `max_diff_size` | 截断 + `"...[truncated]"` 后缀 |
| `test_collect_diff_stat_succeeds_diff_fails` | stat returncode=0，diff returncode=1 | 保留 stat，`full_diff=""` |
| `test_collect_diff_git_not_found` | `create_subprocess_exec` 抛 `FileNotFoundError` | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_timeout` | `communicate` 抛 `TimeoutError` | 返回 `ZERO_DIFF_RESULT` |
| `test_collect_diff_redaction` | diff 中包含 PAT `ghp_xxx...` | 返回值中 PAT 被 `***REDACTED***` 替换 |

### 步骤 3: 确认测试失败 → 写 `diff_collector.py` 实现

### 步骤 4: 确认所有测试通过

### 步骤 5: 回归 — 确认现有 agent 测试套件无失败

```bash
cd /Users/qinyi/SillyHub/backend
python -m pytest app/modules/agent/tests/ -v
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `diff_collector.py` 文件存在于 `backend/app/modules/agent/` 下 | 文件存在，可被 `from app.modules.agent.diff_collector import DiffResult, collect_diff` 导入 |
| AC-02 | `DiffResult` 是 `@dataclass`，包含 `stat_summary: str`, `full_diff: str`, `files_changed: int`, `insertions: int`, `deletions: int` 五个字段 | `import dataclasses; dataclasses.fields(DiffResult)` 返回 5 个字段，类型匹配 |
| AC-03 | `collect_diff` 在 `.git` 不存在时返回 `ZERO_DIFF_RESULT` | `stat_summary=""`, `full_diff=""`, `files_changed=0`, `insertions=0`, `deletions=0` |
| AC-04 | `collect_diff` 在有变更时正确解析统计数字 | 输入 mock 的 `git diff --stat` 含 `"3 files changed, 10 insertions(+), 2 deletions(-)"`，返回 `files_changed=3, insertions=10, deletions=2` |
| AC-05 | `collect_diff` 对大 diff 正确截断 | 设置 `max_diff_size=100`，输入 200 字符 diff，返回 `full_diff` 长度 <= 115（100 + `"\n...[truncated]"`） |
| AC-06 | `collect_diff` 输出经过 `redact_output` 脱敏 | 输入含 `ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` 的 diff，返回值中该 token 被替换为 `***REDACTED***` |
| AC-07 | `collect_diff` 在 git 命令失败时（非零 returncode / FileNotFoundError / TimeoutError）返回 `ZERO_DIFF_RESULT` | 不抛异常，返回零值 |
| AC-08 | `collect_diff` 在 stat 成功但 diff 失败时返回 `stat_summary` 非空、`full_diff=""` 的结果 | stat 信息保留，diff 为空 |
| AC-09 | `_parse_stat_numbers` 对标准格式正确解析 | `"3 files changed, 10 insertions(+), 2 deletions(-)"` → `(3, 10, 2)` |
| AC-10 | `_parse_stat_numbers` 对仅 insertions / 仅 deletions / 空字符串正确处理 | 边界输入返回 `(0, 0, 0)` 或正确的部分值 |
| AC-11 | 模块导入不触发副作用 | `import app.modules.agent.diff_collector` 不执行 subprocess、不修改全局状态 |
| AC-12 | 全部测试通过 | `pytest app/modules/agent/tests/test_diff_collector.py -v` 全绿，无 warning |
| AC-13 | 现有 agent 测试无回归 | `pytest app/modules/agent/tests/ -v --ignore=app/modules/agent/tests/test_diff_collector.py` 全绿 |
