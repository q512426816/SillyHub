// tests/runtime-handler.test.ts
// task-12（2026-08-19-runtime-live-daemon-read）：RuntimeHandler 四方法 + 注册器测试。
//
// 覆盖面（task-12 卡 + design §6.1/§6.3/§8 R-01/R-04）：
//   - read_progress：注入 sillyspecCmd（mock spawn）——成功解析 envelope；
//     旧版 sillyspec 无 dump（stdout 用法提示 + exit 非 0）→ method_not_found；
//     超时 → timeout；输出非 JSON → internal；data:null（无活跃变更）→ null。
//   - workspace_id 校验：非 UUID（含注入串）→ forbidden（shell:true 注入防线）。
//   - read_user_inputs / list_artifacts / read_artifact：真实临时目录 fs
//     （resolveSpecDir 重定向到 mkdtemp，不碰真实 HOME）。
//   - read_artifact：filename 预检矩阵（空/控制字符/绝对路径/../子路径 → forbidden）；
//     不存在 → not_found；超 1MB → artifact_too_large。
//   - 注册器（daemon.ts _registerRuntimeRpcHandler）：四方法名逐字对齐 design §6.1；
//     params 归一（非字符串 → 空串）；root_path 归一透传（task-04：字符串原样、
//     非字符串/空白/缺省 → undefined，readArtifact 第三参）；ws 无
//     registerRpcHandler 走 warn 不抛。
//   - 读点选择（2026-08-20-runtime-readpoint-repo-first task-01，D-01@v1）：
//     root_path 三道校验全过 → 读 <root>/.sillyspec/.runtime；元字符 / 越界 /
//     .runtime 缺失 → 记 warn 回退缓存不抛错；无 root_path → 缓存（现状回归）；
//     workspace_id 非法仍 forbidden（不被回退 catch 吞）；normalizeRootPathParam 归一。
//
// 测试形态：mock spawn（sillyspecCmd 构造注入）+ 真实临时目录 fs（vi.mock 重定向
// resolveSpecDir）+ Daemon 原型法 harness（file-rpc-explorer.test.ts 同打法）。

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RuntimeHandler,
  specCacheRootFor,
  normalizeRootPathParam,
  ARTIFACT_MAX_BYTES,
  SILLYSPEC_TIMEOUT_MS,
} from '../src/runtime-handler.js';
import { RpcError } from '../src/ws-client.js';
import { Daemon } from '../src/daemon.js';

const WS_ID = '12345678-1234-5678-1234-567812345678';

// resolveSpecDir 重定向状态（vi.hoisted 保证先于 vi.mock factory 可用）。
const redirectState = vi.hoisted(() => ({ dir: null as string | null }));

vi.mock('../src/spec-sync.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/spec-sync.js')>();
  const { join: pathJoin } = await import('node:path');
  return {
    ...orig,
    resolveSpecDir: (wsId: string) => {
      if (redirectState.dir !== null) return pathJoin(redirectState.dir, wsId);
      return orig.resolveSpecDir(wsId);
    },
  };
});

/** 断言 promise 以指定 code 的 RpcError reject（file-rpc-explorer.test.ts 同款）。 */
async function expectRpcError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(code);
    return;
  }
  throw new Error(`expected RpcError(${code}) but promise resolved`);
}

/** mock sillyspecCmd：可预设 stdout/stderr/ok/timedOut，记录收到的命令串。 */
function makeCmdRunner(preset?: Partial<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>) {
  const calls: string[] = [];
  const run = async (cmd: string, timeoutMs: number) => {
    calls.push(cmd);
    expect(timeoutMs).toBe(SILLYSPEC_TIMEOUT_MS);
    return {
      ok: preset?.ok ?? true,
      stdout: preset?.stdout ?? '',
      stderr: preset?.stderr ?? '',
      timedOut: preset?.timedOut ?? false,
    };
  };
  return { run, calls };
}

/** 临时目录 + .runtime 布局；resolveSpecDir 重定向至此，返回恢复函数。 */
async function withSpecRoot(): Promise<{ root: string; done: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-rt-handler-'));
  const rt = join(root, WS_ID);
  await mkdir(join(rt, '.runtime', 'artifacts'), { recursive: true });
  await writeFile(join(rt, '.runtime', 'user-inputs.md'), '# 输入\n第一条\n第二条\n', 'utf8');
  await writeFile(join(rt, '.runtime', 'artifacts', 'design.md'), '# 产物\n', 'utf8');
  await writeFile(join(rt, '.runtime', 'artifacts', 'plan.md'), '# 计划\n', 'utf8');
  redirectState.dir = root;
  return {
    root,
    done: async () => {
      redirectState.dir = null;
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * 仓库侧临时目录（模拟成员本机 <root_path>）：内容与缓存侧刻意不同
 * （'# 仓库读点\n' vs '# 输入…'），断言读到哪一侧读点即证。
 */
async function makeRepoRoot(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'sillyhub-rt-repo-'));
  await mkdir(join(repo, '.sillyspec', '.runtime', 'artifacts'), { recursive: true });
  await writeFile(join(repo, '.sillyspec', '.runtime', 'user-inputs.md'), '# 仓库读点\n', 'utf8');
  await writeFile(join(repo, '.sillyspec', '.runtime', 'artifacts', 'repo.md'), '# 仓库产物\n', 'utf8');
  return repo;
}

// ── specCacheRootFor：UUID 白名单（shell:true 注入防线）──────────────────────

describe('specCacheRootFor workspace_id 白名单', () => {
  it('合法 UUID 落在 .sillyhub/daemon/specs/<id> 下', () => {
    const p = specCacheRootFor(WS_ID);
    expect(p).toContain(join('.sillyhub', 'daemon', 'specs', WS_ID));
  });

  it.each([
    [''],
    ['not-a-uuid'],
    ['12345678-1234-5678-1234-56781234567'],
    ['12345678123456781234567812345678'],
    ['../../etc'],
    ['x; rm -rf /'],
    ['a && calc'],
    ['$(whoami)'],
    ['`id`'],
    ['12345678_1234_5678_1234_567812345678'],
  ])('拒绝 %s → forbidden', (wsId: string) => {
    expect(() => specCacheRootFor(wsId)).toThrowError(RpcError);
  });
});

// ── read_progress：mock spawn ────────────────────────────────────────────────

describe('RuntimeHandler.readProgress', () => {
  it('成功解析 envelope，progress 取 data', async () => {
    const data = { project: 'p', current_stage: 'execute', stages: {} };
    const { run } = makeCmdRunner({ stdout: JSON.stringify({ ok: true, data }) });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    expect((await h.readProgress(WS_ID)).progress).toEqual(data);
  });

  it('无活跃变更（data:null）→ progress null', async () => {
    const { run } = makeCmdRunner({
      stdout: JSON.stringify({ ok: false, data: null, errors: ['no active change'] }),
    });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    expect((await h.readProgress(WS_ID)).progress).toBeNull();
  });

  it('旧版 sillyspec（stdout 用法提示 + exit 非 0）→ method_not_found', async () => {
    const { run } = makeCmdRunner({
      ok: false,
      stdout:
        '用法: sillyspec progress <init|show|validate|reset|set-stage|add-step|update-step|complete-stage|dump>',
    });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await expectRpcError(h.readProgress(WS_ID), 'method_not_found');
  });

  it('超时 → timeout', async () => {
    const { run } = makeCmdRunner({ ok: false, timedOut: true });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await expectRpcError(h.readProgress(WS_ID), 'timeout');
  });

  it('输出非 JSON → internal', async () => {
    const { run } = makeCmdRunner({ stdout: 'not json at all' });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await expectRpcError(h.readProgress(WS_ID), 'internal');
  });

  it('非零退出且无用法提示 → internal', async () => {
    const { run } = makeCmdRunner({ ok: false, stderr: 'boom' });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await expectRpcError(h.readProgress(WS_ID), 'internal');
  });

  it('命令串含引号包裹的 --spec-dir + --json', async () => {
    const { run, calls } = makeCmdRunner({ stdout: JSON.stringify({ ok: true, data: {} }) });
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await h.readProgress(WS_ID);
    expect(calls[0]).toContain('sillyspec progress dump --spec-dir "');
    expect(calls[0]).toContain(WS_ID);
    expect(calls[0]).toContain('--json');
  });

  it('非法 workspace_id → forbidden（先于 spawn）', async () => {
    const { run, calls } = makeCmdRunner();
    const h = new RuntimeHandler({ sillyspecCmd: run });
    await expectRpcError(h.readProgress('x; calc'), 'forbidden');
    expect(calls).toHaveLength(0);
  });
});

// ── read_user_inputs / list_artifacts / read_artifact：真实 fs ──────────────

describe('RuntimeHandler 读文件三方法（resolveSpecDir 重定向）', () => {
  it('readUserInputs：存在 → 原文；缺失目录 → null', async () => {
    const env = await withSpecRoot();
    try {
      const h = new RuntimeHandler();
      expect((await h.readUserInputs(WS_ID)).content).toBe('# 输入\n第一条\n第二条\n');
      // 未初始化的 workspace（目录不存在）→ ENOENT → null。
      expect(
        (await h.readUserInputs('87654321-4321-8765-4321-876543218765')).content,
      ).toBeNull();
    } finally {
      await env.done();
    }
  });

  it('listArtifacts：列文件 + size/mtime；目录不存在 → 空数组；非文件跳过', async () => {
    const env = await withSpecRoot();
    try {
      const h = new RuntimeHandler();
      const { artifacts } = await h.listArtifacts(WS_ID);
      const names = artifacts.map((a) => a.filename).sort();
      expect(names).toEqual(['design.md', 'plan.md']);
      const design = artifacts.find((a) => a.filename === 'design.md')!;
      expect(design.size_bytes).toBeGreaterThan(0);
      expect(design.last_modified).toBeTruthy();
      // 子目录（非产物文件）被跳过。
      await mkdir(join(env.root, WS_ID, '.runtime', 'artifacts', 'subdir'), { recursive: true });
      const again = await h.listArtifacts(WS_ID);
      expect(again.artifacts.map((a) => a.filename)).not.toContain('subdir');
      // 未初始化 workspace → 空数组。
      expect(
        (await h.listArtifacts('87654321-4321-8765-4321-876543218765')).artifacts,
      ).toEqual([]);
    } finally {
      await env.done();
    }
  });

  it('readArtifact 预检矩阵 → forbidden（先于 fs）', async () => {
    const env = await withSpecRoot();
    try {
      const h = new RuntimeHandler();
      for (const bad of [
        '',
        'a\x00b',
        '/etc/passwd',
        'C:\\evil.md',
        '..',
        '../escape.md',
        'sub/dir/f.md',
        'a\\b.md',
      ]) {
        await expectRpcError(h.readArtifact(WS_ID, bad), 'forbidden');
      }
    } finally {
      await env.done();
    }
  });

  it('readArtifact：存在 → 原文；不存在 → not_found；超 1MB → artifact_too_large', async () => {
    const env = await withSpecRoot();
    try {
      const h = new RuntimeHandler();
      expect((await h.readArtifact(WS_ID, 'design.md')).content).toBe('# 产物\n');
      await expectRpcError(h.readArtifact(WS_ID, 'gone.md'), 'not_found');

      const bigPath = join(env.root, WS_ID, '.runtime', 'artifacts', 'big.bin');
      await writeFile(bigPath, Buffer.alloc(ARTIFACT_MAX_BYTES + 1, 0x61));
      await expectRpcError(h.readArtifact(WS_ID, 'big.bin'), 'artifact_too_large');
    } finally {
      await env.done();
    }
  });
});

// ── 读点选择（2026-08-20-runtime-readpoint-repo-first task-01，D-01@v1）──────

describe('RuntimeHandler 读点选择（仓库优先缓存回退）', () => {
  it('① root_path 合法（roots 内 + .runtime 存在）→ 读 <root>/.sillyspec/.runtime', async () => {
    const env = await withSpecRoot(); // 缓存侧（回退对比基准）
    const repo = await makeRepoRoot();
    try {
      const pathExists = vi.fn(async () => true);
      const { run, calls } = makeCmdRunner({ stdout: JSON.stringify({ ok: true, data: {} }) });
      const h = new RuntimeHandler({
        sillyspecCmd: run,
        rootsProvider: () => [repo],
        pathExists,
      });
      // readUserInputs / readArtifact：读仓库侧内容（与缓存侧内容区分，证读点）。
      expect((await h.readUserInputs(WS_ID, repo)).content).toBe('# 仓库读点\n');
      expect((await h.readArtifact(WS_ID, 'repo.md', repo)).content).toBe('# 仓库产物\n');
      // readProgress：--spec-dir 指向仓库 .sillyspec（spawn 命令随读点变化）。
      await h.readProgress(WS_ID, repo);
      expect(calls[0]).toContain(`sillyspec progress dump --spec-dir "${join(repo, '.sillyspec')}" --json`);
      // 第三道校验探测的是 <root>/.sillyspec/.runtime 目录。
      expect(pathExists).toHaveBeenCalledWith(join(repo, '.sillyspec', '.runtime'));
    } finally {
      await env.done();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('② root_path 含 shell 元字符 → 回退缓存不抛 forbidden（预检先于 fs 探测）', async () => {
    const env = await withSpecRoot();
    try {
      const pathExists = vi.fn(async () => true);
      const h = new RuntimeHandler({ rootsProvider: () => [env.root], pathExists });
      // 字符集抽查："'`$&|;()%%^（Windows 文件名本禁这些，串仍可构造——防线在 Unix）。
      for (const evil of [
        'C:\\x" & evil',
        '/tmp/a;b',
        'D:\\repo`id`',
        '/tmp/$(x)',
        'E:\\r%r^r',
        '/tmp/a|b',
        '/tmp/a<b>c',
        '/tmp/a\nb',
      ]) {
        // 不抛 forbidden；读到的是缓存侧内容（证回退），非仓库/报错。
        expect((await h.readUserInputs(WS_ID, evil)).content).toBe('# 输入\n第一条\n第二条\n');
      }
      // 元字符预检在最前，未触任何 fs 探测。
      expect(pathExists).not.toHaveBeenCalled();
    } finally {
      await env.done();
    }
  });

  it('③ root_path 越界（rootsProvider 不含它）→ 回退缓存不抛错', async () => {
    const env = await withSpecRoot();
    const repo = await makeRepoRoot(); // 真实目录（realpath 可解），但不在 roots 内
    try {
      const pathExists = vi.fn(async () => true);
      const h = new RuntimeHandler({ rootsProvider: () => [env.root], pathExists });
      // assertWithinAllowedRoots 抛 forbidden 被读点回退捕获，不向 RPC 冒泡。
      expect((await h.readUserInputs(WS_ID, repo)).content).toBe('# 输入\n第一条\n第二条\n');
      expect(pathExists).not.toHaveBeenCalled(); // 越界在存在性探测之前拦下
    } finally {
      await env.done();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('④ root_path 合法但 .runtime 不存在 → 回退缓存', async () => {
    const env = await withSpecRoot();
    const repo = await makeRepoRoot();
    try {
      const h = new RuntimeHandler({
        rootsProvider: () => [repo],
        pathExists: async () => false, // <root>/.sillyspec/.runtime 探测不存在
      });
      expect((await h.readUserInputs(WS_ID, repo)).content).toBe('# 输入\n第一条\n第二条\n');
    } finally {
      await env.done();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('⑤ 无 root_path → 缓存读点（现状回归；roots 注入在场也不切换）', async () => {
    const env = await withSpecRoot();
    const repo = await makeRepoRoot();
    try {
      const h = new RuntimeHandler({ rootsProvider: () => [repo], pathExists: async () => true });
      // 缺参 / 显式 undefined / 空串归一，三者都落缓存读点。
      expect((await h.readUserInputs(WS_ID)).content).toBe('# 输入\n第一条\n第二条\n');
      expect((await h.readUserInputs(WS_ID, undefined)).content).toBe('# 输入\n第一条\n第二条\n');
      expect((await h.readUserInputs(WS_ID, '')).content).toBe('# 输入\n第一条\n第二条\n');
      expect((await h.listArtifacts(WS_ID)).artifacts.map((a) => a.filename).sort()).toEqual([
        'design.md',
        'plan.md',
      ]);
    } finally {
      await env.done();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('⑥ workspace_id 非法 → 仍 forbidden（root_path 在场也不被回退 catch 吞）', async () => {
    const repo = await makeRepoRoot();
    try {
      const { run, calls } = makeCmdRunner();
      const h = new RuntimeHandler({
        sillyspecCmd: run,
        rootsProvider: () => [repo],
        pathExists: async () => true,
      });
      await expectRpcError(h.readUserInputs('not-a-uuid', repo), 'forbidden');
      await expectRpcError(h.readProgress('12345678_1234_5678_1234_567812345678', repo), 'forbidden');
      expect(calls).toHaveLength(0); // 先于 spawn 拒
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

// ── normalizeRootPathParam：RPC 参数归一 ────────────────────────────────────

describe('normalizeRootPathParam', () => {
  it('非空字符串原样返回（不做 trim 改值）', () => {
    expect(normalizeRootPathParam('C:\\repo')).toBe('C:\\repo');
    expect(normalizeRootPathParam(' C:\\repo ')).toBe(' C:\\repo ');
    expect(normalizeRootPathParam('/home/u/项目 目录')).toBe('/home/u/项目 目录');
  });

  it('数字/对象/布尔/null 等非字符串 → undefined', () => {
    for (const v of [42, 0, {}, [], true, null, undefined, Symbol('x')]) {
      expect(normalizeRootPathParam(v)).toBeUndefined();
    }
  });

  it('空串（含纯空白）→ undefined', () => {
    expect(normalizeRootPathParam('')).toBeUndefined();
    expect(normalizeRootPathParam('   ')).toBeUndefined();
    expect(normalizeRootPathParam('\t\n')).toBeUndefined();
  });
});

// ── 注册器（daemon.ts _registerRuntimeRpcHandler，原型法 harness）───────────

type RpcHandlerFn = (params: Record<string, unknown>) => Promise<unknown> | unknown;

function makeFakeWs(): {
  methods: Map<string, RpcHandlerFn>;
  registerRpcHandler: (method: string, handler: RpcHandlerFn) => void;
} {
  const methods = new Map<string, RpcHandlerFn>();
  return {
    methods,
    registerRpcHandler(method, handler) {
      methods.set(method, handler);
    },
  };
}

describe('daemon._registerRuntimeRpcHandler 注册器', () => {
  it('四方法名逐字对齐 design §6.1；params 归一转发 RuntimeHandler', async () => {
    const daemon = Object.create(Daemon.prototype) as unknown as {
      _config: { runtime_id: string };
      _logger: { warn: ReturnType<typeof vi.fn> };
      _runtimeHandler: RuntimeHandler;
      _registerRuntimeRpcHandler: (ws: unknown) => void;
    };
    daemon._config = { runtime_id: 'rt-test' };
    daemon._logger = { warn: vi.fn() };
    const calls: Array<{ method: string; args: unknown[] }> = [];
    daemon._runtimeHandler = {
      readProgress: async (wsId: string) => {
        calls.push({ method: 'readProgress', args: [wsId] });
        return { progress: null };
      },
      readUserInputs: async (wsId: string) => {
        calls.push({ method: 'readUserInputs', args: [wsId] });
        return { content: null };
      },
      listArtifacts: async (wsId: string) => {
        calls.push({ method: 'listArtifacts', args: [wsId] });
        return { artifacts: [] };
      },
      readArtifact: async (wsId: string, filename: string) => {
        calls.push({ method: 'readArtifact', args: [wsId, filename] });
        return { content: null };
      },
    } as unknown as RuntimeHandler;

    const ws = makeFakeWs();
    daemon._registerRuntimeRpcHandler(ws);

    expect([...ws.methods.keys()].sort()).toEqual([
      'runtime.list_artifacts',
      'runtime.read_artifact',
      'runtime.read_progress',
      'runtime.read_user_inputs',
    ]);

    // params 归一：workspace_id 非字符串 → 空串（由 handler 入口拒）。
    await ws.methods.get('runtime.read_progress')!({ workspace_id: WS_ID });
    await ws.methods.get('runtime.read_progress')!({ workspace_id: 42 });
    await ws.methods.get('runtime.read_artifact')!({ workspace_id: WS_ID, filename: 'a.md' });
    expect(calls).toEqual([
      { method: 'readProgress', args: [WS_ID] },
      { method: 'readProgress', args: [''] },
      { method: 'readArtifact', args: [WS_ID, 'a.md'] },
    ]);
  });

  it('root_path 归一透传（task-04，design §5.2）：字符串原样、非字符串/空白/缺省 → undefined', async () => {
    // 捕获全部实参（含可选尾参 rootPath）——防 daemon 侧 import 后未接线
    // （normalizeRootPathParam 引入但 handler 调用没透传）的回归。
    const daemon = Object.create(Daemon.prototype) as unknown as {
      _config: { runtime_id: string };
      _logger: { warn: ReturnType<typeof vi.fn> };
      _runtimeHandler: RuntimeHandler;
      _registerRuntimeRpcHandler: (ws: unknown) => void;
    };
    daemon._config = { runtime_id: 'rt-test' };
    daemon._logger = { warn: vi.fn() };
    const calls: Array<{ method: string; args: unknown[] }> = [];
    daemon._runtimeHandler = {
      readProgress: async (...args: unknown[]) => {
        calls.push({ method: 'readProgress', args });
        return { progress: null };
      },
      readUserInputs: async (...args: unknown[]) => {
        calls.push({ method: 'readUserInputs', args });
        return { content: null };
      },
      listArtifacts: async (...args: unknown[]) => {
        calls.push({ method: 'listArtifacts', args });
        return { artifacts: [] };
      },
      readArtifact: async (...args: unknown[]) => {
        calls.push({ method: 'readArtifact', args });
        return { content: null };
      },
    } as unknown as RuntimeHandler;

    const ws = makeFakeWs();
    daemon._registerRuntimeRpcHandler(ws);

    // 字符串 root_path 原样透传（不做 trim 改值）。
    await ws.methods.get('runtime.read_progress')!({ workspace_id: WS_ID, root_path: 'C:\\repo' });
    await ws.methods.get('runtime.read_user_inputs')!({
      workspace_id: WS_ID,
      root_path: ' C:\\repo ',
    });
    // readArtifact：rootPath 是第三参（workspace_id, filename, root_path）。
    await ws.methods.get('runtime.read_artifact')!({
      workspace_id: WS_ID,
      filename: 'a.md',
      root_path: 'C:\\repo',
    });
    // 非字符串 / 纯空白 / 缺省 → undefined（缓存读点），不是空串。
    await ws.methods.get('runtime.list_artifacts')!({ workspace_id: WS_ID, root_path: 42 });
    await ws.methods.get('runtime.read_artifact')!({
      workspace_id: WS_ID,
      filename: 'a.md',
      root_path: '   ',
    });
    await ws.methods.get('runtime.read_artifact')!({ workspace_id: WS_ID, filename: 'a.md' });

    expect(calls).toStrictEqual([
      { method: 'readProgress', args: [WS_ID, 'C:\\repo'] },
      { method: 'readUserInputs', args: [WS_ID, ' C:\\repo '] },
      { method: 'readArtifact', args: [WS_ID, 'a.md', 'C:\\repo'] },
      { method: 'listArtifacts', args: [WS_ID, undefined] },
      { method: 'readArtifact', args: [WS_ID, 'a.md', undefined] },
      { method: 'readArtifact', args: [WS_ID, 'a.md', undefined] },
    ]);
  });

  it('ws 无 registerRpcHandler → warn 不抛', () => {
    const daemon = Object.create(Daemon.prototype) as unknown as {
      _config: { runtime_id: string };
      _logger: { warn: ReturnType<typeof vi.fn> };
      _runtimeHandler: RuntimeHandler;
      _registerRuntimeRpcHandler: (ws: unknown) => void;
    };
    daemon._config = { runtime_id: 'rt-test' };
    daemon._logger = { warn: vi.fn() };
    daemon._runtimeHandler = new RuntimeHandler();
    expect(() => daemon._registerRuntimeRpcHandler({})).not.toThrow();
    expect(daemon._logger.warn).toHaveBeenCalledWith('ws_no_rpc_support', {
      daemon_local_id: 'rt-test',
    });
  });
});
