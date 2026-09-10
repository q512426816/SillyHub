/**
 * daemon-status-root-persistence.test.ts —— 总览采集根落盘/恢复测试
 *
 * 2026-09-08（temp 投毒排障衍生）：root 仅内存态时 daemon 每次重启后总览采集
 * 静默失联（等下一次 claim 才恢复），页面长期显「总览不可用」。修复后：
 *   - _noteSillySpecStatusRoot 变更时落盘 sillyspec-status-root.json；
 *   - start() 经 _restoreSillySpecStatusRoot 恢复，无需 claim；
 *   - 文件缺失/损坏 → 静默回退旧路径（等 claim），零回归。
 *
 * 隔离：SILLYHUB_DAEMON_DIR 指向临时目录（config.ts daemonStateDir 懒求值，
 * 子进程/env stub 后动态 import 生效）。daemonStateDir 每次调用现读 env——
 * 但模块常量（如 DEFAULT_CONFIG_DIR）import 时求值；本测试只依赖函数，
 * vi.stubEnv 后动态 import daemon.ts 即可。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 落盘是异步 fire-and-forget（生产零阻塞），测试侧轮询等 JSON 可解析
 *（writeFile 先建空文件再写内容，existsSync 会抢跑在空窗口）。 */
async function waitFileJson<T>(path: string, deadlineMs = 2000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch (e) {
      if (Date.now() - t0 > deadlineMs) throw e;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

let stateDir: string;
let restoreEnv: () => void;

beforeEach(async () => {
  stateDir = mkdtempSync(join(tmpdir(), 'ss-root-persist-'));
  const saved = process.env.SILLYHUB_DAEMON_DIR;
  process.env.SILLYHUB_DAEMON_DIR = stateDir;
  restoreEnv = () => {
    if (saved === undefined) delete process.env.SILLYHUB_DAEMON_DIR;
    else process.env.SILLYHUB_DAEMON_DIR = saved;
  };
  // 每用例动态 import（vi.resetModules 保证 SILLYHUB_DAEMON_DIR 新值生效——
  // daemon.ts 模块级常量虽在 import 时求值，daemonStateDir() 函数懒读 env）。
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  rmSync(stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 静音 console（daemon createLogger 直写 console）。 */
function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

/** 最小可构造 Daemon（client/manager 全假——本测试只碰 root 相关私有方法）。 */
async function buildDaemon(): Promise<InstanceType<
  typeof import('../src/daemon.js').Daemon
>> {
  const { Daemon } = await import('../src/daemon.js');
  const config = {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-root-persist',
    profile: 'default',
    workspace_dir: '/tmp/ws-root-persist',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    log_level: 'debug',
  };
  return new Daemon(config as never, {} as never, null as never, {
    sessionManager: null,
    sillyspecManager: {} as never,
  }) as never;
}

describe('2026-09-08 采集根落盘/恢复', () => {
  it('观察 root → 落盘 {root_path, saved_at}；start() 后恢复到内存', async () => {
    const restore = silenceConsole();
    const daemon = await buildDaemon();
    const d = daemon as unknown as {
      _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
      _sillyspecStatusRoot: string | null;
    };
    d._noteSillySpecStatusRoot('b97f8231-9404-43bd-89de-38c281c4d875', 'C:\\repo\\alpha');
    expect(d._sillyspecStatusRoot).toBe('C:\\repo\\alpha');
    const raw = await waitFileJson<{ root_path: string; saved_at: string }>(
      join(stateDir, 'sillyspec-status-root.json'),
    );
    expect(raw.root_path).toBe('C:\\repo\\alpha');
    expect(typeof raw.saved_at).toBe('string');
    expect(raw.root_path).toBe('C:\\repo\\alpha');
    expect(typeof raw.saved_at).toBe('string');

    // 模拟重启：新实例内存空 → 经恢复方法回填。
    const daemon2 = await buildDaemon();
    const d2 = daemon2 as unknown as {
      _restoreSillySpecStatusRoot(): Promise<void>;
      _sillyspecStatusRoot: string | null;
    };
    expect(d2._sillyspecStatusRoot).toBeNull();
    await d2._restoreSillySpecStatusRoot();
    expect(d2._sillyspecStatusRoot).toBe('C:\\repo\\alpha');
    restore();
  });

  it('切换 root → 落盘覆盖为最新值', async () => {
    const restore = silenceConsole();
    const daemon = await buildDaemon();
    const d = daemon as unknown as {
      _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
    };
    d._noteSillySpecStatusRoot('b97f8231-9404-43bd-89de-38c281c4d875', 'C:\\repo\\alpha');
    d._noteSillySpecStatusRoot('b97f8231-9404-43bd-89de-38c281c4d875', 'C:\\repo\\beta');
    // 覆盖写是异步的：轮询直到值为 beta（或超时抛出）。
    const t0 = Date.now();
    let raw: { root_path: string } | null = null;
    for (;;) {
      raw = await waitFileJson<{ root_path: string }>(
        join(stateDir, 'sillyspec-status-root.json'),
      );
      if (raw.root_path === 'C:\\repo\\beta' || Date.now() - t0 > 2000) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(raw.root_path).toBe('C:\\repo\\beta');
    restore();
  });

  it('文件缺失/损坏/字段非法 → 恢复静默跳过（回退等 claim 旧路径）', async () => {
    const restore = silenceConsole();
    // 缺失。
    const daemonA = await buildDaemon();
    const a = daemonA as unknown as {
      _restoreSillySpecStatusRoot(): Promise<void>;
      _sillyspecStatusRoot: string | null;
    };
    await a._restoreSillySpecStatusRoot();
    expect(a._sillyspecStatusRoot).toBeNull();

    // 损坏 JSON。
    writeFileSync(join(stateDir, 'sillyspec-status-root.json'), '{oops', 'utf-8');
    const daemonB = await buildDaemon();
    const b = daemonB as unknown as typeof a;
    await b._restoreSillySpecStatusRoot();
    expect(b._sillyspecStatusRoot).toBeNull();

    // 字段非法（root_path 非字符串）。
    writeFileSync(
      join(stateDir, 'sillyspec-status-root.json'),
      JSON.stringify({ root_path: 123 }),
      'utf-8',
    );
    const daemonC = await buildDaemon();
    const c = daemonC as unknown as typeof a;
    await c._restoreSillySpecStatusRoot();
    expect(c._sillyspecStatusRoot).toBeNull();
    restore();
  });

  it('借用沙箱 rootPath 不观察不落盘（BORROW_SANDBOX_MARKER 守卫不变）', async () => {
    const restore = silenceConsole();
    const daemon = await buildDaemon();
    const d = daemon as unknown as {
      _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
      _sillyspecStatusRoot: string | null;
    };
    d._noteSillySpecStatusRoot('borrow-sandbox:xyz');
    d._noteSillySpecStatusRoot(null, undefined);
    expect(d._sillyspecStatusRoot).toBeNull();
    restore();
  });
});

describe('2026-09-09 心跳工作区键 UUID 守卫（daemon-heartbeat-workspace-key-no-uuid-guard）', () => {
  const REAL_WS = 'b97f8231-9404-43bd-89de-38c281c4d875';

  it('claim 学习：非 UUID workspaceId → 拒绝登记 + warn 一次（不进 sillyspec_status_map）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const daemon = await buildDaemon();
      const d = daemon as unknown as {
        _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
        _sillyspecStatusRoots: Map<string, unknown>;
      };
      d._noteSillySpecStatusRoot('ws-b1', 'C:\\repo\\fake');
      d._noteSillySpecStatusRoot('ws-b1', 'C:\\repo\\fake'); // 第二次不再 warn
      expect(d._sillyspecStatusRoots.has('ws-b1')).toBe(false);
      const hits = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('sillyspec_status_root_non_uuid_ws_rejected'),
      );
      expect(hits.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it('恢复：存量 status-roots.json 含非 UUID 键 → 过滤回填 + warn 带被拒键清单', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      writeFileSync(
        join(stateDir, 'sillyspec-status-roots.json'),
        JSON.stringify({
          workspaces: {
            [REAL_WS]: { root_path: 'C:\\repo\\real', last_claim_at: 1 },
            'ws-b1': { root_path: 'C:\\Temp', last_claim_at: 1 },
          },
        }),
        'utf-8',
      );
      const daemon = await buildDaemon();
      const d = daemon as unknown as {
        _restoreSillySpecStatusRoot(): Promise<void>;
        _sillyspecStatusRoots: Map<string, unknown>;
      };
      await d._restoreSillySpecStatusRoot();
      expect(d._sillyspecStatusRoots.has(REAL_WS)).toBe(true);
      expect(d._sillyspecStatusRoots.has('ws-b1')).toBe(false);
      expect(
        warnSpy.mock.calls.some((c) =>
          String(c[0]).includes('sillyspec_status_roots_non_uuid_keys_dropped'),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it('spec_cache 扫描：specs 根非 UUID 目录（备份名）→ 跳过不进心跳 + warn 一次', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const specsRoot = join(stateDir, 'specs');
      for (const dir of [REAL_WS, 'b97f8231.pre-junction-backup-20260909']) {
        mkdirSync(join(specsRoot, dir, '.runtime'), { recursive: true });
        writeFileSync(
          join(specsRoot, dir, '.runtime', 'spec-version.json'),
          JSON.stringify({ spec_version: 5 }),
          'utf-8',
        );
      }
      const daemon = await buildDaemon();
      const d = daemon as unknown as {
        _collectSpecCacheEntries(): Promise<{ workspace_id: string; spec_version: number }[]>;
      };
      const entries = await d._collectSpecCacheEntries();
      expect(entries).toEqual([{ workspace_id: REAL_WS, spec_version: 5 }]);
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes('spec_cache_non_uuid_dir_skipped')),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});


describe('2026-09-09 FR-04 单槽位防投毒（conflict-root-workspace-scoping task-02）', () => {
  it('无 workspaceId 的 claim（rootPath=Temp）→ 单槽位值不变、不落盘（投毒入口封死）', async () => {
    const restore = silenceConsole();
    const daemon = await buildDaemon();
    const d = daemon as unknown as {
      _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
      _sillyspecStatusRoot: string | null;
    };
    // 先用合法 UUID claim 建立「正确」单槽位（洗白机制基线）。
    d._noteSillySpecStatusRoot('b97f8231-9404-43bd-89de-38c281c4d875', 'C:\\repo\\good');
    expect(d._sillyspecStatusRoot).toBe('C:\\repo\\good');
    // 无 workspaceId 的 claim 带 Temp rootPath → 不得覆盖单槽位（FR-04）。
    d._noteSillySpecStatusRoot(null, 'C:\\Users\\qinyi\\AppData\\Local\\Temp');
    d._noteSillySpecStatusRoot(undefined, '/tmp/poison');
    expect(d._sillyspecStatusRoot).toBe('C:\\repo\\good');
    const raw = await waitFileJson<{ root_path: string }>(
      join(stateDir, 'sillyspec-status-root.json'),
    );
    expect(raw.root_path).toBe('C:\\repo\\good');
    restore();
  });

  it('合法 UUID claim 仍双写（映射 + 单槽位，洗白机制保留）', async () => {
    const restore = silenceConsole();
    const daemon = await buildDaemon();
    const d = daemon as unknown as {
      _noteSillySpecStatusRoot(ws: string | null | undefined, p: string | undefined): void;
      _sillyspecStatusRoot: string | null;
      _sillyspecStatusRoots: Map<string, { rootPath: string }>;
    };
    d._noteSillySpecStatusRoot('11111111-2222-3333-4444-555555555555', 'C:\\repo\\ws-a');
    expect(d._sillyspecStatusRoots.get('11111111-2222-3333-4444-555555555555')?.rootPath).toBe(
      'C:\\repo\\ws-a',
    );
    expect(d._sillyspecStatusRoot).toBe('C:\\repo\\ws-a');
    restore();
  });
});
