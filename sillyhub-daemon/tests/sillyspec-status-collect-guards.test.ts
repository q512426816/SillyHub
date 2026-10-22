// FR-02/03/04（2026-10-21-daemon-sync-hardening）：status 采集治理测试。
//
//   - FR-02：SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖采集超时（合法生效 /
//     非法回退默认 30s / deps 注入优先于 env）。
//   - FR-03：连败退避——同一目标连败 3 次后每 10 轮只实采 1 轮，成功复位，
//     首次进入退避 warn 恰一次。
//   - FR-04：crossrepo 标记（.git/sillyspec-crossrepo.json）目标跳过 spawn、
//     一次性 info 指路、不记失败、标记删除后恢复采集。
//
// 策略：纯函数直测 + manager 全依赖注入（resolveSillySpecBin / runProgressJson /
// statusTargets / logger 假实现，零真实 spawn），对齐 sillyspec-manager.test.ts 惯例。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SillySpecManager,
  SILLYSPEC_STATUS_TIMEOUT_MS,
  parseStatusTimeoutMsEnv,
  shouldSkipStatusCollect,
  STATUS_COLLECT_BACKOFF_GRACE_FAILS,
  STATUS_COLLECT_BACKOFF_EVERY_N,
} from '../src/sillyspec-manager.js';
import type {
  SillySpecProgressOutcome,
  SillySpecStatusTarget,
} from '../src/sillyspec-manager.js';

const TIMEOUT_ENV = 'SILLYHUB_DAEMON_STATUS_TIMEOUT_MS';

// ── FR-02：env 覆盖解析（纯函数） ─────────────────────────────────────────────

describe('parseStatusTimeoutMsEnv', () => {
  it('正整数毫秒生效', () => {
    expect(parseStatusTimeoutMsEnv('120000')).toBe(120000);
    expect(parseStatusTimeoutMsEnv(' 3000 ')).toBe(3000);
  });
  it('缺席/空白/非数字/非正/非整数回退 null（由调用方落默认）', () => {
    expect(parseStatusTimeoutMsEnv(undefined)).toBeNull();
    expect(parseStatusTimeoutMsEnv('')).toBeNull();
    expect(parseStatusTimeoutMsEnv('   ')).toBeNull();
    expect(parseStatusTimeoutMsEnv('abc')).toBeNull();
    expect(parseStatusTimeoutMsEnv('-1')).toBeNull();
    expect(parseStatusTimeoutMsEnv('0')).toBeNull();
    expect(parseStatusTimeoutMsEnv('12.5')).toBeNull();
  });
});

// ── FR-03：退避判定（纯函数） ────────────────────────────────────────────────

describe('shouldSkipStatusCollect', () => {
  it('连败未达宽限不跳过', () => {
    expect(shouldSkipStatusCollect(0, 1)).toBe(false);
    expect(shouldSkipStatusCollect(STATUS_COLLECT_BACKOFF_GRACE_FAILS - 1, 4)).toBe(false);
  });
  it('达宽限后非取模轮跳过、取模轮实采', () => {
    expect(shouldSkipStatusCollect(3, 4)).toBe(true);
    expect(shouldSkipStatusCollect(3, 9)).toBe(true);
    expect(shouldSkipStatusCollect(3, STATUS_COLLECT_BACKOFF_EVERY_N)).toBe(false);
    expect(shouldSkipStatusCollect(5, 20)).toBe(false);
  });
});

// ── harness（全依赖注入，零真实 spawn） ───────────────────────────────────────

let tmpRoot = '';
const savedTimeoutEnv: string | undefined = process.env[TIMEOUT_ENV];

beforeEach(() => {
  delete process.env[TIMEOUT_ENV];
  tmpRoot = mkdtempSync(join(tmpdir(), 'status-guards-'));
});

afterEach(() => {
  if (savedTimeoutEnv === undefined) delete process.env[TIMEOUT_ENV];
  else process.env[TIMEOUT_ENV] = savedTimeoutEnv;
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface LogEntry {
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

/** 构造 manager：假 runner 按 calls[] 顺序产出 outcome，记录每次实参。 */
function makeManager(opts: {
  outcomes: SillySpecProgressOutcome[];
  runnerOptions: Array<{ cwd: string; timeoutMs: number }>;
  logs: LogEntry[];
  targets: () => SillySpecStatusTarget[];
  statusTimeoutMs?: number;
}): SillySpecManager {
  return new SillySpecManager({
    isBusy: () => false,
    resolveSillySpecBin: () => 'fake-sillyspec-bin',
    statusTargets: opts.targets,
    ...(opts.statusTimeoutMs !== undefined ? { statusTimeoutMs: opts.statusTimeoutMs } : {}),
    logger: (level, msg, data) => {
      opts.logs.push({ level, msg, data });
    },
    runProgressJson: async (file, args, options) => {
      opts.runnerOptions.push({ cwd: options.cwd, timeoutMs: options.timeoutMs });
      const next = opts.outcomes.shift();
      if (next === undefined) throw new Error('runner exhausted');
      return next;
    },
  });
}

const failOutcome = (): SillySpecProgressOutcome => ({
  code: 2,
  stdout: '',
  timedOut: false,
  stderr: 'boom',
});
const okOutcome = (): SillySpecProgressOutcome => ({
  code: 0,
  stdout: '{}',
  timedOut: false,
});

// ── FR-02：manager 级 env 覆盖 ───────────────────────────────────────────────

describe('FR-02 status 采集超时 env 覆盖', () => {
  it('env 合法生效 / 非法回退默认 / deps 注入优先于 env', async () => {
    const runnerOptions: Array<{ cwd: string; timeoutMs: number }> = [];
    const logs: LogEntry[] = [];
    const targets = () => [{ workspaceId: 'ws-t', rootPath: tmpRoot }];

    // env 合法：timeoutMs = 120000。
    process.env[TIMEOUT_ENV] = '120000';
    let outcomes = [okOutcome()];
    let mgr = makeManager({ outcomes, runnerOptions, logs, targets });
    await mgr.collectStatusOnce();
    expect(runnerOptions[0]?.timeoutMs).toBe(120000);

    // env 非法：回退默认 30_000。
    runnerOptions.length = 0;
    process.env[TIMEOUT_ENV] = 'abc';
    outcomes = [okOutcome()];
    mgr = makeManager({ outcomes, runnerOptions, logs, targets });
    await mgr.collectStatusOnce();
    expect(runnerOptions[0]?.timeoutMs).toBe(SILLYSPEC_STATUS_TIMEOUT_MS);
    expect(SILLYSPEC_STATUS_TIMEOUT_MS).toBe(30_000);

    // deps 注入优先于 env。
    runnerOptions.length = 0;
    process.env[TIMEOUT_ENV] = '120000';
    outcomes = [okOutcome()];
    mgr = makeManager({ outcomes, runnerOptions, logs, targets, statusTimeoutMs: 5_000 });
    await mgr.collectStatusOnce();
    expect(runnerOptions[0]?.timeoutMs).toBe(5_000);
  });
});

// ── FR-03：连败退避 ──────────────────────────────────────────────────────────

describe('FR-03 status 采集连败退避', () => {
  it('连败 3 次进入退避：第 4~9 轮跳过、第 10 轮实采，warn 恰一次', async () => {
    const runnerOptions: Array<{ cwd: string; timeoutMs: number }> = [];
    const logs: LogEntry[] = [];
    // 4 次实采机会（轮 1/2/3/10）全失败——runner 只会被取 4 次。
    const outcomes = [failOutcome(), failOutcome(), failOutcome(), failOutcome()];
    const mgr = makeManager({
      outcomes,
      runnerOptions,
      logs,
      targets: () => [{ workspaceId: 'ws-b', rootPath: tmpRoot }],
    });
    for (let round = 1; round <= 10; round++) {
      await mgr.collectStatusOnce();
    }
    expect(runnerOptions).toHaveLength(4);
    const entered = logs.filter((l) => l.msg === 'sillyspec_status_backoff_entered');
    expect(entered).toHaveLength(1);
    expect(entered[0]?.data?.['streak']).toBe(STATUS_COLLECT_BACKOFF_GRACE_FAILS);
  });

  it('实采成功复位：复位后每轮都实采，重新失败不立即退避', async () => {
    const runnerOptions: Array<{ cwd: string; timeoutMs: number }> = [];
    const logs: LogEntry[] = [];
    // 轮 1/2/3 失败 → 轮 4~9 跳过 → 轮 10 成功（复位）→ 轮 11/12 实采失败。
    const outcomes = [
      failOutcome(),
      failOutcome(),
      failOutcome(),
      okOutcome(),
      failOutcome(),
      failOutcome(),
    ];
    const mgr = makeManager({
      outcomes,
      runnerOptions,
      logs,
      targets: () => [{ workspaceId: 'ws-r', rootPath: tmpRoot }],
    });
    for (let round = 1; round <= 12; round++) {
      await mgr.collectStatusOnce();
    }
    // 实采轮：1/2/3/10/11/12 = 6 次（轮 4~9 退避跳过）。
    expect(runnerOptions).toHaveLength(6);
    // 复位后重败 2 次未再触发退避（streak 从 1 重计）。
    expect(logs.filter((l) => l.msg === 'sillyspec_status_backoff_entered')).toHaveLength(1);
  });
});

// ── FR-04：crossrepo 标记跳过 ────────────────────────────────────────────────

describe('FR-04 crossrepo 登记根跳过', () => {
  it('跳过 spawn、一次性 info 指路、不记失败；标记删除后恢复采集', async () => {
    const crRoot = mkdtempSync(join(tmpdir(), 'status-crossrepo-'));
    try {
      mkdirSync(join(crRoot, '.git'), { recursive: true });
      writeFileSync(
        join(crRoot, '.git', 'sillyspec-crossrepo.json'),
        JSON.stringify({ workspace: '/real/ws-root', key: 'sub', registeredAt: '2026-10-21T00:00:00Z' }) + '\n',
      );
      const runnerOptions: Array<{ cwd: string; timeoutMs: number }> = [];
      const logs: LogEntry[] = [];
      const mgr = makeManager({
        outcomes: [okOutcome()],
        runnerOptions,
        logs,
        targets: () => [{ workspaceId: 'ws-cr', rootPath: crRoot }],
      });

      // 轮 1：跳过（不 spawn、info 一次性、无失败账、摘要槽移除）。
      await mgr.collectStatusOnce();
      expect(runnerOptions).toHaveLength(0);
      expect(mgr.getStatusError()).toBeNull();
      expect(mgr.getStatusMapSnapshot()).toEqual({});
      const skips = logs.filter((l) => l.msg === 'sillyspec_status_skip_crossrepo');
      expect(skips).toHaveLength(1);
      expect(skips[0]?.level).toBe('info');
      expect(skips[0]?.data?.['workspace_root']).toBe('/real/ws-root');

      // 轮 2：仍跳过且不重复输出。
      await mgr.collectStatusOnce();
      expect(runnerOptions).toHaveLength(0);
      expect(logs.filter((l) => l.msg === 'sillyspec_status_skip_crossrepo')).toHaveLength(1);

      // 标记删除 → 恢复正常采集。
      rmSync(join(crRoot, '.git', 'sillyspec-crossrepo.json'));
      await mgr.collectStatusOnce();
      expect(runnerOptions).toHaveLength(1);
      expect(runnerOptions[0]?.cwd).toBe(crRoot);
    } finally {
      rmSync(crRoot, { recursive: true, force: true });
    }
  });
});
