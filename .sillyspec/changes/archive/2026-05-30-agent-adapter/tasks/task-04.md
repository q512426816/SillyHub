---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-04
title: Diff 收集集成 + Stale Run 清理
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: []
allowed_paths:
  - backend/app/modules/agent/service.py
---

# task-04: Diff 收集集成 + Stale Run 清理

## 修改文件（必填）

- `backend/app/modules/agent/service.py` — 唯一修改文件

## 实现要求

1. 在 `_execute_run_background` 中第 4 步（更新 run record）之后、原第 5 步（Log stdout/stderr）之前，插入 diff 收集步骤：调用 `collect_diff` 获取 `DiffResult`，将 `stat_summary` 写入 `run.diff_summary`
2. 新增 `_cleanup_stale_runs()` 类方法，扫描数据库中 `status='running'` 的 AgentRun 记录，将其标记为 `status='failed'`，设置 `finished_at`、`exit_code=-1`、`output_redacted` 说明原因
3. 在 `AgentService.__init__` 中调用 `_cleanup_stale_runs()`

## 接口定义（代码类任务必填）

### A. DiffResult dataclass（由 task-01 创建，本任务只消费）

```python
# backend/app/modules/agent/diff_collector.py（task-01 产出物）
from dataclasses import dataclass

@dataclass
class DiffResult:
    stat_summary: str        # git diff --stat 输出
    full_diff: str           # git diff 输出（截断）
    files_changed: int       # 变更文件数
    insertions: int          # 新增行数
    deletions: int           # 删除行数
```

### B. collect_diff 函数签名（由 task-01 创建，本任务只调用）

```python
# backend/app/modules/agent/diff_collector.py（task-01 产出物）
async def collect_diff(work_dir: Path) -> DiffResult:
    """在 work_dir 目录下执行 git diff --stat + git diff，返回 DiffResult。

    如果 work_dir 不是 git 仓库或 git 不可用，返回空的 DiffResult（files_changed=0）。
    """
```

### C. _execute_run_background 中 diff 收集步骤的精确插入位置

当前 `_execute_run_background` 流程（6 步）：

```
第 1 步: Load run record
第 2 步: Mark running
第 3 步: Execute via adapter
第 4 步: Update run record（status, exit_code, output_redacted）
第 5 步: Log stdout/stderr（写入 AgentRunLog）
第 6 步: Write audit log（写入 AuditLog）
```

修改后变为 7 步，新增步骤插入位置：

```
第 1 步: Load run record           ← 不变
第 2 步: Mark running              ← 不变
第 3 步: Execute via adapter       ← 不变
第 4 步: Update run record         ← 不变
第 5 步: Collect diff（新增）       ← ★ 新增
第 6 步: Log stdout/stderr         ← 原第 5 步
第 7 步: Write audit log           ← 原第 6 步
```

**新增第 5 步的精确伪代码**（在第 4 步 `self._session.add(run)` 之后、原第 5 步之前）：

```python
# -- 5. Collect diff -------------------------------------------------
try:
    from app.modules.agent.diff_collector import collect_diff

    diff_result = await collect_diff(lease_path)
    # DiffResult -> diff_summary 转换：
    # 格式：统计行 + 文件数/插入/删除汇总
    if diff_result.files_changed > 0:
        run.diff_summary = (
            f"{diff_result.stat_summary}\n"
            f"--- Summary: {diff_result.files_changed} files changed, "
            f"{diff_result.insertions} insertions(+), "
            f"{diff_result.deletions} deletions(-)"
        )
    else:
        run.diff_summary = None
    self._session.add(run)
except Exception as exc:
    # diff 收集失败不应阻塞 run 完成，仅记录日志
    log.warning(
        "diff_collect_failed",
        run_id=str(run_id),
        error=str(exc),
    )
```

**关键要点**：
- diff 收集包裹在 try/except 中，失败不阻塞主流程
- `diff_result.files_changed == 0` 时将 `diff_summary` 设为 `None`（而非空字符串）
- `diff_summary` 格式为 `stat_summary` 原始输出 + 汇总行
- 不修改 `lease_path` 或任何传入参数

### D. _cleanup_stale_runs() 方法签名和逻辑

```python
@classmethod
async def _cleanup_stale_runs(cls, session: AsyncSession) -> int:
    """扫描 status='running' 的 AgentRun，标记为 failed。

    服务重启时注册表清空，但数据库中可能遗留 running 状态的 run。
    本方法将这些 run 标记为 failed，防止永久卡在 running 状态。

    Args:
        session: 数据库会话

    Returns:
        清理的 stale run 数量
    """
    # 1. 查询所有 status='running' 的 AgentRun
    stmt = select(AgentRun).where(col(AgentRun.status) == "running")
    stale_runs = list((await session.execute(stmt)).scalars().all())

    if not stale_runs:
        return 0

    # 2. 逐条标记为 failed
    now = datetime.utcnow()
    for run in stale_runs:
        run.status = "failed"
        run.finished_at = now
        run.exit_code = -1
        run.output_redacted = "Run interrupted: service restarted while agent was running."
        session.add(run)
        log.warning(
            "stale_run_cleaned",
            run_id=str(run.id),
            old_status="running",
            new_status="failed",
        )

    # 3. 批量提交
    await session.commit()
    return len(stale_runs)
```

### E. __init__ 中调用清理

```python
class AgentService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 清理服务重启前遗留的 running 状态 run
        # 使用 asyncio.create_task 避免阻塞 __init__
        import asyncio
        asyncio.get_event_loop().create_task(
            self._cleanup_stale_runs(session)
        )
```

**备选方案**（更稳健）：不在 `__init__` 中自动调用，而是在应用启动 lifespan 中显式调用。但由于当前 `AgentService` 是在路由层每次请求新建的，选择以下方案：

**最终方案**：将 `_cleanup_stale_runs` 改为独立函数（非类方法），在路由层或 FastAPI lifespan 中调用。但为保持最小改动范围，采用 `__init__` 中调用的方式：

```python
def __init__(self, session: AsyncSession) -> None:
    self._session = session
```

不，在 `__init__` 中做异步操作不可靠。采用以下最终方案：

**最终方案**：添加一个 `async def init_cleanup(cls, session: AsyncSession)` 类方法，由路由层在创建 service 后手动调用。但鉴于当前代码中 `AgentService` 在 router 中每次请求 new 一个，在实际请求中自动清理过于频繁。

**最终实际方案**：

1. `_cleanup_stale_runs` 定义为 `@staticmethod` async 函数
2. 在 `AgentService` 上新增 `async def cleanup_stale_runs(self)` 实例方法（委托给 staticmethod）
3. 在文件底部新增模块级函数 `async def cleanup_stale_runs(session: AsyncSession) -> int`
4. 调用方（如 router 或 FastAPI lifespan）负责在启动时调用此函数

实际伪代码：

```python
# ---- 在 AgentService 类内部 ----

async def cleanup_stale_runs(self) -> int:
    """清理 stale running 状态的 AgentRun 记录。"""
    return await _cleanup_stale_runs_impl(self._session)

# ---- 在模块级别 ----

async def _cleanup_stale_runs_impl(session: AsyncSession) -> int:
    """实现：扫描 status='running' 的 AgentRun，标记为 failed。"""
    stmt = select(AgentRun).where(col(AgentRun.status) == "running")
    stale_runs = list((await session.execute(stmt)).scalars().all())
    if not stale_runs:
        return 0
    now = datetime.utcnow()
    for run in stale_runs:
        run.status = "failed"
        run.finished_at = now
        run.exit_code = -1
        run.output_redacted = "Run interrupted: service restarted while agent was running."
        session.add(run)
        log.warning("stale_run_cleaned", run_id=str(run.id))
    await session.commit()
    return len(stale_runs)
```

调用方（本任务不负责，但提供示例）：

```python
# app/main.py 或 app/core/lifespan.py 中
from app.modules.agent.service import _cleanup_stale_runs_impl

async def lifespan(app):
    # ... startup ...
    async with async_session() as session:
        await _cleanup_stale_runs_impl(session)
    yield
    # ... shutdown ...
```

## 边界处理（必填）

1. **collect_diff 抛异常**：用 try/except 包裹，仅 log.warning，不阻塞 run 完成。run.status 和 exit_code 已在第 4 步设置完毕，不受 diff 收集失败影响。

2. **diff_result 为空（files_changed == 0）**：`run.diff_summary` 设为 `None`，与字段默认值保持一致。前端展示时检查 `diff_summary is None` 显示"无文件变更"。

3. **lease_path 不存在或不是 git 仓库**：`collect_diff` 内部处理（task-01 职责），返回 `DiffResult(stat_summary="", full_diff="", files_changed=0, insertions=0, deletions=0)`。本任务对此情况与"无变更"相同处理。

4. **stale run 清理无 stale 记录**：`_cleanup_stale_runs_impl` 返回 0，不执行数据库写入，不产生日志。

5. **stale run 清理与正常流程并发**：清理操作使用独立 session（由调用方传入），如果恰好有 run 正在执行中被误清理，由于 SQLAlchemy 行级锁 + 状态检查，风险极低。实际场景中服务启动时不会有正在执行的 run（进程注册表已清空）。

6. **不修改传入参数**：`_execute_run_background` 不修改 `bundle`、`lease_path`、`workspace_id`、`user_id`、`task_id` 等传入参数。diff 收集只读取 `lease_path`，不写入任何文件。

7. **run 记录在第 4 步之前已 commit**：第 4 步 `self._session.add(run)` 后未立即 commit，diff 写入 `run.diff_summary` 后与后续步骤一起在第 7 步末尾 `await self._session.commit()` 统一提交。如果在 diff 收集到 commit 之间发生异常，SQLAlchemy session rollback 会丢弃 diff 但保留第 2 步的 running 状态。这是可接受的——极端情况下 diff 丢失，但 run 记录可通过 stale 清理恢复。

## 非目标（本任务不做的事）

- 不创建或修改 `diff_collector.py`（task-01 职责）
- 不修改 `AgentRun` 或 `AgentRunLog` 数据模型
- 不修改前端代码
- 不实现 FastAPI lifespan 集成（只提供函数，调用由其他地方负责）
- 不修改 `_execute_run_background` 的整体流程结构（仅插入一步）
- 不处理 kill 逻辑（task-02 职责）
- 不修改 router 或 schema

## 参考

- `backend/app/modules/agent/service.py` 第 156-241 行：`_execute_run_background` 完整实现
- `backend/app/modules/agent/model.py` 第 72-75 行：`diff_summary` 字段定义（`Text, nullable=True`）
- `backend/app/modules/git_gateway/service.py`：git 操作 + 脱敏模式参考
- design.md AD-3：diff 收集时机决策

## TDD 步骤

### 1. 写测试

在 `backend/app/modules/agent/tests/test_diff_collect_integration.py` 中编写：

```python
"""测试 diff 收集集成到 _execute_run_background + stale run 清理。"""
```

测试用例清单：

| 测试 | 说明 |
|---|---|
| `test_execute_run_diff_collected` | mock adapter + collect_diff 返回有变更 → run.diff_summary 非空且包含 stat_summary |
| `test_execute_run_diff_no_changes` | mock collect_diff 返回 files_changed=0 → run.diff_summary is None |
| `test_execute_run_diff_collect_fails` | mock collect_diff 抛 RuntimeError → run.status 仍为 completed，diff_summary is None |
| `test_cleanup_stale_runs_marks_failed` | 插入 2 条 running run → 调用清理 → 均变为 failed + exit_code=-1 |
| `test_cleanup_stale_runs_no_stale` | 无 running run → 返回 0，无数据库写入 |
| `test_cleanup_stale_runs_skips_other_status` | 插入 pending/completed/failed run → 清理不影响这些记录 |

### 2. 确认失败

运行 `pytest backend/app/modules/agent/tests/test_diff_collect_integration.py`，全部失败（import 错误或断言失败）。

### 3. 写代码

在 `service.py` 中实现：
1. 在 `_execute_run_background` 第 4 步之后插入 diff 收集步骤
2. 添加模块级 `_cleanup_stale_runs_impl` 函数
3. 在 `AgentService` 上添加 `cleanup_stale_runs` 实例方法

### 4. 确认通过

运行 `pytest backend/app/modules/agent/tests/test_diff_collect_integration.py`，全部通过。

### 5. 回归

运行 `pytest backend/app/modules/agent/tests/` 全套测试，确认无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | mock adapter + collect_diff 返回有变更的 DiffResult，执行 `_execute_run_background` | `run.diff_summary` 非空，包含 `stat_summary` 原文 + 汇总行（含 files_changed 数值） |
| AC-02 | mock collect_diff 返回 `files_changed=0` 的 DiffResult | `run.diff_summary` 为 `None` |
| AC-03 | mock collect_diff 抛出 `RuntimeError` | `run.status` 仍为 `completed`（如果 exit_code=0），`diff_summary` 为 `None`，日志中有 `diff_collect_failed` |
| AC-04 | 插入 2 条 `status='running'` 的 AgentRun，调用 `cleanup_stale_runs` | 两条均变为 `status='failed'`，`exit_code=-1`，`finished_at` 非空，`output_redacted` 包含 "service restarted" |
| AC-05 | 数据库中无 `status='running'` 的 AgentRun，调用 `cleanup_stale_runs` | 返回 0，不执行任何数据库写入 |
| AC-06 | 插入 pending/completed/failed 状态的 AgentRun，调用 `cleanup_stale_runs` | 这些记录 status 不变 |
| AC-07 | 运行 `pytest backend/app/modules/agent/tests/` 全套 | 全部通过，无回归 |
| AC-08 | 检查 `_execute_run_background` 步骤顺序 | diff 收集在第 4 步之后、原第 5 步（Log stdout/stderr）之前 |
