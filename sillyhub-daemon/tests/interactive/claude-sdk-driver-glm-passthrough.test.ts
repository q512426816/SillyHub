// tests/interactive/claude-sdk-driver-glm-passthrough.test.ts
// task-09 Step 3：GLM 错误透传单测（D-008 / FR-08b / AC-09.7~09.9）。
//
// 覆盖 task-09 §4.3 + §5 边界 6/7：
//   - consume 收 tool_result(is_error=true) → 原样经 onMessage 转发，不拦截 / 不重写 / 不裁剪；
//   - 连续工具失败（GLM Write 3 次均 permission error）→ driver 不预禁 Write、不调 interrupt；
//   - claude 收到 is_error 后自决定产 result（spike D2 caveat 复现）；session 不因工具失败自动 failed；
//   - ClaudeSdkDriverOptions.allowedTools 缺省 → start 不传黑名单（D-008）；
//   - canUseTool 不因 provider=glm / toolName=Write 自动 deny（不在 driver 层做 provider 分支）。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// mock node:fs（resolveClaudeExecutable 用 existsSync）。
const { fsExists, fsRead } = vi.hoisted(() => ({
  fsExists: vi.fn((p: unknown) => false),
  fsRead: vi.fn((_p: unknown) => '' as unknown as Buffer),
}));
vi.mock('node:fs', () => ({
  existsSync: fsExists,
  readFileSync: fsRead,
}));

// mock SDK：让 driver.start 接管返回 fake Query。
const { mockQuery, setMockQueryImpl } = vi.hoisted(() => {
  let impl:
    | ((params: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options?: Record<string, unknown>;
      }) => Query)
    | null = null;
  const mockQuery = vi.fn(
    (params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Record<string, unknown>;
    }): Query => (impl ? impl(params) : (({
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: async () => {},
    }) as unknown as Query)),
  );
  return {
    mockQuery,
    setMockQueryImpl: (
      fn:
        | ((params: {
            prompt: string | AsyncIterable<SDKUserMessage>;
            options?: Record<string, unknown>;
          }) => Query)
        | null,
    ) => {
      impl = fn;
    },
  };
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助构造 ─────────────────────────────────────────────────────────────────

function makeQuery(messages: SDKMessage[]): Query {
  const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
    for (const m of messages) yield m;
  })();
  return {
    [Symbol.asyncIterator]: () => gen,
    interrupt: vi.fn(async () => {}),
  } as unknown as Query;
}

function toolResultError(toolUseId: string, content: string): SDKMessage {
  // GLM Write permission error 的 tool_result 形态（spike D2）。
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: true,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: 'sess',
  } as unknown as SDKMessage;
}

function toolResultSuccess(toolUseId: string, content: string): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: false,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: 'sess',
  } as unknown as SDKMessage;
}

function assistantText(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: 'sess',
  } as unknown as SDKMessage;
}

function resultSuccess(): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

beforeEach(() => {
  mockQuery.mockClear();
  setMockQueryImpl(null);
  fsExists.mockReset();
  fsRead.mockReset();
  fsExists.mockReturnValue(true);
});

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('ClaudeSdkDriver.start：不传 allowedTools 黑名单（AC-09.8 / D-008）', () => {
  it('options.allowedTools 缺省 → 传给 SDK 的 options 不含 allowedTools 字段', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    driver.start(input, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      // allowedTools 不传 → GLM 路径走全工具集（D-008 不预禁）。
    });
    const passedOptions = mockQuery.mock.calls[0]![0].options as Record<
      string,
      unknown
    >;
    expect(passedOptions.allowedTools).toBeUndefined();
  });

  it('options.allowedTools 显式传 → 仍透传（不强制丢弃，但 GLM 路径生产侧缺省）', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    driver.start(input, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      allowedTools: ['Read', 'Glob'], // 调用方显式白名单时透传。
    });
    const passedOptions = mockQuery.mock.calls[0]![0].options as Record<
      string,
      unknown
    >;
    expect(passedOptions.allowedTools).toEqual(['Read', 'Glob']);
  });
});

describe('ClaudeSdkDriver.consume：tool_result(is_error=true) 原样透传（AC-09.7 / D-008）', () => {
  it('tool_result(is_error=true) 经 onMessage 原样转发：payload.is_error 不被改写、content 不裁剪', async () => {
    const longContent = 'E'.repeat(5000); // 超长 content。
    const messages = [
      toolResultError('tu-1', `permission error: ${longContent}`),
      resultSuccess(),
    ];
    setMockQueryImpl(() => makeQuery(messages));
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    const q = driver.start(input, {
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
      cwd: 'C:\\work',
    });
    const onResult = vi.fn(async () => {});
    const onMessage = vi.fn(async () => {});
    await driver.consume(q, { onResult, onMessage });
    // onMessage 收到 tool_result 原样（is_error=true 未被改写）。
    expect(onMessage).toHaveBeenCalledTimes(1);
    const forwarded = onMessage.mock.calls[0]![0] as SDKMessage;
    const tr = (forwarded as unknown as {
      message: { content: Array<Record<string, unknown>> };
    }).message.content[0]!;
    expect(tr.is_error).toBe(true);
    // content 不裁剪（5000 字符全保留）。
    expect(String(tr.content).length).toBe(`permission error: ${longContent}`.length);
  });

  it('tool_result(is_error=false) 也原样转发（driver 不区别 is_error 真假）', async () => {
    const messages = [
      toolResultSuccess('tu-1', 'file written'),
      resultSuccess(),
    ];
    setMockQueryImpl(() => makeQuery(messages));
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    const q = driver.start(input, {
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
      cwd: 'C:\\work',
    });
    const onMessage = vi.fn(async () => {});
    await driver.consume(q, { onResult: async () => {}, onMessage });
    const tr = (
      onMessage.mock.calls[0]![0] as unknown as {
        message: { content: Array<Record<string, unknown>> };
      }
    ).message.content[0]!;
    expect(tr.is_error).toBe(false);
  });
});

describe('ClaudeSdkDriver.consume：连续工具失败不阻断（AC-09.9 / spike D2 caveat）', () => {
  it('GLM Write 3 次均 permission error：driver 不预禁 / 不 interrupt；claude 收到 3 次 is_error 后产 result(success)，session 不崩', async () => {
    // spike D2 实测形态：3 次 tool_result(is_error=true) + assistant 中间文本 + 最终 result(success)。
    const messages: SDKMessage[] = [
      toolResultError('tu-1', 'permission error: write denied'),
      assistantText('write failed, let me try again'),
      toolResultError('tu-2', 'permission error: write denied'),
      assistantText('still failing'),
      toolResultError('tu-3', 'permission error: write denied'),
      assistantText('I was unable to write the file; please check permissions.'),
      resultSuccess(), // claude 放弃后正常结束 turn。
    ];
    setMockQueryImpl(() => makeQuery(messages));
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    const q = driver.start(input, {
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
      cwd: 'C:\\work',
    });
    const interruptSpy = vi.spyOn(q, 'interrupt');
    const onResult = vi.fn(async () => {});
    const onMessage = vi.fn(async () => {});
    await driver.consume(q, { onResult, onMessage });
    // 6 条中间消息全部经 onMessage 转发（3 tool_result + 3 assistant text）。
    expect(onMessage).toHaveBeenCalledTimes(6);
    // driver 不调 interrupt（不强制结束 turn）。
    expect(interruptSpy).not.toHaveBeenCalled();
    // onResult 收到一条 result（claude 自决定结束 turn）。
    expect(onResult).toHaveBeenCalledTimes(1);
    const resultArg = onResult.mock.calls[0]![0] as SDKResultMessage;
    expect(resultArg.subtype).toBe('success');
    expect(resultArg.is_error).toBe(false);
  });
});

describe('ClaudeSdkDriver.consume：result.is_error 与 tool_result(is_error) 不混淆（AC-09.12 / 边界 11）', () => {
  it('turn 级 result.is_error=true 经 onResult 转发；不混入 tool_result 路径', async () => {
    const resultErr: SDKResultMessage = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'turn failed',
      num_turns: 1,
      duration_ms: 1,
      duration_api_ms: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      session_id: 'sess',
      uuid: 'r1',
    } as unknown as SDKResultMessage;
    setMockQueryImpl(() => makeQuery([resultErr]));
    const driver = new ClaudeSdkDriver();
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
    };
    const q = driver.start(input, {
      pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
      cwd: 'C:\\work',
    });
    const onResult = vi.fn(async () => {});
    const onMessage = vi.fn(async () => {});
    await driver.consume(q, { onResult, onMessage });
    // turn 级 result 走 onResult，不进 onMessage。
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]![0]).toBe(resultErr);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
