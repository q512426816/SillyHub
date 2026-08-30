// tests/preflight.test.ts
// 2026-06-24 preflight：启动前预检测试（sillyspec 版本检查 + daemon 自更新）。
// 2026-08-30 daemon-self-heal task-04：fixture 合法化（validFakeBundle，D-006）+
// runPreflight 集成用例 binDir 一律临时目录 + 校验器/下载拦截/备份轮换/respawn
// 拦截新用例 + 真实 bin 目录 sha256 防污染回归（8-30 事故根因用例修正）。
//
// mock 策略：
//   - node:child_process.spawn → spawnMock（runWithTreeKill 用，sillyspec 检查/安装；respawn 拉起）
//   - globalThis.fetch → vi.stubGlobal（latest.json / bundle 下载）
//   - ../src/build-id.js BUILD_ID → 'abc1234'（让 runPreflight 内部走真实 daemon 更新分支，
//     而非 dev 跳过；runDaemonSelfUpdate 接受显式 buildId 参数，不受此 mock 影响）
//   - node:fs/promises 一律不 mock：写盘走真实文件系统，但 binDir 一律注入
//     mkdtempSync 临时目录（runPreflight 集成用例传第三参）——漏传 = 写真实
//     ~/.sillyhub/daemon/bin（8-30 事故根因）；真实目录全程只读（文件级
//     beforeAll/afterAll sha256 清单比对，见文件中部钩子）
//   - bundle fixture 一律 validFakeBundle(buildId)（≥64KB 且含 BUILD_ID，过
//     D-003 校验）；字面量占位文本（'NEW BUNDLE BODY'）只用于校验拦截负向用例
//
// 覆盖场景：
//   sillyspec：未安装 / 过旧 / 最新 / 高于最新 / npm不可达 / 安装失败
//   daemon：dev跳过 / 版本一致 / 版本不一致(下载替换) / 服务器不可达 / 非2xx / 字段缺失 / 下载失败 / 尾斜杠
//   校验器：validateBundleContent 合法/过小/无BUILD_ID/边界 + validateBundleOnDisk 好/坏/读失败
//   downloadAndReplace（直调）：坏内容拦截不落盘 + 备份轮换保留 3 份（含同秒覆盖）
//   respawn：拉起成功/失败不退出 + 盘上坏 bundle 拦截（不 spawn 不 exit）
//   runPreflight 集成：两步隔离 + 同时失败不抛 + binDir 透传
//   真实 bin 防污染：文件级 sha256 清单前后不变（根因回归，只读）

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

// mock spawn（runWithTreeKill 用）：按 cmd 返回模拟 child，emit stdout + close(code)。
// spawnImpl(cmd) 返回 { pid, stdout: EventEmitter, emit close }；测试据 cmd 决定 stdout/exit。
const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// BUILD_ID mock：非 dev，使 runPreflight（内部用全局 BUILD_ID）走 daemon 更新分支。
vi.mock('../src/build-id.js', () => ({ BUILD_ID: 'abc1234' }));

import {
  runPreflight,
  runSillySpecCheck,
  runDaemonSelfUpdate,
  respawnDaemonAndExit,
  fetchLatestBuildId,
  downloadAndReplace,
  validateBundleContent,
  validateBundleOnDisk,
  MIN_BUNDLE_BYTES,
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

function makeConfig(serverUrl = 'http://127.0.0.1:8000'): DaemonConfig {
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

function bundleResponse(body: string | Buffer): Response {
  return new Response(body, { status: 200 });
}

/**
 * 合法假 bundle（D-006）：≥ MIN_BUNDLE_BYTES 且首行含可提取 BUILD_ID，过
 * validateBundleContent 校验——下载替换成功路径的 fixture 一律用它；字面量
 * 占位文本（如 'NEW BUNDLE BODY'）会被防线 2 拦下，只用于负向用例。
 */
function validFakeBundle(buildId: string): Buffer {
  return Buffer.concat([
    Buffer.from(`export const BUILD_ID = "${buildId}";\n`),
    Buffer.alloc(MIN_BUNDLE_BYTES),
  ]);
}

/**
 * 构造 spawn mock 的返回 child：{ pid, stdout, emit close }。
 * nextTick emit 让 runWithTreeKill 的 listener 先注册（await Promise）。
 */
function makeSpawnChild(opts: {
  stdout?: string;
  code?: number;
  error?: boolean;
}): NodeJS.EventEmitter & { pid: number; stdout: NodeJS.EventEmitter } {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter() as NodeJS.EventEmitter & {
    pid: number;
    stdout: NodeJS.EventEmitter;
  };
  child.pid = 12345;
  child.stdout = new EventEmitter();
  process.nextTick(() => {
    if (opts.error) {
      child.emit('error', new Error('spawn fail'));
      return;
    }
    if (opts.stdout !== undefined) child.stdout.emit('data', Buffer.from(opts.stdout));
    child.emit('close', opts.code ?? 0);
  });
  return child;
}

/** 统计 spawnMock 被「含 needle 的命令」调用次数。 */
function execCallsContaining(needle: string): number {
  return spawnMock.mock.calls.filter(
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
  spawnMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  while (tmpRoots.length) {
    const d = tmpRoots.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 真实 bin 目录防污染回归（根因回归，FR-09/D-006，全程只读）─────────────────
// 8-30 事故根因：runPreflight 集成用例未隔离 binDir，假 bundle 写进真实
// ~/.sillyhub/daemon/bin。本文件所有写盘一律走注入的临时目录；此处文件级钩子
// 对真实目录递归取 sha256 清单，全部用例跑完后重算比对（文件集合无增删 + 逐
// 文件内容不变）——任何用例漏传 binDir 都会在此翻红。目录不存在 → 空清单，
// 空对空天然通过（等效跳过）。对真实目录只有读操作，绝不写。

/** 真实 daemon bin 目录（install.sh 与 preflight 共同的落盘点），测试只读。 */
const REAL_BIN_DIR = join(homedir(), '.sillyhub', 'daemon', 'bin');

/** 递归收集 dir 下「相对路径 → sha256」清单（只读；目录不存在返回空清单）。 */
function hashManifest(dir: string): Map<string, string> {
  const manifest = new Map<string, string>();
  if (!existsSync(dir)) return manifest;
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p, `${prefix}${name}/`);
      } else {
        manifest.set(
          `${prefix}${name}`,
          createHash('sha256').update(readFileSync(p)).digest('hex'),
        );
      }
    }
  };
  walk(dir, '');
  return manifest;
}

let realBinManifestBefore = new Map<string, string>();

beforeAll(() => {
  realBinManifestBefore = hashManifest(REAL_BIN_DIR);
});

afterAll(() => {
  const after = hashManifest(REAL_BIN_DIR);
  // 文件集合无增删 + 逐文件 hash 不变（真实目录从未被触碰）
  expect([...after.keys()].sort()).toEqual([...realBinManifestBefore.keys()].sort());
  for (const name of realBinManifestBefore.keys()) {
    expect(after.get(name)).toBe(realBinManifestBefore.get(name));
  }
});

// ── 功能1：sillyspec 版本检查 ─────────────────────────────────────────────────

describe('runSillySpecCheck', () => {
  // spawn mock 路由：按 cmd 返回对应 stdout/exit。失败用 code=1 或不 emit close。
  function spawnByCmd(cmdMap: (cmd: string) => { stdout?: string; code?: number; error?: boolean }): void {
    spawnMock.mockImplementation((cmd: string) =>
      makeSpawnChild(cmdMap(cmd)),
    );
  }

  it('未安装（sillyspec --version 失败）+ 最新可得 → 执行 npm install', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { code: 1 }; // 未安装：非零退出 → null
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      if (cmd.includes('npm install')) return { stdout: '' };
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
    expect(execCallsContaining('npm install -g sillyspec@latest')).toBe(1);
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_not_installed');
    expect(msgs).toContain('sillyspec_updated');
  });

  it('版本过旧（3.19.0 < 3.19.2）→ 执行 npm install', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { stdout: '3.19.0\n' };
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
    expect(execCallsContaining('npm install -g sillyspec@latest')).toBe(1);
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_outdated');
    expect(msgs).toContain('sillyspec_updated');
  });

  it('已是最新（3.19.2 == 3.19.2）→ 不安装', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { stdout: '3.19.2\n' };
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    expect(entries.find((e) => e.msg === 'sillyspec_up_to_date')).toBeTruthy();
  });

  it('高于最新（3.20.0 > 3.19.2）→ 不安装（isOutdated=false）', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { stdout: '3.20.0\n' };
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    expect(entries.find((e) => e.msg === 'sillyspec_up_to_date')).toBeTruthy();
  });

  it('npm view 不可达（非零退出）→ warn 不安装', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { stdout: '3.19.2\n' };
      if (cmd.includes('npm view sillyspec version')) return { code: 1 }; // npm down → null
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
    expect(execCallsContaining('npm install')).toBe(0);
    const e = entries.find((x) => x.msg === 'sillyspec_latest_unavailable');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
  });

  it('npm install 失败（非零退出）→ 记 cmd_failed warn，不抛错、不记 sillyspec_updated', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      if (cmd.includes('sillyspec --version')) return { stdout: '3.19.0\n' };
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      if (cmd.includes('npm install')) return { code: 1 }; // EACCES → false
      return { stdout: '' };
    });
    await expect(runSillySpecCheck(fn)).resolves.toBeUndefined();
    expect(entries.find((e) => e.msg === 'cmd_failed')?.level).toBe('warn');
    expect(entries.find((e) => e.msg === 'sillyspec_updated')).toBeFalsy();
  });

  it('非标准版本（无法 parseSemver）→ 字符串不等即视为旧 → 安装', async () => {
    const { fn, entries } = makeLogger();
    spawnByCmd((cmd) => {
      // 本地 dev 标签、最新也是非标准 → 字符串不等 → isOutdated=true
      if (cmd.includes('sillyspec --version')) return { stdout: '3.19.2-rc.1\n' };
      if (cmd.includes('npm view sillyspec version')) return { stdout: '3.19.2\n' };
      return { stdout: '' };
    });
    await runSillySpecCheck(fn);
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
    const res = await runDaemonSelfUpdate('abc1234', makeConfig(), fn);
    expect(res).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain('/daemon/latest.json');
    expect(entries.find((e) => e.msg === 'daemon_up_to_date')).toBeTruthy();
  });

  it('版本不一致 → 下载 bundle 原子替换到 binDir，返回 true；url 非标准名跳过 mcp 伴生更新', async () => {
    const binDir = makeTmpDir();
    const { fn, entries } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'def5678', url: 'http://x/bundle.js' },
        '/bundle.js': bundleResponse(validFakeBundle('def5678')),
      }),
    );
    vi.stubGlobal('fetch', spy);
    const res = await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(res).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2); // latest.json + bundle.js，无 mcp 请求
    const target = join(binDir, 'sillyhub-daemon.js');
    expect(existsSync(target)).toBe(true);
    // D-006：fixture 为合法假 bundle，落盘内容过校验且 BUILD_ID = 下载版本
    const v = validateBundleContent(readFileSync(target));
    expect(v.ok).toBe(true);
    expect(v.buildId).toBe('def5678');
    const e = entries.find((x) => x.msg === 'daemon_self_updated_need_restart');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
    expect(e!.data).toMatchObject({ from: 'abc1234', to: 'def5678' });
    // tmp 文件已 rename，不残留
    expect(existsSync(`${target}.tmp`)).toBe(false);
    // url 不以 sillyhub-daemon.js 结尾 → mcp 伴生更新跳过（debug）
    expect(entries.find((x) => x.msg === 'mcp_server_update_skip_url_shape')).toBeTruthy();
  });

  it('版本不一致且 url 以 sillyhub-daemon.js 结尾 → mcp-server.js 伴生一并替换', async () => {
    const binDir = makeTmpDir();
    const { fn, entries } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': {
          version: 'def5678',
          url: 'http://x/daemon/latest/sillyhub-daemon.js',
        },
        '/sillyhub-daemon.js': bundleResponse(validFakeBundle('def5678')),
        '/mcp-server.js': bundleResponse(validFakeBundle('mcp-def5678')),
      }),
    );
    vi.stubGlobal('fetch', spy);
    const res = await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(res).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3); // latest.json + 主 bundle + mcp-server.js
    // D-006：主/伴生 bundle 均为合法假 bundle，各自 BUILD_ID 提取正确
    expect(validateBundleContent(readFileSync(join(binDir, 'sillyhub-daemon.js')))).toMatchObject({
      ok: true,
      buildId: 'def5678',
    });
    expect(validateBundleContent(readFileSync(join(binDir, 'mcp-server.js')))).toMatchObject({
      ok: true,
      buildId: 'mcp-def5678',
    });
    expect(
      entries.find((x) => x.msg === 'mcp_server_self_updated')?.data,
    ).toMatchObject({ to: 'def5678' });
    expect(entries.find((x) => x.msg === 'daemon_self_update_restart')).toBeTruthy();
  });

  it('mcp-server.js 下载失败（404）→ 主 bundle 仍替换返回 true，仅 warn 不影响重启', async () => {
    const binDir = makeTmpDir();
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': {
          version: 'def5678',
          url: 'http://x/daemon/latest/sillyhub-daemon.js',
        },
        '/sillyhub-daemon.js': bundleResponse(validFakeBundle('def5678')),
        '/mcp-server.js': new Response('gone', { status: 404 }),
      }),
    );
    const res = await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(res).toBe(true);
    expect(existsSync(join(binDir, 'sillyhub-daemon.js'))).toBe(true);
    expect(existsSync(join(binDir, 'mcp-server.js'))).toBe(false);
    expect(entries.find((x) => x.msg === 'mcp_server_update_failed_keep_old')?.level).toBe('warn');
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
    ).resolves.toBe(false);
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
    await runDaemonSelfUpdate('abc1234', makeConfig('http://127.0.0.1:8000///'), fn);
    expect(String(spy.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:8000/daemon/latest.json',
    );
  });
});

// ── 校验器（D-003 口径，纯函数 + 盘上直调）────────────────────────────────────

describe('validateBundleContent', () => {
  it('合法（≥64KB 且含 BUILD_ID）→ ok=true 且 buildId 提取正确', () => {
    const v = validateBundleContent(validFakeBundle('def5678'));
    expect(v.ok).toBe(true);
    expect(v.buildId).toBe('def5678');
    expect(v.size).toBeGreaterThan(MIN_BUNDLE_BYTES);
  });

  it('坏：<64KB 占位文本（15 字节无 BUILD_ID）→ ok=false 且 buildId=null', () => {
    const v = validateBundleContent(Buffer.from('NEW BUNDLE BODY'));
    expect(v.ok).toBe(false);
    expect(v.buildId).toBe(null);
    expect(v.size).toBe(15);
  });

  it('坏：≥64KB 但无 BUILD_ID（纯填充）→ ok=false', () => {
    const v = validateBundleContent(Buffer.alloc(70_000));
    expect(v.ok).toBe(false);
    expect(v.buildId).toBe(null);
    expect(v.size).toBe(70_000);
  });

  it('边界：恰好 65_536 字节且含 BUILD_ID → ok=true', () => {
    const head = Buffer.from('export const BUILD_ID = "edge5678";\n');
    const buf = Buffer.concat([head, Buffer.alloc(MIN_BUNDLE_BYTES - head.length)]);
    expect(buf.length).toBe(MIN_BUNDLE_BYTES);
    const v = validateBundleContent(buf);
    expect(v.ok).toBe(true);
    expect(v.buildId).toBe('edge5678');
  });
});

describe('validateBundleOnDisk', () => {
  it('盘上合法 bundle → resolves true，零日志', async () => {
    const binDir = makeTmpDir();
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234'));
    const { fn, entries } = makeLogger();
    await expect(validateBundleOnDisk(binDir, fn)).resolves.toBe(true);
    expect(entries).toHaveLength(0);
  });

  it('盘上坏 bundle → false + debug 明细（label/size/buildId）', async () => {
    const binDir = makeTmpDir();
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), Buffer.from('NEW BUNDLE BODY'));
    const { fn, entries } = makeLogger();
    await expect(validateBundleOnDisk(binDir, fn, 'respawn-check')).resolves.toBe(false);
    const e = entries.find((x) => x.msg === 'daemon_bundle_on_disk_invalid');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('debug');
    expect(e!.data).toMatchObject({ label: 'respawn-check', size: 15, buildId: null });
  });

  it('目录不存在（读失败）→ false + debug 明细（含 error 字段）', async () => {
    const { fn, entries } = makeLogger();
    await expect(
      validateBundleOnDisk(join(makeTmpDir(), 'no-such-sub'), fn),
    ).resolves.toBe(false);
    const e = entries.find((x) => x.msg === 'daemon_bundle_on_disk_invalid');
    expect(e).toBeTruthy();
    expect(e!.data?.label).toBe('sillyhub-daemon.js');
    expect(typeof e!.data?.error).toBe('string');
  });
});

// ── downloadAndReplace 写前校验 + 备份轮换（直调，D-003/D-004）─────────────────

describe('downloadAndReplace 写前校验与备份轮换', () => {
  /** stub fetch 固定返回一个 200 的 bundle body。 */
  function stubFetchBuf(buf: Buffer): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(buf, { status: 200 })));
  }

  it('坏内容（15 字节占位）→ false：不写盘、无 .tmp/.bak 残留、旧 target 原样、warn 含 size/buildId', async () => {
    const binDir = makeTmpDir();
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234'));
    const { fn, entries } = makeLogger();
    stubFetchBuf(Buffer.from('NEW BUNDLE BODY'));

    const ok = await downloadAndReplace(
      'http://x/daemon/latest/sillyhub-daemon.js',
      'def5678',
      'abc1234',
      binDir,
      fn,
    );

    expect(ok).toBe(false);
    // 旧 target 逐字节原样；目录内零新增（无 .tmp、无 .bak）
    expect(readFileSync(join(binDir, 'sillyhub-daemon.js'))).toEqual(validFakeBundle('abc1234'));
    expect(readdirSync(binDir)).toEqual(['sillyhub-daemon.js']);
    const e = entries.find((x) => x.msg === 'daemon_bundle_validation_failed');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
    expect(e!.data).toMatchObject({ size: 15, buildId: null });
  });

  it('备份轮换：连续 4 次替换 → 同前缀 .bak 恰 3 份、最旧被清、target 为最新内容', async () => {
    vi.useFakeTimers();
    try {
      const binDir = makeTmpDir();
      writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('v0'));
      const { fn } = makeLogger();
      for (let i = 1; i <= 4; i++) {
        // 每次替换隔 1 秒 → 各次备份时间戳不同（纯数字定长，字典序即时间序）
        vi.setSystemTime(new Date(2026, 7, 30, 12, 0, i));
        stubFetchBuf(validFakeBundle(`v${i}`));
        const ok = await downloadAndReplace(
          'http://x/daemon/latest/sillyhub-daemon.js',
          `v${i}`,
          'v0',
          binDir,
          fn,
        );
        expect(ok).toBe(true);
      }
      const baks = readdirSync(binDir)
        .filter((n) => n.startsWith('sillyhub-daemon.js.bak-'))
        .sort();
      expect(baks).toHaveLength(3); // 轮换上限 3 份
      expect(baks[0]).toBe('sillyhub-daemon.js.bak-20260830-120002'); // 最旧（120001）被清
      expect(baks[2]).toBe('sillyhub-daemon.js.bak-20260830-120004');
      expect(
        validateBundleContent(readFileSync(join(binDir, 'sillyhub-daemon.js'))).buildId,
      ).toBe('v4'); // target = 最新下载内容
    } finally {
      vi.useRealTimers();
    }
  });

  it('同秒两次替换 → .bak 同名覆盖不增份', async () => {
    vi.useFakeTimers();
    try {
      const binDir = makeTmpDir();
      writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('v0'));
      const { fn } = makeLogger();
      const bakCount = (): number =>
        readdirSync(binDir).filter((n) => n.startsWith('sillyhub-daemon.js.bak-')).length;

      vi.setSystemTime(new Date(2026, 7, 30, 12, 0, 0));
      stubFetchBuf(validFakeBundle('v1'));
      await downloadAndReplace(
        'http://x/daemon/latest/sillyhub-daemon.js',
        'v1',
        'v0',
        binDir,
        fn,
      );
      expect(bakCount()).toBe(1);

      stubFetchBuf(validFakeBundle('v2')); // 同一秒再替换
      await downloadAndReplace(
        'http://x/daemon/latest/sillyhub-daemon.js',
        'v2',
        'v1',
        binDir,
        fn,
      );
      expect(bakCount()).toBe(1); // 同名覆盖视为替换，天然去重
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── fetchLatestBuildId（task-04 目标版本回传等价接口）─────────────────────────

describe('fetchLatestBuildId', () => {
  it('latest.json 可得 → 返回 version 字符串，只拉一次不下载 bundle', async () => {
    const { fn } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'def5678-20260829120000', url: 'http://x/bundle.js' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    await expect(fetchLatestBuildId(makeConfig(), fn)).resolves.toBe(
      'def5678-20260829120000',
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain('/daemon/latest.json');
  });

  it('拉取失败（fetch 抛错）→ 返回 null 不抛（warn 已记）', async () => {
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network down');
      }),
    );
    await expect(fetchLatestBuildId(makeConfig(), fn)).resolves.toBe(null);
    expect(entries.find((x) => x.msg === 'daemon_latest_fetch_failed')?.level).toBe('warn');
  });

  it('结构无效（缺 url）→ 复用 fetchLatest 严格校验返回 null', async () => {
    const { fn, entries } = makeLogger();
    vi.stubGlobal(
      'fetch',
      makeFetch({ '/daemon/latest.json': { version: 'def5678' } }),
    );
    await expect(fetchLatestBuildId(makeConfig(), fn)).resolves.toBe(null);
    expect(entries.find((x) => x.msg === 'daemon_latest_invalid_shape')).toBeTruthy();
  });

  it('server_url 尾斜杠 → 同款去斜杠拼接', async () => {
    const { fn } = makeLogger();
    const spy = vi.fn(
      makeFetch({
        '/daemon/latest.json': { version: 'abc1234', url: 'http://x/bundle.js' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    await expect(
      fetchLatestBuildId(makeConfig('http://127.0.0.1:8000///'), fn),
    ).resolves.toBe('abc1234');
    expect(String(spy.mock.calls[0]![0])).toBe('http://127.0.0.1:8000/daemon/latest.json');
  });
});

// ── respawnDaemonAndExit（自更新后自拉起）──────────────────────────────────────

describe('respawnDaemonAndExit', () => {
  /** respawn 子进程替身：pid + unref + on（runWithTreeKill 的 makeSpawnChild 无 unref）。 */
  function makeRespawnChild(pid = 4242) {
    return { pid, unref: vi.fn(), on: vi.fn() };
  }

  it('拉起成功 → detached spawn（node + 新 bundle + 原启动参数）+ unref，500ms 后 exit(0)', async () => {
    vi.useFakeTimers();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const child = makeRespawnChild();
    spawnMock.mockReturnValue(child as never);
    const binDir = makeTmpDir();
    // 防线 3 前置条件：盘上须为合法 bundle（空目录读失败会被拦下不 spawn）
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234'));
    const { fn, entries } = makeLogger();

    await respawnDaemonAndExit(fn, binDir);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe(join(binDir, 'sillyhub-daemon.js'));
    expect(args.slice(1)).toEqual(process.argv.slice(2)); // 复用原启动参数
    expect(opts.detached).toBe(true); // 脱离父进程组，父退出后存活
    expect(opts.stdio).toBe('ignore');
    expect(opts.windowsHide).toBe(true);
    expect(child.unref).toHaveBeenCalledTimes(1); // 不阻塞父进程退出
    expect(entries.find((x) => x.msg === 'daemon_self_update_respawn')?.data).toMatchObject({
      pid: 4242,
    });
    vi.advanceTimersByTime(500);
    expect(exitSpy).toHaveBeenCalledWith(0); // 日志 flush 后退出旧进程
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it('spawn 抛错 → 记 error 不退出（旧进程保活，不裸死）', async () => {
    vi.useFakeTimers();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    spawnMock.mockImplementation(() => {
      throw new Error('spawn boom');
    });
    const binDir = makeTmpDir();
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234'));
    const { fn, entries } = makeLogger();

    await respawnDaemonAndExit(fn, binDir);

    const e = entries.find((x) => x.msg === 'daemon_self_update_respawn_failed');
    expect(e).toBeTruthy();
    expect(e!.level).toBe('error');
    vi.advanceTimersByTime(5_000);
    expect(exitSpy).not.toHaveBeenCalled(); // 拉起失败绝不退出
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it('spawn 返回无 pid（异步失败形态）→ 同样记 error 不退出', async () => {
    vi.useFakeTimers();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    spawnMock.mockReturnValue({ unref: vi.fn(), on: vi.fn() } as never);
    const binDir = makeTmpDir();
    writeFileSync(join(binDir, 'sillyhub-daemon.js'), validFakeBundle('abc1234'));
    const { fn, entries } = makeLogger();

    await respawnDaemonAndExit(fn, binDir);

    expect(entries.find((x) => x.msg === 'daemon_self_update_respawn_failed')).toBeTruthy();
    vi.advanceTimersByTime(5_000);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it('盘上坏 bundle → 防线 3 拦截：不 spawn、不排定 exit，error 拦截事件', async () => {
    vi.useFakeTimers();
    try {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const binDir = makeTmpDir();
      writeFileSync(join(binDir, 'sillyhub-daemon.js'), Buffer.from('NEW BUNDLE BODY'));
      const { fn, entries } = makeLogger();

      await respawnDaemonAndExit(fn, binDir);

      expect(spawnMock).not.toHaveBeenCalled(); // 坏盘绝不被拉起
      vi.advanceTimersByTime(5_000);
      expect(exitSpy).not.toHaveBeenCalled(); // 也不排定退出，旧进程保活
      const e = entries.find((x) => x.msg === 'daemon_self_update_respawn_validation_failed');
      expect(e).toBeTruthy();
      expect(e!.level).toBe('error');
      exitSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── runPreflight 集成（两步隔离）──────────────────────────────────────────────

describe('runPreflight 集成', () => {
  it('两步都执行且互不影响（sillyspec npm 不可达 + daemon 版本一致）', async () => {
    const { fn, entries } = makeLogger();
    spawnMock.mockImplementation((cmd: string) =>
      makeSpawnChild({
        stdout: cmd.includes('sillyspec --version') ? '3.19.2\n' : '',
        code: cmd.includes('npm view sillyspec version') ? 1 : 0, // npm 不可达 → null
      }),
    );
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': { version: 'abc1234', url: 'http://x/bundle.js' },
      }),
    );
    await expect(runPreflight(makeConfig(), fn, makeTmpDir())).resolves.toBeUndefined();
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_latest_unavailable');
    expect(msgs).toContain('daemon_up_to_date');
  });

  it('两步同时失败 → runPreflight 不抛，各自 warn', async () => {
    const { fn, entries } = makeLogger();
    spawnMock.mockImplementation(() => makeSpawnChild({ code: 1 })); // 所有 spawn 非零退出
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('net down');
      }),
    );
    await expect(runPreflight(makeConfig(), fn, makeTmpDir())).resolves.toBeUndefined();
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain('sillyspec_latest_unavailable');
    expect(msgs).toContain('daemon_latest_fetch_failed');
  });

  it('启动期自更新成功 → 拉起新进程（detached spawn）并退出旧进程', async () => {
    vi.useFakeTimers();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    // spawn 路由：sillyspec 命令走 makeSpawnChild；respawn（cmd=node 路径）返回带 unref 的替身。
    spawnMock.mockImplementation((cmd: unknown) => {
      if (typeof cmd === 'string' && cmd.includes('sillyspec')) {
        return makeSpawnChild({
          stdout: cmd.includes('sillyspec --version') ? '3.19.2\n' : '',
          code: cmd.includes('npm view') ? 1 : 0, // npm 不可达 → 快速跳过安装
        });
      }
      return { pid: 7777, unref: vi.fn(), on: vi.fn() };
    });
    // D-006：binDir 注入临时目录——本用例曾不传第三参，假 bundle 直接写进真实
    // ~/.sillyhub/daemon/bin（8-30 事故根因）；fixture 同步换合法假 bundle。
    const binDir = makeTmpDir();
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': {
          version: 'def5678',
          url: 'http://x/daemon/latest/sillyhub-daemon.js',
        },
        '/sillyhub-daemon.js': bundleResponse(validFakeBundle('def5678')),
        '/mcp-server.js': bundleResponse(validFakeBundle('mcp-def5678')),
      }),
    );
    const { fn, entries } = makeLogger();
    await expect(runPreflight(makeConfig(), fn, binDir)).resolves.toBeUndefined();

    // respawn：node + <binDir>/sillyhub-daemon.js + 原启动参数，detached（盘上刚
    // 落盘的合法 bundle 过防线 3 校验 → 照常拉起）
    const respawnCall = spawnMock.mock.calls.find(
      (c) => c[0] === process.execPath,
    ) as [string, string[], Record<string, unknown>];
    expect(respawnCall).toBeTruthy();
    expect(respawnCall[1]![0]).toBe(join(binDir, 'sillyhub-daemon.js'));
    expect(respawnCall[2]).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(entries.find((x) => x.msg === 'daemon_self_update_respawn')).toBeTruthy();

    vi.advanceTimersByTime(500);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it('binDir 透传：第三参目录收到新 bundle，respawn 拉起也指向该目录（真实 bin 不被写）', async () => {
    vi.useFakeTimers();
    try {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      spawnMock.mockImplementation((cmd: unknown) => {
        if (typeof cmd === 'string' && cmd.includes('sillyspec')) {
          return makeSpawnChild({
            stdout: cmd.includes('sillyspec --version') ? '3.19.2\n' : '',
            code: cmd.includes('npm view') ? 1 : 0, // npm 不可达 → 快速跳过安装
          });
        }
        return { pid: 8888, unref: vi.fn(), on: vi.fn() };
      });
      const binDir = makeTmpDir();
      vi.stubGlobal(
        'fetch',
        makeFetch({
          '/daemon/latest.json': { version: 'def5678', url: 'http://x/bundle.js' },
          '/bundle.js': bundleResponse(validFakeBundle('def5678')),
        }),
      );
      const { fn, entries } = makeLogger();
      await expect(runPreflight(makeConfig(), fn, binDir)).resolves.toBeUndefined();

      // 新 bundle 落在注入的临时目录且内容可信
      const v = validateBundleContent(readFileSync(join(binDir, 'sillyhub-daemon.js')));
      expect(v.ok).toBe(true);
      expect(v.buildId).toBe('def5678');
      // respawn 的 bundle 参数 = 注入目录下的文件（非真实 ~/.sillyhub/daemon/bin）
      const respawnCall = spawnMock.mock.calls.find(
        (c) => c[0] === process.execPath,
      ) as [string, string[]];
      expect(respawnCall?.[1]?.[0]).toBe(join(binDir, 'sillyhub-daemon.js'));
      expect(entries.find((x) => x.msg === 'daemon_self_update_restart')).toBeTruthy();
      exitSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 真实 bin 目录防污染回归（根因回归收口）────────────────────────────────────
// 文件级 beforeAll/afterAll（见文件头部钩子）对真实 ~/.sillyhub/daemon/bin 递归
// sha256 清单前后比对；本用例就地再跑一轮完整假下载（latest.json + 主 bundle +
// mcp 伴生），写盘只落注入的临时目录，真实目录从未被触碰。

describe('真实 bin 目录防污染回归', () => {
  it('跑完若干假下载后，真实 ~/.sillyhub/daemon/bin 逐文件 hash 不变（全程只读）', async () => {
    const binDir = makeTmpDir();
    const { fn } = makeLogger();
    vi.stubGlobal(
      'fetch',
      makeFetch({
        '/daemon/latest.json': {
          version: 'def5678',
          url: 'http://x/daemon/latest/sillyhub-daemon.js',
        },
        '/sillyhub-daemon.js': bundleResponse(validFakeBundle('def5678')),
        '/mcp-server.js': bundleResponse(validFakeBundle('mcp-def5678')),
      }),
    );
    const res = await runDaemonSelfUpdate('abc1234', makeConfig(), fn, binDir);
    expect(res).toBe(true);
    // 写盘只出现在注入的临时目录，且落盘内容过盘上校验
    await expect(validateBundleOnDisk(binDir, fn)).resolves.toBe(true);
    // 全文件级清单比对由 afterAll 收口（本文件此前所有 makeFetch 假下载都被覆盖）
  });
});
