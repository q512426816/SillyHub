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
//
// task-06（2026-09-03-agent-provider-abstraction / FR-02 / D-002@v1）追加 envelope 轨：
//   - mock SDK 流复用 task-03 的 fixture（tests/fixtures/claude-sdk-messages/*.json），
//     onTurnMessage 收到的 envelope.events 全过 safeParseAgentEvent（zod）
//   - raw 默认 undefined；SILLYHUB_DEBUG_RAW_EVENTS=1 时为原消息对象（帧级身份对应）
//   - partial flush 先行 + override 撤回（partial-stream-override fixture）
//   - onTurnResult 收映射后的 InteractiveDriverResult（usage 短名 cache_*_tokens + session_id）
//   - 双轨读键：新键存在时旧键不调用（SessionManager 双键形态过渡兼容）
//   - canUseTool/审批桥相关既有断言零改动（文件内既有 case 不动）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  InteractiveDriverResult,
  TurnMessageEnvelope,
  UserTurnInput,
} from '../../src/interactive/driver.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import { FIXTURES_DIR } from '../helpers';

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

/**
 * 加载 task-03 的 SDK 消息 fixture（每文件一个 JSON 数组，见该目录 README）。
 *
 * 本文件对 node:fs 有全局 vi.mock（wrapper→exe 解析用），loadFixture/helpers 的
 * readFileSync 会拿到 mock（默认返回空串）→ JSON.parse 报空输入。故经
 * vi.importActual 取真实 fs 直读 fixture 路径（对齐 claude-events.test.ts 的
 * loadFixture 语义，只绕开本文件的 fs mock，不影响其它 case 的 mock 行为）。
 */
async function loadMessages(name: string): Promise<SDKMessage[]> {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return JSON.parse(
    actual.readFileSync(path.join(FIXTURES_DIR, 'claude-sdk-messages', `${name}.json`), 'utf8'),
  ) as SDKMessage[];
}

/** onTurnMessage 入参判别：TurnMessageEnvelope（含 events 数组）。 */
function isEnvelope(
  m: TurnMessageEnvelope | Record<string, unknown>,
): m is TurnMessageEnvelope {
  return (
    typeof m === 'object' &&
    m !== null &&
    'events' in m &&
    Array.isArray((m as TurnMessageEnvelope).events)
  );
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
  it('两条 result 各触发 onTurnResult；中间消息触发 onTurnMessage（envelope）', async () => {
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
    // task-08：envelope-only（旧键 onResult/onMessage/onError 分支已移除）。
    await driver.consume(handle, {
      onTurnResult: onResult,
      onTurnMessage: onMessage,
      onTurnError: onError,
    });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect((onResult.mock.calls[0]![0] as SDKResultMessage).result).toBe(
      'TURN1',
    );
    expect((onResult.mock.calls[1]![0] as SDKResultMessage).result).toBe(
      'TURN2',
    );
    // onTurnMessage 收到非 result 帧的 envelope（init 1 条 + assistant ×2，
    // 归一化后每帧一个 envelope：session_started / text / text）。
    expect(onMessage).toHaveBeenCalledTimes(3);
    const events = onMessage.mock.calls.flatMap(
      (c) => (c[0] as TurnMessageEnvelope).events,
    );
    expect(events.filter((e) => e.type === 'status').map((e) => e.subtype)).toEqual([
      'session_started',
    ]);
    expect(events.filter((e) => e.type === 'text').map((e) => e.content)).toEqual([
      'turn1 ok',
      'turn2 ok',
    ]);
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
    await driver.consume(handle, { onTurnResult: onResult });
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('generator 抛错 → onTurnError 触发；不调 onTurnResult', async () => {
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
    await driver.consume(handle, { onTurnResult: onResult, onTurnError: onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('spawn EINVAL');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('interrupt 触发的 result(error_during_execution) 正常走 onTurnResult（D1）', async () => {
    const sessionId = 's2';
    const q = makeFakeQuery([resultInterrupt(sessionId)]);
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnResult: onResult });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(
      (onResult.mock.calls[0]![0] as SDKResultMessage).subtype,
    ).toBe('error_during_execution');
  });

  // ── ql-20260825-f3#6：业务回调异常隔离（不得当 query 错误杀整会话）──────────

  it('onResult 回调 reject → 记日志继续迭代，后续消息照常分发，onError 不触发', async () => {
    const sessionId = 's3';
    const q = makeFakeQuery([
      resultSuccess('R1', sessionId),
      assistantText('after-failed-result'),
      resultSuccess('R2', sessionId),
    ]);
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onResult = vi.fn(async (m: SDKResultMessage) => {
        if (m.result === 'R1') throw new Error('business bug');
      });
      const onMessage = vi.fn();
      const onError = vi.fn();
      const driver = new ClaudeSdkDriver();
      await driver.consume(handle, {
        onTurnResult: onResult,
        onTurnMessage: onMessage,
        onTurnError: onError,
      });

      // 修复点：回调异常只影响那一条消息——迭代继续（修复前：中断迭代进
      // onError → SessionManager fail() → 整会话 terminated + 杀子进程）。
      expect(onResult).toHaveBeenCalledTimes(2);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[claude-sdk-driver] onResult callback failed (iteration continues)',
        'success',
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('onTurnMessage 回调 reject → 记日志继续迭代，后续 result 照常分发', async () => {
    const sessionId = 's4';
    const q = makeFakeQuery([
      assistantText('boom-msg'),
      resultSuccess('R-after', sessionId),
    ]);
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onMessage = vi.fn(async () => {
        throw new Error('message handler bug');
      });
      const onResult = vi.fn();
      const onError = vi.fn();
      const driver = new ClaudeSdkDriver();
      await driver.consume(handle, {
        onTurnResult: onResult,
        onTurnMessage: onMessage,
        onTurnError: onError,
      });

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onResult).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[claude-sdk-driver] onTurnMessage callback failed (iteration continues)',
        'assistant',
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('迭代器本身抛错仍走 onTurnError（异常隔离不吞 query 错误）', async () => {
    const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
      yield assistantText('ok');
      throw new Error('query died');
    })();
    const q = {
      [Symbol.asyncIterator]: () => gen,
      interrupt: vi.fn(),
    } as unknown as Query;
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;
    const onMessage = vi.fn();
    const onError = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnMessage: onMessage, onTurnError: onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('query died');
    expect(onMessage).toHaveBeenCalledTimes(1);
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

// ── task-06：consume envelope 轨（TurnMessageEnvelope + 归一化器接入）──────────

describe('ClaudeSdkDriver.consume envelope 轨（task-06 / FR-02 / D-002@v1）', () => {
  /** 经 start() 取真实 handle（start 时实例化 normalizer/partialSink），mock 流吐给定消息。 */
  async function startWithMessages(
    messages: SDKMessage[],
  ): Promise<ClaudeDriverHandle> {
    fsExists.mockReturnValue(true);
    setMockQueryImpl(() => makeFakeQuery(messages));
    const driver = new ClaudeSdkDriver();
    return driver.start(
      { [Symbol.asyncIterator]: () => (async function* () {})() },
      { pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe', cwd: 'C:\\work' },
    );
  }

  afterEach(() => {
    // 调试开关测试用后清理，绝不外溢影响其它 case。
    delete process.env.SILLYHUB_DEBUG_RAW_EVENTS;
  });

  it('session-init-status fixture：envelope.events 全过 safeParseAgentEvent；raw 默认 undefined', async () => {
    const messages = await loadMessages('session-init-status');
    const handle = await startWithMessages(messages);

    const onTurnMessage = vi.fn();
    const onTurnResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnResult, onTurnMessage });

    expect(onTurnMessage).toHaveBeenCalled();
    const envelopes = onTurnMessage.mock.calls
      .map((c) => c[0] as TurnMessageEnvelope | Record<string, unknown>)
      .filter(isEnvelope);
    expect(envelopes.length).toBeGreaterThan(0);
    const all = envelopes.flatMap((env) => env.events);
    for (const env of envelopes) {
      // raw 仅调试开关携带（D-002@v1），默认必须缺席。
      expect(env.raw).toBeUndefined();
      for (const ev of env.events) {
        expect(safeParseAgentEvent(ev).success).toBe(true);
      }
    }

    // system/init（主 agent）→ status/session_started（含 session_id）；
    // 第 9 帧子代理 init（parent_tool_use_id=toolu_task01）守卫丢弃，不产事件。
    const started = all.filter(
      (e) => e.type === 'status' && e.subtype === 'session_started',
    );
    expect(started).toHaveLength(1);
    expect(started[0]!.session_id).toBe('sess-sample-0002');
    // task_* / thinking_tokens 会话信号事件化（D-002@v1 / D-005@v1）。
    expect(all.some((e) => e.subtype === 'agent_task_status')).toBe(true);
    expect(all.some((e) => e.subtype === 'task_notification')).toBe(true);
    expect(all.some((e) => e.subtype === 'thinking_tokens')).toBe(true);
    // local_command（静默丢弃帧）不产事件——间接触发它的帧若上报会带 error 事件，断言无。
    expect(all.some((e) => e.type === 'error')).toBe(false);
    // result 帧不经 onTurnMessage（独立 onTurnResult 链路）。
    expect(
      all.some((e) => e.type === 'turn_result' || e.type === 'complete'),
    ).toBe(false);
    expect(onTurnResult).toHaveBeenCalledTimes(1);
  });

  it('onTurnResult 收映射后的 InteractiveDriverResult：usage 短名统一（全名剔除，task-08）+ session_id', async () => {
    const messages = [assistantText('x'), resultSuccess('R', 'sess-map')];
    const handle = await startWithMessages(messages);
    const onTurnResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnResult });

    expect(onTurnResult).toHaveBeenCalledTimes(1);
    const r = onTurnResult.mock.calls[0]![0] as InteractiveDriverResult;
    expect(r.session_id).toBe('sess-map');
    expect(r.subtype).toBe('success');
    expect(r.is_error).toBe(false);
    // resultSuccess helper 的 usage 四字段全 1/0——映射后短名等值。
    const usage = r.usage!;
    expect(usage.input_tokens).toBe(1);
    expect(usage.output_tokens).toBe(1);
    // task-08 收口：InteractiveDriverResult.usage 双命名统一短名——Anthropic 全名
    // cache_*_input_tokens 映射为短名后**剔除**（daemon.onTurnResult 消费面已同步
    // 改读短名；daemon.ts usage lift 同口径）。
    expect(usage).not.toHaveProperty('cache_read_input_tokens');
    expect(usage).not.toHaveProperty('cache_creation_input_tokens');
    expect(usage.cache_read_tokens).toBe(0);
    expect(usage.cache_creation_tokens).toBe(0);
  });

  it('SILLYHUB_DEBUG_RAW_EVENTS=1：每个非 result 帧都上报 envelope，raw 为原消息对象（身份对应）', async () => {
    process.env.SILLYHUB_DEBUG_RAW_EVENTS = '1';
    const messages = await loadMessages('session-init-status');
    const handle = await startWithMessages(messages);

    const onTurnMessage = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnResult: vi.fn(), onTurnMessage });

    const envelopes = onTurnMessage.mock.calls
      .map((c) => c[0] as TurnMessageEnvelope | Record<string, unknown>)
      .filter(isEnvelope);
    // 调试开启：0 事件帧（local_command/子代理 init 等）也上报——raw 调试通道帧级可见。
    const nonResult = messages.filter(
      (m) => (m as { type?: string }).type !== 'result',
    );
    expect(envelopes).toHaveLength(nonResult.length);
    envelopes.forEach((env, i) => {
      // toBe 身份断言：raw 就是 SDK 吐出的原对象（非拷贝）。
      expect(env.raw).toBe(nonResult[i]);
    });
    // 事件仍全过 zod（调试开关不影响归一化产物）。
    for (const env of envelopes) {
      for (const ev of env.events) {
        expect(safeParseAgentEvent(ev).success).toBe(true);
      }
    }
  });

  it('partial-stream-override fixture：partial flush 先行、override 撤回在后，事件全过 zod', async () => {
    const messages = await loadMessages('partial-stream-override');
    const handle = await startWithMessages(messages);

    const onTurnMessage = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, { onTurnResult: vi.fn(), onTurnMessage });

    const envelopes = onTurnMessage.mock.calls
      .map((c) => c[0] as TurnMessageEnvelope | Record<string, unknown>)
      .filter(isEnvelope);
    const all = envelopes.flatMap((env) => env.events);

    // message_stop 边界 flush 同步经 partialSink 桥转发：thinking + text 两段 partial。
    const partials = all.filter((e) => e.is_partial === true);
    expect(partials.length).toBeGreaterThanOrEqual(2);
    for (const p of partials) {
      expect(typeof p.segment_id).toBe('string');
      expect(p.segment_id!.length).toBeGreaterThan(0);
    }
    // 完整 assistant 到达 → override:true 撤回已 flush partial（D-004@v1）。
    const overrides = all.filter((e) => e.override === true);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    for (const ov of overrides) {
      const firstPartialIdx = all.findIndex(
        (e) => e.is_partial === true && e.segment_id === ov.segment_id,
      );
      expect(firstPartialIdx).toBeGreaterThanOrEqual(0);
      // 顺序契约：同 segment 的 partial 先于 override（envelope 按上报顺序展平）。
      expect(all.indexOf(ov)).toBeGreaterThan(firstPartialIdx);
    }
    // partial envelope 不携带 raw（节流/边界 flush 无对应完整帧语义，默认关）。
    for (const env of envelopes) {
      expect(env.raw).toBeUndefined();
      for (const ev of env.events) {
        expect(safeParseAgentEvent(ev).success).toBe(true);
      }
    }
  });

  it('双轨读键：新键 onTurnMessage 存在时旧键 onMessage 不调用（SessionManager 双键形态）', async () => {
    // 手构 handle（不带 normalizer/partialSink）→ 覆盖 consume 懒建归一化器路径。
    const q = makeFakeQuery([
      systemInit('s1'),
      assistantText('hi'),
      resultSuccess('R', 's1'),
    ]);
    const handle = { provider: 'claude', query: q } as ClaudeDriverHandle;

    const onTurnMessage = vi.fn();
    const onMessage = vi.fn();
    const onTurnResult = vi.fn();
    const onResult = vi.fn();
    const driver = new ClaudeSdkDriver();
    await driver.consume(handle, {
      onTurnResult,
      onTurnMessage,
      onResult,
      onMessage,
    });

    // 新键优先：消息轨只走 onTurnMessage（envelope），result 轨只走 onTurnResult。
    expect(onTurnMessage).toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onTurnResult).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    // 懒建归一化器同样产合法 envelope。
    const envelopes = onTurnMessage.mock.calls
      .map((c) => c[0] as TurnMessageEnvelope | Record<string, unknown>)
      .filter(isEnvelope);
    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) {
      for (const ev of env.events) {
        expect(safeParseAgentEvent(ev).success).toBe(true);
      }
    }
  });
});
