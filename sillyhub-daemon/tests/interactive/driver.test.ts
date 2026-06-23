// tests/interactive/driver.test.ts
// task-01：provider-neutral InteractiveDriver 契约测试（D-001@v1, D-009@v1）。
//
// 覆盖（design §5.1 + task-01 TDD 步骤1）：
//   - 类型层断言：UserTurnInput 结构、InteractiveDriver 契约可被 fake 实现、
//     InputQueue<UserTurnInput> 行为。
//   - 运行层最小流程：fake driver start → consume → interrupt，断言回调被调用。
//
// 本测试不连任何真实 provider SDK；driver.ts 是纯类型文件，此处只验证契约成立 +
// 一个内存 fake driver 跑通 start/consume/interrupt 三段生命周期。

import { describe, it, expect } from 'vitest';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverResult,
  InteractiveDriverStartOptions,
  InteractiveDriverMessage,
  InteractiveProvider,
  UserTurnInput,
} from '../../src/interactive/driver.js';

// ── 类型层断言（编译期：若契约结构改变，tsc 会报错） ──────────────────────────

/** UserTurnInput 必须是 { type:'user'; text:string }。 */
const _sampleUserTurnInput: UserTurnInput = { type: 'user', text: 'hi' };

/** InteractiveProvider 固定 'claude' | 'codex'。 */
const _sampleProvider: InteractiveProvider = 'codex';
void _sampleProvider;

/** InteractiveDriverMessage 是 Record<string, unknown>（宽松鸭子类型）。 */
const _sampleMsg: InteractiveDriverMessage = { event_type: 'text', content: 'x' };
void _sampleMsg;

/** InteractiveDriverResult 字段全可选、宽松。 */
const _sampleResult: InteractiveDriverResult = {
  subtype: 'success',
  is_error: false,
  usage: { input_tokens: 10, output_tokens: 5 },
};
void _sampleResult;

/** InteractiveDriverHandle：provider 必填、processId 可选、close 可选。 */
const _sampleHandle: InteractiveDriverHandle = { provider: 'claude' };
void _sampleHandle;

/** InteractiveDriverStartOptions：cwd 必填、其余可选。 */
const _sampleStartOpts: InteractiveDriverStartOptions = {
  cwd: '/tmp/work',
  manualApproval: true,
  askUserOnly: false,
};
void _sampleStartOpts;

// ── fake driver：满足 InteractiveDriver 接口的最小内存实现 ─────────────────────

/**
 * FakeDriver：把 input AsyncIterable 里的每条 UserTurnInput 当作一条 turn，
 * 对每条 turn emit 一条 message + 一条 result（success）。interrupt 把
 * currentHandle 置 null 并标记 interrupted=true。
 *
 * 用于验证：
 *   1. InteractiveDriver 接口可被实现（契约成立，D-001@v1）；
 *   2. start→consume→interrupt 三段生命周期回调被正确触发；
 *   3. consume 在 input 队列自然结束后正常返回（turn 边界对齐 result）。
 */
class FakeDriver implements InteractiveDriver {
  interrupted = false;
  private _currentHandle: InteractiveDriverHandle | null = null;

  async start(
    input: AsyncIterable<UserTurnInput>,
    _options: InteractiveDriverStartOptions,
  ): Promise<InteractiveDriverHandle> {
    // fake：立即返回一个 handle，consume 时才真正消费 input。
    const handle: InteractiveDriverHandle = {
      provider: 'claude',
      processId: 12345,
      // close 释放语义（fake 无真实资源，仅标记）。
      close: () => {
        this._currentHandle = null;
      },
    };
    this._currentHandle = handle;
    // 把 input 闭包进 handle 的消费上下文（consume 复用）。
    (handle as InteractiveDriverHandle & { __input?: AsyncIterable<UserTurnInput> }).__input = input;
    return handle;
  }

  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const input = (handle as InteractiveDriverHandle & {
      __input?: AsyncIterable<UserTurnInput>;
    }).__input;
    if (!input) return;
    for await (const turn of input) {
      if (this.interrupted) {
        // interrupt 后：emit error result，停止消费（模拟 turn 级打断）。
        await callbacks.onTurnResult({
          subtype: 'error_during_execution',
          is_error: true,
          result: 'interrupted',
        });
        return;
      }
      // 每条 user turn：一条中间 message + 一条 success result。
      const msg: InteractiveDriverMessage = {
        event_type: 'text',
        content: `echo:${turn.text}`,
      };
      if (callbacks.onTurnMessage) {
        await callbacks.onTurnMessage(msg);
      }
      await callbacks.onTurnResult({ subtype: 'success', is_error: false });
    }
  }

  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (handle === null || this._currentHandle === null) return false;
    this.interrupted = true;
    return true;
  }
}

describe('InteractiveDriver 契约（driver.ts）', () => {
  it('InteractiveDriver 接口可被 fake 实现（D-001@v1 契约成立）', () => {
    const driver: InteractiveDriver = new FakeDriver();
    expect(typeof driver.start).toBe('function');
    expect(typeof driver.consume).toBe('function');
    expect(typeof driver.interrupt).toBe('function');
  });

  it('UserTurnInput 形态：{ type:"user", text:string }', () => {
    const u: UserTurnInput = { type: 'user', text: 'hello' };
    expect(u.type).toBe('user');
    expect(u.text).toBe('hello');
  });

  it('fake driver start→consume 完整跑通，回调按序触发', async () => {
    const driver = new FakeDriver();
    // 内存 input：两条 user turn 后结束。
    async function* gen(): AsyncIterable<UserTurnInput> {
      yield { type: 'user', text: 'q1' };
      yield { type: 'user', text: 'q2' };
    }
    const handle = await driver.start(gen(), { cwd: '/tmp' });

    const messages: InteractiveDriverMessage[] = [];
    const results: InteractiveDriverResult[] = [];
    const callbacks: InteractiveDriverCallbacks = {
      onTurnResult: (r) => {
        results.push(r);
      },
      onTurnMessage: (m) => {
        messages.push(m);
      },
    };

    await driver.consume(handle, callbacks);

    expect(messages.map((m) => m.content)).toEqual(['echo:q1', 'echo:q2']);
    expect(results).toHaveLength(2);
    expect(results[0]!.subtype).toBe('success');
    expect(results[0]!.is_error).toBe(false);
  });

  it('interrupt 返回 true 并使后续 turn 收敛为 error result', async () => {
    const driver = new FakeDriver();
    // input：两条 user turn。
    async function* gen(): AsyncIterable<UserTurnInput> {
      yield { type: 'user', text: 'first' };
      yield { type: 'user', text: 'second' };
    }
    const handle = await driver.start(gen(), { cwd: '/tmp' });

    const results: InteractiveDriverResult[] = [];
    const callbacks: InteractiveDriverCallbacks = {
      onTurnResult: (r) => {
        results.push(r);
      },
      // 首条 turn 处理完后注入中断（模拟 turn 进行中打断）。
      onTurnMessage: () => {
        if (results.length === 0) {
          // first turn 的 message 回调内触发 interrupt（标记位），
          // 使 second turn 收敛为 error。
          void driver.interrupt(handle);
        }
      },
    };

    await driver.consume(handle, callbacks);
    // first turn 正常 success，second turn 因 interrupted 收敛为 error。
    expect(results.map((r) => r.subtype)).toEqual([
      'success',
      'error_during_execution',
    ]);
    expect(results[1]!.is_error).toBe(true);
  });

  it('interrupt(null) 返回 false（无 active turn，no-op 不冒泡，E3）', async () => {
    const driver = new FakeDriver();
    const ok = await driver.interrupt(null);
    expect(ok).toBe(false);
  });

  it('handle.provider 必须是 provider union（E5：路由校验用）', async () => {
    const driver = new FakeDriver();
    async function* g(): AsyncIterable<UserTurnInput> {
      yield { type: 'user', text: 'x' };
    }
    const handle = await driver.start(g(), { cwd: '/tmp' });
    expect(handle.provider === 'claude' || handle.provider === 'codex').toBe(true);
  });
});
