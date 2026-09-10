/**
 * task-01（2026-09-07-conflict-diff-compare）：sillyspec_conflict_snapshot RPC
 * daemon 侧行为先行固化（TDD 红态锚定，FR-07/FR-08 / D-001@v1 / D-004@v1 /
 * design §5 Phase 1、§7.1 契约）。task-02 落地实现后本文件转绿。
 *
 * 覆盖行为矩阵（tasks/task-01.md acceptance）：
 *   - RPC 分发：注册 sillyspec_conflict_snapshot，params（change/kind）原样
 *     透传 manager.conflictSnapshot；handler 抛 RpcError → _dispatchRpc 原样
 *     回填 error.code（ws-client 既有语义，本文件锚定到本 method）。
 *   - spec-tree 快照：临时 spec 根写 .sillyspec/.runtime/spec-sync-conflict-
 *     <change>.json（含 conflicting_paths），逐路径回 content/mtime/size；
 *     清单内缺失文件置 missing=true 不带 content。
 *   - 冲突记录缺失 / JSON 损坏 → 抛 RpcError 且 code 非 internal（backend
 *     504/错误映射可区分，design §7.1 注释约定 RpcError 通道）。
 *   - realpath 防逃逸：conflicting_paths 混入 .. 段与 junction/symlink 越界
 *     路径 → 拒读、不泄漏根外内容（file-rpc explorer 同款校验的双保险臂）。
 *   - 四道截断护栏之 daemon 腿三道：单文件 >256KB 置 truncated=true 缺省
 *     content；路径数 >300 截断；files 内容总字节 >4MB 时按信噪比排序
 *     （changes/<change>/ 优先、archive 沉底），溢出路径仅元信息且
 *     truncated=true。
 *   - 二进制：非 utf8 内容置 binary=true 不带 content。
 *   - ql_id：quick-* 名且 guard.json 存在回其 quicklogId；guard.json 缺失与
 *     非 quick 名均回 null。
 *   - progress 快照：kind=progress 读 .runtime/sync-conflict-<change>.json，
 *     并跑 progress show --json（全局 envelope，CLI --json 忽略 --change）由
 *     daemon 自行从 data.changes[] 过滤该 change 条目；local_updated_at 取
 *     last_active。
 *   - 无 spec 根：statusCwd 回 null → 抛 RpcError 且 code=no_spec_root。
 *   - 心跳补报：collectStatusOnce 后 pending_conflicts 的 quick 条带 ql_id；
 *     单条 guard.json 读失败仅缺省该条、不阻断其余条与心跳快照。
 *
 * 策略：照 sillyspec-platform-command.test.ts / sillyspec-manager.test.ts 惯例
 * （runProgressJson/resolveSillySpecBin/statusCwd 全依赖注入、零真实 spawn）+
 * mkdtemp 临时 spec 根（afterEach 清理，Windows 可直接跑；junction 免管理员，
 * EPERM/EXDEV 环境照 file-rpc-explorer.test.ts T9 先例跳过该臂）。
 * 被测接口 conflictSnapshot / _registerSillySpecRpcHandler 尚不存在（task-02
 * 实现）——本文件现阶段全红且红因为方法未实现，即红态锚定。
 *
 * @module sillyspec-conflict-snapshot.test
 */

import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import { SillySpecManager } from '../src/sillyspec-manager.js';
import type {
  SillySpecProgressOutcome,
  SillySpecStatusPendingConflict,
} from '../src/sillyspec-manager.js';
import { RpcError, WsClient } from '../src/ws-client.js';

// ── 公共 fixture ─────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

/** 完整 DaemonConfig fixture（照 sillyspec-platform-command.test.ts，循环间隔拉满防噪音）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-task01-cs',
    profile: 'default',
    workspace_dir: '/tmp/ws-task01-cs',
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

/** 含空格 Windows 风格 bin 路径（execFile 数组形参断言载体，照既有惯例）。 */
const BIN =
  'C:\\Users\\qinyi\\Idea Projects\\repo\\node_modules\\sillyspec\\bin\\sillyspec.js';

/** 冲突记录 created_at 固定值（快照 conflict_created_at 透传断言锚点）。 */
const CONFLICT_CREATED_AT = '2026-09-04T00:35:27.490Z';

// ── design §7.1 result 契约类型（仅锚公开字段名，不依赖实现私有形态）─────────

/** files[] 单项（content 在 truncated/binary/missing/越界拒读时缺省）。 */
interface SnapshotFileEntry {
  path: string;
  content?: string;
  mtime: string | null;
  size: number;
  truncated: boolean;
  binary: boolean;
  missing: boolean;
}

/** sillyspec_conflict_snapshot result（design §7.1）。 */
interface ConflictSnapshotResult {
  change: string;
  kind: string;
  ql_id: string | null;
  conflict_created_at: string;
  local_updated_at: string | null;
  files: SnapshotFileEntry[];
  progress: {
    current_stage: string;
    stage_label: string;
    last_active: string;
    steps: { total: number; completed: number };
    [k: string]: unknown;
  } | null;
}

/** progress 进度条目的全局 envelope 元素形态（data.changes[] 单项）。 */
interface ProgressEnvelopeChange {
  name: string;
  ghost: boolean;
  current_stage: string;
  stage_label: string;
  last_active: string;
  steps: { total: number; completed: number };
}

// ── 临时 spec 根布局 ─────────────────────────────────────────────────────────

const tmpRoots: string[] = [];

/** 建临时 workspace 主仓根（含 .sillyspec/.runtime 目录），afterEach 统一清理。 */
async function makeSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-conflict-snap-'));
  tmpRoots.push(root);
  await mkdir(join(root, '.sillyspec', '.runtime'), { recursive: true });
  return root;
}

/** 写 spec-tree 冲突记录 .sillyspec/.runtime/spec-sync-conflict-<change>.json。 */
async function writeSpecTreeConflictRecord(
  root: string,
  change: string,
  conflictingPaths: string[],
): Promise<void> {
  await writeFile(
    join(root, '.sillyspec', '.runtime', `spec-sync-conflict-${change}.json`),
    JSON.stringify({
      change,
      kind: 'spec-tree',
      created_at: CONFLICT_CREATED_AT,
      server_versions: {},
      conflicting_paths: conflictingPaths,
    }),
  );
}

/** 写 progress 冲突记录 .sillyspec/.runtime/sync-conflict-<change>.json。 */
async function writeProgressConflictRecord(root: string, change: string): Promise<void> {
  await writeFile(
    join(root, '.sillyspec', '.runtime', `sync-conflict-${change}.json`),
    JSON.stringify({ change, kind: 'progress', created_at: CONFLICT_CREATED_AT }),
  );
}

/** 写冲突文件 <root>/.sillyspec/<rel>（父目录自动建）。 */
async function writeSpecFile(root: string, rel: string, data: string | Buffer): Promise<void> {
  const abs = join(root, '.sillyspec', ...rel.split('/'));
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, data);
}

/** 写 quick 会话 guard.json（quicklogId 映射唯一来源，design §5 Phase 1 第 1 条）。 */
async function writeGuard(root: string, quickName: string, body: string): Promise<void> {
  const dir = join(root, '.sillyspec', '.runtime', 'quick-sessions', quickName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'guard.json'), body);
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ── manager harness（全依赖注入，零真实 spawn）───────────────────────────────

/**
 * conflictSnapshot 调用口：task-02 将实现 SillySpecManager.conflictSnapshot(change,
 * kind)；现阶段经 duck-type 直调，未实现时 TypeError（红因锚定，非断言误写）。
 */
function snapshot(
  manager: SillySpecManager,
  change: string,
  kind: 'spec-tree' | 'progress',
  workspaceId?: string,
): Promise<ConflictSnapshotResult> {
  const m = manager as unknown as {
    conflictSnapshot: (
      change: string,
      kind: 'spec-tree' | 'progress',
      workspaceId?: string,
    ) => Promise<ConflictSnapshotResult>;
  };
  return m.conflictSnapshot(change, kind, workspaceId);
}

/** 采集 harness：statusCwd 指向临时 spec 根（或 null=无根），runProgressJson 可编程。 */
function makeSnapshotHarness(opts: {
  root: string | null;
  envelope?: { data: { changes: ProgressEnvelopeChange[] } };
  /** workspace 级根解析器（2026-09-09-conflict-root-workspace-scoping task-01）：按 wsId 查映射根。 */
  rootFor?: (workspaceId: string) => string | null;
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
      return {
        code: 0,
        stdout: JSON.stringify(
          opts.envelope ?? {
            schema_version: 1,
            ok: true,
            generated_at: '2026-09-07T00:00:00+00:00',
            data: { changes: [], pending_conflicts: [] },
          },
        ),
        timedOut: false,
      };
    },
  );
  const manager = new SillySpecManager({
    runCommand: async () => null,
    install: async () => undefined,
    isBusy: () => false,
    now: () => 1_700_000_000_000,
    runProgressJson,
    resolveSillySpecBin: () => BIN,
    statusCwd: () => opts.root,
    statusRootFor: opts.rootFor,
    statusTimeoutMs: 5,
  });
  return { manager, calls, runProgressJson };
}

/** 宽松断言：e 为 RpcError 且 code 非 internal（记录缺失/损坏等可识别错误码通道）。 */
function expectRpcErrorNonInternal(e: unknown): asserts e is RpcError {
  expect(e).toBeInstanceOf(RpcError);
  expect((e as RpcError).code).not.toBe('internal');
}

// ── spec-tree 快照：正常路径 / 记录缺失 / 损坏 ───────────────────────────────

describe('task-01 spec-tree 快照：冲突记录驱动逐路径读取', () => {
  it('正常路径：逐路径回 content/mtime/size（截断/二进制/缺失全 false）；清单内缺失文件 missing=true 不带 content；local_updated_at=冲突文件 mtime 最大值', async () => {
    const root = await makeSpecRoot();
    const change = 'quick-62e1d5fb';
    await writeSpecFile(root, `changes/${change}/design.md`, '设计文档正文');
    await writeSpecFile(root, 'ROADMAP.md', 'roadmap-body');
    await writeSpecTreeConflictRecord(root, change, [
      `changes/${change}/design.md`,
      'ROADMAP.md',
      'changes/gone/missing.md', // 清单有、磁盘无 → missing=true
    ]);
    const h = makeSnapshotHarness({ root });

    const result = await snapshot(h.manager, change, 'spec-tree');

    // 顶层契约字段（design §7.1）。
    expect(result.change).toBe(change);
    expect(result.kind).toBe('spec-tree');
    expect(result.conflict_created_at).toBe(CONFLICT_CREATED_AT);
    expect(result.progress).toBeNull();

    const byPath = new Map(result.files.map((f) => [f.path, f]));
    expect(result.files).toHaveLength(3);

    const design = byPath.get(`changes/${change}/design.md`);
    expect(design).toBeDefined();
    expect(design!.content).toBe('设计文档正文');
    expect(design!.truncated).toBe(false);
    expect(design!.binary).toBe(false);
    expect(design!.missing).toBe(false);
    const designStat = await stat(join(root, '.sillyspec', 'changes', change, 'design.md'));
    expect(design!.size).toBe(designStat.size);
    expect(design!.mtime).toBe(designStat.mtime.toISOString());

    const roadmap = byPath.get('ROADMAP.md');
    expect(roadmap!.content).toBe('roadmap-body');
    const roadmapStat = await stat(join(root, '.sillyspec', 'ROADMAP.md'));
    expect(roadmap!.mtime).toBe(roadmapStat.mtime.toISOString());

    const missing = byPath.get('changes/gone/missing.md');
    expect(missing).toBeDefined();
    expect(missing!.missing).toBe(true);
    expect(missing!.content).toBeUndefined();

    // local_updated_at = 冲突文件 mtime 最大值（design §5 Phase 1）。
    const maxMtime = new Date(
      Math.max(designStat.mtimeMs, roadmapStat.mtimeMs),
    ).toISOString();
    expect(result.local_updated_at).toBe(maxMtime);
  });

  it('冲突记录缺失（spec-sync-conflict-<change>.json 不存在）→ 抛 RpcError 且 code 非 internal', async () => {
    const root = await makeSpecRoot();
    const h = makeSnapshotHarness({ root });
    const err = await snapshot(h.manager, 'no-such-change', 'spec-tree').then(
      () => null,
      (e: unknown) => e,
    );
    expectRpcErrorNonInternal(err);
  });

  it('冲突记录 JSON 损坏 → 抛 RpcError 且 code 非 internal（不回退空快照）', async () => {
    const root = await makeSpecRoot();
    const change = 'broken-json-change';
    await writeFile(
      join(root, '.sillyspec', '.runtime', `spec-sync-conflict-${change}.json`),
      '{ not valid json !!!',
    );
    const h = makeSnapshotHarness({ root });
    const err = await snapshot(h.manager, change, 'spec-tree').then(
      () => null,
      (e: unknown) => e,
    );
    expectRpcErrorNonInternal(err);
  });
});

// ── realpath 防逃逸（.. 段 + junction/symlink 越界）──────────────────────────

describe('task-01 realpath 防逃逸：拒读越界路径、不泄漏根外内容', () => {
  it('conflicting_paths 混入 .. 段与 junction 越界路径 → 越界条目不带 content、根外内容不出现在响应任何角落，根内兄弟文件照常读取', async () => {
    const root = await makeSpecRoot();
    const outside = await mkdtemp(join(tmpdir(), 'sillyhub-conflict-outside-'));
    tmpRoots.push(outside);
    const SECRET = 'SECRET-OUTSIDE-ROOT-CONTENT';
    await writeFile(join(outside, 'secret.txt'), SECRET);

    const change = 'escape-change';
    // mkdtemp 双方都在 tmpdir 直下：<root>/.sillyspec/../../<base(outside)> 即越界落点。
    const dotdotPath = `../../${outside.split(/[\\/]/).pop()!}/secret.txt`;
    const linkRel = 'escape-link/secret.txt';
    const paths = [`changes/${change}/ok.md`, dotdotPath, linkRel];
    await writeSpecFile(root, `changes/${change}/ok.md`, 'in-root-ok');
    await writeSpecTreeConflictRecord(root, change, paths);

    // junction 臂（Windows 免管理员；无权限环境照 T9 先例跳过该臂断言）。
    let junctionArmed = true;
    try {
      await symlink(outside, join(root, '.sillyspec', 'escape-link'), IS_WIN ? 'junction' : 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EXDEV') {
        junctionArmed = false;
      } else {
        throw e;
      }
    }

    const h = makeSnapshotHarness({ root });
    const result = await snapshot(h.manager, change, 'spec-tree');

    const byPath = new Map(result.files.map((f) => [f.path, f]));
    // 越界两条：拒读 = 不带 content；根外内容绝不泄漏（含错误信息/其它字段）。
    const dotdot = byPath.get(dotdotPath);
    expect(dotdot).toBeDefined();
    expect(dotdot!.content).toBeUndefined();
    if (junctionArmed) {
      const viaLink = byPath.get(linkRel);
      expect(viaLink).toBeDefined();
      expect(viaLink!.content).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain(SECRET);

    // 根内兄弟文件不受越界条目连坐（拒读是逐路径粒度）。
    expect(byPath.get(`changes/${change}/ok.md`)!.content).toBe('in-root-ok');
  });
});

// ── 截断护栏（单文件 256KB / 路径 300 / 聚合 4MB 信噪比排序）─────────────────

describe('task-01 截断护栏（design §8 风险表 daemon 腿三道）', () => {
  it('单文件 >256KB → truncated=true 且 content 缺省，元信息（size/mtime）仍在', async () => {
    const root = await makeSpecRoot();
    const change = 'big-file-change';
    const bigBody = 'a'.repeat(256 * 1024 + 1);
    await writeSpecFile(root, `changes/${change}/big.md`, bigBody);
    await writeSpecFile(root, `changes/${change}/small.md`, 'small-ok');
    await writeSpecTreeConflictRecord(root, change, [
      `changes/${change}/big.md`,
      `changes/${change}/small.md`,
    ]);
    const h = makeSnapshotHarness({ root });

    const result = await snapshot(h.manager, change, 'spec-tree');
    const byPath = new Map(result.files.map((f) => [f.path, f]));
    const big = byPath.get(`changes/${change}/big.md`)!;
    expect(big.truncated).toBe(true);
    expect(big.content).toBeUndefined();
    expect(big.size).toBe(256 * 1024 + 1);
    expect(big.missing).toBe(false);
    // 同批小文件不受连坐。
    expect(byPath.get(`changes/${change}/small.md`)!.content).toBe('small-ok');
  });

  it('路径数 >300 → files 截断至 300 条', async () => {
    const root = await makeSpecRoot();
    const change = 'many-paths-change';
    const paths: string[] = [];
    for (let i = 0; i < 305; i++) {
      const rel = `changes/${change}/f${String(i).padStart(3, '0')}.md`;
      await writeSpecFile(root, rel, `body-${i}`);
      paths.push(rel);
    }
    await writeSpecTreeConflictRecord(root, change, paths);
    const h = makeSnapshotHarness({ root });

    const result = await snapshot(h.manager, change, 'spec-tree');
    expect(result.files).toHaveLength(300);
  });

  it('files 内容总字节 >4MB → 按信噪比排序（changes/<change>/ 优先、archive 沉底），溢出路径仅元信息且 truncated=true，已收内容总量 ≤4MB', async () => {
    const root = await makeSpecRoot();
    const change = 'aggregate-cap-change';
    const chunk = 'x'.repeat(200 * 1024); // 单文件 <256KB（不吃单文件帽）
    // 本变更目录 1 个 + 归档 21 个 = 22 × 200KB = 4.4MB > 4MB 聚合帽。
    const ownRel = `changes/${change}/design.md`;
    const archiveRels: string[] = [];
    await writeSpecFile(root, ownRel, chunk);
    for (let i = 0; i < 21; i++) {
      const rel = `changes/archive/2020-01-0${(i % 9) + 1}-old/arch-${i}.md`;
      await writeSpecFile(root, rel, chunk);
      archiveRels.push(rel);
    }
    // 记录内故意把 archive 放前面——排序须由 daemon 按信噪比重排。
    await writeSpecTreeConflictRecord(root, change, [...archiveRels, ownRel]);
    const h = makeSnapshotHarness({ root });

    const result = await snapshot(h.manager, change, 'spec-tree');
    expect(result.files).toHaveLength(22);

    // 信噪比排序：本变更目录文件排第一，archive 全部沉底（在其后）。
    expect(result.files[0]!.path).toBe(ownRel);
    const ownIdx = result.files.findIndex((f) => f.path === ownRel);
    const archiveIdx = result.files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.path.startsWith('changes/archive/'))
      .map(({ i }) => i);
    expect(archiveIdx.every((i) => i > ownIdx)).toBe(true);

    // 聚合帽：带 content 的条目总字节 ≤4MB；被帽截断的条目 truncated=true 仅元信息。
    let totalContentBytes = 0;
    for (const f of result.files) {
      if (f.content !== undefined) {
        totalContentBytes += Buffer.byteLength(f.content, 'utf8');
        expect(f.truncated).toBe(false);
      } else {
        expect(f.truncated).toBe(true);
        expect(f.size).toBe(200 * 1024);
        expect(typeof f.mtime).toBe('string');
      }
    }
    expect(totalContentBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    // 确实有溢出（4.4MB 总量不可能全带内容）。
    expect(result.files.some((f) => f.truncated)).toBe(true);
  });
});

// ── 二进制 ───────────────────────────────────────────────────────────────────

describe('task-01 二进制护栏', () => {
  it('非 utf8 内容 → binary=true 且不带 content（截断/缺失均 false）', async () => {
    const root = await makeSpecRoot();
    const change = 'binary-change';
    // JPEG magic + 非法 utf8 序列，任何 utf8 探测都应判二进制。
    await writeSpecFile(
      root,
      `changes/${change}/img.jpg`,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xc3, 0x28]),
    );
    await writeSpecTreeConflictRecord(root, change, [`changes/${change}/img.jpg`]);
    const h = makeSnapshotHarness({ root });

    const result = await snapshot(h.manager, change, 'spec-tree');
    const img = result.files[0]!;
    expect(img.binary).toBe(true);
    expect(img.content).toBeUndefined();
    expect(img.truncated).toBe(false);
    expect(img.missing).toBe(false);
    expect(img.size).toBe(8);
  });
});

// ── ql_id（quick-* 名 guard.json best-effort 映射，D-004@v1）─────────────────

describe('task-01 ql_id：quick 会话名 → guard.json quicklogId', () => {
  it('quick-* 名且 guard.json 存在 → ql_id=quicklogId；guard.json 缺失 → null；非 quick 名 → null', async () => {
    const root = await makeSpecRoot();
    const quickWithGuard = 'quick-62e1d5fb';
    await writeGuard(root, quickWithGuard, JSON.stringify({ quicklogId: 'ql-20260904-002-62e1' }));
    for (const change of [quickWithGuard, 'quick-aac62562', '2026-09-02-changes-overview-card']) {
      await writeSpecTreeConflictRecord(root, change, []);
    }
    const h = makeSnapshotHarness({ root });

    const withGuard = await snapshot(h.manager, quickWithGuard, 'spec-tree');
    expect(withGuard.ql_id).toBe('ql-20260904-002-62e1');

    const noGuard = await snapshot(h.manager, 'quick-aac62562', 'spec-tree');
    expect(noGuard.ql_id).toBeNull();

    const nonQuick = await snapshot(
      h.manager,
      '2026-09-02-changes-overview-card',
      'spec-tree',
    );
    expect(nonQuick.ql_id).toBeNull();
  });
});

// ── progress 快照（kind=progress）────────────────────────────────────────────

describe('task-01 progress 快照：全局 envelope 过滤该 change 条目', () => {
  it('读 .runtime/sync-conflict-<change>.json + progress show --json 全局 envelope → progress=过滤条目、local_updated_at=last_active、files 空', async () => {
    const root = await makeSpecRoot();
    const change = '2026-09-02-changes-overview-card';
    await writeProgressConflictRecord(root, change);
    const target: ProgressEnvelopeChange = {
      name: change,
      ghost: false,
      current_stage: 'execute',
      stage_label: '波次执行',
      last_active: '2026-09-07T01:02:03+00:00',
      steps: { total: 8, completed: 3 },
    };
    const other: ProgressEnvelopeChange = {
      name: 'other-change',
      ghost: true,
      current_stage: 'archive',
      stage_label: '归档',
      last_active: '2026-08-01T00:00:00+00:00',
      steps: { total: 4, completed: 4 },
    };
    const h = makeSnapshotHarness({
      root,
      envelope: { data: { changes: [other, target] } },
    });

    const result = await snapshot(h.manager, change, 'progress');

    expect(result.kind).toBe('progress');
    expect(result.conflict_created_at).toBe(CONFLICT_CREATED_AT);
    expect(result.files).toEqual([]);
    // CLI --json 分支忽略 --change、恒回全局 envelope——daemon 自行过滤该 change。
    expect(result.progress).not.toBeNull();
    expect(result.progress!.current_stage).toBe('execute');
    expect(result.progress!.stage_label).toBe('波次执行');
    expect(result.progress!.steps).toEqual({ total: 8, completed: 3 });
    expect(result.progress!.last_active).toBe('2026-09-07T01:02:03+00:00');
    expect(result.local_updated_at).toBe('2026-09-07T01:02:03+00:00');

    // 执行形态：execFile 数组形参 [bin, progress, show, --json]，cwd=spec 根。
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.file).toBe(process.execPath);
    expect(h.calls[0]!.args).toEqual([BIN, 'progress', 'show', '--json']);
    expect(h.calls[0]!.options.cwd).toBe(root);
  });
});

// ── 无 spec 根 ───────────────────────────────────────────────────────────────

describe('task-01 无 spec 根', () => {
  it('statusCwd 回 null → 抛 RpcError 且 code=no_spec_root（design §7.1 锚定码）', async () => {
    const h = makeSnapshotHarness({ root: null });
    const err = await snapshot(h.manager, 'any-change', 'spec-tree').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe('no_spec_root');
  });
});

// ── workspace_id 取根（2026-09-09-conflict-root-workspace-scoping task-01 / FR-02/FR-03）──

const WS_ID = 'b97f8231-9404-43bd-89de-38c281c4d875';

describe('task-01 workspace_id 取根：映射查根，未命中不回退单槽位', () => {
  it('带 ws 且映射命中 → 用映射根出快照（statusCwd=null 也不受单槽位影响）', async () => {
    const root = await makeSpecRoot();
    const change = 'quick-77aa11bb';
    await writeSpecFile(root, `changes/${change}/design.md`, '工作区根内容');
    await writeSpecTreeConflictRecord(root, change, [`changes/${change}/design.md`]);
    // 单槽位被投毒为 null（statusCwd 不可用），仅映射根可解析。
    const h = makeSnapshotHarness({ root: null, rootFor: () => root });

    const result = await snapshot(h.manager, change, 'spec-tree', WS_ID);

    expect(result.change).toBe(change);
    expect(result.files[0]!.content).toBe('工作区根内容');
  });

  it('带 ws 且映射未命中 → workspace_root_unknown（单槽位有值也不回退，FR-02 铁律）', async () => {
    const root = await makeSpecRoot();
    const change = 'quick-88bb22cc';
    await writeSpecFile(root, `changes/${change}/design.md`, '单槽位内容');
    await writeSpecTreeConflictRecord(root, change, [`changes/${change}/design.md`]);
    // 单槽位合法（root），但映射未命中 → 必须报错而非退回单槽位。
    const h = makeSnapshotHarness({ root, rootFor: () => null });

    const err = await snapshot(h.manager, change, 'spec-tree', WS_ID).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe('workspace_root_unknown');
  });

  it('不带 ws → legacy 单槽位照常（statusRootFor 有值也不参与，FR-03 回归）', async () => {
    const root = await makeSpecRoot();
    const change = 'quick-99cc33dd';
    await writeSpecFile(root, `changes/${change}/design.md`, '单槽位路径内容');
    await writeSpecTreeConflictRecord(root, change, [`changes/${change}/design.md`]);
    const h = makeSnapshotHarness({ root, rootFor: () => '/nonexistent-root' });

    const result = await snapshot(h.manager, change, 'spec-tree');

    expect(result.files[0]!.content).toBe('单槽位路径内容');
  });
});

// ── 心跳 ql_id 补报（collectStatusOnce 后处理，best-effort）──────────────────

describe('task-01 心跳补报：pending_conflicts 的 quick 条带 ql_id', () => {
  it('quick 条 guard.json 存在 → ql_id 补入；单条 guard.json 损坏仅该条缺省 null，不阻断其余条与整拍快照', async () => {
    const root = await makeSpecRoot();
    await writeGuard(root, 'quick-aaaa1111', JSON.stringify({ quicklogId: 'ql-20260907-006-2972' }));
    await writeGuard(root, 'quick-bbbb2222', '{ corrupted guard json'); // 读失败臂
    // quick-cccc3333 无 guard.json（已清理存量冲突，design §8 低风险行）。
    const envelope = {
      schema_version: 1,
      ok: true,
      generated_at: '2026-09-07T03:00:00+00:00',
      data: {
        active_changes: 1,
        changes: [
          {
            name: '2026-09-02-changes-overview-card',
            ghost: false,
            current_stage: 'execute',
            stage_label: '执行',
            last_active: '2026-09-07T02:59:00+00:00',
            steps: { total: 8, completed: 3 },
          },
        ],
        pending_conflicts: [
          { change: 'quick-aaaa1111', created_at: 't1', type: 'spec-tree' },
          { change: 'quick-bbbb2222', created_at: 't2', type: 'spec-tree' },
          { change: 'quick-cccc3333', created_at: 't3', type: 'progress' },
          { change: '2026-09-02-changes-overview-card', created_at: 't4', type: 'spec-tree' },
        ],
      },
    };
    const h = makeSnapshotHarness({ root, envelope });

    // 单条失败不阻断整拍：collectStatusOnce 照常收敛，快照落定。
    await expect(h.manager.collectStatusOnce()).resolves.toBeUndefined();
    const snap = h.manager.getStatusSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.pending_conflicts).toHaveLength(4);

    const byChange = new Map(
      snap!.pending_conflicts.map((c) => [
        c.change,
        c as SillySpecStatusPendingConflict & { ql_id?: string | null },
      ]),
    );
    expect(byChange.get('quick-aaaa1111')!.ql_id).toBe('ql-20260907-006-2972');
    // 损坏/缺失 guard 仅缺省该条（null），其余字段三键投影原样。
    expect(byChange.get('quick-bbbb2222')!.ql_id ?? null).toBeNull();
    expect(byChange.get('quick-cccc3333')!.ql_id ?? null).toBeNull();
    expect(byChange.get('quick-bbbb2222')!.created_at).toBe('t2');
    // 非 quick 条不带 ql_id（或为 null——DTO 可选字段两态皆可）。
    expect(byChange.get('2026-09-02-changes-overview-card')!.ql_id ?? null).toBeNull();
  });
});

// ── RPC 分发（daemon._registerSillySpecRpcHandler → ws-client._dispatchRpc）───

describe('task-01 RPC 分发：sillyspec_conflict_snapshot 注册与透传', () => {
  /**
   * 注册 harness：真实构造 Daemon 注入假 manager，直调私有注册法拿 handler。
   * task-02 未实现时 _registerSillySpecRpcHandler 不存在 → TypeError 红因锚定。
   */
  function makeRegistrationHarness() {
    const manager = {
      getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
      probeLocal: vi.fn(async () => null),
      probeLatest: vi.fn(async () => null),
      requestUpgrade: vi.fn(async () => undefined),
      requestManualUpgrade: vi.fn(async () => undefined),
      checkAndUpgrade: vi.fn(async () => undefined),
      getStatusSnapshot: vi.fn(() => undefined),
      runResolve: vi.fn(async () => undefined),
      runGhostCleanup: vi.fn(async () => undefined),
      isUpgradeInFlight: vi.fn(() => false),
      recordCommandResult: vi.fn(),
      getCommandResult: vi.fn((): null => null),
      conflictSnapshot: vi.fn(async (_change: string, _kind: string, _ws?: string) => ({
        change: _change,
        kind: _kind,
        ql_id: null,
        conflict_created_at: CONFLICT_CREATED_AT,
        local_updated_at: null,
        files: [],
        progress: null,
      })),
    };
    const daemon = new Daemon(
      makeConfig(),
      { heartbeat: vi.fn(async () => ({})) } as never,
      null as never,
      { sessionManager: null, sillyspecManager: manager as never },
    );
    const ws = { registerRpcHandler: vi.fn() };
    (daemon as unknown as { _registerSillySpecRpcHandler: (w: unknown) => void })
      ._registerSillySpecRpcHandler(ws);
    const registration = ws.registerRpcHandler.mock.calls.find(
      (c) => c[0] === 'sillyspec_conflict_snapshot',
    );
    expect(registration).toBeDefined();
    const handler = registration![1] as (params: Record<string, unknown>) => Promise<unknown>;
    return { manager, handler };
  }

  it('注册后 params（change/kind/workspace_id）原样透传 manager.conflictSnapshot，result 直回', async () => {
    const { manager, handler } = makeRegistrationHarness();
    const result = await handler({
      change: 'quick-62e1d5fb',
      kind: 'spec-tree',
      workspace_id: WS_ID,
    });
    expect(manager.conflictSnapshot).toHaveBeenCalledTimes(1);
    expect(manager.conflictSnapshot).toHaveBeenCalledWith('quick-62e1d5fb', 'spec-tree', WS_ID);
    // 无 workspace_id（旧客户端）→ 归一空串 = legacy 单槽位（FR-03）。
    await handler({ change: 'quick-62e1d5fb', kind: 'spec-tree' });
    expect(manager.conflictSnapshot).toHaveBeenLastCalledWith('quick-62e1d5fb', 'spec-tree', '');
    expect(result).toMatchObject({
      change: 'quick-62e1d5fb',
      kind: 'spec-tree',
      conflict_created_at: CONFLICT_CREATED_AT,
    });
  });

  it('handler 抛 RpcError → _dispatchRpc 原样回填 error.code（no_spec_root 不降级 internal）', async () => {
    const { manager, handler } = makeRegistrationHarness();
    manager.conflictSnapshot.mockRejectedValueOnce(
      new RpcError('no_spec_root', '无已知 workspace 主仓根'),
    );
    const client = new WsClient({ serverUrl: 'http://127.0.0.1:1', runtimeId: 'r1' });
    client.registerRpcHandler('sillyspec_conflict_snapshot', handler);
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => true);

    await (
      client as unknown as {
        _dispatchRpc: (msg: {
          type: string;
          payload: { rpc_id: string; method: string; params: Record<string, unknown> };
        }) => Promise<void>;
      }
    )._dispatchRpc({
      type: MSG.RPC,
      payload: {
        rpc_id: 'rpc-cs-1',
        method: 'sillyspec_conflict_snapshot',
        params: { change: 'c1', kind: 'progress' },
      },
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const out = sendSpy.mock.calls[0]![0] as {
      type: string;
      payload: { rpc_id: string; result?: unknown; error?: { code: string; message: string } };
    };
    expect(out.type).toBe(MSG.RPC_RESULT);
    expect(out.payload.rpc_id).toBe('rpc-cs-1');
    expect(out.payload.error?.code).toBe('no_spec_root');
    expect(out.payload.result).toBeUndefined();
    // kind=progress 同样透传（与上一用例合证 params 不丢不改）。
    expect(manager.conflictSnapshot).toHaveBeenCalledWith('c1', 'progress', '');
  });
});
