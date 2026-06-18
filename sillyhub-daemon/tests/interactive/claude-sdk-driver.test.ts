// tests/interactive/claude-sdk-driver.test.ts
// task-04 Step 2：ClaudeSdkDriver 封装 @anthropic-ai/claude-agent-sdk 的 query。
// SDK 一律 mock（vitest vi.mock），不连真实 bigmodel（CI 不依赖网络/鉴权）。
//
// 覆盖（蓝图 §4.2 + §5）：
//   - start：传给 sdkQuery 的 options（pathToClaudeCodeExecutable/cwd/env）正确
//   - executable 缺失 → ClaudeExecutableNotFoundError
//   - consume：两条 result 各触发 onResult；assistant/system 消息走 onMessage
//   - interrupt(null) → false；interrupt(q) 调用 q.interrupt()
//   - generator 抛错 → onError
//   - wrapper→exe 解析（task-01 R-exe reverse sync）：
//     *.exe 直传 / *.cmd 解 wrapper 取真 exe / 找不到真 exe throw

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// ── mock node:fs：existsSync / readFileSync 由测试逐 case 配置。 ───────────────
// 用 vi.hoisted + vi.mock 让 mock 模块在 import 前 hoist；node:fs 的导出在 ESM 不可
// 重新 define，故不能在 case 内 vi.spyOn(fs,'existsSync')（会抛 "Cannot redefine property"）。
const { fsExists, fsRead } = vi.hoisted(() => ({
  fsExists: vi.fn((p: unknown) => false),
  fsRead: vi.fn((_p: unknown) => '' as unknown as Buffer),
}));
vi.mock('node:fs', () => ({
  existsSync: fsExists,
  readFileSync: fsRead,
}));

// ── mock SDK：默认导出可被测试覆盖的 mockQuery。 ────────────────────────────────
const { mockQuery, setMockQueryImpl } = vi.hoisted(() => {
  // 默认实现：返回一个空 stub Query（consume 不跑，只用于 start 断言调用参数）。
  const defaultQuery = (): Query =>
    ({
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: async () => {},
    }) as unknown as Query;
  let impl:
    | ((params: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options?: Record<string, unknown>;
      }) => Query)
    | null = null;
  const mockQuery = vi.fn(
    (
      params: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options?: Record<string, unknown>;
      },
    ): Query => {
      return impl ? impl(params) : defaultQuery();
    },
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

// 导入待测 driver（在 mock 之后）。
import {
  ClaudeSdkDriver,
  ClaudeExecutableNotFoundError,
  resolveClaudeExecutable,
} from '../../src/interactive/claude-sdk-driver.js';

// ── 辅助：构造伪造 SDK 消息（按 spike H2 两轮形态）──────────────────────────────

function systemInit(sessionId: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'env',
    claude_code_version: '2.1.181',
    cwd: '/work',
    tools: [],
    mcp_servers: [],
    model: 'glm-5.2',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    session_id: sessionId,
    uuid: 'init-uuid',
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

function resultSuccess(text: string, sessionId: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: 'res-uuid',
  } as unknown as SDKResultMessage;
}

function resultInterrupt(sessionId: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: 500,
    duration_api_ms: 400,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: ['interrupted'],
    session_id: sessionId,
    uuid: 'res-interrupt-uuid',
  } as unknown as SDKResultMessage;
}

/**
 * 构造一个伪造 Query（AsyncGenerator + interrupt）。
 * 按给定消息序列吐出，可选 interrupt 调用记录。
 */
function makeFakeQuery(
  messages: SDKMessage[],
  onInterrupt?: () => void,
): Query {
  const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
    for (const m of messages) {
      yield m;
    }
  })();
  const query = {
    [Symbol.asyncIterator]: () => gen,
    interrupt: vi.fn(async () => {
      onInterrupt?.();
    }),
    // Query 接口其他方法桩（driver 不调用，仅为类型满足）。
  } as unknown as Query;
  return query;
}

beforeEach(() => {
  mockQuery.mockClear();
  setMockQueryImpl(null);
  fsExists.mockReset();
  fsRead.mockReset();
  // 默认：existsSync 返回 false（具体 case 显式 override）。
  fsExists.mockReturnValue(false);
  fsRead.mockReturnValue('' as unknown as Buffer);
});

// ── wrapper→exe 解析（task-01 R-exe reverse sync）──────────────────────────────

describe('resolveClaudeExecutable（wrapper→exe 解析，task-01 R-exe）', () => {
  it('.exe 路径直传：返回原路径', () => {
    const realExe =
      'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    expect(resolveClaudeExecutable(realExe)).toBe(realExe);
  });

  it('.cmd wrapper：读 wrapper 内容正则取真 exe 绝对路径', () => {
    const wrapperDir = 'C:\\nvm4w\\nodejs';
    const wrapperPath = path.join(wrapperDir, 'claude.cmd');
    const realExe =
      'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    // 模拟 npm cmd-shim wrapper 内容（含 node_modules\@anthropic-ai\claude-code\bin\claude.exe 绝对路径）
    const wrapperContent = `@"${realExe}" %*`;

    fsExists.mockImplementation((p) => String(p) === wrapperPath || String(p) === realExe);
    fsRead.mockReturnValue(wrapperContent as unknown as Buffer);

    const resolved = resolveClaudeExecutable(wrapperPath);
    // 归一化比对（path.normalize 跨平台）
    expect(path.normalize(resolved)).toBe(path.normalize(realExe));
    expect(fsRead).toHaveBeenCalledWith(wrapperPath, 'utf8');
  });

  it('.cmd wrapper 但解出的 exe 不存在 → throw ClaudeExecutableNotFoundError', () => {
    const wrapperPath = 'C:\\nvm4w\\nodejs\\claude.cmd';
    const wrapperContent =
      'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe %*';
    fsExists.mockImplementation((p) => String(p) === wrapperPath);
    fsRead.mockReturnValue(wrapperContent as unknown as Buffer);
    expect(() => resolveClaudeExecutable(wrapperPath)).toThrow(
      ClaudeExecutableNotFoundError,
    );
  });

  it('.cmd wrapper 内容不含真 exe 路径 → throw ClaudeExecutableNotFoundError', () => {
    const wrapperPath = 'C:\\nvm4w\\nodejs\\claude.cmd';
    fsExists.mockImplementation((p) => String(p) === wrapperPath);
    fsRead.mockReturnValue(
      'echo unrelated wrapper content' as unknown as Buffer,
    );
    expect(() => resolveClaudeExecutable(wrapperPath)).toThrow(
      ClaudeExecutableNotFoundError,
    );
  });

  it('空字符串路径 → throw ClaudeExecutableNotFoundError', () => {
    expect(() => resolveClaudeExecutable('')).toThrow(
      ClaudeExecutableNotFoundError,
    );
  });

  it('wrapper 内容内为相对 node_modules 路径：相对 wrapper dir 解析', () => {
    const wrapperDir = 'C:\\nvm4w\\nodejs';
    const wrapperPath = path.join(wrapperDir, 'claude.cmd');
    const realExe = path.join(
      wrapperDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    );
    // wrapper 内写相对路径（cmd-shim 某些生成方式，相对 wrapper 所在 dir）。
    // 用 .\node_modules\... 避免路径上跳造成比对不一致。
    const wrapperContent = `node .\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    fsExists.mockImplementation((p) => String(p) === wrapperPath || String(p) === realExe);
    fsRead.mockReturnValue(wrapperContent as unknown as Buffer);
    const resolved = resolveClaudeExecutable(wrapperPath);
    expect(path.normalize(resolved)).toBe(path.normalize(realExe));
  });
});

// ── ClaudeSdkDriver.start ─────────────────────────────────────────────────────

describe('ClaudeSdkDriver.start', () => {
  it('传给 sdkQuery 的 options 含 pathToClaudeCodeExecutable / cwd / env', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const input: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () =>
        (async function* () {
          /* empty */
        })(),
    };
    const driver = new ClaudeSdkDriver();
    driver.start(input, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      env: { ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://x' },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]![0] as {
      prompt: unknown;
      options?: Record<string, unknown>;
    };
    expect(call.prompt).toBe(input);
    expect(call.options).toMatchObject({
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      env: { ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://x' },
    });
  });

  it('executable 为空串 → start 抛 ClaudeExecutableNotFoundError，不调 sdkQuery', () => {
    const driver = new ClaudeSdkDriver();
    expect(() =>
      driver.start(
        { [Symbol.asyncIterator]: () => (async function* () {})() },
        { pathToClaudeCodeExecutable: '', cwd: 'C:\\work' },
      ),
    ).toThrow(ClaudeExecutableNotFoundError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('未传 env 时透传 process.env 副本（spike H1）', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const driver = new ClaudeSdkDriver();
    driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: realExe, cwd: 'C:\\work' },
    );
    const call = mockQuery.mock.calls[0]![0] as {
      options?: { env?: Record<string, string> };
    };
    expect(call.options?.env).toBeDefined();
    expect(call.options?.env).not.toBe(process.env);
    // 应继承 process.env 的 key
    expect(Object.keys(call.options!.env!)).toEqual(
      expect.arrayContaining(Object.keys(process.env)),
    );
  });

  it('未传 model/allowedTools 时 options 不含这些 key（让 SDK 走默认）', () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const driver = new ClaudeSdkDriver();
    driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: realExe, cwd: 'C:\\work' },
    );
    const call = mockQuery.mock.calls[0]![0] as {
      options?: Record<string, unknown>;
    };
    expect(call.options).not.toHaveProperty('model');
    expect(call.options).not.toHaveProperty('allowedTools');
    expect(call.options).not.toHaveProperty('resume');
  });

  it('.cmd wrapper 路径：start 自动解析为真 exe 后传 SDK（R-exe 落实）', () => {
    const wrapperPath = 'C:\\nvm4w\\nodejs\\claude.cmd';
    const realExe =
      'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    fsExists.mockImplementation(
      (p) => String(p) === wrapperPath || String(p) === realExe,
    );
    fsRead.mockReturnValue(`@"${realExe}" %*` as unknown as Buffer);

    const driver = new ClaudeSdkDriver();
    driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: wrapperPath, cwd: 'C:\\work' },
    );
    const call = mockQuery.mock.calls[0]![0] as {
      options?: Record<string, unknown>;
    };
    expect(call.options?.pathToClaudeCodeExecutable).toBe(realExe);
  });
});

// ── ClaudeSdkDriver.consume ───────────────────────────────────────────────────

describe('ClaudeSdkDriver.consume（spike H2 两轮 / D4 result 边界）', () => {
  it('两条 result 各触发 onResult；中间消息触发 onMessage', async () => {
    const sessionId = '5b31bbdf-aaaa-bbbb-cccc-dddddddddddd';
    const messages: SDKMessage[] = [
      systemInit(sessionId),
      assistantText('turn1 ok'),
      resultSuccess('TURN1', sessionId),
      assistantText('turn2 ok'),
      resultSuccess('TURN2', sessionId),
    ];
    const q = makeFakeQuery(messages);

    const onResult = vi.fn();
    const onMessage = vi.fn();
    const onError = vi.fn();

    const driver = new ClaudeSdkDriver();
    await driver.consume(q, { onResult, onMessage, onError });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect((onResult.mock.calls[0]![0] as SDKResultMessage).result).toBe(
      'TURN1',
    );
    expect((onResult.mock.calls[1]![0] as SDKResultMessage).result).toBe(
      'TURN2',
    );
    // onMessage 收到非 result 的消息（system init + assistant ×2）
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it('不提供 onMessage 时只调 onResult，不抛', async () => {
    const sessionId = 's1';
    const q = makeFakeQuery([
      assistantText('x'),
      resultSuccess('R', sessionId),
    ]);
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(q, { onResult });
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('generator 抛错 → onError 触发；不调 onResult', async () => {
    const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
      throw new Error('spawn EINVAL');
    })();
    const q = {
      [Symbol.asyncIterator]: () => gen,
      interrupt: vi.fn(),
    } as unknown as Query;

    const onResult = vi.fn();
    const onError = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(q, { onResult, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('spawn EINVAL');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('interrupt 触发的 result(error_during_execution) 正常走 onResult（D1）', async () => {
    const sessionId = 's2';
    const q = makeFakeQuery([resultInterrupt(sessionId)]);
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(q, { onResult });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(
      (onResult.mock.calls[0]![0] as SDKResultMessage).subtype,
    ).toBe('error_during_execution');
  });
});

// ── ClaudeSdkDriver.interrupt ─────────────────────────────────────────────────

describe('ClaudeSdkDriver.interrupt（spike D1 turn 级）', () => {
  it('interrupt(null) → false（no-op）', async () => {
    const driver = new ClaudeSdkDriver();
    expect(await driver.interrupt(null)).toBe(false);
  });

  it('interrupt(q) 调用 q.interrupt() 一次，返回 true', async () => {
    const interruptFn = vi.fn(async () => {});
    const q = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: interruptFn,
    } as unknown as Query;
    const driver = new ClaudeSdkDriver();
    const ok = await driver.interrupt(q);
    expect(ok).toBe(true);
    expect(interruptFn).toHaveBeenCalledTimes(1);
  });

  it('interrupt(q) 时 q.interrupt() 抛错 → 捕获并返回 false（不向上冒泡）', async () => {
    const interruptFn = vi.fn(async () => {
      throw new Error('cannot interrupt');
    });
    const q = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: interruptFn,
    } as unknown as Query;
    const driver = new ClaudeSdkDriver();
    const ok = await driver.interrupt(q);
    expect(ok).toBe(false);
    expect(interruptFn).toHaveBeenCalledTimes(1);
  });
});

// ── 端到端：driver + 真实 InputQueue 喂入 + mock SDK 读取 prompt ─────────────────

describe('driver + InputQueue 端到端（spike H2 同进程多轮）', () => {
  it('SDK 收到的 prompt 是 InputQueue 本身（AsyncIterable）；driver 读 InputQueue 两条 msg 透传 SDK', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const capturedPrompts: AsyncIterable<SDKUserMessage>[] = [];
    setMockQueryImpl((params) => {
      capturedPrompts.push(params.prompt as AsyncIterable<SDKUserMessage>);
      return makeFakeQuery([resultSuccess('OK', 'sess')]);
    });

    const { InputQueue } = await import(
      '../../src/interactive/input-queue.js'
    );
    const queue = new InputQueue();
    queue.push({ type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    queue.close();

    const driver = new ClaudeSdkDriver();
    driver.start(queue, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
    });
    // SDK 收到的 prompt 应是同一个 queue 引用
    expect(capturedPrompts[0]).toBe(queue);
  });
});
