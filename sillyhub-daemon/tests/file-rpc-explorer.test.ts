// tests/file-rpc-explorer.test.ts
// task-03（2026-08-18-workspace-file-browser）：daemon 注册 explorer_* 三 RPC handler
// + 经注册路径的安全矩阵（design §5 关键安全设计 / §7.1 / R-01）。
//
// 覆盖面（task-03.md implementation 第 4 条矩阵）：
//   - 注册器：三方法名逐字对齐 design §7.1；ws 无 registerRpcHandler 走 warn 不抛。
//   - realpath 逃逸：工作区内 symlink/junction 指向 root 外 → forbidden（R-01）。
//   - `..` 与绝对路径越界 → forbidden；params 缺省/类型不对 → forbidden。
//   - root 为 junction 不误拒（realpath 双方解析）。
//   - 超 10MB truncated=true（截断先于传输）；二进制嗅探 binary=true + base64 兜底；
//     encoding=base64 字节精确；非法 encoding 拒 forbidden。
//   - 搜索：噪声目录跳过、默认/显式上限 100、truncated 真值语义（达上限且确有
//     未遍历内容才 true）、空 query forbidden、相对路径 POSIX `/` 分隔。
//   - roots 现取：注册后改 allowed_roots 下次调用立即生效（非快照）；空 roots
//     必拒（守卫「不得照抄裸 list_dir 空 roots 跳校验」，design §5 警示条）。
//
// 测试形态：不构造完整 Daemon（依赖重），用 Object.create(Daemon.prototype) 原型法
// 只喂 _registerExplorerRpcHandler / _effectiveAllowedRoots 触及的 4 个字段，经
// fake WsClientLike 捕获 handler 后按真实注册路径逐 params 调用（行为矩阵走
// handler → file-rpc.explorer* 全链路，非直接调函数）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { RpcError } from '../src/ws-client.js';
import { EXPLORER_MAX_READ_BYTES } from '../src/file-rpc.js';

const IS_WIN = platform() === 'win32';

// ── fixture ─────────────────────────────────────────────────────────────────

/** 断言 promise 以指定 code 的 RpcError reject（全文件共用）。 */
async function expectRpcError(
  p: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(code);
    return;
  }
  throw new Error(`expected RpcError(${code}) but promise resolved`);
}

type RpcHandlerFn = (params: Record<string, unknown>) => Promise<unknown> | unknown;

/** 轻量 fake WsClientLike：捕获 registerRpcHandler 注册的 (method, handler)。 */
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

/**
 * Daemon 原型法 harness：只喂 _registerExplorerRpcHandler 与其调用链
 * （_effectiveAllowedRoots → _config.allowed_roots / _policyCache /
 * _registeredRuntimes）触及的字段，不跑构造器（Client/TaskRunner 等重依赖不搭）。
 */
type DaemonInternals = {
  _config: { runtime_id: string; allowed_roots: string[] } & DaemonConfig;
  _logger: { warn: ReturnType<typeof vi.fn> };
  _policyCache: unknown;
  _registeredRuntimes: Map<string, string>;
  _registerExplorerRpcHandler: (ws: unknown) => void;
};

function makeHarness(allowedRoots: string[]): {
  daemon: DaemonInternals;
  methods: Map<string, RpcHandlerFn>;
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  setAllowedRoots: (roots: string[]) => void;
} {
  const daemon = Object.create(Daemon.prototype) as unknown as DaemonInternals;
  daemon._config = {
    runtime_id: 'rt-explorer-test',
    allowed_roots: [...allowedRoots],
  } as DaemonInternals['_config'];
  daemon._logger = { warn: vi.fn() };
  daemon._policyCache = null; // _effectiveAllowedRoots 对 null 直接跳过 policy 分支
  daemon._registeredRuntimes = new Map();
  const ws = makeFakeWs();
  daemon._registerExplorerRpcHandler(ws);
  return {
    daemon,
    methods: ws.methods,
    call: (method, params) => {
      const h = ws.methods.get(method);
      if (!h) throw new Error(`handler not registered: ${method}`);
      return Promise.resolve(h(params));
    },
    setAllowedRoots: (roots) => {
      daemon._config.allowed_roots = [...roots];
    },
  };
}

/** 临时工作区根 + 桩文件（a/ c/ 目录 + b.txt，同 file-rpc.test.ts 惯例）。 */
async function makeRoot(): Promise<{
  root: string;
  abs: (rel: string) => string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-matrix-'));
  const abs = (rel: string): string => join(root, rel);
  await mkdir(abs('a'));
  await writeFile(abs('b.txt'), 'hello');
  return { root, abs };
}

/** root 外的诱饵目录（含 secret.txt）——用于逃逸/越界断言的目标落点。 */
async function makeOutside(): Promise<{
  outside: string;
  secret: string;
}> {
  const outside = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-out-'));
  const secret = join(outside, 'secret.txt');
  await writeFile(secret, 'top-secret');
  return { outside, secret };
}

// ── 注册器（方法名逐字对齐 design §7.1）──────────────────────────────────────

describe('explorer 注册器 — _registerExplorerRpcHandler（task-03）', () => {
  it('注册且仅注册三个方法：explorer_list_dir / explorer_read_file / explorer_search', () => {
    const h = makeHarness(['/tmp/whatever-root']);
    expect([...h.methods.keys()].sort()).toEqual([
      'explorer_list_dir',
      'explorer_read_file',
      'explorer_search',
    ]);
  });

  it('ws 无 registerRpcHandler（鸭子类型可选）→ warn ws_no_rpc_support，不抛', () => {
    const daemon = Object.create(Daemon.prototype) as unknown as DaemonInternals;
    daemon._config = {
      runtime_id: 'rt-no-rpc',
      allowed_roots: [],
    } as DaemonInternals['_config'];
    daemon._logger = { warn: vi.fn() };
    daemon._policyCache = null;
    daemon._registeredRuntimes = new Map();
    expect(() =>
      daemon._registerExplorerRpcHandler({ connect() {} }),
    ).not.toThrow();
    expect(daemon._logger.warn).toHaveBeenCalledWith(
      'ws_no_rpc_support',
      expect.objectContaining({ daemon_local_id: 'rt-no-rpc' }),
    );
  });
});

// ── explorer_list_dir 经注册路径 ─────────────────────────────────────────────

describe('explorer_list_dir — 经注册路径的越界与列举矩阵（R-01）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let h: ReturnType<typeof makeHarness>;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    h = makeHarness([root]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('合法 path=root → entries 含 name/type/size/mtime，dir 优先 + 字母序', async () => {
    const res = (await h.call('explorer_list_dir', {
      path: root,
      root,
    })) as { entries: { name: string; type: string; size: number; mtime: string }[] };
    expect(res.entries.map((e) => e.name)).toEqual(['a', 'b.txt']);
    const b = res.entries.find((e) => e.name === 'b.txt')!;
    expect(b.type).toBe('file');
    expect(b.size).toBe(5);
    expect(b.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('params 缺 path / path 非字符串 / 缺 root → forbidden（归一为空串由入口断言拒）', async () => {
    await expectRpcError(
      h.call('explorer_list_dir', { root }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_list_dir', { path: 123, root }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_list_dir', { path: root }),
      'forbidden',
    );
  });

  it('`..` 穿越：path 经 root/.. 落到 root 外真实存在的诱饵 → forbidden', async () => {
    const { outside, secret } = await makeOutside();
    try {
      // root 与 outside 同为 tmpdir 下的 mkdtemp 兄弟目录：
      // join 折叠 root/.. 后落点 = outside（真实存在），区别于拼错路径的 not_found。
      const traversalDir = join(root, '..', basename(outside));
      expect(dirname(traversalDir)).toBe(dirname(root)); // 确在 root 外一层
      await expectRpcError(
        h.call('explorer_list_dir', { path: traversalDir, root }),
        'forbidden',
      );
      // read_file 同一逃逸面（R-01：两层校验对读路径同样生效）
      await expectRpcError(
        h.call('explorer_read_file', {
          path: join(traversalDir, basename(secret)),
          root,
        }),
        'forbidden',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('绝对路径直接在 root 外（诱饵目录/文件）→ forbidden（list_dir + read_file）', async () => {
    const { outside, secret } = await makeOutside();
    try {
      await expectRpcError(
        h.call('explorer_list_dir', { path: outside, root }),
        'forbidden',
      );
      await expectRpcError(
        h.call('explorer_read_file', { path: secret, root }),
        'forbidden',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('realpath 逃逸：工作区内 junction/symlink 指向 root 外 → forbidden（Win 用 junction 免管理员）', async () => {
    const { outside, secret } = await makeOutside();
    try {
      try {
        await symlink(outside, abs('escape-dir'), IS_WIN ? 'junction' : 'dir');
      } catch (e) {
        // 无 symlink 权限的环境（EPERM/EXDEV）按 T9 先例跳过本用例
        if (
          (e as NodeJS.ErrnoException).code === 'EPERM' ||
          (e as NodeJS.ErrnoException).code === 'EXDEV'
        ) {
          return;
        }
        throw e;
      }
      // 经链接列目录 → realpath 落点在 realRoot 外 → forbidden
      await expectRpcError(
        h.call('explorer_list_dir', { path: abs('escape-dir'), root }),
        'forbidden',
      );
      // 经链接读文件（越权读宿主任意文件的主通道，R-01 核心）→ forbidden
      await expectRpcError(
        h.call('explorer_read_file', {
          path: join(abs('escape-dir'), 'secret.txt'),
          root,
        }),
        'forbidden',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 10_000);

  it('root 本身是 junction/symlink 不误拒（realpath 双方解析 + roots 条目归一）', async () => {
    const real = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-real-'));
    await writeFile(join(real, 'in-root.txt'), 'hi');
    const link = join(tmpdir(), `sillyhub-explorer-link-${Date.now()}`);
    try {
      try {
        await symlink(real, link, IS_WIN ? 'junction' : 'dir');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
        throw e;
      }
      // allowed_roots 配置成链接形态；path/root 也用链接形态 → realpath 后同落点放行
      const h2 = makeHarness([link]);
      const res = (await h2.call('explorer_list_dir', {
        path: link,
        root: link,
      })) as { entries: { name: string }[] };
      expect(res.entries.map((e) => e.name)).toContain('in-root.txt');
      // root 用链接、path 用真实路径 → 双方 realpath 相等 → 放行
      const res2 = (await h2.call('explorer_list_dir', {
        path: real,
        root: link,
      })) as { entries: { name: string }[] };
      expect(res2.entries.map((e) => e.name)).toContain('in-root.txt');
    } finally {
      await rm(link, { recursive: true, force: true }); // 只删链接本体
      await rm(real, { recursive: true, force: true });
    }
  }, 10_000);
});

// ── explorer_read_file 经注册路径 ────────────────────────────────────────────

describe('explorer_read_file — 截断/编码/二进制矩阵经注册路径', () => {
  let root: string;
  let abs: (rel: string) => string;
  let h: ReturnType<typeof makeHarness>;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    h = makeHarness([root]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('encoding 缺省 utf8：文本原文 + binary=false + truncated=false', async () => {
    const res = (await h.call('explorer_read_file', {
      path: abs('b.txt'),
      root,
    })) as { name: string; content: string; binary: boolean; truncated: boolean };
    expect(res.name).toBe('b.txt');
    expect(res.content).toBe('hello');
    expect(res.binary).toBe(false);
    expect(res.truncated).toBe(false);
  });

  it('encoding=base64 字节精确：解码回原字节（download 链路语义）', async () => {
    // BOM + 'hi' + NUL + 0xff：含非 ASCII 与 NUL，验证 base64 通道字节精确不往返损坏
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69, 0x00, 0xff]);
    await writeFile(abs('blob.bin'), bytes);
    const res = (await h.call('explorer_read_file', {
      path: abs('blob.bin'),
      root,
      encoding: 'base64',
    })) as { content: string; binary: boolean };
    expect(Buffer.from(res.content, 'base64').equals(bytes)).toBe(true);
    expect(res.binary).toBe(true); // NUL 嗅探照实返回
  });

  it('二进制（NUL 字节，encoding 缺省）→ binary=true + content 为 base64 兜底（不报错）', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await writeFile(abs('bin.dat'), bytes);
    const res = (await h.call('explorer_read_file', {
      path: abs('bin.dat'),
      root,
    })) as { binary: boolean; content: string };
    expect(res.binary).toBe(true);
    expect(res.content).toBe(bytes.toString('base64'));
  });

  it('非法 encoding（"hex" / 数字）→ RpcError forbidden，不静默回退', async () => {
    await expectRpcError(
      h.call('explorer_read_file', {
        path: abs('b.txt'),
        root,
        encoding: 'hex',
      }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_read_file', {
        path: abs('b.txt'),
        root,
        encoding: 42,
      }),
      'forbidden',
    );
  });

  it('超 10MB → truncated=true 且 content 恰为前 10MB（截断先于传输，R-04/D-004@v1）', async () => {
    const buf = Buffer.alloc(EXPLORER_MAX_READ_BYTES + 7, 0x62); // 'b'
    await writeFile(abs('big.txt'), buf);
    const res = (await h.call('explorer_read_file', {
      path: abs('big.txt'),
      root,
    })) as { truncated: boolean; size: number; content: string; binary: boolean };
    expect(res.truncated).toBe(true);
    expect(res.size).toBe(EXPLORER_MAX_READ_BYTES + 7); // 原始大小
    expect(Buffer.byteLength(res.content, 'utf8')).toBe(EXPLORER_MAX_READ_BYTES);
    expect(res.binary).toBe(false);
  }, 20_000);

  it('目标非普通文件（目录）→ not_found', async () => {
    await expectRpcError(
      h.call('explorer_read_file', { path: abs('a'), root }),
      'not_found',
    );
  });
});

// ── explorer_search 经注册路径 ───────────────────────────────────────────────

describe('explorer_search — 噪声/上限/truncated 真值矩阵经注册路径', () => {
  let root: string;
  let abs: (rel: string) => string;
  let h: ReturnType<typeof makeHarness>;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    h = makeHarness([root]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('噪声目录整支跳过（node_modules/.git），root 内正常命中', async () => {
    await mkdir(abs('node_modules/pkg'), { recursive: true });
    await mkdir(abs('.git'), { recursive: true });
    await writeFile(abs('node_modules/pkg/needle-dep.js'), 'x');
    await writeFile(abs('.git/needle-config'), 'x');
    await mkdir(abs('src'));
    await writeFile(abs('src/needle-app.ts'), 'x');
    const res = (await h.call('explorer_search', {
      root,
      query: 'needle',
    })) as { matches: { path: string }[] };
    expect(res.matches.map((m) => m.path)).toEqual(['src/needle-app.ts']);
  });

  it('max_results 缺省 100：105 个命中 → 恰 100 条 + truncated=true', async () => {
    for (let i = 0; i < 105; i++) {
      await writeFile(abs(`needle-${String(i).padStart(3, '0')}.txt`), 'x');
    }
    const res = (await h.call('explorer_search', {
      root,
      query: 'needle',
    })) as { matches: unknown[]; truncated: boolean };
    expect(res.matches.length).toBe(100);
    expect(res.truncated).toBe(true);
  });

  it('显式 max_results=2：3 个命中 → 2 条 + truncated=true', async () => {
    for (let i = 0; i < 3; i++) {
      await writeFile(abs(`needle-${i}.txt`), 'x');
    }
    const res = (await h.call('explorer_search', {
      root,
      query: 'needle',
      max_results: 2,
    })) as { matches: unknown[]; truncated: boolean };
    expect(res.matches.length).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('truncated 真值语义：达上限但已无未遍历内容（唯一命中 + max_results=1）→ truncated=false', async () => {
    // 该 root 下唯一 needle 命中即最后一个遍历项：自然结束，无未遍历内容 → false。
    //（root 本身还有 a/ b.txt，但它们都在唯一命中之后按字母序先于 needle 被遍历完，
    // 遍历自然终止时 matches.length 恰达 1，未提前收敛。）
    await writeFile(abs('zz-needle.txt'), 'x');
    const res = (await h.call('explorer_search', {
      root,
      query: 'needle',
      max_results: 1,
    })) as { matches: { path: string }[]; truncated: boolean };
    expect(res.matches.map((m) => m.path)).toEqual(['zz-needle.txt']);
    expect(res.truncated).toBe(false);
  });

  it('空 query / query 非字符串 / 非法 max_results（0、字符串）→ forbidden', async () => {
    await expectRpcError(
      h.call('explorer_search', { root, query: '' }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_search', { root, query: 42 }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_search', { root, query: 'x', max_results: 0 }),
      'forbidden',
    );
    await expectRpcError(
      h.call('explorer_search', { root, query: 'x', max_results: '50' }),
      'forbidden',
    );
  });

  it('命中相对路径统一 POSIX `/` 分隔（Windows 也不出反斜杠）', async () => {
    await mkdir(abs('deep'), { recursive: true });
    await mkdir(abs('deep/nested'), { recursive: true });
    await writeFile(abs('deep/nested/needle.md'), 'x');
    const res = (await h.call('explorer_search', {
      root,
      query: 'needle',
    })) as { matches: { path: string }[] };
    expect(res.matches.map((m) => m.path)).toEqual(['deep/nested/needle.md']);
    expect(res.matches.every((m) => !m.path.includes('\\'))).toBe(true);
  });

  it('root 越出 allowed_roots → forbidden（search 入口同样过双重校验）', async () => {
    const { outside } = await makeOutside();
    try {
      await expectRpcError(
        h.call('explorer_search', { root: outside, query: 'x' }),
        'forbidden',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

// ── roots 现取（design §5 警示条 / task-03 铁律）────────────────────────────

describe('explorer handler — roots 每次 RPC 现取 _effectiveAllowedRoots（task-03 铁律）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let h: ReturnType<typeof makeHarness>;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    h = makeHarness([root]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('注册后改 allowed_roots → 下一次调用立即生效（非构造时快照冻结）', async () => {
    // 注册时 roots=[root]：先证明可读
    const ok = (await h.call('explorer_list_dir', { path: root, root })) as {
      entries: unknown[];
    };
    expect(ok.entries.length).toBeGreaterThan(0);

    // 模拟 policy_update / _syncAllowedRoots 后 roots 收窄为别的目录：
    // 若 handler 捕获了注册时快照，此调用仍会放行——现取模式必须 forbidden。
    const other = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-shrunk-'));
    try {
      h.setAllowedRoots([other]);
      await expectRpcError(
        h.call('explorer_list_dir', { path: root, root }),
        'forbidden',
      );
      await expectRpcError(
        h.call('explorer_read_file', { path: abs('b.txt'), root }),
        'forbidden',
      );
      await expectRpcError(
        h.call('explorer_search', { root, query: 'x' }),
        'forbidden',
      );
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('allowed_roots 收窄为空数组 → forbidden "no allowed_roots configured"（绝不空 roots 跳校验）', async () => {
    h.setAllowedRoots([]);
    let caught: unknown;
    try {
      await h.call('explorer_read_file', { path: abs('b.txt'), root });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect((caught as RpcError).code).toBe('forbidden');
    expect((caught as Error).message).toMatch(/no allowed_roots configured/);
  });

  it('注册后新增 allowed_roots → 下一次调用放行新 root（现取的扩张方向）', async () => {
    const { outside } = await makeOutside();
    try {
      // 注册时 roots=[root]，outside 不在内 → forbidden
      await expectRpcError(
        h.call('explorer_list_dir', { path: outside, root: outside }),
        'forbidden',
      );
      // 现取扩张：加入 outside 后同一注册 handler 立即可读
      h.setAllowedRoots([root, outside]);
      const res = (await h.call('explorer_list_dir', {
        path: outside,
        root: outside,
      })) as { entries: { name: string }[] };
      expect(res.entries.map((e) => e.name)).toContain('secret.txt');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
