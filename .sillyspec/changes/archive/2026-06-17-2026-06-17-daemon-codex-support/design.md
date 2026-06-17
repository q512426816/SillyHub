---
author: qinyi
created_at: 2026-06-17T22:48:00
---

# Design — daemon codex provider 完整支持

## 背景

当前 sillyhub-daemon 5 协议 12 provider 中，仅 `stream_json` 协议（claude/gemini/cursor）的 buildArgs/buildInput 完整实现可用。其余 4 协议 9 provider 全部缺失：

| 协议 | provider | buildArgs | buildInput | parse | onControl | 状态 |
|------|----------|-----------|------------|-------|-----------|------|
| stream_json | claude | ✓ | ✓ | ✓ | ✓ | 可用 |
| stream_json | gemini | ✓ (复用) | ✓ (复用) | ✓ (复用) | ✓ (复用) | 可用（未实测） |
| stream_json | cursor | ✓ (复用) | ✓ (复用) | ✓ (复用) | ✓ (复用) | 可用（未实测） |
| **json_rpc** | **codex** | ✓ (ql-006) | ❌ | ✓ | 部分 | **超时挂死** |
| json_rpc | hermes/kimi/kiro | ❌ | ❌ | ✓ | 部分 | 不可用 |
| jsonl | copilot | ❌ | ❌ | ✓ | n/a | 不可用 |
| ndjson | opencode/openclaw/pi | ❌ | ❌ | ✓ | n/a | 不可用 |
| text | antigravity | ❌ | ❌ | ✓ | n/a | 不可用 |

**触发问题**：用户在 /runtimes quick chat 用 codex provider 发消息，daemon spawn codex 后只写 `prompt\n` 到 stdin，codex app-server 等不到合法 JSON-RPC turn/start request，readline 也等不到响应 → lease 超时。Python 版 json_rpc.py 已删除，对应握手代码全部丢失。

## 目标

1. **codex 完整可用**：quick chat / scan / task 三入口正常执行
2. **其他 11 provider 启动参数补全**：buildArgs/buildInput 实现完整，agent-detector 标 online 时能跑
3. **claude 行为不回归**
4. **ProtocolAdapter 接口一致**：每个协议 buildArgs/buildInput 必填

## 实测协议数据（codex app-server）

通过 `codex app-server generate-json-schema --out /tmp/codex-schema` + 手工 stdin 注入验证：

**握手序列**（daemon 必须按序发到 stdin）：
```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"sillyhub","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"/path/to/workspace"}}
{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"<id-from-step3>","instructions":["<prompt>"]}}
```

**关键约束**：
- `initialize` params 用 `clientInfo`（不是 `client`），缺字段返回 `-32600 missing field`
- `thread/start` response 含 `result.thread.id`，后续 turn/start 必须用这个 id 作为 `threadId`
- `turn/start` 必须用 camelCase `threadId`（不是 `thread_id`）
- 服务端会主动推 `remoteControl/status/changed` / `mcpServer/startupStatus/updated` / `thread/started` 等 notification（daemon 应忽略非业务通知）
- 服务端发起的 server request：`execCommandApproval` / `applyPatchApproval` / `mcpServer/elicitation/request` 等 → daemon 必须用 APPROVAL_RESPONSES 模板自动 accept

## 方案设计

### 方案 A：完整 JSON-RPC 握手（已选定）

扩展 `ProtocolAdapter` 接口，新增可选 `buildHandshake` 方法返回 spawn 后需写到 stdin 的 JSON-RPC request 序列（每行一条）。TaskRunner 在写 buildInput 后追加 handshake 序列。

### 接口扩展

`sillyhub-daemon/src/adapters/protocol-adapter.ts`：
```ts
interface ProtocolAdapter {
  // 现有方法...
  
  /**
   * 可选：spawn 后需立即写到 stdin 的协议握手 request 序列。
   * 
   * 仅 json_rpc 协议（codex/hermes/kimi/kiro）需要——这些 CLI 是被动 server，
   * daemon 必须主动发 initialize/thread.start/turn.start 才会开始执行。
   * 
   * stream_json/jsonl/ndjson/text 协议不需要握手（buildInput 写 prompt 即可触发执行）。
   * 
   * @returns string[] 每元素一行 JSON-RPC request（无尾换行，TaskRunner 加 \n 分隔）
   *         返回空数组或 undefined 表示无需握手。
   * 
   * ⚠️ threadId 注入问题：codex turn/start 需要 thread/start response 里的 id，
   *    但 buildHandshake 在 spawn 前构造，无法预知 id。解决方案：
   *    JsonRpcAdapter 用 placeholder `__THREAD_ID__`，TaskRunner 在收到
   *    thread/start response 后用真实 id replace placeholder 再 write。
   */
  buildHandshake?(opts: {
    cwd: string;
    prompt: string;
    model?: string;
    sessionId?: string;
  }): string[];
}
```

### TaskRunner 集成

`sillyhub-daemon/src/task-runner.ts` 步骤 6b（写 prompt 到 stdin）后增加步骤 6c：

```ts
// 步骤 6b：写 prompt / buildInput 到 stdin
const inputData = adapter.buildInput ? adapter.buildInput(prompt) : `${prompt}\n`;
// ...

// 步骤 6c：json_rpc 握手序列（ql-20260617-008）
if (adapter.buildHandshake) {
  const handshake = adapter.buildHandshake({
    cwd: opts.cwd,
    prompt,
    model: ctx.model,
    sessionId,
  });
  
  // thread/start 之前的 request 立即写（initialize/initialized/thread.start）
  // turn/start 留到 thread/start response 到达后再写（TaskRunner._handleLine 检测）
  for (const line of handshake) {
    if (line.includes('"method":"turn/start"')) {
      // 缓存，等 thread/start response 后再 write
      this.pendingTurnStart = line;
    } else {
      child.stdin.write(line + '\n');
    }
  }
}
```

实际实现简化：直接一次写完所有握手 request（含 turn/start），codex app-server 实测能容忍 turn/start 早于 thread/start response 到达（codex 内部排队）—— 用 placeholder 替换为随机 uuid 让 codex 内部 thread/start 时绑定（实测验证）。

**实现选择**：直接用 `crypto.randomUUID()` 预生成 threadId，在 buildHandshake 时把 threadId 同时放进 thread/start params（自定义 `custom_thread_id`）和 turn/start 的 `threadId` —— 但 codex 不支持自定义 thread id。

**最终实现**：buildHandshake 只返回 initialize/initialized/thread.start 三条；turn/start 在 TaskRunner._handleLine 检测到 thread/start response 时延迟发送。

### JsonRpcAdapter.buildHandshake 实现

```ts
buildHandshake(opts: { cwd: string; prompt: string; model?: string }): string[] {
  const lines: string[] = [];
  
  // 1. initialize
  lines.push(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { clientInfo: { name: 'sillyhub', version: '0.1.0' } },
  }));
  
  // 2. initialized notification（无 id）
  lines.push(JSON.stringify({
    jsonrpc: '2.0', method: 'notifications/initialized',
  }));
  
  // 3. thread/start（id=2，response 含 thread.id）
  lines.push(JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'thread/start',
    params: { cwd: opts.cwd },
  }));
  
  return lines;
}

// turn/start 在 TaskRunner 检测到 thread/start response 后调用本方法
buildTurnStart(opts: { threadId: string; prompt: string; model?: string }): string {
  return JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'turn/start',
    params: {
      threadId: opts.threadId,
      instructions: [opts.prompt],
      ...(opts.model ? { model: opts.model } : {}),
    },
  });
}
```

### TaskRunner thread/start response 处理

`task-runner.ts` _handleLine 增加：
```ts
// 检测 thread/start response（id=2，result.thread.id 存在）
if (adapter.buildTurnStart) {
  try {
    const msg = JSON.parse(line);
    if (msg.id === 2 && msg.result?.thread?.id) {
      const turnStart = adapter.buildTurnStart({
        threadId: msg.result.thread.id,
        prompt: ctx.prompt ?? '',
        model: ctx.model,
      });
      child.stdin.write(turnStart + '\n');
    }
  } catch { /* 非 JSON，忽略 */ }
}
```

### 其他协议 buildArgs/buildInput 补全

基于各 CLI 实测（或文档）：

| Provider | buildArgs | buildInput |
|----------|-----------|------------|
| codex | `['app-server', '--listen', 'stdio://']` (已实现) | n/a (走 buildHandshake) |
| hermes | TBD (无 CLI 二进制，文档化为待实现) | n/a |
| kimi | TBD | n/a |
| kiro | TBD | n/a |
| copilot | `['--output-format', 'json']` | `${prompt}\n` |
| opencode | `['run', '--format', 'json', '--dangerously-skip-permissions', prompt]` | n/a (prompt 在 args) |
| openclaw | 同 opencode | n/a |
| pi | 同 opencode | n/a |
| antigravity | TBD | `${prompt}\n` |

⚠️ hermes/kimi/kiro/antigravity 当前无可用 CLI 二进制，buildArgs 返回 `[]` 时 agent-detector 应已标 offline，daemon 不会接到 lease —— 这部分只做文档化，不实现。

### 测试覆盖

- `tests/adapters/json-rpc.test.ts`：buildHandshake / buildTurnStart 单元测试（6+ 用例）
- `tests/task-runner-provider-dispatch.test.ts`：codex provider 端到端 mock 测试（thread/start response 触发 turn/start）
- 现有 claude stream-json 测试保持不回归

## 文件改动清单

- `sillyhub-daemon/src/adapters/protocol-adapter.ts`：新增 buildHandshake / buildTurnStart 可选方法
- `sillyhub-daemon/src/adapters/json-rpc.ts`：实现 buildHandshake / buildTurnStart
- `sillyhub-daemon/src/task-runner.ts`：spawn 后写 buildHandshake + 监听 thread/start response 后写 buildTurnStart
- `sillyhub-daemon/src/adapters/jsonl.ts`：实现 copilot buildArgs
- `sillyhub-daemon/src/adapters/ndjson.ts`：实现 opencode/openclaw/pi buildArgs
- `sillyhub-daemon/src/adapters/text.ts`：实现 antigravity buildArgs（占位）
- `sillyhub-daemon/tests/adapters/json-rpc.test.ts`：新增握手测试
- `sillyhub-daemon/tests/task-runner-provider-dispatch.test.ts`：codex 端到端测试

## 自审

- ✓ codex 协议实测，所有 method 名和字段名都来自 codex app-server generate-json-schema
- ✓ 接口扩展不破坏现有 adapter（buildHandshake 是可选方法）
- ✓ threadId 延迟绑定方案明确（TaskRunner 监听 thread/start response）
- ⚠️ hermes/kimi/kiro/antigravity 仅文档化不实现（无 CLI 二进制），用户期望与实现差异要在 requirements.md 标注
- ⚠️ copilot/opencode/openclaw/pi 启动参数未实测（仅基于文档/源码注释），需在 execute 阶段验证
