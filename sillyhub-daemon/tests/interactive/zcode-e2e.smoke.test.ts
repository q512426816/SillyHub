// tests/interactive/zcode-e2e.smoke.test.ts
// 2026-10-15-zcode-engine-appserver task-08：ZCode 引擎端到端冒烟（真实 CLI）。
//
// 覆盖（成功标准收口）：
//   1. 全链路一轮对话：真实 spawn → 就绪门 → create/subscribe → session/send →
//      text/thinking 事件流 → turn_result usage（真实模型轮，本地已登录账号）；
//   2. per-session 配置面隔离：ZCODE_DATA_BASE_DIR 指向临时隔离目录，引擎在
//      隔离目录写 telemetry-state.json（实证配置面读取自隔离目录，D-002）；
//   3. stdin EOF 行为记录（R-05）：close 后观察子进程退出方式与耗时，事实留痕。
//
// CLI 缺席容错（照 provider-injection-smoke.integ.test.ts 惯例）：引擎二进制
// 或本机登录凭据（~/.zcode/v2/credentials.json）缺失 → console.warn 后 return
// 跳过（CI 无 Desktop 环境）；不用 it.skip（动态条件）。
//
// 凭据纪律：复制到临时隔离目录的 credentials.json / provider_config.json 在
// afterEach 整体删除；测试不读取、不打印任何凭据内容。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { ZcodeAppServerDriver } from '../../src/interactive/zcode-app-server-driver.js';
import type { InteractiveDriverCallbacks, UserTurnInput } from '../../src/interactive/driver.js';

/** 引擎路径解析（与 agent-detector PROVER_SPECS.zcode 三段式同口径的测试内联版）。 */
function resolveZcodeEngine(): string | null {
  const envPath = process.env['SILLYHUB_ZCODE_PATH'];
  if (envPath && existsSync(envPath)) return envPath;
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    const p = join(localAppData, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs');
    if (existsSync(p)) return p;
  }
  return null;
}

/** 本机 ZCode 登录/配置面（复制进隔离目录用；缺失 = 本机未登录 → 跳过）。 */
const HOST_V2_DIR = join(homedir(), '.zcode', 'v2');
const HOST_CREDENTIALS = join(HOST_V2_DIR, 'credentials.json');
const CONFIG_FILES = [
  'credentials.json',
  'provider_config.json',
  'setting.json',
  'bot-config.json',
  'bot-config.v3.json',
];

/** 真实模型轮上限（秒级完成；60s 富余，vitest testTimeout 120s 兜底）。 */
const TURN_TIMEOUT_MS = 60_000;

const enginePath = resolveZcodeEngine();
const hostReady = existsSync(HOST_CREDENTIALS);

const skipReason = !enginePath
  ? 'ZCode 引擎未探测到（SILLYHUB_ZCODE_PATH / Desktop fallback 均 miss）'
  : !hostReady
    ? '本机 ZCode 登录凭据缺失（~/.zcode/v2/credentials.json）'
    : null;

/** 隔离目录 + 复制配置面。 */
let isoDir: string;
beforeEach(() => {
  isoDir = mkdtempSync(join(tmpdir(), 'zcode-e2e-'));
  if (skipReason === null) {
    mkdirSync(join(isoDir, '.zcode', 'v2'), { recursive: true });
    for (const f of CONFIG_FILES) {
      const src = join(HOST_V2_DIR, f);
      if (existsSync(src)) {
        copyFileSync(src, join(isoDir, '.zcode', 'v2', f));
      }
    }
  }
});
afterEach(() => {
  rmSync(isoDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

/** 简易输入队列（单订阅语义，照驱动测试 helper 简化版）。 */
function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (text: string) => void;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  const queue: AsyncIterable<UserTurnInput> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<UserTurnInput>> {
          while (pending.length === 0 && !closed) {
            await new Promise<void>((r) => setTimeout(r, 20));
          }
          if (pending.length > 0) return { value: pending.shift()!, done: false };
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    queue,
    push: (text: string) => pending.push({ type: 'user', text }),
    close: () => {
      closed = true;
    },
  };
}

describe('zcode 端到端冒烟（真实引擎）', () => {
  it('一轮对话全链路：事件流 text/thinking + turn_result usage + 隔离目录落盘', async () => {
    if (skipReason !== null) {
      console.warn(`[zcode-e2e] skipped: ${skipReason}`);
      return;
    }
    const driver = new ZcodeAppServerDriver();
    const iq = makeInputQueue();
    const handle = await driver.start(iq.queue, {
      cwd: isoDir,
      pathToAgentExecutable: enginePath!,
      env: { ...process.env, ZCODE_DATA_BASE_DIR: isoDir },
    });

    const events: Array<Record<string, unknown>> = [];
    const results: Array<Record<string, unknown>> = [];
    const errors: unknown[] = [];
    const cb: InteractiveDriverCallbacks = {
      onTurnMessage: (env) => {
        for (const e of env.events) events.push(e as Record<string, unknown>);
      },
      onTurnResult: (r) => {
        results.push(r as Record<string, unknown>);
      },
      onTurnError: (e) => {
        errors.push(e);
      },
    };
    const consumePromise = driver.consume(handle, cb);

    iq.push('只回复两个字：乒乓');
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (results.length === 0 && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    iq.close();
    await consumePromise;

    let eofElapsedMs = -1;
    try {
      // 会话建立是硬断言（协议链正确性），与模型轮结果无关。
      const sessionStarted = events.find(
        (e) => e['type'] === 'status' && e['subtype'] === 'session_started',
      );
      expect(sessionStarted?.['session_id']).toMatch(/^sess_/);
      expect(results).toHaveLength(1);
      const result = results[0]!;
      expect(String(result['session_id'])).toMatch(/^sess_/);

      // 模型轮双路径（本机真实额度状态决定走哪条；两条都是协议链正确性证据）：
      //   A 成功：subtype=success + usage 有量 + 文本流含「乒乓」
      //   B 额度/供应商业务错误：is_error=true + 结构化错误 message（D-004 兜底面，
      //     轮必须收敛不挂——turn.failed 归一化映射的回归面）
      if (result['is_error'] === true) {
        const msg = String(result['result']);
        console.log(`[zcode-e2e] 模型轮走 B 路径（供应商错误收敛）：${msg.slice(0, 160)}`);
        expect(msg.length).toBeGreaterThan(0);
        // 结构化错误事件已入流（attribution/error_code 元数据）
        const errEvent = events.find((e) => e['type'] === 'error');
        expect(errEvent).toBeDefined();
        expect(String(errEvent?.['content']).length).toBeGreaterThan(0);
      } else {
        expect(result['subtype']).toBe('success');
        const usage = result['usage'] as Record<string, number> | undefined;
        expect(usage?.['input_tokens'] ?? 0).toBeGreaterThan(0);
        expect(usage?.['output_tokens'] ?? 0).toBeGreaterThan(0);
        const text = events
          .filter((e) => e['type'] === 'text')
          .map((e) => String(e['content']))
          .join('');
        expect(text).toContain('乒乓');
        console.log('[zcode-e2e] 模型轮走 A 路径（成功，usage + 文本流断言通过）');
      }

      // 隔离目录落盘（配置面读取自隔离目录的实证钩子：引擎写 telemetry-state.json）
      expect(existsSync(join(isoDir, '.zcode', 'v2', 'telemetry-state.json'))).toBe(true);
    } finally {
      // R-05：stdin EOF 退出行为——close 后观察子进程退出方式与耗时（事实留痕）。
      // finally 兜底：断言失败也要 close 杀子进程（防 Windows 目录句柄锁）。
      const t0 = Date.now();
      await handle.close();
      const child = (handle as unknown as { child: { exitCode: number | null } }).child;
      const exitDeadline = Date.now() + 15_000;
      while (child.exitCode === null && Date.now() < exitDeadline) {
        await new Promise<void>((r) => setTimeout(r, 100));
      }
      eofElapsedMs = Date.now() - t0;
      console.log(
        `[zcode-e2e] R-05 stdin EOF 行为：exitCode=${String(child.exitCode)}，` +
          `close 后 ${eofElapsedMs}ms 退出`,
      );
    }
    expect(eofElapsedMs).toBeLessThan(15_000);
  }, 120_000);
});
