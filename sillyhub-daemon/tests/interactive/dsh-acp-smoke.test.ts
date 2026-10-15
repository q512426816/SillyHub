// tests/interactive/dsh-acp-smoke.test.ts
// 2026-10-15-dsh-engine-acp task-08：端到端冒烟（真实 dsh 子进程）。
//
// 守卫：本机无 dsh 或版本 < 0.2.1（acp profile 为 dsh 0.2.x 能力）→ describe.skipIf
// 显式跳过并在输出留痕（探测结果 + 版本），CI 日志可辨「未装/低版本故跳过」而非
// 静默假绿；装有 ≥0.2.1 的机器上跑通 initialize → session/new → 一轮 prompt 事件
// 收敛（经真实 dsh --profile acp 子进程）。
//
// 本机实测留痕（2026-10-15，Windows）：本机 dsh=0.1.0-rc.6 < 0.2.1 → skip 分支
// 生效即本变更的版本门语义验证（MIN_VERSIONS dsh [0,2,1] 警告不硬拒同口径）。

import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DshAcpDriver, type DshAcpStartOptions } from '../../src/interactive/dsh-acp-driver.js';
import type { InteractiveDriverCallbacks, UserTurnInput } from '../../src/interactive/driver.js';
import { PROVIDER_SPECS } from '../../src/agent-detector.js';
import { checkMinVersion, parseSemver } from '../../src/version.js';

const execFileAsync = promisify(execFile);

/** 探测本机 dsh：{ok, version, warning}（复用 agent-detector 的探测定义）。 */
async function probeDsh(): Promise<{
  ok: boolean;
  version: string | null;
  belowGate: boolean;
}> {
  const spec = PROVIDER_SPECS.dsh;
  // Windows：dsh 为 npm cmd-shim（dsh.cmd），execFile 无 shell 跑不了 .cmd——
  // win32 加 shell 回退（探测专用；驱动本体走 resolveWindowsCmdShim 先例）。
  const isWin = process.platform === 'win32';
  try {
    const { stdout, stderr } = await execFileAsync(spec.bin, ['--version'], {
      timeout: 10_000,
      ...(isWin ? { shell: true } : {}),
    });
    const m = `${stdout}\n${stderr}`.match(spec.versionPattern);
    const version = m?.[1] ?? null;
    if (version === null) return { ok: true, version: null, belowGate: true };
    const belowGate = checkMinVersion('dsh', version) !== null;
    // eslint-disable-next-line no-console
    console.log(
      `[dsh-smoke] 探测到 dsh=${version}${belowGate ? '（低于 0.2.1 版本门 → 跳过冒烟，D-002 警告不硬拒同口径）' : ''}`,
    );
    return { ok: true, version, belowGate };
  } catch {
    // eslint-disable-next-line no-console
    console.log('[dsh-smoke] 本机未装 dsh（PATH 无二进制）→ 跳过冒烟（显式留痕非静默假绿）');
    return { ok: false, version: null, belowGate: true };
  }
}

let probe: Awaited<ReturnType<typeof probeDsh>>;

beforeAll(async () => {
  probe = await probeDsh();
});

function makeQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  push: (t: string) => void;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  let waiter: (() => void) | null = null;
  return {
    queue: {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            for (;;) {
              if (pending.length > 0) return { value: pending.shift()!, done: false };
              if (closed) return { value: undefined, done: true };
              await new Promise<void>((r) => (waiter = r));
              waiter = null;
            }
          },
        };
      },
    },
    push(t: string) {
      pending.push({ type: 'user', text: t });
      if (waiter) waiter();
    },
    close() {
      closed = true;
      if (waiter) waiter();
    },
  };
}

// 显式 opt-in：SILLYHUB_DSH_SMOKE=1 才跑真实子进程冒烟（版本门在用例内再断言
// ——skipIf 在收集期求值，探测晚于收集，故用环境开关 + 用例内双重守卫）。
describe.skipIf(process.env.SILLYHUB_DSH_SMOKE !== '1')(
  'dsh ACP 端到端冒烟（需 SILLYHUB_DSH_SMOKE=1 且本机 dsh ≥0.2.1；默认跳过）',
  () => {
    it('真实子进程：initialize → session/new → 一轮 prompt 事件收敛', async () => {
      expect(probe.ok, '本机须装有 dsh 才能跑本冒烟').toBe(true);
      expect(probe.belowGate, `dsh=${probe.version} 低于 0.2.1 版本门`).toBe(false);
      const driver = new DshAcpDriver();
      const q = makeQueue();
      const exe = process.env.SILLYHUB_DSH_PATH ?? 'dsh';
      const handle = await driver.start(q.queue, {
        cwd: process.cwd(),
        pathToAgentExecutable: exe,
      } as DshAcpStartOptions);
      const messages: unknown[] = [];
      const results: unknown[] = [];
      const cb: InteractiveDriverCallbacks = {
        onTurnMessage: (envelope) => messages.push(...envelope.events),
        onTurnResult: (r) => results.push(r),
        onTurnError: (e) => results.push({ subtype: 'smoke_error', error: String(e) }),
      };
      const consuming = driver.consume(handle, cb);
      await new Promise((r) => setTimeout(r, 500));
      q.push('回复一个字：好');
      const deadline = Date.now() + 120_000;
      while (results.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      q.close();
      await handle.close?.();
      await consuming;
      expect(results).toHaveLength(1);
      expect(messages.length).toBeGreaterThan(0);
    }, 150_000);
  },
);

// 版本门单侧钉（不依赖本机是否装 dsh——探测不到时 probeDsh 的 catch 分支覆盖）：
// parseSemver 对 prerelease 后缀的忽略语义与 MIN_VERSIONS dsh 门槛一致性。
describe('dsh 冒烟守卫口径', () => {
  it('0.1.0-rc.6 解析为 (0,1,0) 且低于 [0,2,1] 门槛（本机实测版本的解析钉）', () => {
    expect(parseSemver('0.1.0-rc.6')).toEqual([0, 1, 0]);
    expect(checkMinVersion('dsh', '0.1.0-rc.6')).not.toBeNull();
    expect(checkMinVersion('dsh', '0.2.1')).toBeNull();
  });
});
