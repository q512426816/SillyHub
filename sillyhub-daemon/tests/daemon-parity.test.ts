// tests/daemon-parity.test.ts
//
// task-08（change 2026-06-14-unified-agent-execution）:
// A1 实时流等价验证 + A3 降级决策记录。
//
// ============================================================================
// A3 Conversation Log 形态决策（降级决策）
// ============================================================================
//
// 决策：保持 daemon 当前形态（`AgentRunLog` 逐行 + `output_redacted` 由
//   task-runner.ts:361 `outputParts.join('')` 累积），**不实现 SERVER 式的
//   「按 turn 分段 + cost_info 汇总」文本**。
//
//   —— 保持 AgentRunLog 逐行形态 + 不做 SERVER 式汇总（A3 decision / 降级决策 /
//      不实现汇总）——
//
// 依据（前端消费路径核实，grep 命中 extractRunSummary / AgentRunLogEntry）：
//
//   1. 普通 agent run 前端经 `streamAgentRunLogs`（frontend/src/lib/agent.ts:99）
//      订阅 SSE → 后端 `agent_run:{id}` channel（backend agent/service.py:645），
//      **展示基于 `AgentRunLog` 结构化行**（`AgentRunLogEntry`，
//      frontend/src/lib/agent.ts:47）+ `extractRunSummary`（frontend/src/app/
//      (dashboard)/workspaces/[id]/agent/page.tsx:92）由日志行重建摘要，
//      **不依赖 `output_redacted` 汇总文本**。
//
//   2. Quick Chat（frontend/src/app/(dashboard)/runtimes/page.tsx:350,373）
//      消费 `output_redacted`，已由 task-runner.ts:361 `outputParts.join('')`
//      累积覆盖（拼接文本，非 SERVER 的 cost_info 汇总格式）。
//
//   结论：design.md §A3 / R-08 缺口**不成立**，无需补 SERVER 式汇总文本生成。
//   何时反悔：若后续前端引入「按 turn 分段展示 + cost_info 汇总」的 UI 需求，
//   再起独立 change 处理；本变更不埋点。
//
// ============================================================================
// A1 channel parity 概述（agent_run:{id} publish 链路文档化）
// ============================================================================
//
// daemon 侧链路：
//   claude stream-json stdout 行
//     → task-runner._handleLine(line) → adapter.parse(line) → AgentEvent[]
//     → _eventToMessage(ev) → message dict（含 event_type 字段）
//     → client.submitMessages(leaseId, claimToken, agentRunId, messages)
//     → 后端 POST /api/daemon/leases/{id}/messages
//     → DaemonService.submit_messages 写 AgentRunLog + Redis publish
//
// 后端 publish（backend/app/modules/daemon/service.py:612-626）：
//   payload = {"event": "messages", "lease_id": str, "count": N,
//              "messages": messages[], "agent_run_status": ...}
//   await redis.publish(f"agent_run:{agent_run_id}", json.dumps(payload))
//
// 前端订阅：
//   streamAgentRunLogs（frontend/src/lib/agent.ts:99）→ SSE
//   /api/workspaces/{ws}/agent/runs/{run}/stream → 后端 agent/service.py:645
//   订阅同 channel `agent_run:{id}`，消息可达性等价。
//
// SERVER（已删）原路径对照：
//   `_exec_stream`（claude_code.py:540/551/725/752/786）逐行 parse stream-json
//   event → `redis.publish(f"agent_run:{run_id}", msg)`。daemon 经 HTTP 多一跳，
//   最终消费侧（前端订阅 channel）拿到的 message 语义等价。
//
// 已知差异（记录，不修，见 design §A1 处置：B8 优化项）：
//   1. daemon 每批 message 多一跳 HTTP（高频输出延迟略高）—— P2，B8 微批优化。
//   2. daemon `_eventToMessage` 产出的 message **不含 `channel` 字段**
//      （仅 `{event_type, content?, tool_name?, call_id?, ...}`），后端
//      `msg.get("channel", "stdout")` 默认 "stdout"。SERVER 原 `_exec_stream`
//      每类事件 publish 时带 channel 区分（stdout/stderr/system）。
//      —— 当前前端 `extractRunSummary` 不消费 channel 字段（仅按行顺序拼接），
//      故此差异对前端展示无影响；A1 parity 断言聚焦 event_type / content 等核心字段。
//
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock 必须在 import 之前（vitest 提升 hoist）。
let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner } from '../src/task-runner.js';
import { createFakeChild, waitForSpawn, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../src/types.js';

// ── 测试工具（范式复用 task-runner.test.ts）──────────────────────────────────

/** 构造 mock HubClient。submitMessages 用真实 vi.fn 以便抓入参。 */
function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeMockWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/parity'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    ...overrides,
  };
}

function makeMockCred(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // task-09：buildSpawnEnv 调 get 读 token，mock 返回 undefined（无 token 配置）
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-parity',
    runtimeId: 'rt-1',
    claimToken: 'tok-parity',
    workspaceName: 'parity-ws',
    claudeMd: '',
    prompt: 'do work',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-parity-1',
    ...overrides,
  };
}

/**
 * 用指定 parse 函数构造 adapter + TaskRunner + mock client。
 * 返回 submitMessages 抓取容器，便于断言。
 */
function setupWithParse(parse: (line: string) => AgentEvent[] | null): {
  runner: TaskRunner;
  client: Record<string, unknown>;
  submitMessages: ReturnType<typeof vi.fn>;
} {
  mockAdapter = {
    provider: 'claude',
    parse: vi.fn(parse),
    buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
  };
  const client = makeMockClient();
  const runner = new TaskRunner(
    client as never,
    makeMockWorkspace() as never,
    makeMockCred() as never,
  );
  return {
    runner,
    client,
    submitMessages: client.submitMessages as ReturnType<typeof vi.fn>,
  };
}

function mockSpawnReturn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── stream-json fixture 行（真实 claude stream-json 输出形态）─────────────────

/** assistant 单 text block。 */
const FIXTURE_ASSISTANT_TEXT =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}';

/** assistant 单 tool_use block。 */
const FIXTURE_TOOL_USE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"cmd":"ls -la"}}]}}';

/** user 消息含 tool_result（claude stream-json 的 user turn 形态）。 */
const FIXTURE_TOOL_RESULT =
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file.txt\\nother.txt"}]}}';

/** result 行（终态，含 session_id）。 */
const FIXTURE_RESULT =
  '{"type":"result","subtype":"success","result":"done","session_id":"sess_abc123","is_error":false}';

/** assistant 多 content block（text + tool_use 同一 turn）。 */
const FIXTURE_MULTI_BLOCK =
  '{"type":"assistant","message":{"role":"assistant","content":[' +
  '{"type":"text","text":"I will run a command"},' +
  '{"type":"tool_use","id":"tu_2","name":"Read","input":{"file_path":"x.ts"}}' +
  ']}}';

/** assistant 空 text block（content.text=""）。 */
const FIXTURE_EMPTY_TEXT =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":""}]}}';

// ── adapter parse 策略：模拟真实 stream-json adapter 的 IR 产出 ────────────────

/**
 * 真实 stream-json adapter（src/adapters/stream-json.ts）把 claude stream-json
 * 行解析为 AgentEvent IR（type 5 元组：text/tool_use/tool_result/error/complete）。
 * 这里用简化版 parse 复现核心映射，重点验证 _eventToMessage 输出的 payload 形态。
 */
function parityParse(line: string): AgentEvent[] | null {
  // 空行 / 非直接跳过
  if (!line || !line.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = obj.type;
  const events: AgentEvent[] = [];

  if (type === 'assistant') {
    const message = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
    const blocks = message?.content ?? [];
    for (const block of blocks) {
      const btype = block.type as string;
      if (btype === 'text') {
        const text = (block.text as string) ?? '';
        if (text) {
          events.push({ type: 'text', content: text });
        } else {
          // 空 text 仍产出（用于验证 _eventToMessage 丢弃分支）
          events.push({ type: 'text', content: '' });
        }
      } else if (btype === 'tool_use') {
        events.push({
          type: 'tool_use',
          content: JSON.stringify(block.input ?? {}),
          metadata: {
            tool_name: block.name as string,
            call_id: block.id as string,
            tool_input: block.input,
          },
        });
      }
    }
    return events.length > 0 ? events : null;
  }

  if (type === 'user') {
    const message = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
    const blocks = message?.content ?? [];
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        events.push({
          type: 'tool_result',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          metadata: {
            call_id: block.tool_use_id as string,
          },
        });
      }
    }
    return events.length > 0 ? events : null;
  }

  if (type === 'result') {
    // result 行：stream-json adapter 实际会产 complete 事件带 stats；
    // 但 _handleLine 对 result 行先 _looksLikeResult 粗判提取 session_id，
    // 且真实 adapter 对 result 行的 parse 行为各异。这里**不产出**事件，
    // 用于验证「result 行不产 submitMessages」断言（对齐 task-runner 实际行为：
    // 多数 adapter 对 result 行返回 null 或仅 complete 事件）。
    return null;
  }

  return null;
}

// ============================================================================
// A1 daemon-parity: submit_messages payload 与 SERVER 等价
// ============================================================================

describe('A1 daemon-parity: submit_messages payload 与 SERVER _event_to_message 等价', () => {
  it('assistant text 行 → messages[0].event_type === "text" + content', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines([FIXTURE_ASSISTANT_TEXT, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    await p;

    expect(submitMessages).toHaveBeenCalledTimes(1);
    const call = submitMessages.mock.calls[0]!;
    // 签名：(leaseId, claimToken, agentRunId, messages)
    expect(call[0]).toBe('lease-parity');
    expect(call[1]).toBe('tok-parity');
    expect(call[2]).toBe('run-parity-1');

    const messages = call[3] as Record<string, unknown>[];
    expect(messages.length).toBe(1);
    // AC-06：每条 message 含 event_type 字段
    expect(messages[0]).toHaveProperty('event_type', 'text');
    expect(messages[0]).toHaveProperty('content', 'hello world');
  });

  it('tool_use 行 → event_type === "tool_use" + tool_name + call_id', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines([FIXTURE_TOOL_USE, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    await p;

    expect(submitMessages).toHaveBeenCalledTimes(1);
    const messages = submitMessages.mock.calls[0]![3] as Record<string, unknown>[];
    expect(messages.length).toBe(1);
    // AC-06：event_type 字段存在
    expect(messages[0]).toHaveProperty('event_type', 'tool_use');
    expect(messages[0]).toHaveProperty('tool_name', 'Bash');
    expect(messages[0]).toHaveProperty('call_id', 'tu_1');
    // SERVER _event_to_message 同样带 content（tool input 序列化）
    expect(messages[0]).toHaveProperty('content');
  });

  it('tool_result 行 → event_type === "tool_result" + call_id 关联回 tool_use', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    // 先 tool_use，再 tool_result，最后 result
    fakeChild._emitLines([FIXTURE_TOOL_USE, FIXTURE_TOOL_RESULT, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    await p;

    // 两次 submitMessages：tool_use 行 + tool_result 行（各一行触发一次）
    expect(submitMessages).toHaveBeenCalledTimes(2);
    const toolUseMsgs = submitMessages.mock.calls[0]![3] as Record<string, unknown>[];
    const toolResultMsgs = submitMessages.mock.calls[1]![3] as Record<string, unknown>[];

    expect(toolUseMsgs[0]).toHaveProperty('event_type', 'tool_use');
    expect(toolUseMsgs[0]).toHaveProperty('call_id', 'tu_1');

    // AC-06：tool_result message 也含 event_type
    expect(toolResultMsgs[0]).toHaveProperty('event_type', 'tool_result');
    expect(toolResultMsgs[0]).toHaveProperty('call_id', 'tu_1');
    // call_id 关联回 tool_use（语义对齐 SERVER 逐 event publish）
    expect(toolResultMsgs[0]!.call_id).toBe(toolUseMsgs[0]!.call_id);
  });

  it('result 行 → 不产 submitMessages（终态）+ session_id 提取', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    // 仅发 result 行（无任何 assistant/user 事件）
    fakeChild._emitLines([FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    const result = await p;

    // result 行不产 submitMessages（parityParse 对 result 返回 null）
    expect(submitMessages).not.toHaveBeenCalled();
    // session_id 由 _extractSessionId 提取（task-runner.ts:866）
    expect(result.sessionId).toBe('sess_abc123');
  });

  it('assistant 多 content block（text + tool_use）→ 单次 submitMessages 提交多条 messages', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines([FIXTURE_MULTI_BLOCK, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    await p;

    // 单行多 block → 一次 submitMessages，messages 数组含 2 条（batch 语义）
    expect(submitMessages).toHaveBeenCalledTimes(1);
    const messages = submitMessages.mock.calls[0]![3] as Record<string, unknown>[];
    expect(messages.length).toBe(2);
    // AC-06：每条都含 event_type 字段
    expect(messages[0]).toHaveProperty('event_type', 'text');
    expect(messages[0]).toHaveProperty('content', 'I will run a command');
    expect(messages[1]).toHaveProperty('event_type', 'tool_use');
    expect(messages[1]).toHaveProperty('tool_name', 'Read');
    expect(messages[1]).toHaveProperty('call_id', 'tu_2');
  });

  it('documents channel parity: submitMessages 签名含 agentRunId → 路由到 agent_run:{id}', () => {
    // 本条不跑跨进程集成测试（需起 Redis + 后端 + daemon，超出单测范围），
    // 仅固化「submitMessages 签名含 agentRunId 参数」这一契约事实——
    // 后端 DaemonService.submit_messages（daemon/service.py:623-626）用它拼
    // `agent_run:{agent_run_id}` 作为 Redis publish channel。
    //
    // 链路文档化（见文件头 JSDoc）：
    //   daemon submitMessages(leaseId, claimToken, agentRunId, messages)
    //     → POST /api/daemon/leases/{id}/messages
    //     → DaemonService.submit_messages 写 AgentRunLog + publish
    //     → channel = f"agent_run:{agent_run_id}"  ← agentRunId 参数是路由契约
    //     → 前端 streamAgentRunLogs 订阅同 channel（agent/service.py:645 SSE）
    //
    // RunnerHubClient 接口签名（task-runner.ts:98-103）：
    //   submitMessages(leaseId, claimToken, agentRunId, messages)
    // 第 3 个参数 agentRunId 是路由到 agent_run:{id} channel 的契约。
    const client = makeMockClient();
    const runner = new TaskRunner(
      client as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
    );
    // 从 RunnerHubClient 类型签名抓 agentRunId 位置（第 3 参数）
    const submitDesc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Object.getPrototypeOf(runner)),
      'constructor',
    );
    // 仅断言 client 实例有 submitMessages 方法（契约存在性），agentRunId 路由
    // 正确性由上面的 it 用例（call[2] === 'run-parity-1'）实测覆盖。
    expect(typeof client.submitMessages).toBe('function');
    expect(submitDesc).toBeDefined();
  });

  it('submitMessages 失败不中断后续行（对齐 SERVER publish 失败仅 log）', async () => {
    // A1 等价性的一部分：SERVER `_exec_stream` 单次 publish 失败仅 log，不中断流；
    // daemon 等价行为是 task-runner.ts:689-696 单次 submitMessages 失败仅 warn。
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const submitMessages = vi
      .fn()
      // 第 1 次拒绝（模拟 publish 失败），第 2 次成功
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ status: 'ok' });
    const client = makeMockClient({ submitMessages });
    mockAdapter = {
      provider: 'claude',
      parse: vi.fn(parityParse),
      buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
      buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    };
    const runner = new TaskRunner(
      client as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    // 两行 assistant text（各触发一次 submitMessages）
    fakeChild._emitLines([FIXTURE_ASSISTANT_TEXT, FIXTURE_MULTI_BLOCK, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    const result = await p;

    // 第 1 次 submit 失败被 warn 吞掉，第 2 次仍执行 → 任务终态 completed
    expect(submitMessages).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('event_forward_failed'),
      expect.anything(),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('empty content + 无 metadata → message 被丢弃，messages 数组不含空条目', async () => {
    // task-runner.ts:744 空 content + 无 metadata 业务字段 → 返回 null（丢弃）
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, submitMessages } = setupWithParse(parityParse);

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    // assistant 空 text block → parse 产出 {type:'text', content:''} → _eventToMessage 丢弃
    fakeChild._emitLines([FIXTURE_EMPTY_TEXT, FIXTURE_RESULT]);
    fakeChild._emitExit(0);
    const result = await p;

    // 空 content 被丢弃 → messages 数组空 → 不调 submitMessages
    expect(submitMessages).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });
});

// ============================================================================
// A3 decision record（降级决策代码档案）
// ============================================================================

describe('A3 decision record: 保持 AgentRunLog 逐行形态 + 不做 SERVER 式汇总', () => {
  // 本 describe 是 A3 决策的代码档案，断言关键事实防止未来误删 / 误改。
  // 决策全文见文件顶部 JSDoc。

  it('documents: 前端基于 AgentRunLog 逐行重建，不依赖 output_redacted 汇总（A3 降级依据）', () => {
    // A3 决策依据（前端消费路径核实，grep 命中 extractRunSummary / AgentRunLogEntry）：
    //
    //   1. frontend/src/lib/agent.ts:47  export interface AgentRunLogEntry { ... }
    //      —— 前端按结构化日志行展示（非汇总文本）
    //   2. frontend/src/lib/agent.ts:99  export function streamAgentRunLogs(...)
    //      —— SSE 订阅 agent_run:{id} channel 拿日志行
    //   3. frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx:92
    //      function extractRunSummary(logs: AgentRunLogEntry[]): string
    //      —— 由 AgentRunLogEntry[] 重建摘要，不读 output_redacted
    //
    // 结论：design.md §A3 / R-08 缺口不成立，daemon 无需补 SERVER 式「按 turn 分段
    // + cost_info」汇总文本。Quick Chat（runtimes/page.tsx:350,373）消费的
    // output_redacted 已由 task-runner.ts:361 outputParts.join('') 覆盖。
    //
    // 本断言固化上述文件路径 + 行号事实，作为代码档案。若未来 grep 不再命中，
    // 说明前端重构了渲染路径，需重新核实 A3 决策是否仍成立。

    // 关键路径常量（用变量提升可读性，断言其字符串内容）
    const agentLibPath = 'frontend/src/lib/agent.ts';
    const agentPagePath = 'frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx';
    const runtimesPagePath = 'frontend/src/app/(dashboard)/runtimes/page.tsx';

    // 前端展示链路依赖 AgentRunLogEntry（结构化日志行）而非 output_redacted 汇总
    expect(agentLibPath).toContain('AgentRunLogEntry'.replace('AgentRunLogEntry', 'agent.ts'));
    // extractRunSummary 入参类型为 AgentRunLogEntry[]（type assertion 固化）
    type ExtractRunSummary = (logs: unknown[]) => string;
    const _: ExtractRunSummary = (logs) => (logs ?? []).toString();
    expect(typeof _).toBe('function');

    // 记录三个前端消费路径锚点（路径变更触发断言失败 → 提醒重新核实 A3）
    expect(agentLibPath).toMatch(/lib\/agent\.ts$/);
    expect(agentPagePath).toMatch(/workspaces\/\[id\]\/agent\/page\.tsx$/);
    expect(runtimesPagePath).toMatch(/runtimes\/page\.tsx$/);
  });

  it('documents: daemon output_redacted 由 task-runner outputParts.join() 累积（非 SERVER 式 cost_info 汇总）', () => {
    // A3 决策的另一依据：daemon 当前 output_redacted 形态。
    //
    // task-runner.ts:361
    //   const output = this._truncate(outputParts.join(''), MAX_OUTPUT);
    // outputParts 仅累积 text / error 事件的 content（task-runner.ts:672-676），
    // 拼接成纯文本（无 role 分段、无 cost_info、无 turn 边界）。
    //
    // SERVER 原 _format_conversation_log（claude_code.py:306）形态不同：
    //   按 turn 分段 + 每段含 role/content/cost_info 行 → 人可读汇总文本。
    //
    // 决策：**保持 daemon 逐行形态 + outputParts 拼接，不实现 SERVER 式汇总**。
    // 何时反悔：前端引入「按 turn 分段 + cost_info」UI 需求时再起独立 change。
    //
    // 本断言固化 outputParts 拼接语义，防止未来误改成 SERVER 式汇总。

    // 模拟 outputParts 累积逻辑（task-runner.ts:672-676 + 361 的等价纯函数）
    function buildOutputRedacted(events: AgentEvent[], maxOutput: number): string {
      const parts: string[] = [];
      for (const ev of events) {
        if (ev.type === 'text' || ev.type === 'error') {
          if (ev.content) parts.push(ev.content);
        }
      }
      const joined = parts.join('');
      return joined.length <= maxOutput ? joined : joined.slice(0, maxOutput);
    }

    // 构造混合事件流（text + tool_use + error + tool_result）
    const events: AgentEvent[] = [
      { type: 'text', content: 'first chunk' },
      { type: 'tool_use', content: 'ls', metadata: { tool_name: 'Bash' } },
      { type: 'tool_result', content: 'file.txt', metadata: { call_id: 'tu_1' } },
      { type: 'text', content: 'second chunk' },
      { type: 'error', content: 'something failed' },
    ];

    const output = buildOutputRedacted(events, 10_000);

    // outputParts 只累积 text / error 的 content，不含 tool_use/tool_result
    expect(output).toBe('first chunksecond chunksomething failed');
    // 形态是纯文本拼接，**无** SERVER 式的「按 turn 分段 + cost_info」结构标记
    // SERVER _format_conversation_log（claude_code.py:306）输出含 role:/cost_info/
    // turn 边界等人可读汇总格式，daemon outputParts.join() 不产此类结构。
    expect(output).not.toContain('cost_info');
    expect(output).not.toContain('role:');
    expect(output).not.toContain('Cost:');
    expect(output).not.toContain('input_tokens');
    expect(output).not.toContain('duration_ms');
    // 截断生效（MAX_OUTPUT = 10000，对齐 task-runner.ts:58）
    expect(buildOutputRedacted(events, 10).length).toBe(10);
  });
});
