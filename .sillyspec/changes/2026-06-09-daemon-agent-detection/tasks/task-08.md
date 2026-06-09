---
id: task-08
title: "TaskRunner 按 provider 分发执行"
author: qinyi
created_at: "2026-06-09 23:25:05"
priority: P0
estimated_hours: 3
depends_on:
  - task-03
blocks:
  - task-11
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/task_runner.py
  - sillyhub-daemon/tests/test_task_runner_provider_dispatch.py
---

# Task-08: TaskRunner 按 provider 分发执行

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 按 provider 类型选择 backend 执行 |

## 实现要求

### 当前问题

当前 `TaskRunner.execute_task()` 中第 133 行硬编码启动 `claude` 命令：

```python
cmd: list[str] = ["claude", "--print", prompt] if prompt else ["claude"]
proc = await self._launch_agent(cmd, cwd=str(work_dir), env=env)
```

然后手动读取 stdout/stderr（第 140-148 行），无结构化事件解析。

**改造目标**：根据 `payload` 中的 `provider` 字段，使用 `AgentBackend` 工厂获取正确的 backend 实例，委托 backend 执行任务。

### 改造后的流程

```python
async def execute_task(self, lease_id, claim_token, payload):
    # 1. Prepare workspace（不变）
    # 2. Write CLAUDE.md（不变）
    # 3. Render credentials -> env（不变）

    # 4. 获取 provider 和 cmd_path
    provider = payload.get("provider", "claude")  # 默认 claude 向后兼容
    cmd_path = payload.get("cmd_path", "")         # 检测到的二进制路径
    prompt = payload.get("prompt", "")
    timeout = payload.get("timeout", 0)
    model = payload.get("model", "")
    session_id = payload.get("session_id", "")

    # 5. 通过工厂获取 backend
    backend = get_backend(provider)  # task-03 定义的工厂函数
    if backend is None:
        return TaskResult(success=False, error=f"unsupported provider: {provider}")

    # 6. 委托 backend 执行
    result = await backend.execute(
        cmd_path=cmd_path,
        task_prompt=prompt,
        work_dir=str(work_dir),
        env=env,
        timeout=timeout,
        model=model,
        session_id=session_id,
    )

    # 7. 流式报告进度（回调方式）
    # backend.execute 内部通过 on_event 回调发出事件
    # TaskRunner 在回调中将事件转发到 server via submit_messages

    # 8. 收集 diff（不变）
    # 9. 返回 TaskResult（从 backend result 转换）
```

### Backend 工厂集成

使用 task-03 定义的 `get_backend(provider: str) -> AgentBackend | None` 工厂函数。

工厂映射（由 task-03 到 task-06 逐步建立）：

| provider | protocol | Backend 类 |
|----------|----------|-----------|
| claude | stream_json | StreamJsonBackend |
| codex | json_rpc | JsonRpcBackend |
| copilot | jsonl | JsonlBackend |
| opencode | ndjson | NdjsonBackend |
| openclaw | ndjson | NdjsonBackend |
| hermes | json_rpc | JsonRpcBackend |
| gemini | stream_json | StreamJsonBackend |
| pi | ndjson | NdjsonBackend |
| cursor | stream_json | StreamJsonBackend |
| kimi | json_rpc | JsonRpcBackend |
| kiro | json_rpc | JsonRpcBackend |
| antigravity | text | TextBackend |

### 事件流式转发

Backend 的 `execute` 方法需要一个事件回调机制，用于实时转发 agent 输出到服务端。

在 `AgentBackend.execute` 中增加 `on_event` 回调参数：

```python
async def execute(
    self,
    cmd_path: str,
    task_prompt: str,
    work_dir: str,
    env: dict[str, str],
    *,
    timeout: float = 0,
    model: str = "",
    session_id: str = "",
    on_event: Callable[[AgentEvent], Awaitable[None]] | None = None,
) -> TaskResult:
```

TaskRunner 提供 `on_event` 回调实现：

```python
async def _on_agent_event(self, event: AgentEvent, lease_id: str, claim_token: str, agent_run_id: str):
    """Forward agent events to the server via submit_messages."""
    message = self._event_to_message(event)
    if message:
        try:
            await self._client.submit_messages(
                lease_id=lease_id,
                claim_token=claim_token,
                agent_run_id=agent_run_id,
                messages=[message],
            )
        except Exception as exc:
            logger.warning("event_forward_failed error=%s", exc)
```

### TaskResult 转换

Backend 返回的 `TaskResult` 与 TaskRunner 使用的 `TaskResult` 字段对齐（两者同名同类，直接使用）。

补充 diff 收集结果：

```python
# Backend result 中的 output/error/exit_code/success/duration_ms 直接使用
# 额外收集 diff
diff_result = await self._workspace.collect_diff(work_dir)
result.patch = diff_result.get("patch", "")
result.files_changed = diff_result.get("files_changed", 0)
result.insertions = diff_result.get("insertions", 0)
result.deletions = diff_result.get("deletions", 0)
```

### 删除旧逻辑

删除以下旧代码：
- 硬编码 `cmd = ["claude", "--print", prompt]` 行
- `_launch_agent` 方法（backend 自己管理子进程）
- `_stream_output` 方法（backend 自己管理输出流）

## 接口定义

### TaskRunner 构造器变更

```python
class TaskRunner:
    def __init__(
        self,
        client: HubClient,
        workspace_manager: WorkspaceManager,
        credential_manager: CredentialManager,
    ) -> None:
        self._client = client
        self._workspace = workspace_manager
        self._credentials = credential_manager
        self._running_tasks: dict[str, asyncio.Task[TaskResult]] = {}
```

构造器签名不变。Backend 通过工厂函数获取，不需要注入。

### execute_task 变更

```python
async def execute_task(
    self,
    lease_id: str,
    claim_token: str,
    payload: dict[str, Any],
) -> TaskResult:
    """Execute a claimed task end-to-end using the appropriate agent backend."""
```

方法签名不变，内部实现改为使用 backend 工厂。

## 边界处理

1. **provider 不在工厂映射中**：`get_backend(provider)` 返回 `None` -> 返回 `TaskResult(success=False, error=f"unsupported provider: {provider}")`，不抛异常。
2. **payload 无 provider 字段**：默认 `provider="claude"`，保持向后兼容（旧服务端 payload 不含 provider 字段时仍使用 claude）。
3. **cmd_path 为空**：传空字符串给 backend，由 backend 内部通过 `shutil.which` 查找默认二进制路径。如果也找不到 -> backend 返回 `TaskResult(success=False)`。
4. **backend.execute 抛异常**：捕获所有异常，返回 `TaskResult(success=False, error=str(exc))`，与现有行为一致。
5. **事件转发失败不中断执行**：`on_event` 回调中 `submit_messages` 失败只记录 warning，不影响 backend 继续执行。
6. **diff 收集失败不标记任务失败**：保持现有行为，diff 收集失败时 patch/files_changed 等字段为默认值。
7. **timeout 为 0 或负数**：传给 backend 时语义为"无超时"，由 backend 自行决定默认超时（如 30 分钟）。

## 非目标

- 不实现并发多 agent 执行（同一时刻只执行一个 task）。
- 不实现 agent 执行取消（`cancel_task` 已有框架，但不传递到 backend 层）。
- 不实现 token usage 上报到服务端（V2）。
- 不实现 agent subprocess 资源限制（CPU/memory cgroup）。
- 不修改 `TaskRunner` 构造器签名（不需要注入 backend，通过工厂获取）。

## 参考

- `sillyhub-daemon/sillyhub_daemon/task_runner.py`：当前 `execute_task()` 方法（第 76-188 行），硬编码 `claude --print` 命令。
- `sillyhub-daemon/sillyhub_daemon/client.py`：`submit_messages()` 方法（第 115-132 行）。
- Design 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/design.md` Phase 3。
- Plan 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/plan.md` Wave 3。

## TDD步骤

1. **写测试 `_test_execute_task_uses_claude_backend`**：payload `provider="claude"`，验证调用 `StreamJsonBackend.execute` 而非硬编码命令。
2. **写测试 `_test_execute_task_uses_codex_backend`**：payload `provider="codex"`，验证调用 `JsonRpcBackend.execute`。
3. **写测试 `_test_execute_task_uses_copilot_backend`**：payload `provider="copilot"`，验证调用 `JsonlBackend.execute`。
4. **写测试 `_test_execute_task_uses_text_backend`**：payload `provider="antigravity"`，验证调用 `TextBackend.execute`。
5. **写测试 `_test_execute_task_default_provider_is_claude`**：payload 无 `provider` 字段，默认使用 claude backend。
6. **写测试 `_test_execute_task_unsupported_provider`**：payload `provider="unknown"`，验证返回 `TaskResult(success=False, error="unsupported provider: unknown")`。
7. **写测试 `_test_execute_task_passes_correct_params`**：验证 backend.execute 收到正确的 `cmd_path`、`task_prompt`、`work_dir`、`env`、`timeout`、`model`。
8. **写测试 `_test_execute_task_event_forwarding`**：mock backend 发出事件，验证 `submit_messages` 被调用转发事件。
9. **写测试 `_test_execute_task_event_forward_failure_doesnt_break`**：mock `submit_messages` 抛异常，验证 backend 继续执行不中断。
10. **写测试 `_test_execute_task_diff_collected`**：验证执行后 diff 被收集并附加到 TaskResult。
11. **写测试 `_test_execute_task_backward_compatible`**：旧格式 payload（无 `provider`/`cmd_path`）仍能正常执行。
12. **实现改造**：修改 `execute_task()` 使用 backend 工厂，删除 `_launch_agent` 和 `_stream_output`。
13. **添加 `_on_agent_event` 回调**：实现事件转发逻辑。
14. **添加 `_event_to_message` 转换**：将 AgentEvent 转为 submit_messages 格式。

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| A-01 | `execute_task` 使用 `get_backend(provider)` 工厂获取 backend 实例 | 单元测试 |
| A-02 | provider 为 `"claude"` 时使用 StreamJsonBackend | 单元测试 |
| A-03 | provider 为 `"codex"` 时使用 JsonRpcBackend | 单元测试 |
| A-04 | provider 为 `"copilot"` 时使用 JsonlBackend | 单元测试 |
| A-05 | provider 为 `"antigravity"` 时使用 TextBackend | 单元测试 |
| A-06 | payload 无 `provider` 字段时默认使用 `"claude"` | 单元测试 |
| A-07 | 不支持的 provider 返回 `TaskResult(success=False)` | 单元测试 |
| A-08 | backend.execute 收到正确的 `cmd_path`、`task_prompt`、`work_dir`、`env` 参数 | 单元测试 |
| A-09 | agent 事件通过 `submit_messages` 转发到服务端 | 单元测试 |
| A-10 | 事件转发失败不中断任务执行 | 单元测试 |
| A-11 | 执行后 diff 正确收集到 TaskResult | 单元测试 |
| A-12 | 旧格式 payload（无 provider/cmd_path）向后兼容 | 单元测试 |
| A-13 | 硬编码 `_launch_agent` 和 `_stream_output` 方法已删除 | 代码审查 |
| A-14 | 所有测试通过 `pytest sillyhub-daemon/tests/test_task_runner_provider_dispatch.py` | CI |
