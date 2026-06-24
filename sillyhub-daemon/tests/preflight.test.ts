// tests/preflight.test.ts
// 2026-06-24 preflight：启动前预检测试（sillyspec 版本检查 + daemon 自更新）。
//
// mock 策略：
//   - node:child_process.execSync → execMock（sillyspec 检查/安装走 execSync）
//   - globalThis.fetch → vi.stubGlobal（latest.json / bundle 下载）
//   - ../src/build-id.js BUILD_ID → 'abc1234'（让 runPreflight 内部走真实 daemon 更新分支，
//     而非 dev 跳过；runDaemonSelfUpdate 接受显式 buildId 参数，不受此 mock 影响）
//
// 覆盖场景：
//   sillyspec：未安装 / 过旧 / 最新 / 高于最新 / npm不可达 / 安装失败
//   daemon：dev跳过 / 版本一致 / 版本不一致(下载替换) / 服务器不可达 / 非2xx / 字段缺失 / 下载失败 / 尾斜杠
//   runPreflight 集成：两步隔离 + 同时失败不抛

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock('node:child_process', () => ({ execSync: execMock }));

// BUILD_ID mock：非 dev，使 runPreflight（内部用全局 BUILD_ID）走 daemon 更新分支。
vi.mock('../src/build-id.js', () => ({ BUILD_ID: 'abc1234' }));

import {
  runPreflight,
  runSillySpecCheck,
  runDaemonSelfUpdate,
} from '../src/preflight.js';
import type { DaemonConfig } from '../src/config.js';

// ── 共用辅助 ──────────────────────────────────────────────────────────────────

interface LogEntry {
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

/** 收集 (level,msg,data) 调用为 entries 数组，便于断言事件名/级别。 */
function makeLogger(): {
  fn: (level: string, msg: string, data?: Record<string, unknown>) => void;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  const fn = (
    level: string,
    msg: string,
    data?: Record<string, unknown>,
  ): void => {
    entries.push({ level, msg, data });
  };
  return { fn, entries };
}

function makeConfig(serverUrl = 'http://test:8000'): DaemonConfig {
  return {
    server_url: serverUrl,
    token: 'tok',
    api_key: null,
    runtime_id: 'rt-1',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 1,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: ['/tmp'],
    spec_root_map: '',
  };
}

/**
 * 按 URL 子串路由返回不同 Response 的 fetch 替身。
 * value 为 Response 则原样返回（bundle 等非 JSON）；否则 JSON.stringify 包成 200。
 */
function makeFetch(
  routes: Record<string, unknown | Response>,
): (url: string) => Promise<Response> {
  return async (url: string) => {
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const val = routes[key];
        if (val instanceof Response) return val;
        return new Response(JSON.stringify(val), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  };
}

function bundleResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

/** 统计 execMock 被「含 needle 的命令」调用次数。 */
function execCallsContaining(needle: string): number {
  return execMock.mock.calls.filter(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes(needle),
  ).length;
}

const tmpRoots: string[] = [];
function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'preflight-test-'));
  tmpRoots.push(d);
  return d;
}

beforeEach(() => {
  execMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  while (tmpRoots.length) {
    const d = tmpRoots.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 功能1：sillyspec 版本检查 ─────────────────────────────────────────────────

describe('runSillySpecCheck', () => {
  it('未安装（sillyspec --version 抛错）+ 最新可得 → 执行 npm install', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) throw new Error('not found');
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      if (cmd.includes('npm install')) return '';
      return '';
    });
    runSillySpecCheck(fn);
    expect(execCallsContaining('npm install -g sillyspec@latest')).toBe(1);
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_not_installed');
    expect(msgs).toContain('sillyspec_updated');
  });

  it('版本过旧（3.19.0 < 3.19.2）→ 执行 npm install', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.19.0\n';
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      return '';
    });
    runSillySpecCheck(fn);
    expect(execCallsContaining('npm install -g sillyspec@latest')).toBe(1);
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_outdated');
    expect(msgs).toContain('sillyspec_updated');
  });

  it('已是最新（3.19.2 == 3.19.2）→ 不安装', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.19.2\n';
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      return '';
    });
    runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    expect(entries.find((e) => e.msg === 'sillyspec_up_to_date')).toBeTruthy();
  });

  it('高于最新（3.20.0 > 3.19.2）→ 不安装（isOutdated=false）', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.20.0\n';
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      return '';
    });
    runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    expect(entries.find((e) => e.msg === 'sillyspec_up_to_date')).toBeTruthy();
  });

  it('npm view 不可达（抛错）→ warn 不安装', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.19.2\n';
      if (cmd.includes('npm view sillyspec version')) throw new Error('npm down');
      return '';
    });
    runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    const e = entries.find((x) => x.msg === 'sillyspec_latest_unavailable');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
  });

  it('npm install 失败 → 记 cmd_failed warn，不抛错、不记 sillyspec_updated', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.19.0\n';
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      if (cmd.includes('npm install')) throw new Error('EACCES');
      return '';
    });
    expect(() => runSillySpecCheck(fn)).not.toThrow();
    expect(entries.find((e) => e.msg === 'cmd_failed')?.level).toBe('warn');
    expect(entries.find((e) => e.msg === 'sillyspec_updated')).toBeFalsy();
  });

  it('非标准版本（无法 parseSemver）→ 字符串不等即视为旧 → 安装', () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      // 本地 dev 标签、最新也是非标准 → 字符串不等 → isOutdated=true
      if (cmd.includes('sillyspec --version')) return '3.19.2-rc.1\n';
      if (cmd.includes('npm view sillyspec version')) return '3.19.2\n';
      return '';
    });
    runSillySpecCheck(fn);
    // parseSemver('3.19.2-rc.1')=[3,19,2], parseSemver('3.19.2')=[3,19,2] → 相等 → 不旧
    // 此用例验证 prerelease 被忽略后视为相等，不安装。
    expect(execCallsContaining('npm install')).toBe(0);
    expect(entries.find((e) => e.msg === 'sillyspec_up_to_date')).toBeTruthy();
  });
});

// ── 功能2：daemon 自更新 ───────────────────────────────────────────────────────

describe('runDaemonSelfUpdate', () => {
  it('dev 构建（buildId=dev）→ 跳过，不访问网络', async () => {
    const { fn, entries } = makeLogger();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await runDaemonSelfUpdate('dev', makeConfig(), fn);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      entries.find((e) => e.msg === 'daemon_self_update_skip_dev_build'),
    ).toBeTruthy();
  });

  it('版本一致（latest.version == buildId）→ 只拉 latest.json，不下载', async () => {
    const { fn, entries } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'abc1234', url: 'http://x/bundle.js' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    await runDaemonSelfUpdate('abc1234', makeConfig(), fn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain('/daemon/latest.json');
    expect(entries.find((e) => e.msg === 'daemon_up_to_date')).toBeTruthy();
  });

  it('版本不一致 → 下载 bundle 原子替换到 binDir，warn 提示重启', async () => {
    const binDir = makeTmpDir();
    const { fn, entries } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'def5678', url: 'http://x/bundle.js' },
        '/bundle.js': bundleResponse('NEW BUNDLE BODY'),
      }),
    );
    vi.stubGlobal('fetch', spy);
    await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(spy).toHaveBeenCalledTimes(2);
    const target = join(binDir, 'sillyhub-daemon.js');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('NEW BUNDLE BODY');
    const e = entries.find((x) => x.msg === 'daemon_self_updated_need_restart');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
    expect(e!.data).toMatchObject({ from: 'abc1234', to: 'def5678' });
    // tmp 文件已 rename，不残留
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('服务器不可达（fetch 抛错）→ warn 不崩，不下载', async () => {
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network down');
      }),
    );
    await expect(
      runDaemonSelfUpdate('abc1234', makeConfig(), fn),
    ).resolves.toBeUndefined();
    const e = entries.find((x) => x.msg === 'daemon_latest_fetch_failed');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
  });

  it('latest.json 非 2xx（500）→ warn 不下载', async () => {
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('err', { status: 500 }))),
    );
    await runDaemonSelfUpdate('abc1234', makeConfig(), fn);
    expect(
      entries.find((x) => x.msg === 'daemon_latest_fetch_non_ok'),
    ).toBeTruthy();
  });

  it('latest.json 字段缺失（无 url）→ warn 不下载', async () => {
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      makeFetch({ '/daemon/latest.json': { version: 'def5678' } }),
    );
    await runDaemonSelfUpdate('abc1234', makeConfig(), fn);
    expect(
      entries.find((x) => x.msg === 'daemon_latest_invalid_shape'),
    ).toBeTruthy();
  });

  it('bundle 下载失败（非 2xx）→ warn，不写文件', async () => {
    const binDir = makeTmpDir();
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': { version: 'def5678', url: 'http://x/bundle.js' },
        '/bundle.js': new Response('err', { status: 502 }),
      }),
    );
    await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(
      entries.find((x) => x.msg === 'daemon_bundle_download_non_ok'),
    ).toBeTruthy();
    expect(existsSync(join(binDir, 'sillyhub-daemon.js'))).toBe(false);
  });

  it('server_url 含尾斜杠 → 拼接去重（无 //）', async () => {
    const { fn } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'abc1234', url: 'http://x/bundle.js' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    await runDaemonSelfUpdate('abc1234', makeConfig('http://test:8000///'), fn);
    expect(String(spy.mock.calls[0]![0])).toBe(
      'http://test:8000/daemon/latest.json',
    );
  });
});

// ── runPreflight 集成（两步隔离）──────────────────────────────────────────────

describe('runPreflight 集成', () => {
  it('两步都执行且互不影响（sillyspec npm 不可达 + daemon 版本一致）', async () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('sillyspec --version')) return '3.19.2\n';
      if (cmd.includes('npm view sillyspec version')) throw new Error('down');
      return '';
    });
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': { version: 'abc1234', url: 'http://x/bundle.js' },
      }),
    );
    await expect(runPreflight(makeConfig(), fn)).resolves.toBeUndefined();
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_latest_unavailable');
    expect(msgs).toContain('daemon_up_to_date');
  });

  it('两步同时失败 → runPreflight 不抛，各自 warn', async () => {
    const { fn, entries } = makeLogger();
    execMock.mockImplementation(() => {
      throw new Error('exec down');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('net down');
      }),
    );
    await expect(runPreflight(makeConfig(), fn)).resolves.toBeUndefined();
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_latest_unavailable');
    expect(msgs).toContain('daemon_latest_fetch_failed');
  });
});
