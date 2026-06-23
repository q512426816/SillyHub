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
import type { UserTurnInput } from '../../src/interactive/driver.js';

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
  mapUserTurnInputToSdk,
} from '../../src/interactive/claude-sdk-driver.js';
import type { ClaudeDriverHandle } from '../../src/interactive/claude-sdk-driver.js';

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
    const wrapperContent = `node .\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    // 跨平台：posix 上 path.normalize 不规整反斜杠，resolveClaudeExecutable 解析出的
    // 路径保留 Windows 反斜杠 + .\ 前缀。mock 比对与断言统一做「反斜杠→正斜杠 + normalize」，
    // 否则非 Windows 平台裸字符串比对必然失配（pre-existing 缺陷）。
    const norm = (p: string) => path.normalize(String(p).replace(/\\/g, '/'));
    fsExists.mockImplementation((p) => norm(p) === norm(wrapperPath) || norm(p) === norm(realExe));
    fsRead.mockReturnValue(wrapperContent as unknown as Buffer);
    const resolved = resolveClaudeExecutable(wrapperPath);
    expect(norm(resolved)).toBe(norm(realExe));
  });
});

// ── ClaudeSdkDriver.start ─────────────────────────────────────────────────────

describe('ClaudeSdkDriver.start', () => {
  it('传给 sdkQuery 的 options 含 pathToClaudeCodeExecutable / cwd / env', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const input: AsyncIterable<UserTurnInput> = {
      [Symbol.asyncIterator]: () =>
        (async function* () {
          /* empty */
        })(),
    };
    const driver = new ClaudeSdkDriver();
    await driver.start(input, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      env: { ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://x' },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]![0] as {
      prompt: unknown;
      options?: Record<string, unknown>;
    };
    // task-03（D-009@v1）：prompt 是 mapUserTurnInputToSdk 转换后的 AsyncIterable，
    // 不再是原 input 引用（SDK 类型隔离在 driver 内部）。
    expect(call.prompt).not.toBe(input);
    expect(call.options).toMatchObject({
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
      env: { ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'http://x' },
    });
  });

  it('executable 为空串 → start 抛 ClaudeExecutableNotFoundError，不调 sdkQuery', async () => {
    const driver = new ClaudeSdkDriver();
    await expect(
      driver.start(
        { [Symbol.asyncIterator]: () => (async function* () {})() },
        { pathToClaudeCodeExecutable: '', cwd: 'C:\\work' },
      ),
    ).rejects.toBeInstanceOf(ClaudeExecutableNotFoundError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('未传 env 时透传 process.env 副本（spike H1）', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const driver = new ClaudeSdkDriver();
    await driver.start(
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

  it('未传 model/allowedTools 时 options 不含这些 key（让 SDK 走默认）', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const driver = new ClaudeSdkDriver();
    await driver.start(
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

  it('.cmd wrapper 路径：start 自动解析为真 exe 后传 SDK（R-exe 落实）', async () => {
    const wrapperPath = 'C:\\nvm4w\\nodejs\\claude.cmd';
    const realExe =
      'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    fsExists.mockImplementation(
      (p) => String(p) === wrapperPath || String(p) === realExe,
    );
    fsRead.mockReturnValue(`@"${realExe}" %*` as unknown as Buffer);

    const driver = new ClaudeSdkDriver();
    await driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: wrapperPath, cwd: 'C:\\work' },
    );
    const call = mockQuery.mock.calls[0]![0] as {
      options?: Record<string, unknown>;
    };
    expect(call.options?.pathToClaudeCodeExecutable).toBe(realExe);
  });

  it('task-03（AC-03.1）：ClaudeSdkDriver implements InteractiveDriver，provider==="claude"', () => {
    const driver = new ClaudeSdkDriver();
    expect(driver.provider).toBe('claude');
    // start/consume/interrupt 三方法存在（鸭子类型契约）
    expect(typeof driver.start).toBe('function');
    expect(typeof driver.consume).toBe('function');
    expect(typeof driver.interrupt).toBe('function');
  });

  it('task-03（AC-03.2）：start 返回 ClaudeDriverHandle（含 query + provider=claude）', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const driver = new ClaudeSdkDriver();
    const handle = await driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: realExe, cwd: 'C:\\work' },
    );
    expect(handle.provider).toBe('claude');
    expect((handle as ClaudeDriverHandle).query).toBeDefined();
    expect(typeof (handle as ClaudeDriverHandle).query.interrupt).toBe(
      'function',
    );
  });
});

// ── mapUserTurnInputToSdk：UserTurnInput → SDKUserMessage 转换（D-009@v1）────────

describe('mapUserTurnInputToSdk（UserTurnInput → SDKUserMessage，D-009@v1）', () => {
  it('逐条映射 {type:user,text} → {type:user,message:{role:user,content:text},parent_tool_use_id:null}', async () => {
    const turns: UserTurnInput[] = [
      { type: 'user', text: 'hi' },
      { type: 'user', text: 'second turn' },
    ];
    async function* src(): AsyncGenerator<UserTurnInput, void> {
      for (const t of turns) yield t;
    }
    const out: SDKUserMessage[] = [];
    for await (const m of mapUserTurnInputToSdk(src())) {
      out.push(m);
    }
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
    });
    expect(out[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'second turn' },
      parent_tool_use_id: null,
    });
  });

  it('空 text 仍 yield 一条消息（边界 1：driver 不校验语义）', async () => {
    async function* src(): AsyncGenerator<UserTurnInput, void> {
      yield { type: 'user', text: '' };
    }
    const out: SDKUserMessage[] = [];
    for await (const m of mapUserTurnInputToSdk(src())) {
      out.push(m);
    }
    expect(out).toHaveLength(1);
    expect((out[0] as { message: { content: string } }).message.content).toBe(
      '',
    );
  });

  it('空上游 → 不 yield 任何消息', async () => {
    async function* src(): AsyncGenerator<UserTurnInput, void> {
      /* empty */
    }
    const out: SDKUserMessage[] = [];
    for await (const m of mapUserTurnInputToSdk(src())) {
      out.push(m);
    }
    expect(out).toHaveLength(0);
  });

  it('task-03（AC-03.2）：start 喂入 UserTurnInput 后，SDK 收到的 prompt 首条是转换后的 SDKUserMessage', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const captured: SDKUserMessage[] = [];
    setMockQueryImpl((params) => {
      // SDK 实际会 for-await 消费 prompt（mapUserTurnInputToSdk 的输出）。
      void (async () => {
        for await (const m of params.prompt as AsyncIterable<SDKUserMessage>) {
          captured.push(m);
        }
      })();
      return makeFakeQuery([resultSuccess('OK', 'sess')]);
    });

    async function* input(): AsyncGenerator<UserTurnInput, void> {
      yield { type: 'user', text: 'hello' };
    }
    const driver = new ClaudeSdkDriver();
    await driver.start(input(), {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
    });
    // 等 mock 内 async 消费完成
    await new Promise((r) => setImmediate(r));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    });
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
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;

    const onResult = vi.fn();
    const onMessage = vi.fn();
    const onError = vi.fn();

    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onResult, onMessage, onError });

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
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onResult });
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
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;

    const onResult = vi.fn();
    const onError = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onResult, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('spawn EINVAL');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('interrupt 触发的 result(error_during_execution) 正常走 onResult（D1）', async () => {
    const sessionId = 's2';
    const q = makeFakeQuery([resultInterrupt(sessionId)]);
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onResult });
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

  it('interrupt(handle) 调用底层 query.interrupt() 一次，返回 true', async () => {
    const interruptFn = vi.fn(async () => {});
    const q = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: interruptFn,
    } as unknown as Query;
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const driver = new ClaudeSdkDriver();
    const ok = await driver.interrupt(handle);
    expect(ok).toBe(true);
    expect(interruptFn).toHaveBeenCalledTimes(1);
  });

  it('interrupt(handle) 时 query.interrupt() 抛错 → 捕获并返回 false（不向上冒泡）', async () => {
    const interruptFn = vi.fn(async () => {
      throw new Error('cannot interrupt');
    });
    const q = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: interruptFn,
    } as unknown as Query;
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const driver = new ClaudeSdkDriver();
    const ok = await driver.interrupt(handle);
    expect(ok).toBe(false);
    expect(interruptFn).toHaveBeenCalledTimes(1);
  });

  it('task-03（AC-03.6）：handle 无 query.interrupt 方法 → false', async () => {
    const handle = {
      provider: 'claude',
      query: {},
    } as unknown as ClaudeDriverHandle;
    const driver = new ClaudeSdkDriver();
    const ok = await driver.interrupt(handle);
    expect(ok).toBe(false);
  });
});

// ── 端到端：driver + 真实 InputQueue 喂入 + mock SDK 读取 prompt ─────────────────

describe('driver + InputQueue 端到端（spike H2 同进程多轮）', () => {
  it('task-03（D-009@v1）：InputQueue<UserTurnInput> 喂入 driver，SDK 经 mapUserTurnInputToSdk 读到转换后的 SDKUserMessage', async () => {
    const realExe = 'C:\\bin\\claude.exe';
    fsExists.mockReturnValue(true);
    const captured: SDKUserMessage[] = [];
    setMockQueryImpl((params) => {
      // SDK 实际 for-await 消费 driver 转换后的 prompt。
      void (async () => {
        for await (const m of params.prompt as AsyncIterable<SDKUserMessage>) {
          captured.push(m);
        }
      })();
      return makeFakeQuery([resultSuccess('OK', 'sess')]);
    });

    const { InputQueue } = await import(
      '../../src/interactive/input-queue.js'
    );
    // task-01 起 InputQueue 默认类型参数为 UserTurnInput（provider-neutral）。
    const queue = new InputQueue<UserTurnInput>();
    queue.push({ type: 'user', text: 'hi' });
    queue.push({ type: 'user', text: 'second' });
    queue.close();

    const driver = new ClaudeSdkDriver();
    await driver.start(queue, {
      pathToClaudeCodeExecutable: realExe,
      cwd: 'C:\\work',
    });
    // 等 mock 内 async 消费完成
    await new Promise((r) => setImmediate(r));
    // 两条 UserTurnInput 均经 mapUserTurnInputToSdk 转成 SDKUserMessage 透传 SDK。
    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
    });
    expect(captured[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'second' },
      parent_tool_use_id: null,
    });
  });
});
