---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-01
title: 删除 SERVER 执行路径 + 新增 NoOnlineDaemonError
priority: P0
depends_on: []
blocks: [task-03, task-04, task-11]
allowed_paths:
  - backend/app/modules/agent/adapters/claude_code.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/base.py
  - backend/app/modules/agent/__init__.py
  - backend/app/modules/agent/adapters/__init__.py
  - backend/app/modules/agent/tests/test_adapter_isolation.py
---

# task-01: 删除 SERVER 执行路径 + 新增 NoOnlineDaemonError

> 对应 plan 全局验收 1 / 3；风险 R-01（删除面广）、R-05（dev 无 daemon 开发摩擦）。
> 对应 design §Phase 1（87-92）、§9 兼容策略（298-304）。

## 修改文件

- `backend/app/modules/agent/adapters/claude_code.py` — **整文件删除**（902 行：`_build_claude_command` / `_build_stream_input` / `_exec_stream` / `_parse_stream_events` / `_format_conversation_log` / `_extract_result_metadata` / `ClaudeCodeAdapter.run_with_bundle` / `ClaudeCodeAdapter.run`）
- `backend/app/modules/agent/adapters/__init__.py` — 移除对 `claude_code` 模块 / `ClaudeCodeAdapter` 的 import 与 re-export
- `backend/app/modules/agent/service.py` — 删除三条 SERVER 执行体 `_execute_run_background`(348) / `_execute_stage_run`(970) / `_execute_scan_run`(1341)；删除 `_proc_registry`(143)；删除 `kill_run` 内 SIGTERM→5s→SIGKILL 链(487-543)；删除 `collect_diff` 调用(424-426)；移除三处 `if backend == ExecutionBackend.DAEMON ... else SERVER fallback` 分支(845/861、1313 之后) ，三处 dispatch 调用改为「失败即终止 + 置 failed」
- `backend/app/modules/agent/placement.py` — 删除 `dispatch_to_server`(193)；`decide_backend`(55) 去 SERVER 分支与 `preferred_backend="server"` 支持(87-106)；`ExecutionBackend.SERVER` 枚举值(36) 保留（避免历史数据/外部反序列化报错）但不再产生；新增 `NoOnlineDaemonError` 异常类
- `backend/app/modules/agent/base.py` — **无逻辑改动**（`AgentAdapter` ABC 保留于 124 行，作为未来扩展点，不动）
- `backend/app/modules/agent/tests/test_adapter_isolation.py` — 删除针对 `ClaudeCodeAdapter` 的测试用例（保留其他 adapter 隔离测试）

## 实现要求

1. **先删 claude_code.py 整文件**（`backend/app/modules/agent/adapters/claude_code.py`，902 行），同步清理 `adapters/__init__.py` 与任何 import（`grep -rn "claude_code\|ClaudeCodeAdapter" backend/app` 必须无命中，测试文件除外）。
2. **删除 service.py 三条执行体**：`_execute_run_background`(348) / `_execute_stage_run`(970) / `_execute_scan_run`(1341) 整函数体（连同其内部 `collect_diff`(424-426) 调用、`render_bundle_to_claude_md` 渲染、`asyncio.create_subprocess_exec` 调用、Redis publish 逻辑）。
3. **删除 `_proc_registry`**：`service.py:143` 的类属性 `dict[uuid.UUID, asyncio.subprocess.Process]` 及所有读写点。
4. **重写 `kill_run`**(487-543)：删除 `proc = self._proc_registry.get(run_id)`(519)、`proc.send_signal(signal.SIGTERM)`(525)、`SIGKILL`(533)、`self._proc_registry.pop(run_id, None)`(543)；本任务只把 SERVER 侧 SIGTERM 链拆掉，**改道 `cancel_lease` 的实现在 task-04**（本任务保留 `kill_run` 签名 `async def kill_run(self, run_id: uuid.UUID) -> AgentRun`，函数体可暂时留空壳/`pass` 或调用 task-04 将注入的 `DaemonLeaseService`，确保不阻塞 task-03/04）。
   - **执行顺序说明**：task-01 与 task-04 都改 `kill_run`，但 task-01 先做、task-04 后做；task-01 阶段 `kill_run` 改为「仅删除 SERVER 链 + TODO 标注待 task-04 接入 cancel_lease」，`grep "SIGTERM" service.py` 必须在本任务结束时无命中。
5. **三处 dispatch 入口（start_run 330/845、start_stage_dispatch 846、start_scan_dispatch 1313）的分支简化**：移除 `if backend == ExecutionBackend.DAEMON: ... else: SERVER fallback` 双分支，改为「无在线 daemon → 抛 `NoOnlineDaemonError`，外层 try 捕获 → 置 `AgentRun.status="failed"` + `error_code="no_online_daemon"` + `output_redacted="未检测到在线 daemon，请启动 sillyhub-daemon 后重试"`」。
   - **注意**：本任务仅改 dispatch 入口的分支判断逻辑；`dispatch_to_daemon` 的**签名扩展**（加 repo_url/branch/allowed_paths/tool_config/timeout_seconds）在 **task-03** 完成。本任务 dispatch_to_daemon 调用仍用旧签名 `dispatch_to_daemon(run.id, user_id)`。
6. **新增 `NoOnlineDaemonError`**（位于 `placement.py`，与 `ExecutionBackend` 同文件）：携带 `workspace_id: uuid.UUID | None`、`user_id: uuid.UUID`；`__str__` 返回「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」。
7. **`decide_backend` 签名兼容性**：保留 `preferred_backend: str | None = None` 参数（防止外部调用方传参报 TypeError），但行为改为：若 `preferred_backend="server"` → 抛 `NoOnlineDaemonError`（不再静默 fallback）；其他值忽略，走 daemon-only 路径。**返回类型保留 `ExecutionBackend`**，但实际只会返回 `DAEMON`（或抛异常）。
8. **`ExecutionBackend.SERVER` 枚举值不删**（保留于 36 行，防止既有 DB 序列化数据 / 反序列化报错；本项目数据可清空，但保留枚举零成本且更安全）。
9. **`base.py` 的 `AgentAdapter` ABC 完全不动**（124 行），仅删除其子类 `ClaudeCodeAdapter`。
10. **import 清理**：`service.py` 顶部移除 `from app.modules.agent.adapters.claude_code import ...`（如有）、`import signal`、`import asyncio.subprocess` 等 SERVER 路径专属 import；保留 daemon 路径所需 import。

## 接口定义

### 新增异常（placement.py）

```python
class NoOnlineDaemonError(Exception):
    """无在线 daemon，SERVER 路径已删除，无法执行 AgentRun。

    上层（AgentService 三处 dispatch 入口）捕获后：
    - 置 AgentRun.status = "failed"
    - AgentRun.error_code = "no_online_daemon"
    - AgentRun.output_redacted = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
    """

    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID,
        message: str = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试",
    ) -> None:
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.message = message
        super().__init__(message)
```

### AgentRun.error_code 字段说明

> **需 execute 时确认**：`AgentRun` model 是否已有 `error_code` 列。若无，本任务**新增**该列（`String | None`，可空），并加入迁移（本项目未上线，可清空数据，无需兼容）。若已有则直接写入。

```python
# AgentRun model（backend/app/modules/agent/model.py，若 error_code 不存在则新增）
error_code: Mapped[str | None] = mapped_column(String, nullable=True)
```

### 三处 dispatch 入口捕获模式（service.py 范式）

```python
# start_run / start_stage_dispatch / start_scan_dispatch 通用模式
try:
    backend = await placement.decide_backend(
        workspace_id=workspace_id,
        user_id=user_id,
        preferred_backend=preferred_backend,  # 保留参数，行为已改
        # change_id/task_id 仅按原签名传
    )
    # backend 现在恒为 DAEMON；decide_backend 内部无 daemon 时已抛 NoOnlineDaemonError
    lease_id = await placement.dispatch_to_daemon(run.id, user_id)
    # ... task-03 会扩签名
except NoOnlineDaemonError as exc:
    run.status = "failed"
    run.error_code = "no_online_daemon"
    run.output_redacted = exc.message
    run.finished_at = datetime.now(UTC)
    self._session.add(run)
    await self._session.commit()
    log.warning("agent_run_failed_no_online_daemon", run_id=str(run.id), user_id=str(exc.user_id))
    return run
```

### kill_run（task-01 阶段的空壳，待 task-04 接入）

```python
async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
    """Terminate a running agent execution.

    SERVER-side SIGTERM/SIGKILL chain removed (task-01).
    Cancel-lease integration added in task-04.
    """
    # TODO(task-04): 接入 DaemonLeaseService.cancel_lease(agent_run_id)
    # 本任务阶段保留 run 状态查询与返回，避免 task-03/04 阻塞
    ...
```

## 边界处理

1. **（null/空值）** `NoOnlineDaemonError` 的 `workspace_id` 允许为 `None`（scan run 可能无 workspace 关联），`user_id` 必填；构造时校验 `user_id is not None`，否则 TypeError。
2. **（兼容性 brownfield）** `ExecutionBackend.SERVER` 枚举值**保留不删**，避免既有 `daemon_task_leases`/`AgentRun` 历史数据反序列化失败；本项目未上线数据可清空，但保留枚举零成本。`preferred_backend` 参数保留签名但语义变更（"server" → 抛异常，不再 fallback）。
3. **（异常不静默吞）** 三处 dispatch 入口捕获 `NoOnlineDaemonError` 后必须显式写回 `AgentRun.status="failed"` + `error_code` + `output_redacted` 并 `commit`；**禁止**捕获后 `pass` 或仅 log。其他异常（DB 错误等）向上抛由 FastAPI 处理。
4. **（参数不可变）** `decide_backend` 的入参 `preferred_backend` 不做 mutate；`NoOnlineDaemonError` 构造后字段只读。
5. **（歧义/冲突）** 若 `decide_backend` 内部 `_get_online_runtime` 返回 None 但 `preferred_backend="server"` 仍调用方意图——明确**以异常告知**而非静默执行 SERVER（SERVER 已删，无路径）；调用方需调整传参或启动 daemon。
6. **（task-01 vs task-04 对 kill_run 的协作）** task-01 只删 SERVER 链 + 留 TODO 标注；task-04 接入 `cancel_lease`。两任务通过 plan 依赖关系（task-04 depends_on=[task-01]）保证顺序。execute 时若 task-01 先 merge 而 task-04 未做，`kill_run` 为空壳——**临时接受**（kill 调用幂等返回 run），task-04 补全。
7. **（清理孤儿 import）** 删除 claude_code.py 后，全仓库 `grep -rn "ClaudeCodeAdapter\|claude_code" backend/app`（除 test_adapter_isolation.py 的清理）必须无命中；包括 `service.py` / `coordinator.py` / 任何 `__init__.py`。

## 非目标

- **不**删除 `agent/base.py` 的 `AgentAdapter` ABC（保留为扩展点，design §Phase 1 明确）。
- **不**扩展 `dispatch_to_daemon` 签名（repo_url/branch/allowed_paths/tool_config/timeout_seconds）——那是 **task-03** 的范围。本任务 dispatch_to_daemon 调用仍用旧 2 参数签名。
- **不**接入 `DaemonLeaseService.cancel_lease` 到 `kill_run`——那是 **task-04** 的范围。本任务 `kill_run` 仅删 SERVER 链 + 留空壳。
- **不**新增 execution-context 端点（task-02）。
- **不**改 `ExecutionBackend` 枚举结构（仅改 `decide_backend` 行为）。
- **不**改前端 / daemon 子项目（本 Wave 1 仅后端 agent 模块）。
- **不**为 SERVER 路径留特性开关或灰度（design §9 破坏性切换）。

## TDD 步骤

1. **写测试** `backend/app/modules/agent/tests/test_no_online_daemon.py`（新建）：
   - `test_decide_backend_raises_no_online_daemon_when_no_runtime`：mock `_get_online_runtime` 返回 None → `pytest.raises(NoOnlineDaemonError)`
   - `test_decide_backend_preferred_server_raises`：传 `preferred_backend="server"` → `pytest.raises(NoOnlineDaemonError)`（不再 fallback）
   - `test_start_run_sets_failed_with_error_code`：mock decide_backend 抛 NoOnlineDaemonError → AgentRun.status=="failed" + error_code=="no_online_daemon" + output_redacted 含「未检测到在线 daemon」
   - `test_claude_code_module_removed`：`import importlib; pytest.raises(ModuleNotFoundError)` for `app.modules.agent.adapters.claude_code`
2. **确认失败**：`cd backend && uv run pytest app/modules/agent/tests/test_no_online_daemon.py -q` → 全红（claude_code 还在 / NoOnlineDaemonError 未定义）。
3. **写实现**：按「实现要求」逐条改 5 个文件。
4. **确认通过**：重跑上述测试 → 全绿。
5. **回归**：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`（plan 风险 R-01 应对）；同时 `grep -rn "_build_claude_command\|_exec_stream\|_execute_.*_background\|_proc_registry\|dispatch_to_server" backend/app` 必须无命中（验收 1）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -rn "_build_claude_command\|_exec_stream\|_execute_run_background\|_execute_stage_run\|_execute_scan_run\|_proc_registry\|dispatch_to_server\|ClaudeCodeAdapter" backend/app`（不含 tests/） | **无命中**（对齐 plan 全局验收 1） |
| AC-02 | `test -f backend/app/modules/agent/adapters/claude_code.py && echo EXISTS` | 输出非 `EXISTS`（文件已删除）；`backend/app/modules/agent/base.py` 仍存在且 `AgentAdapter` ABC 在第 124 行 |
| AC-03 | `grep -n "SIGTERM\|SIGKILL\|_proc_registry" backend/app/modules/agent/service.py` | 无命中（task-01 阶段 kill_run 已拆链，task-04 接 cancel_lease 后仍无 SIGTERM） |
| AC-04 | `grep -n "class NoOnlineDaemonError" backend/app/modules/agent/placement.py` | 命中 1 行；异常含 `workspace_id` / `user_id` / `message` 三字段 |
| AC-05 | 单测：`test_start_run_sets_failed_with_error_code`（mock 无在线 daemon 触发 start_run） | AgentRun.status=="failed" 且 error_code=="no_online_daemon" 且 output_redacted 含「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」（对齐 plan 全局验收 3） |
| AC-06 | 单测：`test_decide_backend_preferred_server_raises`（传 preferred_backend="server"） | `pytest.raises(NoOnlineDaemonError)`（对齐 plan 全局验收 11：preferred_backend="server" 不再支持） |
| AC-07 | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` | 全绿且覆盖率 ≥ 60%（风险 R-01 应对） |
| AC-08 | `grep -rn "preferred_backend=\"server\"\|preferred_backend='server'" backend/app` | 调用方仍可传该值但行为已变（不报错，抛 NoOnlineDaemonError）；本任务不强制改调用方，但 service.py 三处入口的 else SERVER fallback 分支已删 |
