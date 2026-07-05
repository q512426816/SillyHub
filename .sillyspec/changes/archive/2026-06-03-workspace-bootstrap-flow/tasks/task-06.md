---
id: task-06
title: _execute_scan_run 收尾 reparse 单测
priority: P1
estimated_hours: 2
depends_on: [task-02]
blocks: []
allowed_paths:
  - backend/app/modules/agent/tests/test_scan_run_reparse.py
created_at: 2026-06-03 15:22:07
author: WhaleFall
---

# task-06 _execute_scan_run 收尾 reparse 单测

## 背景

task-02 在 `AgentService._execute_scan_run` 的成功收尾分支（`exit_code == 0`，
`backend/app/modules/agent/service.py:1165` 的 `await session.commit()` 之后、
外层 1167 行 `except` 之前）新增「自动 reparse 子组件」逻辑，且 reparse 包在独立
`try/except`，失败只 `log.warning("scan_run_reparse_failed", ...)`，不改 run 状态、
不 re-raise。本任务为该行为补单元测试，锁定三条契约：

1. `exit_code == 0` 时 `WorkspaceService.reparse(workspace_id)` 被调用恰好一次；
2. `exit_code != 0` 时 reparse **不**被调用；
3. reparse 抛异常时 run 仍为 `completed`、`exit_code == 0`，仅记 warning（不抛、不标 failed）。

`_execute_scan_run` 通过 `asyncio.create_task` 在后台拉起，使用独立 DB session
（`backend/app/modules/agent/service.py:1093-1094` 的 `async with factory() as session`）。
**测试可直接 `await svc._execute_scan_run(...)`**（它本身是协程，无需经由 create_task），
只要 mock 掉 adapter 与 reparse 即可，无需真实子进程、真实 Redis、真实 claude CLI。

## 修改文件（精确路径）

- 新增文件：`backend/app/modules/agent/tests/test_scan_run_reparse.py`

> 仅新增此测试文件，不得修改任何源代码（含 `service.py`、`workspace/service.py`）。
> 选址理由：现有 agent service 级测试（`test_kill.py`、`test_m2n_agent_run.py`、
> `test_adapter_isolation.py`）均位于 `backend/app/modules/agent/tests/`，且 task-02
> 的 TDD 步骤明确指向该目录。`backend/tests/modules/agent/` 主要承载 coordinator /
> stage_dispatch 等更高层集成测试，与本单测粒度不符，故择 `app/modules/agent/tests/`。

## 实现要求

公共约定：

- 文件顶部 `from __future__ import annotations`，导入
  `import json, uuid`、`from datetime import datetime`、`from pathlib import Path`、
  `from unittest.mock import AsyncMock, MagicMock, patch`、`import pytest`，
  以及 `from app.modules.agent.model import AgentRun`、
  `from app.modules.agent.service import AgentService`、
  `from app.modules.agent.base import AgentSpecBundle, AgentRunResult`。
- 使用 `db_session`（conftest 提供的内存 SQLite AsyncSession，见
  `backend/conftest.py:71-75`）作为后台 session 的替身：通过 patch
  `app.modules.agent.service.get_session_factory` 让 `factory()` 返回一个产出
  `db_session` 的异步上下文管理器，从而 `_execute_scan_run` 内部
  `async with factory() as session` 拿到测试 session。
- 真实落库一个 `AgentRun`（`status="pending"`，含 `id/agent_type/change_id=None`），
  使后台逻辑能 `session.get(AgentRun, run_id)` 取到并更新；同时真实建一个
  `Workspace` 以便 `workspace_id` 合法（参考 `test_m2n_agent_run.py:20-31`）。
- 构造最小 `AgentSpecBundle`（`change_summary/task_key/task_title` 必填，见
  「接口定义」），`work_dir` 用 `tmp_path`。

### Mock adapter（ADAPTERS['claude_code'].run_with_bundle）

`_execute_scan_run` 内部 `adapter_cls = ADAPTERS.get("claude_code")`（service.py:1103），
然后 `adapter = adapter_cls()`、`result = await adapter.run_with_bundle(run_id, bundle, work_dir)`。
按现有写法（`test_router.py:136-139`）patch 类方法返回伪 result：

```python
def _fake_result(exit_code: int) -> MagicMock:
    r = MagicMock()
    r.exit_code = exit_code
    r.stdout = "scan output"
    r.stderr = ""
    r.redacted_output = "scan output"
    r.timed_out = False
    return r

patch(
    "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
    new=AsyncMock(return_value=_fake_result(0)),
)
```

> 注意：`run_with_bundle` 是 async，故用 `AsyncMock`（而非 `MagicMock`），否则
> `await adapter.run_with_bundle(...)` 会失败。result 本身用同步 `MagicMock`
> （它只是被读属性，不被 await）。

### Spy reparse（WorkspaceService.reparse）

task-02 内部 `from app.modules.workspace.service import WorkspaceService` 后
`svc = WorkspaceService(session)`、`await svc.reparse(workspace_id)`。spy 该方法：

```python
reparse_spy = AsyncMock(
    return_value=(MagicMock(), {"created": 1, "relations_created": 0}, [], [])
)
patch(
    "app.modules.workspace.service.WorkspaceService.reparse",
    new=reparse_spy,
)
```

- 断言被调用：`reparse_spy.assert_awaited_once()`，并校验入参 `workspace_id`
  （`reparse_spy.await_args.args` 或 `.kwargs`，依实现是位置/关键字传参择一断言；
  task-02 伪代码用 `await svc.reparse(workspace_id)` 位置传参，故断言
  `reparse_spy.await_args.args[0] == workspace_id`）。
- 断言未调用：`reparse_spy.assert_not_awaited()`。
- 模拟异常：`reparse_spy = AsyncMock(side_effect=RuntimeError("parse boom"))`。

### 用例 Arrange/Act/Assert

**用例 1：test_scan_run_success_triggers_reparse**
- Arrange：真实建 Workspace + 落库 pending AgentRun；patch factory→db_session；
  patch `run_with_bundle`→`AsyncMock(return_value=_fake_result(0))`；patch
  `WorkspaceService.reparse`→`AsyncMock(return_value=(MagicMock(), {"created":1,...}, [], []))`。
- Act：`await svc._execute_scan_run(run_id=run.id, bundle=bundle, work_dir=tmp_path,
  workspace_id=ws.id, user_id=user_id)`。
- Assert：`reparse_spy.assert_awaited_once()`；`reparse_spy.await_args.args[0] == ws.id`；
  从 db 重新 `await db_session.get(AgentRun, run.id)`，`run.status == "completed"`、
  `run.exit_code == 0`。

**用例 2：test_scan_run_failure_skips_reparse**
- Arrange：同上但 `run_with_bundle`→`_fake_result(1)`；reparse spy 不期望被调用。
- Act：同上 await。
- Assert：`reparse_spy.assert_not_awaited()`；`run.status == "failed"`、`run.exit_code == 1`。

**用例 3：test_scan_run_reparse_exception_keeps_completed**
- Arrange：`run_with_bundle`→`_fake_result(0)`；`reparse`→`AsyncMock(side_effect=RuntimeError("boom"))`；
  用 `caplog`（pytest 内置）捕获日志，`caplog.set_level("WARNING")`（注意项目用
  structlog，见下「边界处理」第 4 条的断言降级策略）。
- Act：`await svc._execute_scan_run(...)`——**不应抛异常**。
- Assert：用例本身未抛（无 `pytest.raises`）；`reparse_spy.assert_awaited_once()`；
  重新取 run：`run.status == "completed"`、`run.exit_code == 0`、`run.finished_at is not None`。

## 接口定义

### 被测方法签名（service.py:1072）

```python
async def _execute_scan_run(
    self,
    *,
    run_id: uuid.UUID,
    bundle: AgentSpecBundle,
    work_dir: Path,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None
```
- 全部关键字参数（`*` 之后）。无返回值；副作用为更新 run、写日志/审计、收尾 reparse。

### AgentService 构造

```python
# backend/app/modules/agent/service.py
svc = AgentService(db_session)   # __init__(self, session: AsyncSession)
```

### mock adapter 的 result 结构（base.py:100-108）

```python
@dataclass
class AgentRunResult:
    exit_code: int          # 0=成功 → 触发 reparse；非 0 → 跳过
    stdout: str             # 写入 AgentRunLog(channel="stdout")
    stderr: str             # 写入 AgentRunLog(channel="stderr")
    redacted_output: str    # 截断 [:10000] 落 run.output_redacted
    timed_out: bool = False
```
- mock 用 `MagicMock`，需至少设置 `exit_code/stdout/stderr/redacted_output/timed_out`
  四到五个属性（被测代码读取 `result.exit_code`、`result.stdout`、`result.stderr`、
  `result.redacted_output`，见 service.py:1127-1136、1159）。`redacted_output` 须为
  真实 str（被切片 `[:10000]`），不能是裸 MagicMock。

### run_with_bundle 签名（base.py:138 / claude_code.py:216）

```python
async def run_with_bundle(
    self,
    run_id: uuid.UUID,
    bundle: AgentSpecBundle,
    lease_path: Path,
    timeout: int = 600,
) -> AgentRunResult
```
- patch 目标字符串：`"app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle"`。

### AgentSpecBundle 最小构造（base.py:52-97）

```python
bundle = AgentSpecBundle(
    change_summary="scan",
    task_key="scan",
    task_title="Scan workspace",
)
```
- 仅三个必填位置/关键字字段无默认值；其余字段（`spec_root`、`stage` 等）有默认值可省略。

### WorkspaceService.reparse 返回（workspace/service.py:372）

```python
async def reparse(
    self, workspace_id: uuid.UUID,
) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]
```
- spy `return_value` 用 `(MagicMock(), {"created": 1, "relations_created": 0}, [], [])`
  即可满足 task-02 收尾对 `stats.get("created")` / `stats.get("relations_created")` 的读取。

## 边界处理（至少 5 条测试场景）

1. **成功收尾调用 reparse 一次且传对 workspace_id**（用例 1）：`exit_code == 0`，
   `reparse_spy.assert_awaited_once()` 且 `await_args.args[0] == ws.id`。
2. **失败不 reparse**（用例 2）：`exit_code == 1`，`reparse_spy.assert_not_awaited()`，
   run.status == "failed"。
3. **reparse 抛异常 run 仍 completed 且不抛出**（用例 3）：`side_effect=RuntimeError`，
   `_execute_scan_run` 不抛、run.status == "completed"、exit_code == 0。
4. **reparse 失败仅 warning（不连带外层 except 标 failed）**：用例 3 额外断言 run
   未被外层 1167 行 except 改成 failed（即 status 仍 completed、exit_code 仍为 0，
   不是 -1）。日志断言策略：项目用 structlog，`caplog` 可能捕获不到结构化字段；
   **优先**断言「run 状态正确 + 未抛异常」这一可观察行为；如需校验 warning，
   patch `app.modules.agent.service.log.warning`（`log` 为模块级 `get_logger`，
   service.py:36）为 `MagicMock`，断言 `log.warning.assert_called_once()` 且首位参数
   含 `"scan_run_reparse_failed"`。降级保证：即便不校验日志，前述行为断言已锁定契约。
5. **reparse 返回空 created（projects 为空）不报错**：另设
   `test_scan_run_reparse_empty_created`，reparse spy 返回
   `(MagicMock(), {"created": 0, "relations_created": 0}, [], [])`，断言
   `_execute_scan_run` 正常结束、run.status == "completed"、reparse 被调用一次
   （验证收尾对「无子组件」结果的容忍）。
6. **adapter 缺失早退不触发 reparse**（可选增强）：patch
   `app.modules.agent.service.ADAPTERS` 为 `{}`，使 `ADAPTERS.get("claude_code")`
   返回 None 走 service.py:1104-1111 早退分支，断言 `reparse_spy.assert_not_awaited()`
   且 run.status == "failed"。
7. **run 记录缺失早退不触发 reparse**（可选增强）：传一个数据库中不存在的
   `run_id`（不落库 AgentRun），走 service.py:1098-1100 `return`，断言
   `reparse_spy.assert_not_awaited()`，且不抛异常。

> 必备场景下限为 1/2/3/4/5 五条；6/7 为加分覆盖，建议一并实现以钉住早退分支。

## 非目标

- 不测前端（弹窗 / 详情页由 task-03 / task-04 负责，本任务纯后端单测）。
- 不测 `scan_generate` 幂等（task-05 范围）。
- 不验证 `reparse` 内部解析 / UPSERT / relations 正确性（reparse 自身已有测试，
  本任务只 spy 其被调用与否，**不**断言子 workspace 真实落库数量）。
- 不测真实 claude CLI / 子进程 / Redis 发布（全部 mock）。
- 不修改 `service.py` 或 `workspace/service.py` 源代码。
- 不验证审计日志 `AuditLog` 内容（属 task-02 既有行为，非本收尾契约重点）。

## 参考（现有 agent service 测试写法）

- **service 级单测 + mock_session/adapter_service fixture**：
  `backend/app/modules/agent/tests/test_kill.py:18-34`（`AsyncMock` session、
  `AgentService(mock_session)`、`autouse` 清理 registry）。
- **patch adapter.run_with_bundle 返回伪 result**：
  `backend/app/modules/agent/tests/test_router.py:128-139`
  （`mock_result.exit_code=0` 等属性 + `patch(".../ClaudeCodeAdapter.run_with_bundle")`）。
- **真实建 Workspace / AgentRun helper**：
  `backend/app/modules/agent/tests/test_m2n_agent_run.py:20-77`。
- **db_session / tmp_path fixtures**：`backend/conftest.py:44-75`
  （内存 SQLite，`db_session` 直接可用，无需真实 PG/Redis）。
- **patch asyncio 子进程 + Redis 模式**（如需深入 mock）：
  `backend/app/modules/agent/tests/test_kill.py:246-319`。
- **被测后台 session 模式 / 局部 import / 早退分支**：
  `backend/app/modules/agent/service.py:1090-1167`。

## TDD 步骤

1. **建桩（红）**：新建 `test_scan_run_reparse.py`，写好三条必备用例
   （success / failure / reparse-exception）的函数骨架与 patch 目标字符串，
   先运行确认能 import、能命中 `_execute_scan_run`（task-02 未实现 reparse 前，
   用例 1/3 因 reparse 未被调用而失败——即「红」）。
2. **依赖 task-02 落地实现**：task-02 在 service.py:1165 commit 后插入守卫 + reparse
   try/except 后，用例 1/3 应转绿；用例 2（失败跳过）在 task-02 前后均应绿
   （`exit_code != 0` 本就不进收尾）。
3. **补边界（用例 5 及可选 6/7）**：补空 created、adapter 缺失、run 缺失场景。
4. **跑测试**：
   `pytest backend/app/modules/agent/tests/test_scan_run_reparse.py -v`，
   以及 `pytest backend/app/modules/agent/tests/ -k scan_run` 全绿。
5. **重构**：抽出 `_fake_result(exit_code)` 与 `_setup(db_session, tmp_path)` helper
   复用，patch 目标字符串集中常量化，确认 `AsyncMock` 用于 async（run_with_bundle /
   reparse），`MagicMock` 用于同步 result 对象。

## 验收标准

| AC | 验收点 | 验证方式 | 期望 |
|---|---|---|---|
| AC-1 | 成功 scan 触发 reparse 一次 | 用例 1：mock `run_with_bundle` 返回 exit_code==0，spy reparse | `reparse_spy.assert_awaited_once()` 且 `await_args.args[0]==workspace_id`，run.status=="completed"、exit_code==0 |
| AC-2 | 失败 scan 不 reparse | 用例 2：mock 返回 exit_code==1 | `reparse_spy.assert_not_awaited()`，run.status=="failed"、exit_code==1 |
| AC-3 | reparse 异常不连带 run 失败、不抛出 | 用例 3：reparse `side_effect=RuntimeError` | `_execute_scan_run` 不抛异常，run.status=="completed"、exit_code==0、finished_at 非空 |
| AC-4 | reparse 失败仅 warning | 用例 3：patch `service.log.warning` 为 MagicMock（或退化为行为断言） | `log.warning` 以 `"scan_run_reparse_failed"` 调用一次（或至少 run 状态未被外层 except 改为 failed/-1） |
| AC-5 | 空 created 收尾不报错 | 用例 5：reparse 返回 `{"created":0,...}` | `_execute_scan_run` 正常结束，run.status=="completed"，reparse 被调用一次 |
| AC-6 | 测试隔离无外部依赖 | 全部用例用 db_session + tmp_path + mock，不连真实 CLI/Redis/PG | `pytest .../test_scan_run_reparse.py -v` 全绿，无网络/子进程 |
| AC-7 | 变更范围受限 | git diff 仅新增 `backend/app/modules/agent/tests/test_scan_run_reparse.py` | 无源代码改动 |
