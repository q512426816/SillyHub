// tests/interactive/claude-events.test.ts
// 2026-09-03-agent-provider-abstraction task-03：ClaudeEventNormalizer golden 用例。
//
// 覆盖（task-03 验收四条）：
//   1. 完整消息展开——full-message-mixed fixture 逐喂 normalizeMessage，产出事件
//      序列与预期逐字段对照（预期值 = backend _extract_sdk_messages 对同输入行为
//      的手写快照：类型/内容/tool 配对/usage/depth/edit_patch，
//      run_sync/service.py:3446-3716）；
//   2. partial 流式——partial-stream-override fixture + 假时钟控制 500ms 节流，
//      断言 flush 事件 is_partial + segment_id + 实时 usage（D-003@v1）；完整消息
//      到达后 override 事件形态（D-004@v1：override:true + segment_id + 完整内容）；
//   3. status 会话信号——session-init-status fixture：session_started 映射、
//      plan/task 族映射、无业务价值帧静默丢弃；
//   4. depth 状态机跨帧——Task 子代理 depth+1、嵌套 depth+2、onTurnEnd 后回落。
//
// 全部产出事件过 safeParseAgentEvent（zod 一致性，agent-event-schema.ts）。
//
// fixture 来源（真实采样 + SDK 信封构造 + 脱敏）见
// tests/fixtures/claude-sdk-messages/README.md。

import { describe, it, expect, afterEach, vi } from 'vitest';

import { ClaudeEventNormalizer } from '../../src/interactive/claude-events.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import type { AgentEvent } from '../../src/types.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadFixture } from '../helpers';

/** 加载 fixture 消息序列（每文件一个 JSON 数组）。 */
function loadMessages(name: string): SDKMessage[] {
  return JSON.parse(
    loadFixture(`claude-sdk-messages/${name}.json`),
  ) as SDKMessage[];
}

/** 收集 onPartialFlush 的归一化器构造辅助。 */
function makeNormalizer(
  partials: AgentEvent[],
  now?: () => number,
): ClaudeEventNormalizer {
  return new ClaudeEventNormalizer({
    onPartialFlush: (ev) => partials.push(ev),
    ...(now ? { now } : {}),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. 完整消息展开（golden：_extract_sdk_messages 行为快照）
// ─────────────────────────────────────────────────────────────────────────────

describe('完整消息展开（full-message-mixed）', () => {
  const DOCKER_CMD =
    "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1 | head -40";
  const BASH_INPUT = {
    command: DOCKER_CMD,
    description: 'List running docker containers',
  };
  const TASK_INPUT = {
    description: 'Compute 17 times 23',
    prompt: 'Compute 17 * 23. Return only the numerical result.',
    subagent_type: 'general-purpose',
  };
  const EDIT_INPUT = {
    file_path: '<REDACTED>/spec-sync.ts',
    old_string:
      'async function walkDir(root: string, pruneTop?: Set<string>): Promise<WalkEntry[]> {',
    new_string:
      'async function walkDir(\n  root: string,\n  pruneTop?: Set<string>,\n  pruneNames?: Set<string>,\n): Promise<WalkEntry[]> {',
    replace_all: false,
  };
  const READ_INPUT = { file_path: '<REDACTED>/NOTES.md' };
  // service.py:3581 json.dumps(input_obj) 口径：入参整体 JSON。
  const bashArgsJson = JSON.stringify(BASH_INPUT);
  const taskArgsJson = JSON.stringify(TASK_INPUT);
  const editArgsJson = JSON.stringify(EDIT_INPUT);
  const readArgsJson = JSON.stringify(READ_INPUT);
  // service.py:3689 json.dumps(structuredPatch) 口径。
  const editPatchJson = JSON.stringify([
    {
      oldStart: 536,
      oldLines: 7,
      newStart: 536,
      newLines: 11,
      lines: [
        '  *（tar 标准是 forward slash；Windows 下 join 用反斜杠，但 tar entry name 必须是正斜杠）。',
        '  */',
        '-async function walkDir(root: string, pruneTop?: Set<string>): Promise<WalkEntry[]> {',
        '+async function walkDir(',
        '+  root: string,',
        '+  pruneTop?: Set<string>,',
        '+  pruneNames?: Set<string>,',
        '+): Promise<WalkEntry[]> {',
        '   const out: WalkEntry[] = [];',
      ],
    },
  ]);
  const bashOut =
    'NAMES\tIMAGE\tPORTS\nsillyhub-backend\tsillyhub:latest\t0.0.0.0:8000->8000/tcp';
  const editResult =
    'The file <REDACTED>/spec-sync.ts has been updated successfully. (file state is current in your context — no need to Read it back)';

  it('事件序列与 _extract_sdk_messages 行为快照逐字段一致', () => {
    const msgs = loadMessages('full-message-mixed');
    const partials: AgentEvent[] = [];
    let clock = 0;
    const norm = makeNormalizer(partials, () => clock);
    const events: AgentEvent[] = [];
    for (const msg of msgs) {
      clock += 100; // 每条消息推进 100ms（bash elapsed_ms 确定性）
      events.push(...norm.normalizeMessage(msg));
    }
    norm.dispose();

    // 无 stream_event → 无 partial flush。
    expect(partials).toEqual([]);

    const sid = 'sess-sample-0001';
    expect(events).toEqual([
      // msg1：assistant（main，msg_main_001）——tool_use 会话信号先行
      // （session-manager.ts:4584-4660 顺序），usage/session_id 盖章首条内容事件
      // （service.py:3481-3501），归属 depth 注入每条（service.py:3694-3714，
      // 现 daemon 恒挂 msg.depth：主 agent=0）。
      {
        type: 'status',
        subtype: 'bash_status',
        content: '',
        metadata: { command: DOCKER_CMD, status: 'running' },
      },
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: '',
        metadata: {
          task_id: 'toolu_task01',
          task_name: 'Compute 17 times 23',
          status: 'running',
        },
      },
      {
        type: 'thinking',
        content:
          'The user wants me to spawn a general-purpose subagent to compute 17*23, then reply with the number and "done".',
        segment_id: 'main:msg_main_001:thinking',
        depth: 0,
        usage: {
          input_tokens: 9771,
          output_tokens: 752,
          cache_read_tokens: 25088,
          cache_creation_tokens: 0,
        },
        session_id: sid,
      },
      {
        type: 'text',
        content:
          'I will run a quick environment check and dispatch a subagent for the arithmetic.',
        segment_id: 'main:msg_main_001:text',
        depth: 0,
      },
      {
        type: 'tool_use',
        tool_name: 'Bash',
        call_id: 'toolu_bash01',
        content: bashArgsJson,
        metadata: { tool_kind: 'bash' },
        depth: 0,
      },
      {
        type: 'tool_use',
        tool_name: 'Task',
        call_id: 'toolu_task01',
        content: taskArgsJson,
        metadata: { tool_kind: 'task' },
        depth: 0,
      },
      // msg2：user tool_result（Bash 终态 bash_chunk + bash_status，
      // session-manager.ts:4814-4829；elapsed=200-100=100ms）。
      {
        type: 'status',
        subtype: 'bash_chunk',
        content: bashOut,
        metadata: {
          command: DOCKER_CMD,
          channel: 'stdout',
          is_final: true,
        },
      },
      {
        type: 'status',
        subtype: 'bash_status',
        content: '',
        metadata: {
          command: DOCKER_CMD,
          status: 'completed',
          exit_code: 0,
          elapsed_ms: 100,
        },
      },
      {
        type: 'tool_result',
        call_id: 'toolu_bash01',
        content: bashOut,
        depth: 0,
        session_id: sid,
      },
      // msg3：assistant（main，msg_main_002）。
      {
        type: 'text',
        content: 'The environment is healthy. Now let me fix the spec sync walk function.',
        segment_id: 'main:msg_main_002:text',
        depth: 0,
        usage: {
          input_tokens: 12345,
          output_tokens: 210,
          cache_read_tokens: 40112,
          cache_creation_tokens: 0,
        },
        session_id: sid,
      },
      {
        type: 'tool_use',
        tool_name: 'Edit',
        call_id: 'toolu_edit01',
        content: editArgsJson,
        metadata: { tool_kind: 'write' },
        depth: 0,
      },
      // msg4：user tool_result（Edit structuredPatch → edit_patch，
      // service.py:3684-3691）。
      {
        type: 'tool_result',
        call_id: 'toolu_edit01',
        content: editResult,
        edit_patch: editPatchJson,
        depth: 0,
        session_id: sid,
      },
      // msg5：assistant 子代理（parent=toolu_task01，subagent_type，depth=1）。
      {
        type: 'thinking',
        content:
          'The task is a simple multiplication. I will read the project notes first, as the prompt hints they contain a precomputed table.',
        segment_id: 'toolu_task01:msg_sub_001:thinking',
        parent_tool_use_id: 'toolu_task01',
        subagent_type: 'general-purpose',
        depth: 1,
        usage: { input_tokens: 210, output_tokens: 33 },
        session_id: sid,
      },
      {
        type: 'text',
        content: 'Reading the project notes before answering.',
        segment_id: 'toolu_task01:msg_sub_001:text',
        parent_tool_use_id: 'toolu_task01',
        subagent_type: 'general-purpose',
        depth: 1,
      },
      {
        type: 'tool_use',
        tool_name: 'Read',
        call_id: 'toolu_read01',
        content: readArgsJson,
        metadata: { tool_kind: 'read' },
        parent_tool_use_id: 'toolu_task01',
        subagent_type: 'general-purpose',
        depth: 1,
      },
      // msg6：user 子代理 tool_result（list 形 content 拼接，service.py:3643-3652）。
      {
        type: 'tool_result',
        call_id: 'toolu_read01',
        content: '17 * 23 = 391 (precomputed in notes)',
        parent_tool_use_id: 'toolu_task01',
        depth: 1,
        session_id: sid,
      },
      // msg7：assistant 子代理最终文本。
      {
        type: 'text',
        content: '17 * 23 = 391',
        segment_id: 'toolu_task01:msg_sub_002:text',
        parent_tool_use_id: 'toolu_task01',
        subagent_type: 'general-purpose',
        depth: 1,
        session_id: sid,
      },
      // msg8：user 主上下文 Task tool_result（tool_use_result 无 structuredPatch
      // → 不带 edit_patch）。
      {
        type: 'tool_result',
        call_id: 'toolu_task01',
        content: '391',
        depth: 0,
        session_id: sid,
      },
      // msg9：assistant 收尾（usage 全字段映射）。
      {
        type: 'text',
        content: '17 × 23 = 391. done.',
        segment_id: 'main:msg_main_003:text',
        depth: 0,
        usage: {
          input_tokens: 10112,
          output_tokens: 12,
          cache_read_tokens: 52000,
          cache_creation_tokens: 1024,
        },
        session_id: sid,
      },
    ]);
  });

  it('thinking 超 20000 字符截断 + tool_result 超 100000 字符截断（service.py:3547/3664）', () => {
    const norm = makeNormalizer([]);
    const longThinking = 'x'.repeat(20001);
    const longResult = 'y'.repeat(100005);
    const ev1 = norm.normalizeMessage({
      type: 'assistant',
      message: {
        id: 'msg_trunc',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: longThinking }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage);
    expect(ev1).toEqual([
      {
        type: 'thinking',
        content: 'x'.repeat(20000) + '...',
        segment_id: 'main:msg_trunc:thinking',
        depth: 0,
      },
    ]);
    const ev2 = norm.normalizeMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_t1', content: longResult },
        ],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage);
    expect(ev2).toEqual([
      {
        type: 'tool_result',
        call_id: 'toolu_t1',
        content:
          'y'.repeat(100000) + '\n...(输出过长，已截断，共 100005 字符)',
        depth: 0,
      },
    ]);
    norm.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. partial 流式 + override（session-manager.ts:5629-5988/6066-6153 移植）
// ─────────────────────────────────────────────────────────────────────────────

describe('partial 流式与 override 撤回（partial-stream-override）', () => {
  it('500ms 节流 flush 吐 is_partial + segment_id + 实时 usage（D-003@v1）', () => {
    vi.useFakeTimers();
    const msgs = loadMessages('partial-stream-override');
    const partials: AgentEvent[] = [];
    const norm = makeNormalizer(partials);

    // message_start → block_start → 3× thinking_delta → message_delta（usage）。
    for (let i = 0; i <= 5; i++) {
      expect(norm.normalizeMessage(msgs[i]!)).toEqual([]);
    }
    // 节流窗口内无输出。
    expect(partials).toEqual([]);
    vi.advanceTimersByTime(500);
    // segmentId = `${parentKey}:${messageId}:${blockType}`（task-13 修复后格式）；
    // usage = 轮级累计（message_start input 100）+ delta output 差分 + cache 快照。
    expect(partials).toEqual([
      {
        type: 'thinking',
        content: 'Let me compute 17*23.',
        is_partial: true,
        segment_id: 'main:msg_p1:thinking',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 500,
          cache_creation_tokens: 0,
          // ctx_tokens = message_start 的 input+cache_read+cache_creation
          // = 100+500+0（D-005@v1，仅 main 桶携带）。
          ctx_tokens: 600,
        },
      },
    ]);
    norm.dispose();
  });

  it('完整消息到达 → override 事件（override:true + segment_id + 完整内容，D-004@v1）', () => {
    vi.useFakeTimers();
    const msgs = loadMessages('partial-stream-override');
    const partials: AgentEvent[] = [];
    const norm = makeNormalizer(partials);

    for (let i = 0; i <= 6; i++) norm.normalizeMessage(msgs[i]!); // 至 message_stop
    vi.advanceTimersByTime(500); // thinking partial 已 flush
    expect(partials).toHaveLength(1);

    // 完整 assistant（msg_p1 thinking）：override 原位替换（旧轨完整行 + 尾随
    // [THINKING_OVERRIDE] 信号行的事件合并），携带终态 usage + session_id 盖章。
    // usage 映射仅携带出现的字段（msg_p1 终态 usage 无 cache_creation）。
    const events1 = norm.normalizeMessage(msgs[7]!);
    expect(events1).toEqual([
      {
        type: 'thinking',
        content: 'Let me compute 17*23.',
        segment_id: 'main:msg_p1:thinking',
        override: true,
        depth: 0,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 500,
        },
        session_id: 'sess-sample-0001',
      },
    ]);

    // text 段：不推进定时器，message_stop 边界 flush 残留缓冲（任务卡要求）。
    partials.length = 0;
    for (let i = 8; i <= 14; i++) norm.normalizeMessage(msgs[i]!); // 至 message_stop
    expect(partials).toEqual([
      {
        type: 'text',
        content: 'The answer is 391.',
        is_partial: true,
        segment_id: 'main:msg_p2:text',
        // 轮级累计：input=100+320；output：msg_p2 的 message_start 重置 per-call
        // tracker（session-manager.ts:5682）→ delta 120 全额累加 = 50+120=170；
        // cache 快照 replace（message_start 起始值）；ctx_tokens 以 msg_p2 的
        // message_start 重建 = 320+700+64（D-005@v1）。
        usage: {
          input_tokens: 420,
          output_tokens: 170,
          cache_read_tokens: 700,
          cache_creation_tokens: 64,
          ctx_tokens: 1084,
        },
      },
    ]);

    const events2 = norm.normalizeMessage(msgs[15]!);
    expect(events2).toEqual([
      {
        type: 'text',
        content: 'The answer is 391.',
        segment_id: 'main:msg_p2:text',
        override: true,
        depth: 0,
        usage: {
          input_tokens: 320,
          output_tokens: 120,
          cache_read_tokens: 700,
          cache_creation_tokens: 64,
        },
        session_id: 'sess-sample-0001',
      },
    ]);
    norm.dispose();
  });

  it('未流式过的 segment：完整消息产普通事件（非 override）+ late partial 守卫', () => {
    vi.useFakeTimers();
    const norm = makeNormalizer([]);
    const complete = {
      type: 'assistant',
      message: {
        id: 'msg_noflush',
        role: 'assistant',
        content: [{ type: 'text', text: 'plain complete' }],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;
    expect(norm.normalizeMessage(complete)).toEqual([
      {
        type: 'text',
        content: 'plain complete',
        segment_id: 'main:msg_noflush:text',
        depth: 0,
      },
    ]);
    // 完整消息已覆盖该 segment → 后到 partial 直接丢弃（session-manager.ts:5734-5737）。
    const lateDelta = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'late' },
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;
    expect(norm.normalizeMessage(lateDelta)).toEqual([]);
    vi.advanceTimersByTime(1000);
    norm.dispose();
  });

  it('normalizeOverrideSignal 直接调用的事件形态', () => {
    const norm = makeNormalizer([]);
    expect(
      norm.normalizeOverrideSignal('text', 'main:m1:text', 'full content'),
    ).toEqual({
      type: 'text',
      content: 'full content',
      segment_id: 'main:m1:text',
      override: true,
    });
    expect(
      norm.normalizeOverrideSignal('thinking', 'main:m1:thinking', 'thoughts'),
    ).toEqual({
      type: 'thinking',
      content: 'thoughts',
      segment_id: 'main:m1:thinking',
      override: true,
    });
    norm.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. status 会话信号映射（D-002@v1）
// ─────────────────────────────────────────────────────────────────────────────

describe('status 会话信号（session-init-status）', () => {
  it('system/init（主）→ session_started；子代理 init 守卫丢弃', () => {
    const msgs = loadMessages('session-init-status');
    const norm = makeNormalizer([]);
    expect(norm.normalizeMessage(msgs[0]!)).toEqual([
      {
        type: 'status',
        subtype: 'session_started',
        content: '',
        session_id: 'sess-sample-0002',
        metadata: {
          model: 'claude-sonnet-4-5',
          claude_code_version: '2.1.216',
        },
      },
    ]);
    // 子代理 init（parent_tool_use_id 非空）→ []。
    expect(norm.normalizeMessage(msgs[8]!)).toEqual([]);
    norm.dispose();
  });

  it('EnterPlanMode tool_use → plan_mode + tool_use 事件', () => {
    const msgs = loadMessages('session-init-status');
    const norm = makeNormalizer([]);
    expect(norm.normalizeMessage(msgs[1]!)).toEqual([
      {
        type: 'status',
        subtype: 'plan_mode',
        content: '',
        metadata: {
          summary: {
            objective: 'Refactor the sync layer',
            tasks: ['Scan current walkers', 'Draft new prune API', 'Wire callers'],
            design_snippet: 'walkDir gains pruneNames: Set<string>',
          },
        },
      },
      {
        type: 'tool_use',
        tool_name: 'EnterPlanMode',
        call_id: 'toolu_plan01',
        content: JSON.stringify({
          objective: 'Refactor the sync layer',
          tasks: ['Scan current walkers', 'Draft new prune API', 'Wire callers'],
          design_snippet: 'walkDir gains pruneNames: Set<string>',
        }),
        // classify_tool_kind 只映射 exitplanmode → plan（EnterPlanMode → other，
        // backend tool_kind.py:114-115 同逻辑，R-05 防漂移）。
        metadata: { tool_kind: 'other' },
        depth: 0,
        session_id: 'sess-sample-0002',
      },
    ]);
    norm.dispose();
  });

  it('task_started / task_progress / task_notification → 对应 status 事件', () => {
    const msgs = loadMessages('session-init-status');
    const norm = makeNormalizer([]);
    expect(norm.normalizeMessage(msgs[2]!)).toEqual([
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: 'Compute 17 times 23',
        metadata: {
          task_id: 'bgtask-01',
          task_name: 'Compute 17 times 23',
          status: 'running',
          tool_use_id: 'toolu_task01',
          subagent_type: 'general-purpose',
        },
      },
    ]);
    expect(norm.normalizeMessage(msgs[3]!)).toEqual([
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: 'Reading project notes',
        metadata: {
          task_id: 'bgtask-01',
          task_name: 'Compute 17 times 23',
          status: 'running',
          tool_use_id: 'toolu_task01',
          subagent_type: 'general-purpose',
          last_tool_name: 'Read',
          summary: 'Reading project notes',
          elapsed_ms: 4500,
          total_tokens: 1200,
          tool_uses: 2,
        },
      },
    ]);
    expect(norm.normalizeMessage(msgs[4]!)).toEqual([
      {
        type: 'status',
        subtype: 'task_notification',
        content: 'Computed 17 * 23 = 391',
        metadata: {
          task_id: 'bgtask-01',
          status: 'completed',
          tool_use_id: 'toolu_task01',
          summary: 'Computed 17 * 23 = 391',
          elapsed_ms: 8200,
        },
      },
    ]);
    norm.dispose();
  });

  it('thinking_tokens 帧 → status/thinking_tokens 事件（D-005@v1，legacy [SYSTEM:thinking_tokens] 行等价）', () => {
    const msgs = loadMessages('session-init-status');
    const norm = makeNormalizer([]);
    // legacy flush 行内容 = estimated_tokens running total 数值
    // （session-manager.ts:5962-5971）；原字段（estimated_tokens/estimated_tokens_delta）进 metadata。
    expect(norm.normalizeMessage(msgs[6]!)).toEqual([
      {
        type: 'status',
        subtype: 'thinking_tokens',
        content: '512',
        metadata: { estimated_tokens: 512, estimated_tokens_delta: 100 },
      },
    ]);
    norm.dispose();
  });

  it('无业务价值帧静默丢弃：skip_transcript / local_command / result', () => {
    const msgs = loadMessages('session-init-status');
    const norm = makeNormalizer([]);
    // msgs[5]=skip_transcript task_started；[7]=local_command；
    // [9]=result（走 driver onResult 独立链路）。
    for (const idx of [5, 7, 9]) {
      expect(norm.normalizeMessage(msgs[idx]!)).toEqual([]);
    }
    norm.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. depth 状态机跨帧（session-manager.ts:4557-4569/5500-5528 移植）
// ─────────────────────────────────────────────────────────────────────────────

describe('depth 状态机', () => {
  /** 最小 assistant 消息（单 text block 或单 tool_use block）。 */
  function assistant(
    mid: string,
    parent: string | null,
    blocks: unknown[],
  ): SDKMessage {
    return {
      type: 'assistant',
      message: { id: mid, role: 'assistant', content: blocks },
      parent_tool_use_id: parent,
    } as unknown as SDKMessage;
  }

  it('Task 子代理帧 depth+1，嵌套 depth+2，onTurnEnd 后回落', () => {
    const norm = makeNormalizer([]);
    // 主 agent（depth 0）派 Task t1 → subagentDepth[t1]=1。
    norm.normalizeMessage(
      assistant('m1', null, [
        { type: 'tool_use', id: 'toolu_t1', name: 'Task', input: {} },
      ]),
    );
    // 子代理（parent t1，depth 1）再派 Task t2 → subagentDepth[t2]=2。
    // （同时产 agent_task_status 会话信号——depth 断言只看 tool_use 内容事件。）
    const sub = norm.normalizeMessage(
      assistant('m2', 'toolu_t1', [
        { type: 'tool_use', id: 'toolu_t2', name: 'Task', input: {} },
      ]),
    );
    expect(sub.filter((e) => e.type === 'tool_use').map((e) => e.depth)).toEqual([1]);
    // 孙代理（parent t2）文本 → depth 2。
    const grand = norm.normalizeMessage(
      assistant('m3', 'toolu_t2', [{ type: 'text', text: 'grandchild' }]),
    );
    expect(grand.map((e) => e.depth)).toEqual([2]);
    // turn 收尾：depth 登记表清空 → 回落。
    norm.onTurnEnd();
    const main2 = norm.normalizeMessage(
      assistant('m4', null, [{ type: 'text', text: 'back to main' }]),
    );
    expect(main2.map((e) => e.depth)).toEqual([0]);
    // 深度查不到时退化 1（R-04 口径，session-manager.ts:4567）。
    const orphan = norm.normalizeMessage(
      assistant('m5', 'toolu_unknown', [{ type: 'text', text: 'orphan' }]),
    );
    expect(orphan.map((e) => e.depth)).toEqual([1]);
    norm.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. zod 契约一致性：全部产出事件过 safeParseAgentEvent
// ─────────────────────────────────────────────────────────────────────────────

describe('safeParseAgentEvent 契约校验', () => {
  it('三份 fixture 的全部产出事件（含 partial flush）均通过 zod 校验', () => {
    vi.useFakeTimers();
    const all: AgentEvent[] = [];
    for (const name of [
      'full-message-mixed',
      'partial-stream-override',
      'session-init-status',
    ]) {
      const partials: AgentEvent[] = [];
      let clock = 0;
      const norm = makeNormalizer(partials, () => clock);
      for (const msg of loadMessages(name)) {
        clock += 100;
        all.push(...norm.normalizeMessage(msg));
      }
      vi.advanceTimersByTime(1000); // 残留节流窗口 flush
      all.push(...partials);
      norm.dispose();
    }
    expect(all.length).toBeGreaterThan(0);
    for (const ev of all) {
      const parsed = safeParseAgentEvent(ev);
      if (!parsed.success) {
        expect(
          JSON.stringify(parsed.error.issues),
          `event failed zod: ${JSON.stringify(ev)}`,
        ).toBe('[]');
      }
      expect(parsed.success).toBe(true);
    }
  });
});
