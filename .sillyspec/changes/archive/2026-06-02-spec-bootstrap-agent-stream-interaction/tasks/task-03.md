---
id: task-03
title: 更新 spec bootstrap 后端测试
priority: P0
estimated_hours: 3
author: qinyi
created_at: 2026-06-02T10:00:00
depends_on:
  - task-01
  - task-02
blocks:
  - task-10
allowed_paths:
  - backend/app/modules/spec_workspace/tests/test_bootstrap.py
---

# task-03: 更新 spec bootstrap 后端测试

本任务只更新 spec bootstrap 的后端测试，验证 task-01、task-02 已把 `/spec-bootstrap` 从同步直接执行 `sillyspec init` 改为异步创建 `AgentRun`、后台调用 `ClaudeCodeAdapter.run_with_bundle()`、再由后端 `SpecValidator` 收尾。

## 修改文件

- `backend/app/modules/spec_workspace/tests/test_bootstrap.py`
  - 替换当前围绕 `_run_sillyspec_init()`、同步 `stdout/stderr/command` 返回值的断言。
  - 新增或重写服务层测试，覆盖立即返回、`AgentRun`/`AgentRunWorkspace` 持久化、后台 adapter 调用、验证成功、验证失败、adapter 失败、后台异常、not found。
  - 不修改生产代码、不修改 `backend/app/modules/agent/tests/test_router.py`；该文件只作为 mocking 和 SSE 测试风格参考。

## 实现要求

- 测试必须以 task-01/task-02 的新契约为准：`SpecBootstrapService.bootstrap()` 创建 run 后立即返回，不等待 Claude Code 或 validator 完成。
- 移除对 `SpecBootstrapService._run_sillyspec_init` 的 patch；该直接 CLI 私有方法在新实现中不应再是测试依赖。
- 增加 adapter 结果 helper，例如 `_fake_agent_result(...) -> AgentRunResult`，字段覆盖 `exit_code`、`stdout`、`stderr`、`redacted_output`、`timed_out`。
- 立即返回测试应 patch 后台调度点，例如 `asyncio.create_task` 或 task-01 引入的等价 helper，避免测试真正启动后台协程；如捕获到 coroutine，必须关闭或 await，避免 `RuntimeWarning: coroutine was never awaited`。
- 后台执行测试应直接调用 task-02 暴露的后台执行函数或方法，例如 `_execute_bootstrap_agent_run(...)`；如果实际名称不同，以实现为准，但断言同一行为契约。
- adapter patch 路径优先对齐现有 agent router 测试：`app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle`，除非 task-02 在 bootstrap 模块中引入了更窄的 import 路径。
- 对传入 adapter 的 `AgentSpecBundle` 做结构化断言：
  - `task_key == "spec-bootstrap"`
  - `task_title == "Bootstrap spec workspace"`
  - `available_tools` 包含 `"sillyspec"`
  - `allowed_paths` 同时覆盖 `spec_root` 和 workspace `root_path`
  - `platform_metadata["bootstrap"] is True`
  - `platform_metadata["workspace_id"] == str(workspace.id)`
  - `proposal` 或 `task_markdown` 包含 `sillyspec init --dir` 与 `sillyspec run scan --dir`
- 成功路径要断言 DB 终态，而不是只看返回 dict：`AgentRun.status == "completed"`、`exit_code == 0`、`SpecWorkspace.sync_status == "clean"`、`last_synced_at` 被设置、存在 `spec_bootstrap.complete` 审计事件。
- 失败路径要断言可观测状态：`AgentRun.status == "failed"`、`SpecWorkspace.sync_status == "dirty"`、`AgentRunLog(channel="stderr")` 或 command/validation `SpecConflict` 被写入。
- 测试不得启动真实 `claude`、`sillyspec`、Redis、文件 watcher 或外部网络请求。

## 接口定义

- `SpecBootstrapService.bootstrap(workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict`
  - 期望立即返回：
    - `agent_run_id: str`
    - `stream_url: str`，形如 `/api/workspaces/{workspace_id}/agent/runs/{run_id}/stream`
    - `status: "pending"`，或实现明确采用的初始可流式状态
    - `spec_root: str`
    - `message: str`
  - 不再同步返回 `stdout`、`stderr`、`command`、`validation_passed` 作为主要结果。
- `ClaudeCodeAdapter.run_with_bundle(run_id, bundle, lease_path, timeout=..., on_log=...) -> AgentRunResult`
  - `bundle` 类型为 `AgentSpecBundle`。
  - `lease_path`/`work_dir` 应指向可执行 bootstrap 的 workspace code root 或 task-02 约定的工作目录。
  - `on_log(channel: str, content: str, ts: str)` 被调用时，后台执行逻辑应写入 `AgentRunLog`。
- 需要断言的持久化模型：
  - `AgentRun`: `agent_type="claude_code"`，`status` 生命周期为 `pending -> running -> completed/failed`。
  - `AgentRunWorkspace`: 关联 bootstrap run 与 workspace。
  - `AgentRunLog`: 保存 stdout/stderr/tool_call 等 adapter 日志。
  - `SpecWorkspace`: 保存 `sync_status` 与 `last_synced_at`。
  - `SpecConflict`: 保存 command 或 validation 失败。
  - `AuditLog`: 至少覆盖 `spec_bootstrap.start` 与 `spec_bootstrap.complete`。

## 边界处理

- 缺少 `SpecWorkspace` 或 `Workspace` 时，保留 `SpecWorkspaceNotFound` 行为，不创建 `AgentRun`、目录或审计记录。
- `bootstrap()` 立即返回时，后台任务尚未执行；测试不能要求 `sync_status` 已变为 `clean` 或 `dirty`。
- adapter 返回 `exit_code != 0` 时，即使 validator 可能通过，也必须判定 run 失败、`sync_status="dirty"`，并创建 `conflict_type="command"` 的 `SpecConflict`。
- validator 返回错误时，adapter `exit_code == 0` 也必须判定 run 失败、`sync_status="dirty"`，并为 validation issues 创建 `SpecConflict`。
- adapter 抛出异常时，后台执行逻辑必须捕获异常并把 run 落到 `failed`，写入 stderr/error 日志，避免 run 永远卡在 `running`。
- adapter 的 `on_log` 回调可能在最终结果前写入多条日志；测试应断言日志被持久化，不依赖固定批量 flush 次数。
- SSE 订阅可能晚于日志写入；本任务只断言 bootstrap 写入 `AgentRunLog`，不重复测试 agent router 的 stream replay 细节。
- `spec_root` 目录创建应保持幂等；目录已存在时测试不应期待异常。
- 成功验证所需的最小 spec 文件应由测试 fixture 或 adapter side effect 明确写入，避免依赖真实 CLI 生成。
- 后台调度被 patch 时，要处理被拦截 coroutine 的生命周期，避免测试污染事件循环。

## 非目标

- 不实现或修改 `SpecBootstrapService`、`SpecValidator`、`ClaudeCodeAdapter`、agent router、Redis/SSE 服务。
- 不新增 `POST /agent/runs/{run_id}/input` 的测试；这是 task-05 的范围。
- 不修改前端 API 类型、Workspace 页面、Agent 控制台或文档。
- 不做真实端到端 Claude Code/SillySpec CLI 测试。
- 不扩大 allowed paths；如生产代码行为不满足这些测试，把失败反馈给 task-01/task-02，而不是在本任务中修生产代码。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
  - 决策 1：`/spec-bootstrap` 异步返回 `AgentRun`
  - 决策 2：恢复 `AgentSpecBundle + ClaudeCodeAdapter` 边界
  - 决策 3：最终状态由 `SpecValidator.validate(spec_root)` 决定
  - 后台执行流程与兼容策略
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md`
  - task-03 目标：覆盖立即返回、adapter 调用、验证成功/失败、后台异常
- `backend/app/modules/spec_workspace/bootstrap.py`
  - 当前旧实现仍是同步直接 CLI；测试需要迁移到新契约
- `backend/app/modules/spec_workspace/tests/test_bootstrap.py`
  - 当前测试 helpers、workspace/spec workspace fixture 可复用
- `backend/app/modules/agent/tests/test_router.py`
  - `ClaudeCodeAdapter.run_with_bundle` patch 风格、`AgentRunResult` mock 风格、SSE 日志断言风格

## TDD 步骤

1. 先运行现有目标测试，记录旧测试对 `_run_sillyspec_init()` 和同步返回字段的依赖：
   ```powershell
   pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py -q
   ```
2. 重写测试 helpers：
   - 保留 `_create_workspace()`、`_create_spec_workspace()`。
   - 用 `_fake_agent_result()` 替换 `_fake_init_result()`。
   - 增加查询 `AgentRun`、`AgentRunLog`、`AgentRunWorkspace`、`AuditLog`、`SpecConflict` 的小 helper 时，保持在同一个测试文件内。
3. 先写立即返回测试：
   - patch 后台调度。
   - 调用 `SpecBootstrapService.bootstrap()`
   - 断言返回 `agent_run_id`、`stream_url`、`status`、`spec_root`。
   - 断言 `AgentRun` 为 pending、`agent_type="claude_code"`、存在 `AgentRunWorkspace` 与 start audit。
   - 断言没有同步调用 adapter 或 validator。
4. 写 adapter bundle 测试：
   - 直接执行后台 helper。
   - patch `ClaudeCodeAdapter.run_with_bundle`。
   - 捕获 `AgentSpecBundle` 并断言 bootstrap 专用字段、allowed paths、metadata、prompt 内容。
5. 写成功收尾测试：
   - adapter side effect 写入最小可通过 validator 的 `.sillyspec/projects/*.yaml`。
   - 返回 `AgentRunResult(exit_code=0, ...)`。
   - 断言 run completed、sync clean、`last_synced_at`、complete audit、stdout/log 持久化。
6. 写 validation failure 测试：
   - adapter 返回成功但写入缺失或非法 spec。
   - 断言 run failed、sync dirty、validation `SpecConflict(stage="bootstrap")`。
7. 写 adapter failure 与异常测试：
   - `exit_code=1, stderr="boom"` 覆盖 command conflict。
   - `side_effect=RuntimeError("boom")` 覆盖后台异常落库。
8. 保留 not found 测试，并确认不会创建 run。
9. 运行目标测试；若失败来自 production 契约未完成，记录失败给 task-01/task-02，不在本任务越界修改生产代码：
   ```powershell
   pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py -q
   ```

## 验收标准

| 编号 | 标准 | 验证方式 |
|---|---|---|
| AC-01 | `bootstrap()` 测试验证立即返回 `agent_run_id`、`stream_url`、初始 `status`、`spec_root`，不等待后台执行完成 | 目标测试中 patch 后台调度并断言 adapter 未同步调用 |
| AC-02 | 测试验证 bootstrap 创建 `AgentRun(agent_type="claude_code")` 与 `AgentRunWorkspace` 关联 | 查询 DB 并断言 run/workspace 关联存在 |
| AC-03 | 测试验证传给 `ClaudeCodeAdapter.run_with_bundle()` 的 `AgentSpecBundle` 包含 bootstrap task key、allowed paths、sillyspec tool、metadata 和 init/scan 指令 | 捕获 mock call 的 `bundle` 参数并断言字段 |
| AC-04 | adapter 成功且 validator 通过时，测试验证 run completed、exit_code 0、sync clean、`last_synced_at` 和 complete audit | 后台 helper 测试查询 DB |
| AC-05 | adapter 成功但 validator 失败时，测试验证 run failed、sync dirty、创建 validation `SpecConflict` | 构造非法 spec，查询 DB |
| AC-06 | adapter 返回非零退出码时，测试验证 run failed、stderr 日志、sync dirty、创建 command `SpecConflict` | mock `AgentRunResult(exit_code=1, stderr="boom")` |
| AC-07 | adapter 抛异常时，测试验证 run 不停留在 running，错误被写入日志或 output，sync dirty 或保持失败可观测状态 | mock `side_effect=RuntimeError(...)` 并查询 DB |
| AC-08 | 缺少 spec workspace/workspace 的 not found 行为仍被覆盖 | 保留或更新 `pytest.raises(SpecWorkspaceNotFound)` 测试 |
| AC-09 | 测试文件不再依赖 `_run_sillyspec_init()` 或真实 `sillyspec` CLI | `rg "_run_sillyspec_init|sillyspec init\""` 只允许出现在断言 prompt 文本中 |
| AC-10 | 目标测试在 task-01/task-02 完成后通过 | `pytest backend/app/modules/spec_workspace/tests/test_bootstrap.py -q` |
