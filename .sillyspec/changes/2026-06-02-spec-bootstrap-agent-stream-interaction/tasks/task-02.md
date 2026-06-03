---
author: qinyi
created_at: 2026-06-02T09:59:36
id: task-02
title: 实现 bootstrap 后台 ClaudeCodeAdapter 执行与验证收尾
priority: P0
estimated_hours: 5
depends_on:
  - task-01
blocks:
  - task-03
allowed_paths:
  - backend/app/modules/spec_workspace/bootstrap.py
---

# task-02: 实现 bootstrap 后台 ClaudeCodeAdapter 执行与验证收尾

## 修改文件

- `backend/app/modules/spec_workspace/bootstrap.py`

本任务只允许修改上面这个文件。不要修改 router、agent adapter、validator、测试、前端或文档；这些由后续任务覆盖。

## 实现要求

1. 在 task-01 已完成的异步启动基础上，补齐 bootstrap 后台执行函数。`bootstrap()` 创建 `AgentRun(status="pending", agent_type="claude_code")` 并返回后，后台任务必须独立完成运行、日志、验证、状态和审计收尾。
2. 后台任务必须使用新的 DB session，不能复用请求级 `self._session`。使用 `app.core.db.get_session_factory()` 在后台函数内创建 `AsyncSession`，避免请求结束后 session 关闭导致 run 卡住。
3. 不再执行裸 `sillyspec` 子进程。删除或停止调用 `_run_sillyspec_init()`，后台执行必须通过 `ClaudeCodeAdapter.run_with_bundle()` 完成。
4. 构造 bootstrap 专用 `AgentSpecBundle`，字段必须包含：
   - `change_summary="Spec workspace bootstrap"`
   - `task_key="spec-bootstrap"`
   - `task_title="Bootstrap spec workspace"`
   - `proposal` 或 `task_markdown` 明确说明平台托管 spec root 初始化目标
   - `task_markdown` 明确要求运行 `sillyspec init --dir <spec_root>` 和 `sillyspec run scan --dir <spec_root>`
   - `allowed_paths=[str(spec_root), str(code_root)]`
   - `available_tools=["sillyspec"]`
   - `spec_strategy=spec_ws.strategy`
   - `profile_version=spec_ws.profile_version`
   - `platform_metadata={"bootstrap": True, "workspace_id": str(workspace_id), "spec_root": str(spec_root), "code_root": str(code_root)}`
5. 为 adapter 准备稳定运行目录。优先使用 `spec_root / ".runtime" / "bootstrap" / str(run_id)`，创建目录后传给 `run_with_bundle()` 作为 `lease_path`，避免 adapter 把 `CLAUDE.md` 写到代码仓库根目录。
6. prompt 必须要求 Claude 不要等待真实 stdin 交互；遇到需要用户确认的内容时，写入日志说明阻塞点并继续使用保守默认值，无法继续时正常失败。完整用户指导接口由 task-04/task-05 实现。
7. 给 `run_with_bundle()` 传入 `on_log` callback，将 adapter 的 stdout/tool_call 增量写入 `AgentRunLog`。单条 `content_redacted` 最多保存 4000 字符，累计若干条后 commit，结束时 flush。
8. adapter 返回后必须运行 `SpecValidator.validate(spec_root)`。最终成功条件是 `result.exit_code == 0 and report.passed`，不能只依赖 Claude CLI exit code。
9. 成功时更新：
   - `AgentRun.status="completed"`
   - `AgentRun.finished_at`
   - `AgentRun.exit_code=result.exit_code`
   - `AgentRun.output_redacted=result.redacted_output[:10000]`
   - `SpecWorkspace.sync_status="clean"`
   - `SpecWorkspace.last_synced_at=now`
   - `SpecWorkspace.updated_at=now`
10. 失败时更新：
    - `AgentRun.status="failed"`
    - `AgentRun.finished_at`
    - `AgentRun.exit_code=result.exit_code`，后台异常可用 `1`
    - `AgentRun.output_redacted` 写入 adapter redacted output 或异常摘要，最多 10000 字符
    - `SpecWorkspace.sync_status="dirty"`
    - 为 adapter 非零退出创建 `SpecConflict(stage="bootstrap", conflict_type="command")`
    - 为每个 `report.errors` 创建 `SpecConflict(stage="bootstrap", conflict_type=issue.category)`
11. adapter stderr 必须额外写入 `AgentRunLog(channel="stderr")`。如果后台函数自身抛异常，也要写一条 stderr 日志，便于 SSE 历史回放能看到失败原因。
12. 无论成功或失败，都写 `AuditLog(action="spec_bootstrap.complete", resource_type="agent_run", resource_id=run.id)`，`details_json` 至少包含 `validation_passed`、`error_count`、`warning_count`、`sync_status`、`exit_code`、`spec_root`。
13. 外层必须有 `try/except` 兜底，保证任何异常都不会让 run 永久停在 `running`。异常路径要 commit 最终状态，并记录结构化日志 `log.exception` 或 `log.error`。

## 接口定义

推荐在 `SpecBootstrapService` 所在模块内补齐以下接口。若 task-01 已创建同名占位函数，直接填充实现，不要引入新模块。

```python
async def _execute_bootstrap_agent_run(
    *,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    spec_root: str,
    code_root: str,
) -> None:
    """Run ClaudeCodeAdapter in the background and finalize bootstrap state."""
```

控制流：

```python
factory = get_session_factory()
async with factory() as session:
    run = await session.get(AgentRun, run_id)
    spec_ws = await _load_spec_workspace(session, workspace_id)
    workspace = await session.get(Workspace, workspace_id)
    if run/spec_ws/workspace missing:
        mark run failed when possible
        commit
        return

    mark run running + started_at
    commit

    runtime_dir = Path(spec_root) / ".runtime" / "bootstrap" / str(run_id)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    bundle = _build_bootstrap_bundle(
        workspace_id=workspace_id,
        spec_ws=spec_ws,
        spec_root=Path(spec_root),
        code_root=Path(code_root),
    )

    async def on_log(channel: str, content: str, ts: str) -> None:
        add AgentRunLog(run_id=run_id, timestamp=parse_ts(ts), channel=channel, content_redacted=content[:4000])
        commit every 5 entries

    result = await ClaudeCodeAdapter().run_with_bundle(
        run_id=run_id,
        bundle=bundle,
        lease_path=runtime_dir,
        timeout=600,
        on_log=on_log,
    )
    flush log callback

    if result.stderr.strip():
        write stderr AgentRunLog chunks

    report = SpecValidator().validate(spec_root)
    validation_passed = result.exit_code == 0 and report.passed

    update AgentRun + SpecWorkspace
    create SpecConflict rows for command and validation errors
    create AuditLog("spec_bootstrap.complete")
    commit
```

Helper 约定：

```python
def _build_bootstrap_bundle(
    *,
    workspace_id: uuid.UUID,
    spec_ws: SpecWorkspace,
    spec_root: Path,
    code_root: Path,
) -> AgentSpecBundle:
    """Return the exact bootstrap AgentSpecBundle consumed by ClaudeCodeAdapter."""
```

```python
async def _write_run_log(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    channel: str,
    content: str,
    chunk_size: int = 4000,
) -> None:
    """Persist long stderr/summary text as chunked AgentRunLog rows."""
```

如需解析 adapter callback 的 ISO timestamp，可在本文件内实现轻量 helper；不要从 `agent.service` 导入私有函数造成循环依赖。

## 边界处理

- `run_id` 查不到：记录 `log.error("spec_bootstrap_run_missing", ...)` 后返回；不要创建新的 run。
- `SpecWorkspace` 或 `Workspace` 查不到：将 run 标记为 `failed`，写 stderr 日志，`exit_code=1`，并提交，避免后台异常泄露到 event loop。
- `code_root` 不存在：仍允许 adapter 在 runtime dir 启动，但 bundle/prompt 必须明确记录 code root 缺失；最终通常由 validation 或 adapter 失败收尾，不能直接静默成功。
- `spec_root` 不存在：后台函数需要 `mkdir(parents=True, exist_ok=True)` 后再运行 adapter；若创建失败，按异常失败路径收尾。
- adapter 返回 `exit_code=0` 但 `SpecValidator` 不通过：最终状态必须是 `failed`，`sync_status="dirty"`，并为每个 validation error 创建 `SpecConflict`。
- adapter 返回非零但 validator 通过：最终状态仍是 `failed`，因为后台命令链没有可信完成；创建 command conflict，保留 validator warning/error 信息到 audit。
- `result.stderr` 很长：按 4000 字符分块写 `AgentRunLog`，`AgentRun.output_redacted` 截断到 10000 字符。
- `on_log` 写 DB 失败：捕获并 `log.warning`，不要中断 adapter 进程；最终 stderr/output 和 run 状态仍要落库。
- 后台异常发生在 run 已标记 running 之后：必须在 except 中重新读取 run 并标记 `failed`，写 stderr 日志和 complete audit，防止 SSE 一直等待。
- 重复触发 bootstrap 由 task-01 的启动语义负责；本任务不做去重，但后台函数必须只收尾传入的 `run_id`，不能更新其他 run。
- 不修改传入的 `Path` 或字符串参数；需要路径计算时创建局部 `Path(...)` 对象。
- 不为 validator warnings 创建 open conflict；warnings 只进入 audit details，除非现有设计另有明确错误级别。

## 非目标

- 不修改 `/spec-bootstrap` HTTP 响应 schema 或 router 行为。
- 不实现 `POST /agent/runs/{run_id}/input`，也不实现真正可暂停/恢复的 stdin 交互。
- 不修改 `ClaudeCodeAdapter` 的 stream-json 协议、Redis 发布逻辑或 supported tools。
- 不新增数据库表、枚举或 migration。
- 不更新前端 SSE 展示、Agent 控制台或 Workspace 页面。
- 不扩展 `SpecValidator` 的验证规则。
- 不提交正式测试文件；后端测试覆盖由 task-03 完成。本任务实现时可以先本地草拟测试用例验证思路，但最终提交范围保持在 `bootstrap.py`。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md`
- `backend/app/modules/spec_workspace/bootstrap.py`
- `backend/app/modules/agent/adapters/claude_code.py`
- `backend/app/modules/agent/base.py`
- `backend/app/modules/spec_workspace/validator.py`
- `.sillyspec/docs/backend/modules/spec_workspace.md`
- `.sillyspec/docs/backend/modules/agent.md`

可复用模式：

- `backend/app/modules/agent/service.py` 的后台任务使用独立 session、`run_with_bundle(..., on_log=...)`、增量写 `AgentRunLog`、最终更新 `AgentRun`。
- 当前 `bootstrap.py` 已有 `SpecValidator`、`SpecConflict`、`AuditLog`、stdout/stderr 分块写入和 sync_status 收尾逻辑，可迁移到 adapter 后置验证路径。

## TDD 步骤

1. 先列出 task-03 需要落地的失败用例：adapter 成功 + validator 通过、adapter 非零、validator error、后台异常、stderr 分块、run/spec workspace 缺失。
2. 用 mock `ClaudeCodeAdapter.run_with_bundle()` 和 mock `SpecValidator.validate()` 草拟最小断言，确认当前直接 `_run_sillyspec_init()` 路径无法满足“adapter 被调用”和“后台异常不留 running”的断言。
3. 实现 `_execute_bootstrap_agent_run()`、`_build_bootstrap_bundle()`、日志 callback 和验证收尾。
4. 用同一组 mock 断言验证：bundle 字段正确、run 状态正确、`SpecConflict` 创建正确、complete audit 一定写入。
5. 运行现有后端目标测试；正式测试文件由 task-03 提交后，再回归 `backend/app/modules/spec_workspace/tests/test_bootstrap.py` 和 agent SSE 相关测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 搜索 `bootstrap.py` 中的 bootstrap 后台路径 | 不再通过 `_run_sillyspec_init()` 或 `asyncio.create_subprocess_exec()` 执行 SillySpec；后台执行调用 `ClaudeCodeAdapter.run_with_bundle()` |
| AC-02 | 检查后台 DB session 使用 | `asyncio.create_task` 触发的后台函数内部使用 `get_session_factory()` 创建新 session，不复用请求级 `self._session` |
| AC-03 | mock adapter 并捕获传入 bundle | `AgentSpecBundle` 包含 `task_key="spec-bootstrap"`、`available_tools=["sillyspec"]`、`allowed_paths=[spec_root, code_root]` 和 bootstrap metadata |
| AC-04 | mock adapter 产生 stdout/tool_call callback | callback 写入 `AgentRunLog`，channel 保持 adapter 传入值，单条内容不超过 4000 字符 |
| AC-05 | adapter exit 0 且 validator passed | run 变为 `completed`，`exit_code=0`，`sync_status="clean"`，`last_synced_at` 更新，无 open conflict |
| AC-06 | adapter exit 非零 | run 变为 `failed`，`sync_status="dirty"`，创建 `SpecConflict(stage="bootstrap", conflict_type="command")` |
| AC-07 | validator 返回 errors | 即使 adapter exit 0，run 仍为 `failed`，为每个 validation error 创建对应 `SpecConflict` |
| AC-08 | adapter stderr 非空 | stderr 被写入 `AgentRunLog(channel="stderr")`，长内容按 4000 字符分块 |
| AC-09 | 后台函数中抛出异常 | run 最终为 `failed`，写入 stderr 日志，`output_redacted` 有异常摘要，不会停留在 `running` |
| AC-10 | 检查审计记录 | 成功、adapter 失败、validation 失败、异常失败四类路径都写 `spec_bootstrap.complete` audit，details 包含 exit_code、validation_passed、sync_status |
| AC-11 | 检查变更范围 | git diff 只包含 `backend/app/modules/spec_workspace/bootstrap.py` 的实现变更；没有 router、adapter、validator、前端、测试或文档变更 |
