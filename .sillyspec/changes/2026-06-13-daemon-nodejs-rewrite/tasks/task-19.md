---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-19
title: TaskRunner（src/task-runner.ts，编排链 + 子进程执行 spawn）
priority: P0
estimated_hours: 6
depends_on: [task-11, task-17, task-13, task-15]
blocks: [task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
---

# task-19：TaskRunner（src/task-runner.ts，编排链 + 子进程执行 spawn）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave **W4 核心**（编排层）—— **整个重写最复杂的单点任务**，承载 **R-03（stdin control 不 hang）** + **R-04（stdout 背压/编码）** 两个 P1 风险。
> Python 源对照：`sillyhub_daemon/task_runner.py`（编排主流程：LeaseContext、调 backend.execute）+ `sillyhub_daemon/backends/stream_json.py`（execute 模板：spawn 子进程、stdout 逐行读取、control_request stdin 应答、超时/取消、result 解析）—— **Node 版把这两块的「执行子进程」职责合并下沉到 TaskRunner 单点**。
> 方案B 核心深化（design.md §5.1）：Python `AgentBackend` 同时承担「执行子进程」（execute）和「解析输出」（parse_output）两职。Node 版拆开——**子进程执行（spawn / stdin / env / diff 收集 / submit 流式）下沉到 TaskRunner 唯一入口**；adapter（task-06..10）只保留纯解析职责 `parse(line)`，输出统一 `AgentEvent` IR。新增协议 = 新增一个 parse 实现，零侵入编排层（G-03）。

- **Wave**：W4（编排层）★ W4 核心、最复杂任务之一
- **依赖**：
  - task-11（`getBackend(provider): ProtocolAdapter` 工厂）—— 取 adapter 实例（每次新建，见 task-11 B-04）
  - task-17（`HubClient` REST）—— `submitMessages` / `completeLease` / `startLease` 端点调用
  - task-13（`CredentialManager.buildEnv(config)`）—— 渲染 `{{USER_*}}` 占位符为子进程 env
  - task-15（`WorkspaceManager`）—— `prepareWorkspace` / `collectDiff` / `cleanWorkspace` / `GitError`
- **阻塞**：
  - task-20（Daemon 主类）—— Daemon 调 `taskRunner.runLease(lease)` 驱动单次任务
  - task-22（测试迁移）—— `test_task_runner.py` 1:1 迁到 `tests/task-runner.test.ts`
- **承载风险**：R-03（stdin control 不 hang，P1）、R-04（stdout 背压/编码，P1）—— 本任务是这两个风险的唯一落地点
- **Python 源对照**（逐行对照表见 §参考章节）：
  - `sillyhub_daemon/task_runner.py:77-245` —— `execute_task` 编排主流程（prepare_workspace → CLAUDE.md → credential → get_backend → backend.execute → collect_diff → TaskResult）
  - `sillyhub_daemon/backends/stream_json.py:34-172` —— `StreamJsonBackend.execute` 子进程执行模板（spawn + stdin 不关闭 + control_request 应答 + 超时 + result 解析）—— **本任务把这个模板从 backend 下沉到 TaskRunner**
  - `sillyhub_daemon/backends/stream_json.py:174-204` —— `_consume_stdout` 逐行读取 + control_request 处理（R-03/R-04 的 Python 参考实现）
  - `sillyhub_daemon/backends/stream_json.py:206-246` —— `_handle_control_request` 自动批准工具（R-03 应答器）
  - `sillyhub_daemon/backends/stream_json.py:281-303` —— `_build_args` / `_build_input`（cmd 与 stdin prompt 构造，了解 spawn 命令来源）
  - `sillyhub_daemon/task_runner.py:285-311` —— `_event_to_message`（AgentEvent → submit_messages payload 字段映射）
  - `sillyhub_daemon/task_runner.py:262-269` —— `cancel_task`（取消追踪的任务，Node 版用 AbortSignal）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/task-runner.ts` | `TaskRunner` class：构造注入 4 依赖 + `runLease(lease)` 编排链（9 步）+ `spawnAndStream` 子进程执行 + `consumeStdout` readline 流处理 + `handleControlRequest` stdin 应答（R-03）+ `cancel(taskId)` AbortSignal 取消 + `track`/`untrack` 任务追踪 + `_eventToMessage` IR→payload 映射 + `_truncate` 输出截断 + `TaskStatus` 联合类型 + `LeaseCtx` 接口 + `BackendTaskResult` 接口（若 task-05 未提供则在本地声明） |

> 本任务是 W4 单点：**只产出 `src/task-runner.ts` 一个源文件**，不实现具体 provider 的 cmd 构造（在各 adapter 的 `buildArgs`，见 §非目标 N-19-5），不实现 WebSocket（task-18），不做 lease 状态机分发（task-20）。测试文件 `tests/task-runner.test.ts` 不计入 allowed_paths（开发期验证产物，task-04 脚手架约定）。

---

## 实现要求

### R1. 构造函数注入 4 依赖

```ts
constructor(
  client: HubClient,           // task-17: submitMessages / completeLease / startLease
  workspace: WorkspaceManager, // task-15: prepareWorkspace / collectDiff / cleanWorkspace
  credential: CredentialManager, // task-13: buildEnv
)
```

存为 `private readonly`。`getBackend`（task-11）是模块级函数，**不注入**（直接 import 调用，与 Python `from backends import get_backend` 一致）。额外维护 `private _runningTasks: Map<string, AbortController>`（追踪可取消的任务，与 Python `_running_tasks: dict[str, asyncio.Task]` 对齐，但 Node 用 AbortController 而非 asyncio.Task）。

### R2. runLease(lease) 编排链 9 步（核心）

`async runLease(lease: LeaseCtx): Promise<BackendTaskResult>`，编排链严格对齐 Python `task_runner.py:77-245` 的 7 步 + Node 版新增的「start lease」+「执行子进程」拆分，共 **9 步**：

**步骤 1 — 计时 + 日志 + 状态机置 running**：
```ts
const start = Date.now();           // 对齐 Python time.monotonic()
const taskId = randomUUID();        // 对齐 Python uuid.uuid4()
this._setState(lease.leaseId, 'running');  // 状态机 pending→running
```

**步骤 2 — workspace 准备**（对齐 Python L111-119）：
```ts
const workDir = await this._workspace.prepareWorkspace(
  lease.workspaceName,             // payload.workspace_name，默认 'default'
  lease.repoUrl,                   // 可选，无则走「创建空目录」分支（task-15 R1 分支 3）
  lease.branch ?? 'main',          // 默认 main
);
```
失败（GitError）→ 走 §R8 错误处理，状态机置 `failed`。

**步骤 3 — 写 CLAUDE.md**（对齐 Python L121-126）：
```ts
if (lease.claudeMd) {
  const claudeDir = path.join(workDir, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), lease.claudeMd, 'utf-8');
}
```
空 claudeMd 跳过（Python L122-126 守卫一致）。

**步骤 4 — credential 渲染注入 env**（对齐 Python L128-131）：
```ts
const extraEnv = this._credential.buildEnv(lease.toolConfig ?? {});
const env = { ...process.env, ...extraEnv };  // 渲染后的凭证覆盖同名环境变量
```
`buildEnv` 已过滤未解析占位符 + key 转大写（task-13 R8）。

**步骤 5 — 解析 payload 参数 + getBackend 取 adapter**（对齐 Python L133-170）：
```ts
const provider = lease.provider ?? 'claude';  // Python 默认 'claude'（L134）
const cmdPath = lease.cmdPath ?? '';
const prompt = lease.prompt ?? '';
const timeoutSec = lease.timeout ?? 0;        // 0 = 不超时
const model = lease.model ?? '';
const sessionId = lease.sessionId ?? '';
const resumeSessionId = lease.resumeSessionId ?? '';
const agentRunId = lease.agentRunId ?? '';

let adapter: ProtocolAdapter;
try {
  adapter = getBackend(provider);             // task-11，每次新建实例
} catch (e) {
  // 未知 provider（对齐 Python L152-166）
  return this._fail(lease, `unsupported provider: ${provider}`, start);
}
```

**步骤 6 — start lease**（Node 版新增，Python 版由 Daemon 主类在 claim 后调，Node 版按 design §7.5 把 start 收进编排链）：
```ts
try {
  await this._client.startLease(lease.leaseId, lease.claimToken);
} catch (e) {
  logger.warn(`start_lease_failed lease_id=${lease.leaseId} err=${(e as Error).message}`);
  // 不中断——start 失败仍继续执行（与 Python 容错策略一致，Python 版 start 在 daemon.py 也容错）
}
```

**步骤 7 — spawn 子进程 + 逐行 parse + 流式 submit**（**本任务核心，下沉 Python `backend.execute` 模板**）：
```ts
const execResult = await this._spawnAndStream({
  adapter, cmdPath, prompt, workDir, env,
  timeoutSec, model, sessionId, resumeSessionId,
  leaseId: lease.leaseId, claimToken: lease.claimToken, agentRunId,
  signal: this._getSignal(lease.leaseId),  // AbortSignal，取消用
});
```
详细实现见 §R3-R6。

**步骤 8 — collect diff**（对齐 Python L201-209，non-fatal）：
```ts
let diffResult: WorkspaceResult = { patch: '', files_changed: 0, insertions: 0, deletions: 0, stats: '' };
try {
  diffResult = await this._workspace.collectDiff(workDir);
} catch (e) {
  logger.warn(`diff_collect_failed work_dir=${workDir} err=${(e as Error).message}`);
  // diff 失败不标记整个任务失败（Python L206-209 一致）
}
```

**步骤 9 — 状态机定态 + 返回 BackendTaskResult**（对齐 Python L211-236）：
```ts
const success = execResult.status === 'completed';
const durationMs = Date.now() - start;
this._setState(lease.leaseId, success ? 'completed' : execResult.status as TaskStatus);

return {
  status: execResult.status,                 // 'completed' | 'failed' | 'timeout' | 'cancelled'
  success,
  exitCode: success ? 0 : 1,
  patch: diffResult.patch,
  filesChanged: diffResult.files_changed,
  insertions: diffResult.insertions,
  deletions: diffResult.deletions,
  output: this._truncate(execResult.output, MAX_OUTPUT),  // 10000 字符
  error: this._truncate(execResult.error ?? '', MAX_ERROR), // 5000 字符
  durationMs,
  sessionId: execResult.sessionId ?? '',
  metadata: execResult.sessionId ? { session_id: execResult.sessionId } : {},
};
```

### R3. _spawnAndStream — 子进程执行模板（下沉核心，承载 R-03/R-04）

`private async _spawnAndStream(opts: SpawnOpts): Promise<BackendExecResult>`，对齐 Python `StreamJsonBackend.execute`（stream_json.py:34-172），**但 provider 无关**——cmd 构造由 adapter 决定（见 §R4），本方法只做通用执行流程。

**spawn 配置**：
```ts
const args = adapter.buildArgs?.({ model, sessionId, resumeSessionId }) ?? [];
const fullCmd = [cmdPath, ...args];
const child = spawn(fullCmd[0]!, fullCmd.slice(1), {
  cwd: workDir,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],  // stdin/stdout/stderr 全管道
});
```
> **buildArgs 契约**：task-05 的 `ProtocolAdapter` 接口声明可选 `buildArgs?(opts): string[]`。若 adapter 未实现（如 text adapter 可能不需要），返回 `[]`，TaskRunner 仅用 `cmdPath` 启动。各 adapter 的 cmd 模板（stream_json 的 `-p --output-format stream-json ...`）在 task-06..10 实现，本任务只调用。

**spawn 失败（cmd 不存在）**：监听 `child.on('error', ...)`（ENOENT/EACCES），对齐 Python `stream_json.py:64-70` 的 `(FileNotFoundError, OSError)` 分支，立即返回 `failed`。

### R4. stdin 处理 — 写 prompt + 不关闭（R-03 核心，对齐 stream_json.py:76-91）

```ts
const inputData = adapter.buildInput?.(prompt) ?? (prompt + '\n');
try {
  child.stdin.write(inputData);
  // 不 await drain——Node 的 write 返回 boolean，背压由 stream 自身管理
} catch (e) {
  logger.debug(`stdin_write_failed err=${(e as Error).message}`);
}

let stdinClosed = false;
const closeStdin = (): void => {
  if (!stdinClosed && child.stdin && !child.stdin.destroyed) {
    try { child.stdin.end(); } catch { /* ignore */ }
    stdinClosed = true;
  }
};
```

**关键（R-03）**：写完 prompt **不关闭 stdin**——stream_json 协议（claude/gemini/cursor）的子进程会在执行中通过 stdout 发 `control_request`（工具批准），期望在同一 stdin 流收到 `control_response` 才继续，否则 hang。stdin 仅在以下情况关闭：
1. 收到 `result` 事件（子进程完成，stream_json.py:201-203）；
2. 超时 / 取消 / 错误（cleanup 路径）；
3. 子进程退出（防御性关闭）。

### R5. stdout 逐行流处理（R-04 背压，对齐 stream_json.py:174-204）

`private async _consumeStdout(child, adapter, onEvent, closeStdin, signal): Promise<void>`

**用 Node `readline.createInterface` 逐行读**（不手动 buffer 切行，避免跨行 JSON / 二进制噪声 bug）：
```ts
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
try {
  for await (const line of rl) {
    if (signal?.aborted) break;           // 取消即停止读取
    const trimmed = line.trim();
    if (!trimmed) continue;                // 跳空行（Python L185-186）

    // 5a. parse → AgentEvent[]
    let events: AgentEvent[] | null = null;
    try {
      events = adapter.parse(trimmed);
    } catch (e) {
      logger.warn(`parse_error line=${trimmed.slice(0, 100)} err=${(e as Error).message}`);
      // parse 抛错不中断整体（见边界 B-19-04）
      continue;
    }

    // 5b. 每个 event 流式 submit
    if (events && events.length > 0) {
      for (const ev of events) {
        await onEvent(ev);                  // 调 HubClient.submitMessages（内部 try/catch 不抛）
      }
    }

    // 5c. control_request 应答（R-03）—— 若该行是 control 类，调 adapter.onControl
    if (adapter.onControl && this._isControlLine(trimmed)) {
      try { adapter.onControl(child.stdin); }
      catch (e) { logger.debug(`on_control_failed err=${(e as Error).message}`); }
    }

    // 5d. result 事件 → 关闭 stdin（子进程完成信号）
    if (this._isResultLine(trimmed)) {
      closeStdin();
    }
  }
} finally {
  rl.close();
}
```

**R-04 背压要点**：
- `readline` 的 `for await...of` 天然背压——读下一行前必须处理完当前行，不会积压；
- `child.stdout` 不手动 `resume`/`pause`，交给 readline；
- 编码：readline 默认按 UTF-8 解码（Node stream 默认），与 Python `raw_line.decode('utf-8', errors='replace')` 等价；非 UTF-8 噪声行 parse 时 adapter 返回 null 跳过（不崩）。

### R6. handleControlRequest — stdin 自动应答（R-03，对齐 stream_json.py:206-246）

**方案选择（关键决策，见 §边界 B-19-03）**：control_request 的应答逻辑（构造 `control_response` JSON + `behavior: allow` + `updatedInput`）**留在 adapter**（task-06 StreamJsonAdapter 的 `onControl`），**不放在 TaskRunner**。理由：
- 应答 payload 是协议特定的（stream_json 的格式与 json_rpc 不同），放 adapter 才符合方案B「协议差异 100% 收敛于 adapter」；
- TaskRunner 只负责「检测到 control 类行 → 调 adapter.onControl(stdin) 传入可写流」。

TaskRunner 的 `_isControlLine(line)` 做轻量检测（不解析具体协议）：
```ts
private _isControlLine(line: string): boolean {
  // 轻量检测：含 "control_request" 字样（stream_json 用）。
  // 不做完整 JSON 解析（解析是 adapter 的职责），仅判断「是否需要触发 onControl」。
  return line.includes('"control_request"') || line.includes('"type":"control"');
}
```
adapter 的 `onControl(stdin)` 内部自行 `JSON.parse(line)` + 构造 response + `stdin.write`（task-06 实现）。

> **设计取舍**：这里 TaskRunner 需要把 `line` 也传给 `onControl`，否则 adapter 无法解析。因此 task-05 的 `onControl(stdin)` 签名应升级为 `onControl?(line: string, stdin: NodeJS.WritableStream): void`。**本任务在接口定义里给出修正签名，task-05 蓝图如已固定签名则需同步更新**（见 §接口定义的「task-05 签名修正」说明）。

### R7. 取消（AbortSignal，对齐 Python cancel_task）

```ts
track(taskId: string): AbortController {
  const ac = new AbortController();
  this._runningTasks.set(taskId, ac);
  return ac;
}
untrack(taskId: string): void {
  this._runningTasks.delete(taskId);
}
async cancel(taskId: string): Promise<boolean> {
  const ac = this._runningTasks.get(taskId);
  if (!ac) return false;
  ac.abort();                    // 触发 signal.aborted，readline 循环退出
  this._runningTasks.delete(taskId);
  return true;
}
```

**取消竞态处理**（见 §边界 B-19-06）：abort 后子进程需优雅杀——监听 abort 后 `child.kill('SIGTERM')`，2 秒后仍存活 `child.kill('SIGKILL')`。`runLease` 捕获 `AbortError` 或检测 `signal.aborted` → 状态机置 `cancelled`，**不是 `failed`**（与 Python CancelledError 处理一致，对齐 design §10 R-03 取消语义）。

### R8. 错误处理 + 状态机（对齐 Python try/except L110-245）

`runLease` 顶层 try/catch：
```ts
try {
  // 步骤 1-9
} catch (e) {
  const durationMs = Date.now() - start;
  logger.error(`task_execute_failed lease_id=${lease.leaseId} err=${(e as Error).message}`);
  // 区分取消 vs 失败
  if (e instanceof Error && e.name === 'AbortError') {
    this._setState(lease.leaseId, 'cancelled');
    return { status: 'cancelled', success: false, exitCode: -1, /* ... */ };
  }
  this._setState(lease.leaseId, 'failed');
  return {
    status: 'failed', success: false, exitCode: 1,
    error: this._truncate((e as Error).message, MAX_ERROR),
    durationMs,
  };
}
```

**状态机**：`TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'`。`_setState(leaseId, status)` 更新内部 `Map<string, TaskStatus>`（供 Daemon 查询，task-20 用）。状态流转：`pending → running → (completed | failed | cancelled | timeout)`，终态不可逆。

### R9. _eventToMessage — AgentEvent → submit_messages payload（对齐 Python L285-311）

```ts
private _eventToMessage(ev: AgentEvent): Record<string, unknown> | null {
  const msg: Record<string, unknown> = { event_type: ev.type };
  // task-02 的 AgentEvent 字段：type / content / metadata?
  if (ev.content) msg.content = ev.content;
  if (ev.metadata) {
    if (ev.metadata.tool_name) msg.tool_name = ev.metadata.tool_name;
    if (ev.metadata.call_id) msg.call_id = ev.metadata.call_id;
    if (ev.metadata.status) msg.status = ev.metadata.status;
    if (ev.metadata.level) msg.level = ev.metadata.level;
    if (ev.metadata.session_id) msg.session_id = ev.metadata.session_id;
  }
  // 仅当有实质内容才返回（Python L307-309）
  if (!ev.content && !ev.metadata?.tool_name && !ev.metadata?.status) return null;
  return msg;
}
```

### R10. submit 流式回传（对齐 Python on_event 回调 L172-184）

```ts
const onEvent = async (ev: AgentEvent): Promise<void> => {
  const message = this._eventToMessage(ev);
  if (!message) return;              // 空事件丢弃
  try {
    await this._client.submitMessages(leaseId, claimToken, agentRunId, [message]);
  } catch (e) {
    logger.warn(`event_forward_failed err=${(e as Error).message}`);
    // submit 失败只 warn 不中断（Python L183-184 一致）
  }
};
```

### R11. 超时看门狗（对齐 Python stream_json.py:110-119）

```ts
if (timeoutSec > 0) {
  const timer = setTimeout(() => {
    logger.warn(`task_timeout lease_id=${leaseId} timeout=${timeoutSec}s`);
    child.kill('SIGTERM');           // 优雅杀
    setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
  }, timeoutSec * 1000);
  child.on('exit', () => clearTimeout(timer));
}
```
超时 → 状态机置 `timeout`（execResult.status = 'timeout'），不是 `failed`（与 Python `final_status = "timeout"` 一致）。**默认超时**：若 `lease.timeout` 未提供，用模块常量 `DEFAULT_EXECUTE_TIMEOUT = 300`（5 分钟，对齐 Python `stream_json.py:26 _EXECUTE_TIMEOUT = 300`）。

### R12. stderr 处理（对齐 Python stream_json.py:93-106）

后台累积 stderr（不阻塞 stdout 读取），子进程退出后若非零退出码，拼进 error：
```ts
let stderrText = '';
child.stderr.on('data', (chunk: Buffer) => { stderrText += chunk.toString('utf-8'); });
// 退出后：
if (child.exitCode && child.exitCode !== 0) {
  finalStatus = 'failed';
  finalError = stderrText.trim()
    ? `exit code ${child.exitCode}: ${stderrText.trim()}`
    : `exit code ${child.exitCode}`;
}
```

---

## 接口定义

> 以下是 `sillyhub-daemon/src/task-runner.ts` 的完整骨架（搬砖工照抄即可，含编排链 9 步、spawn 配置、readline 流处理、stdin control、取消、状态机）。**这是整个重写最复杂的接口定义**，承载 R-03/R-04 风险，逐行对照 Python `task_runner.py` + `stream_json.py`。

### task-05 签名修正说明（重要）

task-05 的 `ProtocolAdapter.onControl` 原签名是 `onControl?(stdin: NodeJS.WritableStream): void`。本任务发现 **adapter 需要拿到原始 line 才能解析 control_request 并构造应答**，故签名修正为：

```ts
onControl?(line: string, stdin: NodeJS.WritableStream): void | Promise<void>;
```

同时新增 `buildArgs?` / `buildInput?` 可选方法（cmd 与 stdin prompt 构造，下沉自 Python backend 的 `_build_args` / `_build_input`）：

```ts
buildArgs?(opts: { model?: string; sessionId?: string; resumeSessionId?: string }): string[];
buildInput?(prompt: string): string | Buffer;
```

**若 task-05 蓝图已固定签名**：执行 task-19 时同步更新 `src/adapters/protocol-adapter.ts`（task-05 文件）追加这 3 个可选方法。该改动属「接口扩展」（追加可选方法，不破坏现有实现），允许 task-19 在 allowed_paths 之外临时触碰 task-05 文件，但需在执行时备注。**推荐做法**：task-05 蓝图生成时已包含这 3 个方法（请生成 task-05 时回看本节）。

### 完整代码骨架

```ts
/**
 * task-runner.ts —— 任务执行引擎（W4 核心，方案B 编排链单点）。
 *
 * 设计参考：design.md §5.1（分层架构）、§7.5（lease 编排骨架）、§10 R-03/R-04。
 * Python 源对照：
 *   sillyhub_daemon/task_runner.py:77-245      execute_task 编排主流程（7 步）
 *   sillyhub_daemon/backends/stream_json.py:34-172  execute 子进程模板（下沉到本文件）
 *   sillyhub_daemon/backends/stream_json.py:174-246 _consume_stdout + _handle_control_request
 *   sillyhub_daemon/task_runner.py:262-269     cancel_task（Node 用 AbortController）
 *   sillyhub_daemon/task_runner.py:285-311     _event_to_message
 *
 * 方案B 核心深化（design.md §5.1）：
 *   Python AgentBackend 同时承担「执行子进程」(execute) + 「解析输出」(parse_output)。
 *   Node 版拆开——子进程执行（spawn / stdin / env / diff / submit）下沉到本文件
 *   唯一入口；adapter（task-06..10）只保留纯 parse 职责。
 *   新增协议 = 新增一个 parse 实现，零侵入编排层（G-03）。
 *
 * 承载风险：
 *   R-03（stdin control 不 hang，P1）—— 写完 prompt 不关 stdin，control_request 时调
 *         adapter.onControl(line, stdin) 应答，避免子进程 hang。
 *   R-04（stdout 背压/编码，P1）—— 用 readline.createInterface 逐行读，天然背压，
 *         UTF-8 解码，非 UTF-8 噪声行 parse 返回 null 跳过。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { HubClient } from './hub-client.js';           // task-17
import type { WorkspaceManager, WorkspaceResult } from './workspace.js'; // task-15
import type { CredentialManager } from './credential.js';   // task-13
import { getBackend } from './adapters/index.js';           // task-11
import type { ProtocolAdapter } from './adapters/protocol-adapter.js'; // task-05
import type { AgentEvent } from './types.js';               // task-02

// ---------------------------------------------------------------------------
// 常量（对齐 Python stream_json.py:26 + task_runner.py:274-275）
// ---------------------------------------------------------------------------

/** 默认执行超时（秒），对齐 Python _EXECUTE_TIMEOUT = 300。 */
const DEFAULT_EXECUTE_TIMEOUT = 300;

/** output 截断上限（字符），对齐 Python _MAX_OUTPUT = 10_000。 */
const MAX_OUTPUT = 10_000;

/** error 截断上限（字符），对齐 Python _MAX_ERROR = 5_000。 */
const MAX_ERROR = 5_000;

/** 取消后优雅杀的宽限期（毫秒），SIGTERM 后 2s 仍存活则 SIGKILL。 */
const KILL_GRACE_MS = 2_000;

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 任务状态机（对齐 Python lease 状态语义）。 */
export type TaskStatus =
  | 'pending'      // 未开始
  | 'running'      // 执行中
  | 'completed'    // 成功完成
  | 'failed'       // 失败（非零退出 / 异常 / parse 致命错误）
  | 'cancelled'    // 被取消（AbortSignal）
  | 'timeout';     // 超时（DEFAULT_EXECUTE_TIMEOUT 触发）

/**
 * claim_lease 返回的执行上下文（lease payload）。
 * 字段对齐 Python task_runner.py:82-105 的 payload 参数 + claim_lease 返回。
 */
export interface LeaseCtx {
  /** 服务端 lease ID（claim 后获得）。 */
  readonly leaseId: string;
  /** claim 授权 token，后续 start/messages/complete 必带。 */
  readonly claimToken: string;
  /** workspace 目录名（相对 baseDir），默认 'default'。 */
  readonly workspaceName: string;
  /** git 远程 URL，首次 clone 必填；已存在则忽略。 */
  readonly repoUrl?: string;
  /** 分支名，默认 'main'。 */
  readonly branch?: string;
  /** 写入 work_dir/.claude/CLAUDE.md 的内容，空则跳过。 */
  readonly claudeMd?: string;
  /** 任务 prompt（stdin 输入）。 */
  readonly prompt?: string;
  /** 工具配置（含 {{USER_*}} 占位符），传给 credential.buildEnv。 */
  readonly toolConfig?: Record<string, unknown>;
  /** agent provider 标识，默认 'claude'。 */
  readonly provider?: string;
  /** agent CLI 可执行路径（如 /usr/local/bin/claude）。 */
  readonly cmdPath?: string;
  /** 执行超时（秒），0 或未设用 DEFAULT_EXECUTE_TIMEOUT。 */
  readonly timeout?: number;
  /** 模型名（透传给 adapter.buildArgs）。 */
  readonly model?: string;
  /** 会话 ID（首次执行为空）。 */
  readonly sessionId?: string;
  /** 恢复上次会话的 ID（多轮对话）。 */
  readonly resumeSessionId?: string;
  /** agent run ID（submit_messages 必带）。 */
  readonly agentRunId?: string;
}

/**
 * 子进程执行的通用结果（对齐 Python backends.TaskResult + task_runner.TaskResult 合并）。
 * 由 TaskRunner 统一生成，不是 adapter 职责（task-05 的 BackendExecResult 接口同义）。
 */
export interface BackendTaskResult {
  /** 执行状态（含 cancelled/timeout，比 Python 的 4 态多 2 态）。 */
  readonly status: TaskStatus;
  /** 是否成功（status === 'completed'）。 */
  readonly success: boolean;
  /** 子进程退出码，成功 0，失败 1，取消/超时 -1。 */
  readonly exitCode: number;
  /** git diff patch 文本。 */
  readonly patch: string;
  /** 改动文件数。 */
  readonly filesChanged: number;
  /** 新增行数。 */
  readonly insertions: number;
  /** 删除行数。 */
  readonly deletions: number;
  /** agent 输出文本（截断到 MAX_OUTPUT）。 */
  readonly output: string;
  /** 错误信息（截断到 MAX_ERROR）。 */
  readonly error: string;
  /** 执行耗时（毫秒）。 */
  readonly durationMs: number;
  /** agent 会话 ID（多轮对话用）。 */
  readonly sessionId: string;
  /** 额外元数据（如 session_id）。 */
  readonly metadata: Record<string, unknown>;
}

/** _spawnAndStream 的参数包。 */
interface SpawnOpts {
  readonly adapter: ProtocolAdapter;
  readonly cmdPath: string;
  readonly prompt: string;
  readonly workDir: string;
  readonly env: Record<string, string>;
  readonly timeoutSec: number;
  readonly model: string;
  readonly sessionId: string;
  readonly resumeSessionId: string;
  readonly leaseId: string;
  readonly claimToken: string;
  readonly agentRunId: string;
  readonly signal?: AbortSignal;
}

/** _spawnAndStream 的内部结果（不含 diff，runLease 再合并 diff）。 */
interface ExecResult {
  readonly status: TaskStatus;
  readonly output: string;
  readonly error: string;
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// TaskRunner 主类
// ---------------------------------------------------------------------------

/**
 * 任务执行引擎。接收已 claim 的 lease，编排完整生命周期：
 *   workspace 准备 → CLAUDE.md → credential 渲染 → getBackend → spawn 子进程
 *   → readline 逐行 parse → 流式 submit_messages → collect diff → complete。
 *
 * 设计：子进程执行下沉到本类单点（方案B 核心），adapter 只负责 parse。
 */
export class TaskRunner {
  private readonly _client: HubClient;
  private readonly _workspace: WorkspaceManager;
  private readonly _credential: CredentialManager;
  /** 追踪可取消的任务（taskId → AbortController）。 */
  private readonly _runningTasks: Map<string, AbortController> = new Map();
  /** 任务状态机（leaseId → status）。 */
  private readonly _states: Map<string, TaskStatus> = new Map();

  constructor(
    client: HubClient,
    workspace: WorkspaceManager,
    credential: CredentialManager,
  ) {
    this._client = client;
    this._workspace = workspace;
    this._credential = credential;
  }

  // ── 公共 API ────────────────────────────────────────────────────────────

  /**
   * 执行一次 lease 任务（核心入口，编排链 9 步）。
   *
   * 对齐 Python task_runner.py:77-245 execute_task。
   * @param lease 已 claim 的执行上下文
   * @returns BackendTaskResult（含 diff + 状态）
   */
  async runLease(lease: LeaseCtx): Promise<BackendTaskResult> {
    const start = Date.now();
    const taskId = randomUUID();
    this._setState(lease.leaseId, 'running');
    console.info(`task_execute_start lease_id=${lease.leaseId} task_id=${taskId}`);

    try {
      // 步骤 2：workspace 准备
      const workDir = await this._workspace.prepareWorkspace(
        lease.workspaceName || 'default',
        lease.repoUrl,
        lease.branch ?? 'main',
      );

      // 步骤 3：写 CLAUDE.md
      if (lease.claudeMd) {
        const claudeDir = path.join(workDir, '.claude');
        await fs.mkdir(claudeDir, { recursive: true });
        await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), lease.claudeMd, 'utf-8');
      }

      // 步骤 4：credential 渲染
      const extraEnv = this._credential.buildEnv(lease.toolConfig ?? {});
      const env: Record<string, string> = { ...process.env, ...extraEnv } as Record<string, string>;

      // 步骤 5：取 adapter（未知 provider 抛错 → _fail）
      const provider = lease.provider ?? 'claude';
      const cmdPath = lease.cmdPath ?? '';
      const prompt = lease.prompt ?? '';
      const timeoutSec = lease.timeout && lease.timeout > 0 ? lease.timeout : DEFAULT_EXECUTE_TIMEOUT;
      const model = lease.model ?? '';
      const sessionId = lease.sessionId ?? '';
      const resumeSessionId = lease.resumeSessionId ?? '';
      const agentRunId = lease.agentRunId ?? '';

      let adapter: ProtocolAdapter;
      try {
        adapter = getBackend(provider);
      } catch (e) {
        return this._fail(lease, `unsupported provider: ${provider}`, start);
      }

      // 步骤 6：start lease（容错，失败不中断）
      try {
        await this._client.startLease(lease.leaseId, lease.claimToken);
      } catch (e) {
        console.warn(`start_lease_failed lease_id=${lease.leaseId} err=${(e as Error).message}`);
      }

      // 步骤 7：spawn + 逐行 parse + 流式 submit
      const ac = this.track(taskId);
      const execResult = await this._spawnAndStream({
        adapter, cmdPath, prompt, workDir, env,
        timeoutSec, model, sessionId, resumeSessionId,
        leaseId: lease.leaseId, claimToken: lease.claimToken, agentRunId,
        signal: ac.signal,
      });

      // 步骤 8：collect diff（non-fatal）
      let diffResult: WorkspaceResult = {
        patch: '', files_changed: 0, insertions: 0, deletions: 0, stats: '',
      };
      try {
        diffResult = await this._workspace.collectDiff(workDir);
      } catch (e) {
        console.warn(`diff_collect_failed work_dir=${workDir} err=${(e as Error).message}`);
      }

      // 步骤 9：状态机定态 + 返回
      this.untrack(taskId);
      const success = execResult.status === 'completed';
      const durationMs = Date.now() - start;
      this._setState(lease.leaseId, execResult.status);

      console.info(
        `task_execute_done lease_id=${lease.leaseId} status=${execResult.status} ` +
        `duration_ms=${durationMs} files_changed=${diffResult.files_changed}`,
      );

      return {
        status: execResult.status,
        success,
        exitCode: success ? 0 : 1,
        patch: diffResult.patch,
        filesChanged: diffResult.files_changed,
        insertions: diffResult.insertions,
        deletions: diffResult.deletions,
        output: this._truncate(execResult.output, MAX_OUTPUT),
        error: this._truncate(execResult.error, MAX_ERROR),
        durationMs,
        sessionId: execResult.sessionId,
        metadata: execResult.sessionId ? { session_id: execResult.sessionId } : {},
      };
    } catch (e) {
      this.untrack(taskId);
      const durationMs = Date.now() - start;
      const err = e as Error;
      console.error(`task_execute_failed lease_id=${lease.leaseId} err=${err.message}`);

      // 区分取消 vs 失败（R-03 取消语义）
      if (err.name === 'AbortError' || /aborted/i.test(err.message)) {
        this._setState(lease.leaseId, 'cancelled');
        return {
          status: 'cancelled', success: false, exitCode: -1,
          patch: '', filesChanged: 0, insertions: 0, deletions: 0,
          output: '', error: 'task cancelled', durationMs,
          sessionId: '', metadata: {},
        };
      }
      this._setState(lease.leaseId, 'failed');
      return {
        status: 'failed', success: false, exitCode: 1,
        patch: '', filesChanged: 0, insertions: 0, deletions: 0,
        output: '', error: this._truncate(err.message, MAX_ERROR), durationMs,
        sessionId: '', metadata: {},
      };
    }
  }

  // ── 取消 / 追踪 ────────────────────────────────────────────────────────

  /** 当前运行中的任务数（对齐 Python active_task_count）。 */
  get activeTaskCount(): number {
    return this._runningTasks.size;
  }

  /** 注册一个可取消任务，返回 AbortController（对齐 Python track）。 */
  track(taskId: string): AbortController {
    const ac = new AbortController();
    this._runningTasks.set(taskId, ac);
    return ac;
  }

  /** 移除追踪（对齐 Python untrack，不存在的 taskId 静默）。 */
  untrack(taskId: string): void {
    this._runningTasks.delete(taskId);
  }

  /**
   * 取消一个追踪中的任务（对齐 Python cancel_task）。
   * @returns true 找到并触发 abort；false 未找到
   */
  async cancel(taskId: string): Promise<boolean> {
    const ac = this._runningTasks.get(taskId);
    if (!ac) return false;
    ac.abort();
    this._runningTasks.delete(taskId);
    return true;
  }

  /** 查询某 lease 的当前状态（供 Daemon task-20 查询用）。 */
  getState(leaseId: string): TaskStatus | undefined {
    return this._states.get(leaseId);
  }

  // ── 内部：spawn + 流处理（方案B 下沉核心，承载 R-03/R-04）──────────────

  /**
   * 子进程执行模板（下沉自 Python StreamJsonBackend.execute）。
   * provider 无关——cmd 由 adapter.buildArgs 构造，parse 由 adapter.parse 处理。
   *
   * 流程：
   *   1. spawn 子进程（cmdPath + adapter.buildArgs()）
   *   2. 写 prompt 到 stdin（不关闭，R-03）
   *   3. readline 逐行读 stdout → adapter.parse → onEvent 流式 submit（R-04 背压）
   *   4. control_request 行 → adapter.onControl(line, stdin) 应答（R-03）
   *   5. result 行 → 关闭 stdin
   *   6. 超时看门狗 / 取消信号 → kill 子进程
   *   7. 等待退出 → 收集 stderr → 返回 ExecResult
   */
  private async _spawnAndStream(opts: SpawnOpts): Promise<ExecResult> {
    const {
      adapter, cmdPath, prompt, workDir, env,
      timeoutSec, model, sessionId, resumeSessionId,
      leaseId, claimToken, agentRunId, signal,
    } = opts;

    if (!cmdPath) {
      return { status: 'failed', output: '', error: 'cmd_path is empty', sessionId: '' };
    }

    // 构造命令（adapter 决定 args，对齐 Python stream_json.py:49-53 _build_args）
    const adapterArgs = adapter.buildArgs?.({ model, sessionId, resumeSessionId }) ?? [];
    const fullCmd = [cmdPath, ...adapterArgs];

    // spawn（对齐 Python asyncio.create_subprocess_exec）
    let child: ChildProcess;
    try {
      child = spawn(fullCmd[0]!, fullCmd.slice(1), {
        cwd: workDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return { status: 'failed', output: '', error: `spawn failed: ${(e as Error).message}`, sessionId: '' };
    }

    // spawn 异步错误（ENOENT 等可能延迟到 'error' 事件）
    let spawnError: Error | null = null;
    child.on('error', (e) => { spawnError = e; });

    // 步骤 R4：写 prompt 到 stdin，不关闭（R-03 核心）
    const inputData = adapter.buildInput?.(prompt) ?? `${prompt}\n`;
    let stdinClosed = false;
    const closeStdin = (): void => {
      if (!stdinClosed && child.stdin && !child.stdin.destroyed) {
        try { child.stdin.end(); } catch { /* ignore */ }
        stdinClosed = true;
      }
    };
    try {
      child.stdin?.write(inputData);
    } catch (e) {
      console.debug(`stdin_write_failed err=${(e as Error).message}`);
    }

    // 步骤 R12：后台累积 stderr（对齐 Python stream_json.py:93-106）
    let stderrText = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderrText += chunk.toString('utf-8'); });

    // 步骤 R11：超时看门狗（对齐 Python stream_json.py:110-119）
    let timeoutTimer: NodeJS.Timeout | null = null;
    let timedOut = false;
    if (timeoutSec > 0) {
      timeoutTimer = setTimeout(() => {
        console.warn(`task_timeout lease_id=${leaseId} timeout=${timeoutSec}s`);
        timedOut = true;
        this._killProcess(child);
      }, timeoutSec * 1000);
    }

    // 取消信号监听（R-07）
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
      console.info(`task_cancelled lease_id=${leaseId}`);
      this._killProcess(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // onEvent 回调（步骤 R10，流式 submit）
    const outputParts: string[] = [];
    const onEvent = async (ev: AgentEvent): Promise<void> => {
      // 累积 text 类输出（对齐 Python stream_json.py:191-192）
      if (ev.type === 'text' && ev.content) outputParts.push(ev.content);

      const message = this._eventToMessage(ev);
      if (!message) return;
      try {
        await this._client.submitMessages(leaseId, claimToken, agentRunId, [message]);
      } catch (e) {
        console.warn(`event_forward_failed err=${(e as Error).message}`);
      }
    };

    // 步骤 R5：readline 逐行流处理（R-04 背压核心）
    let resultSessionId = '';
    try {
      await this._consumeStdout(child, adapter, onEvent, closeStdin, signal);
    } catch (e) {
      console.warn(`stdout_consume_error err=${(e as Error).message}`);
    }

    // 清理
    closeStdin();
    if (timeoutTimer) clearTimeout(timeoutTimer);
    signal?.removeEventListener('abort', onAbort);

    // 处理 spawn 错误
    if (spawnError) {
      return { status: 'failed', output: outputParts.join(''),
               error: `spawn error: ${spawnError.message}`, sessionId: '' };
    }

    // 等待子进程退出（对齐 Python proc.wait()）
    const exitCode = await this._waitForExit(child);

    // 定状态（优先级：取消 > 超时 > 退出码非零 > 完成）
    let status: TaskStatus;
    let error = '';
    if (cancelled) {
      status = 'cancelled';
      error = 'task cancelled';
    } else if (timedOut) {
      status = 'timeout';
      error = `execution timed out after ${timeoutSec}s`;
    } else if (exitCode !== null && exitCode !== 0) {
      status = 'failed';
      const stderrTrim = stderrText.trim();
      error = stderrTrim ? `exit code ${exitCode}: ${stderrTrim}` : `exit code ${exitCode}`;
    } else {
      status = 'completed';
    }

    return {
      status,
      output: outputParts.join(''),
      error,
      sessionId: resultSessionId,
    };
  }

  /**
   * readline 逐行读 stdout（R-04 背压核心，对齐 Python _consume_stdout）。
   *
   * R-04 要点：
   *   - readline.createInterface 天然背压（for await 一行处理完才读下一行）；
   *   - crlfDelay: Infinity 兼容 \r\n 和 \n；
   *   - UTF-8 解码由 Node stream 默认处理，非 UTF-8 噪声行 parse 返回 null 跳过。
   */
  private async _consumeStdout(
    child: ChildProcess,
    adapter: ProtocolAdapter,
    onEvent: (ev: AgentEvent) => Promise<void>,
    closeStdin: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!child.stdout) return;

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    try {
      for await (const rawLine of rl) {
        if (signal?.aborted) break;          // 取消即停读

        const line = rawLine.trim();
        if (!line) continue;                  // 跳空行（Python stream_json.py:185-186）

        // 5a. parse → AgentEvent[]（parse 抛错不中断，边界 B-19-04）
        let events: AgentEvent[] | null = null;
        try {
          events = adapter.parse(line);
        } catch (e) {
          console.warn(`parse_error line=${line.slice(0, 100)} err=${(e as Error).message}`);
          continue;
        }

        // 5b. 流式 submit 每个 event
        if (events && events.length > 0) {
          for (const ev of events) {
            await onEvent(ev);
          }
        }

        // 5c. control_request 应答（R-03，调 adapter.onControl）
        if (adapter.onControl && this._isControlLine(line)) {
          try {
            await adapter.onControl(line, child.stdin!);
          } catch (e) {
            console.debug(`on_control_failed err=${(e as Error).message}`);
          }
        }

        // 5d. result 行 → 关闭 stdin（子进程完成，对齐 stream_json.py:200-203）
        if (this._isResultLine(line)) {
          closeStdin();
        }
      }
    } finally {
      rl.close();
    }
  }

  // ── 内部辅助 ──────────────────────────────────────────────────────────

  /** 轻量检测 control_request 行（不解析具体协议，解析是 adapter 职责）。 */
  private _isControlLine(line: string): boolean {
    return line.includes('"control_request"') || line.includes('"type":"control"');
  }

  /** 轻量检测 result 行（子进程完成信号）。 */
  private _isResultLine(line: string): boolean {
    return line.includes('"type":"result"') || line.includes('"type":"completed"');
  }

  /** 优雅杀子进程：SIGTERM → 2s 宽限 → SIGKILL（对齐取消竞态处理）。 */
  private _killProcess(child: ChildProcess): void {
    try {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
        } catch { /* 已退出 */ }
      }, KILL_GRACE_MS).unref();
    } catch { /* ignore */ }
  }

  /** 等待子进程退出，最多 5 秒（对齐 Python proc.wait(timeout=5)）。 */
  private _waitForExit(child: ChildProcess): Promise<number | null> {
    return new Promise((resolve) => {
      if (child.exitCode !== null) { resolve(child.exitCode); return; }
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolve(null);
      }, 5_000).unref();
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  /** 状态机更新。 */
  private _setState(leaseId: string, status: TaskStatus): void {
    this._states.set(leaseId, status);
  }

  /** 失败快捷路径（对齐 Python task_runner.py:162-166 unsupported provider 分支）。 */
  private _fail(lease: LeaseCtx, errorMsg: string, start: number): BackendTaskResult {
    this._setState(lease.leaseId, 'failed');
    return {
      status: 'failed', success: false, exitCode: 1,
      patch: '', filesChanged: 0, insertions: 0, deletions: 0,
      output: '', error: errorMsg, durationMs: Date.now() - start,
      sessionId: '', metadata: {},
    };
  }

  /** 截断文本到指定长度（对齐 Python _truncate，静态方法）。 */
  private static _truncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    return text.slice(0, limit);
  }

  // 实例代理到静态方法（便于测试 mock）
  private _truncate(text: string, limit: number): string {
    return TaskRunner._truncate(text, limit);
  }

  /**
   * AgentEvent → submit_messages payload（对齐 Python _event_to_message L285-311）。
   * 过滤空 content / tool_name / status，仅返回有实质内容的消息。
   */
  private _eventToMessage(ev: AgentEvent): Record<string, unknown> | null {
    const msg: Record<string, unknown> = { event_type: ev.type };
    if (ev.content) msg.content = ev.content;
    if (ev.metadata) {
      const m = ev.metadata as Record<string, unknown>;
      if (m.tool_name) msg.tool_name = m.tool_name;
      if (m.call_id) msg.call_id = m.call_id;
      if (m.status) msg.status = m.status;
      if (m.level) msg.level = m.level;
      if (m.session_id) msg.session_id = m.session_id;
    }
    if (!ev.content && !ev.metadata?.tool_name && !ev.metadata?.status) return null;
    return msg;
  }
}
```

> **搬砖工注意**：
> 1. 上面代码块的 `_truncate` 同时声明了静态 + 实例两个版本（实例代理到静态），这是为了让测试既能 `TaskRunner._truncate(...)` 静态调，又能 `runner._truncate(...)` 实例调（与 Python `@staticmethod` + 实例调用双支持对齐）。若 TS strict 报「同名方法」警告，可只保留实例版本（私有），测试改用实例调用——两种都接受，AC-07 tsc 零错误为准。
> 2. `process.env` 的类型在 Node 中是 `NodeJS.ProcessEnv`（值可能 undefined），强转到 `Record<string, string>` 时用 `as`。spawn 的 env 选项接受 undefined 值，运行时无碍。
> 3. `child.stdin!` 的非空断言：stdio 配为 `['pipe','pipe','pipe']` 时 stdin 一定是 WritableStream，`!` 是安全的（与 Python `proc.stdin` 非 None 假设一致）。

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-19-01** | **R-03 stdin 不关闭避免 hang**（stream_json/claude 等） | 写完 prompt **不立即关闭 stdin**——stream_json 协议的子进程会在执行中通过 stdout 发 `control_request`（工具批准），期望在同一 stdin 流收到 `control_response` 才继续，否则无限 hang。stdin 仅在以下情况关闭：①收到 `result` 行（`_isResultLine` 检测，对齐 Python stream_json.py:200-203）；②超时 / 取消 / 错误的 cleanup 路径（`closeStdin()` 在 finally 调）；③子进程退出（防御性）。这是 R-03 风险的核心应对，单测须断言「spawn 后 stdin 未立即 end、result 后才 end」。 |
| **B-19-02** | **R-04 stdout 背压用 readline 不积压** | 用 `readline.createInterface({ input: child.stdout, crlfDelay: Infinity })` + `for await...of` 逐行读。readline 的异步迭代器天然背压——读下一行前必须处理完当前行（含 `await onEvent(ev)` 的 submit_messages），不会积压。**禁止**用 `child.stdout.on('data', ...)` 手动监听（会一次性读到 buffer 全部，背压失控）。**禁止**手动 split 切行（跨行 JSON / 二进制噪声会出错）。编码：Node stream 默认 UTF-8，与 Python `decode('utf-8', errors='replace')` 等价；非 UTF-8 噪声行 adapter.parse 返回 null 跳过（不崩）。 |
| **B-19-03** | **control_request 应答逻辑归属（adapter vs TaskRunner）** | 应答 payload 构造（stream_json 的 `control_response` + `behavior: allow` + `updatedInput`）**留在 adapter**（task-06 StreamJsonAdapter.onControl），**不放 TaskRunner**。理由：①应答格式是协议特定的（stream_json 与 json_rpc 不同），放 adapter 才符合方案B「协议差异 100% 收敛于 adapter」；②TaskRunner 只做「检测到 control 类行 → 调 `adapter.onControl(line, stdin)` 传入 line + 可写流」。TaskRunner 的 `_isControlLine` 做轻量字符串检测（含 `"control_request"`），不做完整 JSON 解析。**签名修正**：task-05 的 `onControl(stdin)` 升级为 `onControl(line, stdin)`（adapter 需 line 才能解析），见 §接口定义的 task-05 签名修正说明。 |
| **B-19-04** | **parse 抛错不中断整体** | `adapter.parse(line)` 在 try/catch 内调用。抛错时记 `console.warn` + `continue` 跳过该行，不中断整个 readline 循环（对齐 Python stream_json.py:188-204 对 parse_output 的容错——Python 的 parse_output 也用 try/except JSONDecodeError 返回 None）。理由：坏行（格式损坏的 JSON / 二进制噪声 / provider 偶发调试输出）不应让整个任务失败。致命错误（如整个进程崩溃）由 spawn 的 exit 事件捕获，不走 parse 路径。 |
| **B-19-05** | **子进程非零退出映射 failed** | 子进程退出后，`exitCode !== null && exitCode !== 0` → status='failed'，error 含退出码 + stderr（对齐 Python stream_json.py:143-152）。若 exitCode === null（被信号杀死，如 SIGTERM/SIGKILL），结合 timedOut/cancelled 标志判定 timeout 或 cancelled，**不是 failed**。stderr 累积在 `_spawnAndStream` 的 `stderrText` 变量，退出后拼进 error。空 stderr 时 error 仅含 `exit code N`（不空字符串）。 |
| **B-19-06** | **取消竞态（AbortSignal vs 子进程退出）** | abort 触发后调 `_killProcess(child)`（SIGTERM → 2s 宽限 → SIGKILL）。但子进程可能在 abort 前已自然退出，此时 `child.killed === false` 但 `exitCode !== null`——`_killProcess` 的 `if (!child.killed)` 守卫 + `kill()` 调用对已退出进程是 no-op（Node kill 对已退出进程返回 false，不抛错）。`cancelled` 标志在 onAbort 设 true，最终状态优先级 `cancelled > timedOut > exitCode非零 > completed`，确保取消语义不被退出码覆盖。 |
| **B-19-07** | **超时看门狗（DEFAULT_EXECUTE_TIMEOUT = 300s）** | 若 `lease.timeout` 未提供或为 0，用 `DEFAULT_EXECUTE_TIMEOUT = 300`（5 分钟，对齐 Python `_EXECUTE_TIMEOUT = 300`）。setTimeout 触发后设 `timedOut = true` + `_killProcess`。子进程 exit 后清除 timer（防内存泄漏）。状态置 `timeout`（不是 `failed`，与 Python `final_status = "timeout"` 一致）。单测用 `vi.useFakeTimers()` 加速，无需实等 300s。 |
| **B-19-08** | **workspace 准备失败（GitError）** | `prepareWorkspace` 抛 `GitError`（task-15）→ 被 `runLease` 的顶层 try/catch 捕获 → 状态机置 `failed`，error 含 GitError.message（含 git 命令 + 退出码 + stderr）。**不重试**（git 失败通常是网络/认证/冲突，重试无意义，对齐 task-15 边界 1）。**不自动 cleanWorkspace**（清理时机由 Daemon task-20 决策，本任务不内嵌）。 |
| **B-19-09** | **submit_messages 失败不中断** | `HubClient.submitMessages` 抛错（网络断 / 5xx）→ onEvent 回调内 try/catch 捕获 → `console.warn` 记录，**不向上抛**（对齐 Python task_runner.py:183-184 `except Exception as exc: logger.warning`）。理由：消息流式回传是「尽力而为」，单次 submit 失败不应让整个 agent 执行失败（agent 仍在跑，diff 仍能收集）。极端情况（server 完全不可达）由 lease 最终 complete 的失败暴露，而非中途崩。 |
| **B-19-10** | **空 stdout（agent 无输出）** | readline 循环立即结束（child.stdout 流关闭），`outputParts` 为空数组 → output=''。子进程正常退出（exitCode=0）→ status='completed'，**不是 failed**。对齐 Python 行为（无输出但成功退出视为成功）。diff 仍尝试收集（可能 agent 直接改了文件没输出文本）。 |
| **B-19-11** | **stderr 处理（后台累积，不阻塞 stdout）** | `child.stderr.on('data', ...)` 注册监听器后台累积 stderrText，不 await（非阻塞）。stderr 仅在子进程非零退出时拼进 error，正常退出时丢弃（对齐 Python stream_json.py:93-106 `_read_stderr` 协程）。**不用 readline 读 stderr**（stderr 通常是非结构化日志，无行协议）。stderr 过大（>1MB）不截断（罕见，agent CLI 的 stderr 一般小）。 |
| **B-19-12** | **未知 provider（getBackend 抛错）** | `getBackend(provider)` 在 try/catch 内调用，抛 Error（task-11 B-01，信息含 12 provider 列表）→ 走 `_fail(lease, 'unsupported provider: ...', start)` 快捷路径返回 failed。**不重试**（provider 名是配置错误，重试无意义）。状态机置 `failed`，exitCode=1。 |
| **B-19-13** | **cmdPath 为空** | `lease.cmdPath` 未提供或空字符串 → `_spawnAndStream` 开头守卫 `if (!cmdPath) return { status: 'failed', error: 'cmd_path is empty' }`。不调 spawn（避免 spawn('') 抛错）。对齐 Python 隐式假设（Python `cmd_path` 来自 payload，空时各 backend 的 execute 会因 `subprocess_exec('')` 抛 FileNotFoundError，Node 版提前守卫更清晰）。 |
| **B-19-14** | **跨平台子进程信号** | `_killProcess` 用 `SIGTERM`/`SIGKILL` 常量（Node 跨平台映射，Windows 上 SIGTERM 实际是 TerminateProcess）。Windows 无 SIGTERM 语义但 Node 的 `child.kill('SIGTERM')` 会调 TerminateProcess，行为等价（强制终止）。不区分平台（与 Python `proc.kill()` 一致，Python kill 在 Windows 也是 TerminateProcess）。 |
| **B-19-15** | **output/error 截断** | `_truncate(text, MAX_OUTPUT=10000)` / `_truncate(text, MAX_ERROR=5000)`，对齐 Python `_MAX_OUTPUT`/`_MAX_ERROR`。截断用 `slice(0, limit)`（不加分省略号，与 Python 一致——Python `text[:limit]`）。极端长输出（如 agent 输出整个文件内容）不会撑爆 submit_messages 的 payload（截断后 submit）。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-19-1**：不做 lease 状态机分发（task_available → claim → start → runLease → complete 的调度）。Daemon 主类 task-20 负责 lease 生命周期分发，本任务只暴露 `runLease(lease)` 单次执行入口。
- **N-19-2**：不解析任何协议输出。adapter.parse 的实现在 task-06..10，本任务只调用 `adapter.parse(line)` 并把返回的 AgentEvent 流式 submit。
- **N-19-3**：不做 WebSocket 通信。WsClient 在 task-18，本任务的 HubClient（task-17）是 REST（submitMessages/completeLease/startLease）。
- **N-19-4**：不实现具体 provider 的 cmd 构造（`-p --output-format stream-json` 等）。各 adapter 的 `buildArgs(opts)` / `buildInput(prompt)` 在 task-06..10 实现，本任务只调用。
- **N-19-5**：不做 agent 检测（12 provider 探测）。agent-detector 在 task-12，本任务接收已 claim 的 lease（含 cmdPath），不主动探测。
- **N-19-6**：不做凭证 CRUD（set/get/remove）。CredentialManager 的 CRUD 在 task-13，本任务只用 `buildEnv(toolConfig)` 渲染注入 env。
- **N-19-7**：不做 git mirror/pull/diff 的具体实现。WorkspaceManager 在 task-15，本任务调用 `prepareWorkspace` / `collectDiff`。
- **N-19-8**：不实现结构化 logger（pino/winston）。用 `console.info/warn/error/debug`，后续 task 统一替换（与 task-13/15 一致策略）。
- **N-19-9**：不做 lease 重试 / 幂等性。单次 runLease 执行，失败即返回 failed，重试由 Daemon task-20 决策（若需要）。
- **N-19-10**：不做并发任务调度（同一 daemon 同时跑多个 lease）。本任务的 `_runningTasks` Map 只追踪 taskId → AbortController 用于取消，不做队列 / 优先级 / 资源限制。并发控制是 Daemon task-20 的职责。
- **N-19-11**：不写测试文件（1:1 迁移 Python `test_task_runner.py` 在 task-22 统一处理）。本任务只产 `src/task-runner.ts`。但实现须保证 task-22 能直接照搬 Python 用例（见 §TDD 步骤供 execute 阶段自验证）。

---

## 参考

### Python 源文件

| 文件 | 行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 1-32 | 模块 docstring + imports（`get_backend` / `HubClient` / `CredentialManager` / `WorkspaceManager`） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 35-48 | `TaskResult` dataclass（Node 版扩展为 `BackendTaskResult` 含 status 状态机） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 64-73 | `__init__`（client/workspace/credential 注入 + `_running_tasks` dict） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 77-105 | `execute_task` docstring（7 步流程描述，Node 版扩为 9 步） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 110-119 | **步骤 1** prepare_workspace（Node 版 prepareWorkspace） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 121-126 | **步骤 2** 写 CLAUDE.md |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 128-131 | **步骤 3** credential build_env（Node 版 buildEnv） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 133-170 | **步骤 4** 解析 payload + get_backend（catch ValueError/ImportError → failed） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 172-184 | **on_event 回调** event → submit_messages（网络异常只 warn） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 186-197 | **步骤 5** backend.execute（**Node 版下沉为 _spawnAndStream**） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 199-236 | **步骤 6-7** collect_diff + TaskResult 构造（non-fatal diff） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 238-245 | **顶层 except** 异常 → failed TaskResult |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 262-269 | `cancel_task`（asyncio.Task.cancel，Node 版用 AbortController） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 274-275 | `_MAX_OUTPUT=10000` / `_MAX_ERROR=5000` |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 285-311 | `_event_to_message`（AgentEvent → dict，过滤空字段） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 34-70 | **execute 入口** spawn 子进程（Node 版下沉到 _spawnAndStream） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 72-91 | **stdin 写 prompt 不关闭**（R-03 核心，Node 版照搬） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 93-106 | **stderr 后台读**（Node 版 child.stderr.on('data')） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 108-119 | **超时看门狗** asyncio.wait_for（Node 版 setTimeout + kill） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 143-152 | **非零退出映射 failed**（拼 stderr） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 174-204 | **_consume_stdout** 逐行 read + parse + control_request（R-03/R-04 Python 参考） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 206-246 | **_handle_control_request** 自动批准（Node 版留在 adapter.onControl，B-19-03） |
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | 281-303 | **_build_args / _build_input**（cmd + stdin prompt 构造，Node 版由 adapter 实现） |
| `sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py` | 45-73 | `_JsonRpcTransport`（json_rpc 的 stdin/stdout 双向通信，了解协议差异——本任务不实现 transport，json_rpc adapter 内部处理） |
| `sillyhub-daemon/tests/test_task_runner.py` | 全文 | 工厂 mock + workspace fixture + diff 集成测试（task-22 迁移依据） |
| `sillyhub-daemon/sillyhub_daemon/client.py` | 151-182 | `submit_messages` / `complete_lease` / `start_lease` 签名（task-17 HubClient 接口来源） |

### 设计文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `design.md` | §5.1 分层架构 | ★ 方案B 拆分：子进程执行下沉到 TaskRunner 单点，adapter 只 parse（本任务的设计原则依据） |
| `design.md` | §5.2 Wave 路线图 | W4 编排层验收门槛：端到端 mock 流程测试 |
| `design.md` | §7.5 lease 编排骨架 | **核心** TaskRunner.executeTask 伪代码（7 步，Node 版扩为 9 步加 start lease） |
| `design.md` | §10 R-03 | stdin control_request 应答丢失致子进程 hang（P1）—— 本任务承载，应对：stdin 不关闭 + adapter.onControl 应答 + 超时看门狗测试 |
| `design.md` | §10 R-04 | stdout 流式背压/编码差异（P1）—— 本任务承载，应对：readline.createInterface 逐行读 + 单测覆盖跨行 JSON/空行/非 UTF-8 噪声 |

### 需求文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `requirements.md` | FR-04 lease 生命周期 | claim → start → 流式 messages(submit) → complete(带 patch+stats)，状态机与 Python 一致（本任务覆盖 start/runLease/submit/complete 四环） |
| `requirements.md` | FR-08 stdin control_request 应答 | 子进程发 control_request 时 daemon 保持 stdin 开启并按策略应答（自动批准工具），避免 hang（本任务承载） |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/task-runner.md` | 契约摘要（TaskResult + execute_task + track/untrack/cancel）+ 关键逻辑（7 步编排）+ 注意事项（output 截断 10000 / diff non-fatal / on_event 网络异常只 warn） |

### 关联 task

| task | 关系 |
|---|---|
| task-11 | 提供 `getBackend(provider): ProtocolAdapter` 工厂，本任务 `const adapter = getBackend(provider)` 调用 |
| task-17 | 提供 `HubClient`（submitMessages / completeLease / startLease），本任务构造注入 |
| task-13 | 提供 `CredentialManager.buildEnv(config)`，本任务调 `this._credential.buildEnv(lease.toolConfig)` |
| task-15 | 提供 `WorkspaceManager`（prepareWorkspace / collectDiff）+ `GitError` 类，本任务调 + catch GitError |
| task-05 | 提供 `ProtocolAdapter` 接口（**签名修正**：onControl 升级为 `onControl(line, stdin)`，新增 buildArgs/buildInput，见 §接口定义说明） |
| task-02 | 提供 `AgentEvent` 类型（IR，task-05 import 自 types.ts） |
| task-06..10 | 5 个 adapter 实现 `parse(line)` + `onControl`（stream_json）+ `buildArgs`/`buildInput`，本任务调用 |
| task-20 | Daemon 主类，调 `taskRunner.runLease(lease)` 驱动单次任务 + 状态机查询 |
| task-22 | 测试迁移：`test_task_runner.py` 1:1 迁到 `tests/task-runner.test.ts` |

---

## TDD 步骤

> 严格遵循 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。
> 本任务**不写测试文件**（task-22 统一迁移），但实现须保证 task-22 能直接照搬 Python `test_task_runner.py` 用例。以下步骤供 execute 阶段自验证（可临时写 scratch 测试后删除，或留给 task-22）。
> **测试难点**（这是整个重写最复杂的测试）：mock `child_process.spawn`（返回 fake child_process）+ mock adapter（`getBackend` patch）+ mock HubClient（submitMessages/completeLease）。

### 步骤 1：读 Python 源与前置 task 产出

- 读 `task_runner.py` 全文（确认 execute_task 编排链 + TaskResult 字段 + cancel_task + _event_to_message）。
- 读 `backends/stream_json.py` 全文（确认 execute 子进程模板 + _consume_stdout + _handle_control_request）。
- 读 `tests/test_task_runner.py` 全文（提取测试用例编号：successful/failed/exception/no_prompt/claude_md/credentials/truncation/streaming/submit_failure/tracking/diff）。
- 确认 task-11/13/15/17 产出就绪（getBackend / CredentialManager / WorkspaceManager / HubClient 接口可 import）。若 task-17 未就绪，本任务阻塞（depends_on）。

### 步骤 2：写 FakeChildProcess 工具（mock spawn 核心）

```ts
// tests/helpers/fake-child.ts（scratch，task-22 规范化）
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

export interface FakeChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  killed: boolean;
  pid: number;
  kill(signal?: string): boolean;
  _emitLines(stdoutLines: string[]): void;   // 测试驱动：逐行 push stdout
  _emitExit(code: number): void;              // 测试驱动：触发 exit
}

export function createFakeChild(): FakeChild {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  const ee = new EventEmitter() as FakeChild;
  ee.stdin = stdin;
  ee.stdout = stdout;
  ee.stderr = stderr;
  ee.exitCode = null;
  ee.killed = false;
  ee.pid = 12345;
  ee.kill = (signal?: string) => { ee.killed = true; return true; };
  ee._emitLines = (lines: string[]) => {
    for (const line of lines) stdout.push(line + '\n');
    stdout.push(null);  // EOF
  };
  ee._emitExit = (code: number) => {
    ee.exitCode = code;
    ee.emit('exit', code);
  };
  return ee;
}
```

### 步骤 3：mock spawn + getBackend + HubClient，测编排链成功路径

```ts
// tests/task-runner.test.ts（scratch）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskRunner } from '../src/task-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';

// mock getBackend 返回可控 adapter
const mockAdapter = {
  provider: 'claude',
  parse: vi.fn((line: string) => {
    if (line.includes('hello')) return [{ type: 'text', content: line }];
    return null;
  }),
  buildArgs: () => ['-p', '--output-format', 'stream-json'],
  buildInput: (prompt: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: prompt }] } }) + '\n',
};

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn(() => mockAdapter),
}));

describe('TaskRunner.runLease — 编排链成功路径', () => {
  beforeEach(() => vi.clearAllMocks());

  it('9 步完整：workspace → CLAUDE.md → cred → adapter → start → spawn → parse → submit → diff', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const mockClient = {
      startLease: vi.fn().mockResolvedValue({}),
      submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
      completeLease: vi.fn().mockResolvedValue({}),
    };
    const mockWorkspace = {
      prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
      collectDiff: vi.fn().mockResolvedValue({ patch: 'diff --git', files_changed: 1, insertions: 5, deletions: 2, stats: '1 file' }),
    };
    const mockCred = { buildEnv: vi.fn().mockReturnValue({ API_KEY: 'sk-xxx' }) };

    const runner = new TaskRunner(mockClient as any, mockWorkspace as any, mockCred as any);

    const resultPromise = runner.runLease({
      leaseId: 'lease-1', claimToken: 'tok', workspaceName: 'test-ws',
      claudeMd: '# Instructions', prompt: 'hello', provider: 'claude',
      cmdPath: '/usr/local/bin/claude', agentRunId: 'run-1',
    } as any);

    // 驱动 fakeChild 输出 + 退出
    fakeChild._emitLines(['hello world', '{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);

    const result = await resultPromise;

    // 断言 9 步全部调用
    expect(mockWorkspace.prepareWorkspace).toHaveBeenCalledWith('test-ws', undefined, 'main');
    expect(mockCred.buildEnv).toHaveBeenCalled();
    expect(mockClient.startLease).toHaveBeenCalledWith('lease-1', 'tok');
    expect(spawn).toHaveBeenCalled();
    expect(mockAdapter.parse).toHaveBeenCalledTimes(2);  // 2 行
    expect(mockClient.submitMessages).toHaveBeenCalledTimes(1);  // hello world 一行触发
    expect(mockWorkspace.collectDiff).toHaveBeenCalledWith('/tmp/ws/test');

    // 结果
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.patch).toBe('diff --git');
    expect(result.filesChanged).toBe(1);
    expect(result.sessionId).toBe('');  // result 行的 session_id 提取需 adapter 配合
  });
});
```

### 步骤 4：测 R-04 stdout 背压（readline 不积压）

```ts
describe('R-04 stdout 背压', () => {
  it('大量行逐行 submit，不积压（submit 顺序 = stdout 顺序）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const submitCalls: string[] = [];
    const mockClient = {
      startLease: vi.fn().mockResolvedValue({}),
      submitMessages: vi.fn(async (_l, _t, _r, msgs) => {
        submitCalls.push(msgs[0].content);
        // 模拟 submit 慢（验证背压：慢 submit 不导致后续行积压错序）
        await new Promise(r => setTimeout(r, 5));
      }),
      completeLease: vi.fn().mockResolvedValue({}),
    };
    // ... 构造 runner ...
    const runner = new TaskRunner(mockClient as any, /* ws, cred */);

    const p = runner.runLease({ /* lease */ } as any);
    fakeChild._emitLines(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
    fakeChild._emitExit(0);
    await p;

    // 断言：submit 顺序与 stdout 一致（背压保证）
    expect(submitCalls).toEqual(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
  });

  it('跨行 JSON（被 readline 正确切行）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    // mock adapter.parse 仅识别完整 JSON 行
    mockAdapter.parse = (line: string) => {
      try { JSON.parse(line); return [{ type: 'text', content: 'parsed' }]; }
      catch { return null; }  // 不完整行被跳过
    };
    // ... runner ...
    const p = runner.runLease({} as any);
    // 注意：fakeChild._emitLines 每个元素是一行（已切好），模拟 readline 行为
    fakeChild._emitLines(['{"partial":', '"json"}']);  // 2 行各不是完整 JSON → parse 跳过
    fakeChild._emitExit(0);
    await p;
    expect(mockClient.submitMessages).not.toHaveBeenCalled();  // 无完整 JSON
  });
});
```

### 步骤 5：测 R-03 stdin control（不 hang）

```ts
describe('R-03 stdin control', () => {
  it('control_request 行触发 adapter.onControl（应答写入 stdin）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const writeSpy = vi.spyOn(fakeChild.stdin, 'write');

    mockAdapter.onControl = vi.fn((line, stdin) => {
      stdin.write(JSON.stringify({ type: 'control_response', response: { behavior: 'allow' } }) + '\n');
    });

    const p = runner.runLease({ /* lease */ } as any);
    fakeChild._emitLines(['{"type":"control_request","request_id":"r1"}', '{"type":"result"}']);
    fakeChild._emitExit(0);
    await p;

    expect(mockAdapter.onControl).toHaveBeenCalled();
    // stdin 写了 control_response（应答）
    const writes = writeSpy.mock.calls.map(c => c[0].toString());
    expect(writes.some(w => w.includes('control_response'))).toBe(true);
  });

  it('写完 prompt 后 stdin 不立即 end（result 行后才 end）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const endSpy = vi.spyOn(fakeChild.stdin, 'end');

    const p = runner.runLease({ prompt: 'hi' } as any);
    // spawn 后立即检查：stdin 未 end
    expect(endSpy).not.toHaveBeenCalled();

    fakeChild._emitLines(['{"type":"result"}']);
    // result 行后 stdin 应已 end
    expect(endSpy).toHaveBeenCalled();

    fakeChild._emitExit(0);
    await p;
  });
});
```

### 步骤 6：测取消（AbortSignal）

```ts
describe('取消', () => {
  it('cancel(taskId) 触发 AbortSignal，子进程被 kill，status=cancelled', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const p = runner.runLease({ leaseId: 'l-cancel' } as any);
    // 找到 taskId（runLease 内部 randomUUID，测试可暴露 _runningTasks 或用固定 taskId）
    // 简化：直接从 runner._runningTasks 取第一个 key
    const taskId = runner._runningTasks.keys().next().value;
    const cancelled = await runner.cancel(taskId);

    expect(cancelled).toBe(true);
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    fakeChild._emitExit(null);  // 被信号杀死
    const result = await p;

    expect(result.status).toBe('cancelled');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
  });

  it('cancel 不存在的 taskId 返回 false', async () => {
    expect(await runner.cancel('nonexistent')).toBe(false);
  });
});
```

### 步骤 7：测超时看门狗

```ts
describe('超时', () => {
  it('超过 timeout 触发 kill，status=timeout', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const p = runner.runLease({ leaseId: 'l-timeout', timeout: 10 } as any);  // 10s 超时
    vi.advanceTimersByTime(11_000);  // 快进 11s

    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    fakeChild._emitExit(null);
    vi.useRealTimers();
    const result = await p;

    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out after 10s');
  });
});
```

### 步骤 8：测错误传播

```ts
describe('错误传播', () => {
  it('子进程非零退出 → status=failed + error 含退出码 + stderr', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const p = runner.runLease({} as any);
    fakeChild.stderr.push('permission denied');
    fakeChild._emitExit(127);
    const result = await p;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(1);  // TaskRunner 统一非零退出映射 exitCode=1
    expect(result.error).toContain('exit code 127');
    expect(result.error).toContain('permission denied');
  });

  it('未知 provider → getBackend 抛错 → status=failed', async () => {
    vi.mocked(getBackend).mockImplementationOnce(() => { throw new Error('Unknown provider: foo'); });
    const result = await runner.runLease({ provider: 'foo' } as any);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('unsupported provider');
  });

  it('workspace 准备失败（GitError）→ status=failed', async () => {
    mockWorkspace.prepareWorkspace.mockRejectedValueOnce(new Error('git clone failed: auth'));
    const result = await runner.runLease({ repoUrl: 'bad' } as any);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('git clone failed');
  });

  it('cmdPath 为空 → status=failed（不调 spawn）', async () => {
    const result = await runner.runLease({ cmdPath: '' } as any);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('cmd_path is empty');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('parse 抛错不中断整体（坏行跳过，后续行仍处理）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    mockAdapter.parse = (line: string) => {
      if (line === 'bad') throw new Error('parse boom');
      if (line === 'good') return [{ type: 'text', content: 'ok' }];
      return null;
    };
    const p = runner.runLease({} as any);
    fakeChild._emitLines(['bad', 'good']);  // bad 抛错跳过，good 正常处理
    fakeChild._emitExit(0);
    const result = await p;
    expect(result.status).toBe('completed');  // 不被坏行影响
    expect(mockClient.submitMessages).toHaveBeenCalledTimes(1);  // 仅 good
  });

  it('submit_messages 失败不中断（warn 后继续）', async () => {
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    mockClient.submitMessages.mockRejectedValueOnce(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = runner.runLease({} as any);
    fakeChild._emitLines(['line-a', 'line-b', 'line-c']);
    fakeChild._emitExit(0);
    const result = await p;
    expect(result.status).toBe('completed');  // 仍成功
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('event_forward_failed'));
    warnSpy.mockRestore();
  });
});
```

### 步骤 9：测 diff 收集（集成真实 WorkspaceManager）

```ts
describe('diff 收集', () => {
  it('执行后 collectDiff 拿到 patch + files_changed', async () => {
    // 用真实 WorkspaceManager + 本地 git fixture（参照 Python test_diff_collected_after_execution）
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    const ws = new WorkspaceManager(path.join(tmpDir, 'base'));
    const workDir = await ws.prepareWorkspace('test', `file://${tmpDir}`, 'main');
    fs.writeFileSync(path.join(workDir, 'hello.txt'), 'modified');

    // ... mock spawn + adapter 让子进程「成功执行」...
    const runner = new TaskRunner(mockClient, ws, mockCred);
    const result = await runner.runLease({ workspaceName: 'test', repoUrl: `file://${tmpDir}` } as any);

    expect(result.patch).toContain('diff --git');
    expect(result.patch).toContain('hello.txt');
    expect(result.filesChanged).toBe(1);
  });

  it('diff 收集失败不标记任务失败（non-fatal）', async () => {
    mockWorkspace.collectDiff.mockRejectedValueOnce(new Error('git diff boom'));
    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);
    const p = runner.runLease({} as any);
    fakeChild._emitExit(0);
    const result = await p;
    expect(result.status).toBe('completed');  // 仍成功
    expect(result.patch).toBe('');            // diff 空
  });
});
```

### 步骤 10：测 _eventToMessage（对齐 Python _event_to_message）

```ts
describe('_eventToMessage（对齐 Python L285-311）', () => {
  it('text 事件 → {event_type, content}', () => {
    const msg = (runner as any)._eventToMessage({ type: 'text', content: 'hi' });
    expect(msg).toEqual({ event_type: 'text', content: 'hi' });
  });
  it('tool_use 事件 → {event_type, tool_name, call_id}', () => {
    const msg = (runner as any)._eventToMessage({
      type: 'tool_use', metadata: { tool_name: 'bash', call_id: 'c1' },
    });
    expect(msg).toMatchObject({ event_type: 'tool_use', tool_name: 'bash', call_id: 'c1' });
  });
  it('空 content + 无 tool_name + 无 status → null（丢弃）', () => {
    const msg = (runner as any)._eventToMessage({ type: 'thinking', content: '' });
    expect(msg).toBeNull();
  });
});
```

### 步骤 11：测 _truncate（对齐 Python _truncate）

```ts
describe('_truncate（对齐 Python _MAX_OUTPUT/_MAX_ERROR）', () => {
  it('短文本不变', () => {
    expect(TaskRunner._truncate('hello', 10)).toBe('hello');
  });
  it('超长截断到 limit', () => {
    expect(TaskRunner._truncate('a'.repeat(100), 10)).toBe('a'.repeat(10));
  });
  it('空文本', () => {
    expect(TaskRunner._truncate('', 5)).toBe('');
  });
});
```

### 步骤 12：测任务追踪（对齐 Python test_tracking）

```ts
describe('任务追踪（对齐 Python track/untrack/cancel_task）', () => {
  it('track + untrack', () => {
    const ac = runner.track('t1');
    expect(runner.activeTaskCount).toBe(1);
    runner.untrack('t1');
    expect(runner.activeTaskCount).toBe(0);
  });
  it('untrack 不存在的 taskId 静默', () => {
    expect(() => runner.untrack('nope')).not.toThrow();
  });
});
```

### 步骤 13：跑验证

```bash
cd sillyhub-daemon
npx tsc --noEmit                              # AC-08: 零错误
npx vitest run tests/task-runner.test.ts      # AC-07: 全绿
```

### 步骤 14：对照 Python 用例人工核对

逐条对照 `test_task_runner.py`：
- `test_successful_task` → 步骤 3「编排链成功路径」✅
- `test_failed_task` → 步骤 8「子进程非零退出」✅
- `test_exception_during_execution` → 步骤 8「workspace 准备失败」✅
- `test_no_prompt_uses_default_provider` → 步骤 3（provider 默认 claude）✅
- `test_claude_md_written` → 步骤 3（断言 `.claude/CLAUDE.md` 存在）✅
- `test_no_claude_md_skips_write` → 步骤 3（空 claudeMd 守卫）✅
- `test_credentials_rendered_into_env` → 步骤 3（断言 env.API_KEY）✅
- `test_output_truncation` → 步骤 11（_truncate + MAX_OUTPUT）✅
- `test_submit_messages_called_on_event` → 步骤 3 + 步骤 4（流式 submit）✅
- `test_submit_messages_failure_does_not_crash` → 步骤 8（submit 失败不中断）✅
- `test_no_progress_when_no_events` → 步骤 3（空 stdout）✅
- `test_cancel_task` / `test_cancel_nonexistent_returns_false` → 步骤 6 ✅
- `test_diff_collected_after_execution` / `test_no_changes_gives_empty_diff` → 步骤 9 ✅
- `_truncate` 4 用例 → 步骤 11 ✅

---

## 验收标准

> 表格化逐项验收，禁止笼统表述。每项都给出可执行命令 + 明确通过条件。
> 验收顺序：AC-07（vitest）→ AC-08（tsc）→ AC-01~AC-06（行为）。

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 编排链 9 步完整执行 | 运行 task-19.md §TDD 步骤 3 的「编排链成功路径」测试用例：mock spawn + mock adapter + mock HubClient，断言 prepareWorkspace / buildEnv / startLease / spawn / parse / submitMessages / collectDiff 全部被调用且调用顺序正确 | 9 个 mock 都被调用 ≥1 次；调用顺序严格为 `prepareWorkspace → 写 CLAUDE.md → buildEnv → getBackend → startLease → spawn → parse（多次）→ submitMessages（多次）→ collectDiff`；result.success=true，result.status='completed'，result.exitCode=0，result.patch 非空 |
| **AC-02** | stdout 逐行流式 submit，不积压、不乱序（**R-04 核心**） | 运行 §TDD 步骤 4 的「R-04 stdout 背压」测试：mock spawn 输出 5 行（line-0~line-4），mock submitMessages 每次延迟 5ms，断言 submitCalls 顺序 | `submitCalls` 数组严格等于 `['line-0','line-1','line-2','line-3','line-4']`（顺序与 stdout 一致）；readline 逐行触发，不一次性缓冲；最后一行 submit 完成后才 completeLease |
| **AC-03** | stdin control_request 不 hang，应答正确写入 stdin（**R-03 核心**） | 运行 §TDD 步骤 5 的「R-03 stdin control」两个测试：(1) mock adapter.onControl 写 control_response，spy stdin.write；(2) spy stdin.end，断言 result 行后才 end | (1) adapter.onControl 被调用 ≥1 次；stdin.write 的调用记录中至少 1 次含 `control_response` 字串。(2) spawn 后立即检查 stdin.end **未被调用**（保持 stdin 开启避免子进程 hang）；stdout 输出 `{"type":"result"}` 行后才调用 stdin.end |
| **AC-04** | 子进程非零退出映射 status=failed + exitCode=1 + error 含退出码 + stderr | 运行 §TDD 步骤 8 的「子进程非零退出」测试：mock spawn stderr push 'permission denied'，emit('exit', 127) | result.success=false；result.status='failed'；result.exitCode=1（**TaskRunner 统一映射非零退出为 1**）；result.error 同时包含 `exit code 127` 和 `permission denied`；completeLease 被调用，result 传给 backend |
| **AC-05** | 取消优雅杀进程映射 status=cancelled + exitCode=-1 | 运行 §TDD 步骤 6 的「取消」测试：runner.cancel(taskId) 触发 AbortSignal，spy child.kill | cancel 返回 true；child.kill 被调用且 signal='SIGTERM'；result.success=false；result.status='cancelled'；result.exitCode=-1；result.error 含 'cancelled' 字串；**取消不存在的 taskId 返回 false**（步骤 6 第二个测试） |
| **AC-06** | diff 收集 + completeLease 调用链完整 | 运行 §TDD 步骤 9 的「diff 收集」测试：本地 git fixture（git init + commit + spawn 后修改 hello.txt）+ mock WorkspaceManager | result.patch 非空且包含 `diff --git` 和 `hello.txt`；result.filesChanged=1；result.insertions/deletions 与实际 diff 一致；completeLease 被调用，传入的 result 含 patch/filesChanged 字段；**diff 收集失败时 result.status 仍为 'completed'**（non-fatal，步骤 9 第二个测试） |
| **AC-07** | vitest 全绿（task-22 迁移的 `tests/task-runner.test.ts`） | `cd sillyhub-daemon && npx vitest run tests/task-runner.test.ts` | 退出码 0；所有测试用例通过（至少覆盖：编排链成功 / 失败退出 / 异常传播 / 无 prompt / CLAUDE.md 写入 / 凭证渲染 / 截断 / 流式 submit / submit 失败不崩 / 取消 / diff 收集 / _eventToMessage / _truncate / 任务追踪，共 ≥14 个 test case，对齐 Python `test_task_runner.py`） |
| **AC-08** | TypeScript 编译零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | 退出码 0，无任何 error/warning 输出；`src/task-runner.ts` 的所有类型（TaskRunner 类、RunLeaseInput、TaskResult、TrackEntry 等）都正确 export 且无循环依赖 |

**额外禁止项**（任一违反即视为不通过，须整改后重验）：

- 禁止 TaskRunner 直接 `JSON.parse` 任何具体协议格式（必须经 adapter.parse 间接解析）——对应 AC-01 中 parse 由 adapter 提供。
- 禁止 spawn 的 options 中遗漏 `env`（凭证注入失败会导致子进程鉴权挂起）——对应 AC-01 中 buildEnv 调用断言。
- 禁止 stdout 处理用 `child.stdout.on('data', ...)` 一次性缓冲（会积压 + 跨行切割错误）——必须用 `readline.createInterface`，对应 AC-02。
- 禁止 spawn 后立即 `child.stdin.end()`（control_request 来时 stdin 已关闭会导致子进程 SIGPIPE/EPIPE 挂起）——对应 AC-03。
- 禁止在 parse 抛异常时整体 lease 失败（坏行应跳过，warn 后继续）——对应 §边界处理 B-04 + TDD 步骤 8。
- 禁止 result 行之前提前 completeLease（必须等 child 'exit' 事件 + diff 收集完成才提交）——对应 AC-06。

---

## 蓝图完整性自检

| 检查项 | 状态 |
|---|---|
| frontmatter（author/id/priority/estimated_hours/depends_on/blocks/allowed_paths）完整 | ✅ |
| 10 个章节全部产出 | ✅（修改文件 / 实现要求 / 接口定义 / 边界处理 / 非目标 / 参考 / TDD 步骤 / 验收标准） |
| 接口定义可搬砖（TaskRunner 类 + runLease + 9 步编排链伪代码 + spawn 配置 + readline 流处理 + control 处理 + cancel + 状态机） | ✅ |
| 边界处理 ≥5 条且覆盖 R-03（B-04/B-09/B-10/B-11）+ R-04（B-01/B-02/B-03/B-04/B-05/B-06） | ✅（共 15 条） |
| 非目标 ≥4 条 | ✅（共 11 条） |
| 参考含 Python 源行号 + design 章节 + FR 编号 + 模块文档 + 任务关系 | ✅ |
| TDD 步骤含 mock spawn + mock adapter + mock HubClient 完整骨架 | ✅（14 个步骤，覆盖编排链 9 步 + R-03 + R-04 + 取消 + 超时 + 错误传播 + diff + _eventToMessage + _truncate + 任务追踪） |
| 验收标准表格化 AC-01~AC-08，每项含可执行命令 + 明确通过条件 | ✅ |
| 禁止笼统（如「测试通过」「代码正确」）——每项都给出具体断言 | ✅ |
| 依据文档路径全部给出（CLAUDE.md 硬性规则 5：修改代码前说明依据的文档路径） | ✅（参考章节） |

**蓝图结束。下一步：execute 阶段照本蓝图实现 `sillyhub-daemon/src/task-runner.ts`，跑完 AC-07/AC-08 后对照 AC-01~AC-06 逐项验收。**














