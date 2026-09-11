/**
 * sillyspec_file_diff（单文件变化比对，ql-20260910-017-2006）测试。
 *
 * 覆盖：
 *   1. SillySpecManager.fileDiff：成功路径——spawn 参数（node + bin 数组形参、
 *      scope-audit --change --file --json、cwd=工作区根）+ stdout JSON 信封
 *      snake_case 投影（base_ref/anchor_label/note/diff）；untracked note 透传
 *   2. 能力门：旧 sillyspec（exit 1 + stderr「未知命令」）→ RpcError
 *      sillyspec_capability_missing；其余非零 → scope_audit_failed（exit code）
 *   3. 入口断言：invalid_params / no_spec_root；超时 → scope_audit_timeout
 *   4. diff 超 256KB 截断 truncated=true
 *   5. daemon.ts RPC 注册：sillyspec_file_diff handler 挂载并归一透传
 *      （params 非字符串归一空串交 manager 入口断言）
 *
 * mock 范式照 sillyspec-conflict-snapshot.test / daemon-heartbeat-sillyspec.test：
 * manager 层 DI 假 runProgressJson（可编程 outcome）；注册层真实构造 Daemon 注入
 * 假 manager 直调私有注册法（鸭子类型）。
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { Daemon } from '../src/daemon.js';
import {
  SillySpecManager,
  SILLYSPEC_FILE_DIFF_MAX_CHARS,
} from '../src/sillyspec-manager.js';
import type { SillySpecProgressOutcome } from '../src/sillyspec-manager.js';
import { RpcError } from '../src/ws-client.js';
import type { DaemonConfig } from '../src/config.js';

const BIN = 'C:\\sillyspec\\bin\\sillyspec.js';

/** 假 ws（仅捕获 handler 注册）。 */
function makeFakeWs() {
  const handlers = new Map<string, (params: Record<string, unknown>) => unknown>();
  return {
    handlers,
    registerRpcHandler: (method: string, handler: (params: Record<string, unknown>) => unknown) => {
      handlers.set(method, handler);
    },
  };
}

/** DaemonConfig fixture（循环间隔拉满防噪音，照 conflict-snapshot test 同款）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-filediff',
    profile: 'default',
    workspace_dir: '/tmp/ws-filediff',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'debug',
    default_timeout_seconds: 1800,
    max_retries: 1,
    retry_max_attempts: 3,
    retry_base_delay_ms: 1000,
    retry_backoff_factor: 2,
    retry_jitter: 0.2,
    loop_restart_backoff_ms: 5000,
    max_loop_restarts: 10,
    outbox_max_per_run: 500,
    outbox_max_total: 5000,
    disconnect_log_threshold_sec: 30,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: [],
    spec_root_map: '',
    self_reload_check_interval_sec: 600,
    sillyspec_update_interval_sec: 9999,
    sillyspec_status_interval_sec: 0,
    sillyspec_command_timeout_sec: 120,
    ...overrides,
  };
}

/** fileDiff harness：DI 假 runProgressJson（可编程 outcome）+ 可编程根/bin。 */
function makeFileDiffHarness(opts: {
  outcome?: SillySpecProgressOutcome;
  root?: string | null;
  bin?: string | null;
}) {
  const calls: {
    file: string;
    args: string[];
    options: { cwd: string; timeoutMs: number; maxBufferBytes: number };
  }[] = [];
  const runProgressJson = vi.fn(
    async (
      file: string,
      args: string[],
      options: { cwd: string; timeoutMs: number; maxBufferBytes: number },
    ): Promise<SillySpecProgressOutcome> => {
      calls.push({ file, args, options });
      if (opts.outcome !== undefined) return opts.outcome;
      return { code: 0, stdout: '', timedOut: false };
    },
  );
  const manager = new SillySpecManager({
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => 1_700_000_000_000,
    runProgressJson,
    resolveSillySpecBin: () => (opts.bin === undefined ? BIN : opts.bin),
    statusCwd: () => (opts.root === undefined ? 'C:\\repo' : opts.root),
    statusTimeoutMs: 5,
    commandTimeoutMs: 120_000,
  });
  return { manager, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ql-20260910-017-2006 manager.fileDiff：成功路径与信封投影', () => {
  it('exit 0 + 合法信封 → snake_case 投影；spawn 为 node+bin 数组形参、cwd=根、--file/--json 参数齐', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({
          command: 'scope-audit',
          change: '2026-09-10-mcp-central-registry',
          file: 'src/a.ts',
          ok: true,
          mode: 'full-flow',
          root: 'C:\\repo',
          baseRef: '3f22d6b',
          anchorLabel: '3f22d6b',
          diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n',
          note: null,
        }),
        timedOut: false,
      },
    });
    const result = await h.manager.fileDiff('2026-09-10-mcp-central-registry', 'src/a.ts');
    expect(result).toEqual({
      change: '2026-09-10-mcp-central-registry',
      file: 'src/a.ts',
      ok: true,
      mode: 'full-flow',
      base_ref: '3f22d6b',
      anchor_label: '3f22d6b',
      diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n',
      note: null,
      truncated: false,
    });
    // spawn：node + [bin, ...args] 数组形参（runResolve 同款），cwd=根
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.file).toBe(process.execPath);
    expect(h.calls[0]!.args).toEqual([
      BIN,
      'scope-audit',
      '--change',
      '2026-09-10-mcp-central-registry',
      '--file',
      'src/a.ts',
      '--json',
    ]);
    expect(h.calls[0]!.options.cwd).toBe('C:\\repo');
  });

  it('untracked 新文件（diff null + note）→ diff/note 原样透传，truncated=false', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          mode: 'quick',
          baseRef: 'HEAD',
          anchorLabel: 'HEAD 未提交窗口',
          diff: null,
          note: '未跟踪新文件——不在 git diff 内，文件全部行为新增；直接查看文件本体',
        }),
        timedOut: false,
      },
    });
    const result = await h.manager.fileDiff('quick-a1b2c3d4', 'docs/new.md');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('quick');
    expect(result.base_ref).toBe('HEAD');
    expect(result.anchor_label).toBe('HEAD 未提交窗口');
    expect(result.diff).toBeNull();
    expect(result.note).toBe(
      '未跟踪新文件——不在 git diff 内，文件全部行为新增；直接查看文件本体',
    );
    expect(result.truncated).toBe(false);
  });
});

describe('ql-20260910-017-2006 manager.fileDiff：能力门与错误族', () => {
  it('旧 sillyspec（exit 1 + stderr「未知命令」）→ RpcError sillyspec_capability_missing', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 1,
        stdout: '',
        stderr: '❌ 未知命令: scope-audit\n\nSillySpec CLI — 规范驱动开发工具包\n用法: ...',
        timedOut: false,
      },
    });
    await expect(
      h.manager.fileDiff('2026-09-10-mcp-central-registry', 'src/a.ts'),
    ).rejects.toMatchObject({
      code: 'sillyspec_capability_missing',
    });
  });

  it('其余非零（变更不存在等）→ RpcError scope_audit_failed 带 exit code', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 1,
        stdout: '',
        stderr: '❌ 变更目录不存在（活跃与归档区均未找到）: ...',
        timedOut: false,
      },
    });
    await expect(
      h.manager.fileDiff('2099-01-01-no-such-change', 'src/a.ts'),
    ).rejects.toMatchObject({ code: 'scope_audit_failed' });
  });

  it('入口断言：change/file 空 → invalid_params；无根 → no_spec_root；无 bin → sillyspec_bin_missing', async () => {
    const ok = makeFileDiffHarness({});
    await expect(ok.manager.fileDiff('', 'src/a.ts')).rejects.toMatchObject({
      code: 'invalid_params',
    });
    await expect(ok.manager.fileDiff('c', '')).rejects.toMatchObject({
      code: 'invalid_params',
    });
    const noRoot = makeFileDiffHarness({ root: null });
    await expect(noRoot.manager.fileDiff('c', 'src/a.ts')).rejects.toMatchObject({
      code: 'no_spec_root',
    });
    const noBin = makeFileDiffHarness({ bin: null });
    await expect(noBin.manager.fileDiff('c', 'src/a.ts')).rejects.toMatchObject({
      code: 'sillyspec_bin_missing',
    });
  });

  it('超时（timedOut）→ RpcError scope_audit_timeout', async () => {
    const h = makeFileDiffHarness({
      outcome: { code: null, stdout: '', timedOut: true },
    });
    await expect(h.manager.fileDiff('c', 'src/a.ts')).rejects.toMatchObject({
      code: 'scope_audit_timeout',
    });
  });

  it('stdout 非法 JSON → scope_audit_failed（不误判能力缺失）', async () => {
    const h = makeFileDiffHarness({
      outcome: { code: 0, stdout: 'not json at all', timedOut: false },
    });
    await expect(h.manager.fileDiff('c', 'src/a.ts')).rejects.toMatchObject({
      code: 'scope_audit_failed',
    });
  });
});

describe('ql-20260910-017-2006 manager.fileDiff：256KB 截断护栏', () => {
  it('diff 超长 → 截断至上限 + truncated=true；未超 → 原样 + truncated=false', async () => {
    const big = 'x'.repeat(SILLYSPEC_FILE_DIFF_MAX_CHARS + 100);
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({ ok: true, mode: 'full-flow', diff: big }),
        timedOut: false,
      },
    });
    const result = await h.manager.fileDiff('c', 'src/a.ts');
    expect(result.truncated).toBe(true);
    expect(result.diff).toHaveLength(SILLYSPEC_FILE_DIFF_MAX_CHARS);
  });

  it('代理对边界（ql-20260911-003-355a P2）：截断点落在代理对中间 → 丢高代理项不产生 lone surrogate', async () => {
    // 星面字符（😀 = U+1F600，2 个 code unit）：1 个 ASCII 前缀 + N 个 emoji 使
    // 裸 slice 的截断点恰好落在最后一个 emoji 的代理对中间（高代理悬挂在结尾）。
    const emojiCount = Math.floor(SILLYSPEC_FILE_DIFF_MAX_CHARS / 2);
    const big = 'x' + '😀'.repeat(emojiCount) + 'x'.repeat(10);
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({ ok: true, mode: 'full-flow', diff: big }),
        timedOut: false,
      },
    });
    const result = await h.manager.fileDiff('c', 'src/a.ts');
    expect(result.truncated).toBe(true);
    // 安全截断：不超过上限，且不以高代理项（lone surrogate）结尾
    expect(result.diff.length).toBeLessThanOrEqual(SILLYSPEC_FILE_DIFF_MAX_CHARS);
    const lastUnit = result.diff.charCodeAt(result.diff.length - 1);
    expect(lastUnit >= 0xdc00 && lastUnit <= 0xdfff).toBe(true); // 结尾是低代理=成对完整
  });
});

describe('ql-20260911-001-c0be manager.auditTable：表模式投影', () => {
  it('full-flow 信封 → 三态行投影 + 锚点短化 + totals；spawn 参数无 --file', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({
          command: 'scope-audit',
          change: '2026-09-10-change-scope-audit',
          mode: 'full-flow',
          ok: true,
          degradedReason: null,
          baseAnchor: '3f22d6b9b6d1f85415be416c5086e29cfd9998a4',
          totals: { files: 17, additions: 2196, deletions: 254 },
          rows: [
            { path: 'src/index.js', additions: 426, deletions: 17, kind: 'modified', planned: '修改', verdict: 'planned' },
            { path: 'CLAUDE.md', additions: 1, deletions: 1, kind: 'modified', planned: null, verdict: 'unplanned' },
            { path: 'logo.png', additions: null, deletions: null, kind: 'binary', planned: null, verdict: 'unplanned' },
          ],
          excluded: { foreignDeclared: [] },
          note: null,
        }),
        timedOut: false,
      },
    });
    const result = await h.manager.auditTable('2026-09-10-change-scope-audit');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('full-flow');
    expect(result.base_ref).toBe('3f22d6b9b6d1f85415be416c5086e29cfd9998a4');
    expect(result.anchor_label).toBe('3f22d6b');
    expect(result.totals).toEqual({ files: 17, additions: 2196, deletions: 254 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      path: 'src/index.js', additions: 426, deletions: 17, kind: 'modified',
      planned: '修改', verdict: 'planned', declared: null, attribution: null,
    });
    // 二进制行行数 null 原样（不出伪数据）
    expect(result.rows[2]!.additions).toBeNull();
    expect(result.truncated).toBe(false);
    expect(h.calls[0]!.args).toEqual([
      BIN, 'scope-audit', '--change', '2026-09-10-change-scope-audit', '--json',
    ]);
  });

  it('quick 信封 → attribution 行 + 语义锚原样不短化 + degraded 透传', async () => {
    const h = makeFileDiffHarness({
      outcome: {
        code: 0,
        stdout: JSON.stringify({
          mode: 'quick', ok: false,
          degradedReason: 'quick 会话 quick-xxxx 不存在（祖先链各 specBase 下均无 guard.json）',
          baseAnchor: null,
          totals: { files: 0, additions: 0, deletions: 0 },
          rows: [
            { path: 'docs/a.md', declared: false, additions: 0, deletions: 72, kind: 'deleted', attribution: 'undeclared' },
            { path: 'src/b.ts', declared: true, additions: 10, deletions: 2, kind: 'modified', attribution: 'declared' },
          ],
          excluded: { foreignDeclared: ['frontend/src/x.ts'] },
        }),
        timedOut: false,
      },
    });
    const result = await h.manager.auditTable('quick-xxxx');
    expect(result.mode).toBe('quick');
    expect(result.ok).toBe(false);
    expect(result.degraded_reason).toContain('不存在');
    expect(result.rows[1]!.attribution).toBe('declared');
    expect(result.excluded_foreign_declared).toEqual(['frontend/src/x.ts']);
  });

  it('rows 超 500 护栏 → 截断 + truncated=true；能力门复用共享执行器', async () => {
    const rows = Array.from({ length: 505 }, (_, i) => ({
      path: `src/f${i}.ts`, additions: 1, deletions: 0, kind: 'modified',
      verdict: 'planned',
    }));
    const h = makeFileDiffHarness({
      outcome: { code: 0, stdout: JSON.stringify({ ok: true, mode: 'full-flow', rows }), timedOut: false },
    });
    const result = await h.manager.auditTable('c1');
    expect(result.rows).toHaveLength(500);
    expect(result.truncated).toBe(true);

    // 能力门（旧 sillyspec 未知命令）同 fileDiff
    const old = makeFileDiffHarness({
      outcome: { code: 1, stdout: '', stderr: '❌ 未知命令: scope-audit', timedOut: false },
    });
    await expect(old.manager.auditTable('c1')).rejects.toMatchObject({
      code: 'sillyspec_capability_missing',
    });
  });
});

describe('ql-20260910-017-2006 daemon RPC 注册：sillyspec_file_diff', () => {
  it('handler 挂载并归一透传（非字符串参数归一空串交 manager 入口断言）', async () => {
    const manager = {
      getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
      probeLocal: vi.fn(async () => null),
      probeLatest: vi.fn(async () => null),
      requestUpgrade: vi.fn(async () => undefined),
      requestManualUpgrade: vi.fn(async () => undefined),
      checkAndUpgrade: vi.fn(async () => undefined),
      getStatusSnapshot: vi.fn(() => undefined),
      getStatusError: vi.fn(() => null),
      getStatusMapSnapshot: vi.fn((): undefined => undefined),
      runResolve: vi.fn(async () => undefined),
      runGhostCleanup: vi.fn(async () => undefined),
      isUpgradeInFlight: vi.fn(() => false),
      recordCommandResult: vi.fn(),
      getCommandResult: vi.fn((): null => null),
      conflictSnapshot: vi.fn(async () => ({})),
      fileDiff: vi.fn(async () => ({ ok: true })),
    };
    const daemon = new Daemon(
      makeConfig(),
      {} as never,
      null as never,
      { sessionManager: null, sillyspecManager: manager as never },
    );
    const ws = makeFakeWs();
    (daemon as unknown as { _registerSillySpecRpcHandler: (ws: unknown) => void })
      ._registerSillySpecRpcHandler(ws);

    expect(ws.handlers.has('sillyspec_conflict_snapshot')).toBe(true);
    const handler = ws.handlers.get('sillyspec_file_diff')!;
    expect(handler).toBeTypeOf('function');

    // 正常透传（字符串三参）
    await handler({ change: 'c1', file: 'src/a.ts', workspace_id: 'ws-1' });
    expect(manager.fileDiff).toHaveBeenCalledWith('c1', 'src/a.ts', 'ws-1');
    // 非字符串归一空串 → manager 入口断言（invalid_params 由 manager 抛）
    await handler({ change: 123, file: null });
    expect(manager.fileDiff).toHaveBeenLastCalledWith('', '', '');
  });
});
