// tests/test_bundle_metadata_compat.test.ts
// task-10（2026-08-29-change-delete-closure-and-spec-pull / design §7.3 / FR-08 / NFR-03）：
// bundle 新增顶层 PLATFORM-BUNDLE.json 快照元数据后的 daemon 零改动兼容回归。
//
// backend task-08 起 build_bundle 在 tar 顶层加内存生成的
// PLATFORM-BUNDLE.json {spec_version, strategy, generated_at, server}；design §7.3 结论
// 「daemon pull 侧不受影响（多一个文件，.runtime 排除规则不变；daemon 本地
// spec-version.json 逻辑不动）」——本测试纯新增验证该结论，daemon 源码零修改：
//   - pullSpecBundle（src/spec-sync.ts:92-199）解包兼容：元数据作为顶层普通文件
//     （typeflag '0'）落地无害，spec 文件全部落地，返回 specDir 非 null；
//   - 保鲜链路：pull 覆盖清掉 .runtime 后 bumpLocalSpecVersion（:1314-1336）在含
//     元数据文件的目录上完整重建 .runtime/spec-version.json，readLocalSpecVersion
//     读回一致；shouldRefreshSpec（:1290-1297）四分支判定矩阵不受顶层多余文件影响；
//   - 回灌判定：hasUnsyncedLocalChanges（:240-266）对 pull+bump 后的目录不误报
//     （PLATFORM-BUNDLE.json mtime=解包时刻，早于 bump 写入的 synced_at；newestMtime
//     仅跳 .runtime/）。
//
// 范式照 tests/spec-transport-tar-sync/spec-sync.test.ts：hoisted mock node:os.homedir
// 固定 spec_dir 父目录；手工 ustar buildTarEntry 构造 bundle（成员顺序对齐 backend
// build_bundle：元数据成员在最前，其后 sorted 目录+文件）；mock client duck-type
// 不依赖 hub-client 导出；真实解包到 os.tmpdir() 临时目录。
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, vi, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-bundle-meta-home'),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});

// 在 spec-sync import 前设定临时 home（mkdtempSync 顶层安全）。
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'bundle-meta-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

// spec-sync 在 homedir mock 就位后 import。
const {
  resolveSpecDir,
  pullSpecBundle,
  hasUnsyncedLocalChanges,
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  DAEMON_STATE_FILENAME,
} = await import('../src/spec-sync.js');

afterAll(() => {
  try {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── 手工 ustar 构造（照 spec-transport-tar-sync/spec-sync.test.ts 范式）────────
function buildTarEntry(name: string, content: string, typeflag: string, isDir = false): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 'utf-8');
  header.write(isDir ? '0000755' : '0000644', 100, 'ascii');
  header[107] = 0;
  header.write('0000000', 108, 'ascii');
  header[115] = 0;
  header.write('0000000', 116, 'ascii');
  header[123] = 0;
  const size = isDir ? 0 : Buffer.byteLength(content, 'utf-8');
  header.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  header.write('00000000000', 136, 'ascii');
  header[147] = 0;
  header.write('        ', 148, 'ascii');
  header[156] = typeflag.charCodeAt(0);
  header.write('ustar', 257, 'ascii');
  header[262] = 0;
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  if (isDir) return header;
  const data = Buffer.from(content, 'utf-8');
  const padLen = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(padLen, 0)]);
}

function tarBuf(entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]); // 2×512 zero block 结尾
}

// ── task-08 契约：顶层 PLATFORM-BUNDLE.json 四键（spec_version/strategy/
//    generated_at/server；backend service.build_bundle json.dumps indent=2）────────
const BUNDLE_SPEC_VERSION = 7;
const BUNDLE_METADATA_JSON = JSON.stringify(
  {
    spec_version: BUNDLE_SPEC_VERSION,
    strategy: 'platform-managed',
    generated_at: '2026-08-29T12:34:56.789+00:00',
    server: 'https://hub.example.test',
  },
  null,
  2,
);

/** 构造含 PLATFORM-BUNDLE.json 的 bundle tar（成员顺序对齐 backend：元数据最先，
 *  其后 sorted 目录 + 文件；目录 entry 带 trailing '/' + typeflag '5'，对齐 Python
 *  tarfile 目录成员写法）。 */
function buildMetadataBundle(): Buffer {
  return tarBuf([
    buildTarEntry('PLATFORM-BUNDLE.json', BUNDLE_METADATA_JSON, '0'),
    buildTarEntry('changes/', '', '5', true),
    buildTarEntry('changes/2026-08-29-demo/', '', '5', true),
    buildTarEntry('changes/2026-08-29-demo/design.md', '# demo design\n', '0'),
    buildTarEntry('docs/', '', '5', true),
    buildTarEntry('docs/CONVENTIONS.md', '# conventions\n', '0'),
  ]);
}

/** mock client（duck-type，不依赖 hub-client.ts 导出）：getSpecBundle 返回含元数据 bundle。 */
function mockClientWithMetadataBundle(): { getSpecBundle: ReturnType<typeof vi.fn> } {
  return { getSpecBundle: vi.fn().mockResolvedValue(buildMetadataBundle()) };
}

// ── 1. pullSpecBundle 解包兼容 ────────────────────────────────────────────────

describe('pullSpecBundle：bundle 含 PLATFORM-BUNDLE.json 解包兼容（task-10 / design §7.3）', () => {
  it('解包成功：返回 specDir 非 null，元数据作为顶层普通文件落地无害，spec 文件全部落地', async () => {
    const wsId = 'ws-bundle-meta-pull';
    const client = mockClientWithMetadataBundle() as any;

    // pull 前预置本地残留（验证 rm+覆盖语义未被元数据成员破坏：旧文件不残留）。
    const specDir = resolveSpecDir(wsId);
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'stale-local.md'), 'stale');

    // 预置残留会让默认回灌检查判 true（状态文件缺失+本地有内容）触发
    // push_before_pull 分支——本用例聚焦解包兼容，按 PullSpecBundleOptions 文档
    // 注入 `() => false` 显式禁用回灌检查（回灌链路在下方专项 describe 覆盖）。
    const r = await pullSpecBundle(client, wsId, { unsyncedChecker: () => false });
    expect(r).not.toBeNull();
    expect(r).toBe(specDir);

    // 覆盖语义：pull 前的本地残留被 rm 清掉（元数据成员不破坏 rm+覆盖链路）。
    expect(existsSync(join(r!, 'stale-local.md'))).toBe(false);

    // spec 文件全部落地（含嵌套目录）。
    expect(readFileSync(join(r!, 'changes', '2026-08-29-demo', 'design.md'), 'utf-8')).toBe(
      '# demo design\n',
    );
    expect(readFileSync(join(r!, 'docs', 'CONVENTIONS.md'), 'utf-8')).toBe('# conventions\n');

    // PLATFORM-BUNDLE.json 作为顶层普通文件落地（内容 JSON round-trip，四键完整）。
    const metaRaw = readFileSync(join(r!, 'PLATFORM-BUNDLE.json'), 'utf-8');
    expect(JSON.parse(metaRaw)).toEqual({
      spec_version: BUNDLE_SPEC_VERSION,
      strategy: 'platform-managed',
      generated_at: '2026-08-29T12:34:56.789+00:00',
      server: 'https://hub.example.test',
    });

    // 顶层元数据文件不被 extractTar 当异常 entry 跳过（tar_skip_entry 仅针对
    // symlink/hardlink 等非 regular/dir 类型，typeflag '0' 直接收录）。
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client2 = mockClientWithMetadataBundle() as any;
      const r2 = await pullSpecBundle(client2, 'ws-bundle-meta-pull-2', {});
      expect(existsSync(join(r2!, 'PLATFORM-BUNDLE.json'))).toBe(true);
      expect(
        warnSpy.mock.calls.some((args) =>
          args.some((a) => typeof a === 'string' && a.includes('tar_skip_entry')),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── 2. 保鲜链路：pull → bump 重建 spec-version.json → shouldRefreshSpec 四分支 ──

describe('保鲜链路：pull+bump 在含元数据目录上重建 .runtime/spec-version.json（task-10）', () => {
  it('端到端：pull 覆盖清掉 .runtime → local null → bump 重建 → 读回一致；四分支判定矩阵全绿', async () => {
    const wsId = 'ws-bundle-meta-fresh';
    const specDir = resolveSpecDir(wsId);

    // 预置旧状态文件（验证 pull 的 rm+覆盖把 .runtime 一并清掉——bundle 不含 .runtime）。
    mkdirSync(join(specDir, '.runtime'), { recursive: true });
    writeFileSync(
      join(specDir, DAEMON_STATE_FILENAME),
      JSON.stringify({ spec_version: 3, synced_at: '2026-08-01T00:00:00Z' }),
    );

    const client = mockClientWithMetadataBundle() as any;
    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(specDir);
    // 元数据文件与 spec 文件均在（含元数据 bundle 解包成功）。
    expect(existsSync(join(specDir, 'PLATFORM-BUNDLE.json'))).toBe(true);
    expect(existsSync(join(specDir, 'docs', 'CONVENTIONS.md'))).toBe(true);

    // pull 覆盖后状态文件不存在（rm -rf 整目录 + bundle 无 .runtime 成员）。
    expect(existsSync(join(specDir, DAEMON_STATE_FILENAME))).toBe(false);

    // 分支②：local null + lease 有版本 → true（视为落后触发 pull）。
    const localBefore = await readLocalSpecVersion(specDir);
    expect(localBefore).toBeNull();
    expect(shouldRefreshSpec(localBefore, BUNDLE_SPEC_VERSION)).toBe(true);

    // 分支①：lease 版本缺失（undefined/null）→ false（旧 backend 未透传不强制刷新）。
    expect(shouldRefreshSpec(localBefore, undefined)).toBe(false);
    expect(shouldRefreshSpec(localBefore, null)).toBe(false);

    // bump 在含 PLATFORM-BUNDLE.json 的目录上完整重建状态文件（mkdir 补 .runtime 父目录）。
    await bumpLocalSpecVersion(specDir, BUNDLE_SPEC_VERSION);

    const stateRaw = readFileSync(join(specDir, DAEMON_STATE_FILENAME), 'utf-8');
    const state = JSON.parse(stateRaw) as Record<string, unknown>;
    expect(state.spec_version).toBe(BUNDLE_SPEC_VERSION);
    expect(typeof state.synced_at).toBe('string');
    expect(Number.isNaN(Date.parse(state.synced_at as string))).toBe(false);

    // 读回一致（pull rm+覆盖后重建语义回归）。
    const localAfter = await readLocalSpecVersion(specDir);
    expect(localAfter).toBe(BUNDLE_SPEC_VERSION);

    // 分支③：相等 → false（缓存新鲜跳过 pull）。
    expect(shouldRefreshSpec(localAfter, BUNDLE_SPEC_VERSION)).toBe(false);
    // 分支④：不等（服务端重扫递增）→ true（落后触发 pull）。
    expect(shouldRefreshSpec(localAfter, BUNDLE_SPEC_VERSION + 1)).toBe(true);
  });
});

// ── 3. 回灌判定：hasUnsyncedLocalChanges 不因元数据文件误报 ───────────────────

describe('回灌判定：hasUnsyncedLocalChanges 不因 PLATFORM-BUNDLE.json 误报（task-10）', () => {
  it('pull 后未 bump：状态文件缺失 + 本地有内容 → true（既有语义不受元数据影响）', async () => {
    const wsId = 'ws-bundle-meta-unsynced-pre';
    const client = mockClientWithMetadataBundle() as any;
    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(resolveSpecDir(wsId));
    // pull 覆盖清掉状态文件，本地（含元数据 + spec 文件）有内容 → 按既有兜底语义
    // 判「有未回灌改动」。与不含元数据文件的 bundle 行为一致——元数据不改变判定。
    expect(await hasUnsyncedLocalChanges(r!)).toBe(true);
  });

  it('pull + bump 后：元数据 mtime=解包时刻 ≤ synced_at → false 不误报未回灌', async () => {
    const wsId = 'ws-bundle-meta-unsynced-post';
    const client = mockClientWithMetadataBundle() as any;
    const r = await pullSpecBundle(client, wsId, {});
    // 确定性隔离：synced_at 是 ISO 毫秒截断值，而 mtimeMs 在 NTFS/ext4 上带亚毫秒
    // 精度——pull 与 bump 落在同一毫秒时截断可能把 synced_at 拉到 mtime 之下（生
    // 产环境此竞态只致下次 pull 多一次无害回灌，测试须隔离）。隔 5ms 保证 bump 严格
    // 晚于解包毫秒，断言聚焦「元数据文件计入 newestMtime 也不误报」本身。
    await new Promise((resolve) => setTimeout(resolve, 5));
    await bumpLocalSpecVersion(r!, BUNDLE_SPEC_VERSION);

    // PLATFORM-BUNDLE.json 作为顶层普通文件计入 newestMtime（newestMtime 仅跳
    // .runtime/），但其 mtime=解包时刻，严格早于（或等于）bump 写入的 synced_at
    // → localMtime > syncedAtMs 为 false，不误报。AC-4：不误报未回灌。
    expect(await hasUnsyncedLocalChanges(r!)).toBe(false);

    // 下一次 pull 前的默认回灌检查（pullSpecBundle 内置 checker）同样不触发
    // postSpecSync——含元数据 bundle 的二次 pull 走纯覆盖，不误触回灌。
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client2 = { getSpecBundle: vi.fn().mockResolvedValue(buildMetadataBundle()), postSpecSync: postSpy } as any;
    const r2 = await pullSpecBundle(client2, wsId, {});
    expect(r2).toBe(r);
    expect(postSpy).not.toHaveBeenCalled();
    expect(existsSync(join(r2!, 'PLATFORM-BUNDLE.json'))).toBe(true);
  });
});
