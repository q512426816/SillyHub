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
//
// 审计 P1-5（2026-08 追加，§4 describe）：backend build_bundle 用 Python
// tarfile.open(mode="w")（3.8+ 默认 PAX 格式），daemon extractTar 原为纯 ustar 手写
// 解析（不读 PAX 'x' 扩展头 / GNU 'L' 长名 / ustar prefix 字段）→ ① 每成员前置的
// typeflag 'x' 头（磁盘成员 mtime 为 float 时必现）落入 tar_skip_entry 警告噪音；
// ② 路径 >100 字节时 name 字段被截断、完整路径只在 PAX path 记录 → 文件静默落到
// 截断的错误路径（进而 hasUnsyncedLocalChanges 误判本地有未回灌改动）。本文件新增
// PAX/GNU-L/ustar-prefix 生产格式 fixture 验证 extractTar 补齐三类扩展读取。

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
// prefix（345-500，155 字节）为 ustar 标准拆分字段：非空且 magic ustar 时读取方应
// name = prefix + '/' + name（P1-5 用例用；既有调用缺省 '' 不写不影响）。
function buildTarEntry(
  name: string,
  content: string,
  typeflag: string,
  isDir = false,
  prefix = '',
): Buffer {
  // 防御：name/prefix 超字段宽度会溢出写脏邻接字段（Buffer.write 不按字段截断），
  // PAX/GNU 长名用例必须传已截断的 name + 扩展头承载完整路径。
  if (Buffer.byteLength(name, 'utf-8') > 100) {
    throw new Error(`test fixture name >100 bytes: ${name}`);
  }
  if (Buffer.byteLength(prefix, 'utf-8') > 155) {
    throw new Error(`test fixture prefix >155 bytes: ${prefix}`);
  }
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
  if (prefix) header.write(prefix, 345, 'utf-8');
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

// ── PAX/GNU 扩展头构造（审计 P1-5）────────────────────────────────────────────
// 形态对齐依据：本机 Python 3.12.10 tarfile.open(mode="w") 实测 dump（与 backend
// build_bundle 同款调用：TarInfo.addfile 元数据成员 + tar.add(arcname) 磁盘成员）：
//   - 磁盘成员 mtime 为 float（os.stat().st_mtime）→ 每成员前置 typeflag 'x' 头
//     （name '././@PaxHeader'，magic 'ustar\0' version '00'），data 形如
//     "28 mtime=1788005616.3831797\n"；元数据成员（TarInfo 默认 int mtime）无 'x' 头。
//   - 路径 >100 字节 → 同一 'x' 头 data 追加 "132 path=<完整路径>\n" 记录，紧随的
//     实体头 name 字段只剩前 100 字节（截断、无 NUL 填充语义差异）。
// CI 无 python 依赖，fixture 手工构造上述字节流（ASCII 路径下 char slice == byte slice）。

/** 构造单条 PAX 记录 "<len> <key>=<value>\n"：len 十进制、含自身位数 + 空格 + 记录体。 */
function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`;
  const bodyLen = Buffer.byteLength(body, 'utf-8');
  let digits = 1;
  let total = 0;
  for (;;) {
    total = digits + 1 + bodyLen;
    const width = String(total).length;
    if (width === digits) break;
    digits = width;
  }
  return `${total} ${body}`;
}

/** typeflag 'x' 扩展头 + data（records 为若干条 paxRecord 拼接；不落盘，由下一实体消费）。 */
function buildPaxExtHeader(records: string[]): Buffer {
  return buildTarEntry('././@PaxHeader', records.join(''), 'x');
}

/** typeflag 'L' GNU 长名头：data 是 NUL 结尾完整名（512 对齐补零），对齐 src 侧
 *  buildLongLinkHeader 的 GNU 惯例（占位名 '././@LongLink'）。 */
function buildGnuLongLinkEntry(name: string): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  const dataSize = nameBytes.length + 1; // name + NUL 终止符
  const header = Buffer.alloc(512, 0);
  header.write('././@LongLink', 0, 'ascii');
  header.write('0000644', 100, 'ascii');
  header[107] = 0;
  header.write('0000000', 108, 'ascii');
  header[115] = 0;
  header.write('0000000', 116, 'ascii');
  header[123] = 0;
  header.write(dataSize.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  header.write('00000000000', 136, 'ascii');
  header[147] = 0;
  header.write('        ', 148, 'ascii');
  header[156] = 0x4c; // 'L'
  header.write('ustar', 257, 'ascii');
  header[262] = 0;
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const data = Buffer.alloc(Math.ceil(dataSize / 512) * 512, 0);
  nameBytes.copy(data);
  return Buffer.concat([header, data]);
}

/** tar 头 name 字段 100 字节截断（Python tarfile PAX 长名行为：截断、完整值在 path 记录）。 */
function truncateName(name: string): string {
  return Buffer.from(name, 'utf-8').subarray(0, 100).toString('utf-8');
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

// ── 4. 审计 P1-5：backend PAX 打包形态解包兼容（typeflag 'x' / 'L' / ustar prefix）─

describe('PAX/GNU/ustar-prefix 解包兼容（审计 P1-5，对齐 backend tarfile mode "w" PAX 输出）', () => {
  it('每成员前置 typeflag "x" PAX 头（float mtime 记录，Python 磁盘成员形态）：全部落地且无 tar_skip_entry 告警', async () => {
    const wsId = 'ws-pax-mtime-prefix';
    // 形态照 Python 实测 dump：元数据成员（TarInfo int mtime）无 'x' 头；磁盘成员
    // （tar.add → float st_mtime）每个前置 'x' 头含 "NN mtime=<float>\n" 记录。
    const bundle = tarBuf([
      buildTarEntry('PLATFORM-BUNDLE.json', BUNDLE_METADATA_JSON, '0'),
      buildPaxExtHeader([paxRecord('mtime', '1788005616.3821805')]),
      buildTarEntry('changes/', '', '5', true),
      buildPaxExtHeader([paxRecord('mtime', '1788005616.3821805')]),
      buildTarEntry('changes/2026-08-29-demo/', '', '5', true),
      buildPaxExtHeader([paxRecord('mtime', '1788005616.3821805')]),
      buildTarEntry('changes/2026-08-29-demo/design.md', '# demo design\n', '0'),
      buildPaxExtHeader([paxRecord('mtime', '1788005616.3831797')]),
      buildTarEntry('docs/CONVENTIONS.md', '# conventions\n', '0'),
    ]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(bundle) } as any;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await pullSpecBundle(client, wsId, {});
      expect(r).toBe(resolveSpecDir(wsId));
      // 'x' 扩展头被识别消费，不落盘、不告警；实体成员照常全部落地。
      expect(readFileSync(join(r!, 'changes', '2026-08-29-demo', 'design.md'), 'utf-8')).toBe(
        '# demo design\n',
      );
      expect(readFileSync(join(r!, 'docs', 'CONVENTIONS.md'), 'utf-8')).toBe('# conventions\n');
      expect(readFileSync(join(r!, 'PLATFORM-BUNDLE.json'), 'utf-8')).toBe(BUNDLE_METADATA_JSON);
      expect(
        warnSpy.mock.calls.some((args) =>
          args.some((a) => typeof a === 'string' && a.includes('tar_skip_entry')),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('>100 字节路径：name 截断 + PAX path 记录 → 解到完整正确路径，截断路径不落盘', async () => {
    const wsId = 'ws-pax-long-path';
    const longDir = 'changes/' + 'x'.repeat(40) + '/' + 'y'.repeat(60); // 109 字节 >100
    const longFile = longDir + '/deep-file.md'; // 122 字节（Python 实测同形态用例）
    // 形态照 Python 实测：'x' 头 data = path 记录 + mtime 记录；紧随实体头 name 只剩
    // 前 100 字节（目录条目截断后无 trailing '/'，dir 判定须靠 typeflag '5' + path 记录）。
    const bundle = tarBuf([
      buildPaxExtHeader([paxRecord('path', longDir + '/'), paxRecord('mtime', '1788005616.3831797')]),
      buildTarEntry(truncateName(longDir), '', '5', true),
      buildPaxExtHeader([paxRecord('path', longFile), paxRecord('mtime', '1788005616.3831797')]),
      buildTarEntry(truncateName(longFile), 'deep content\n', '0'),
    ]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(bundle) } as any;

    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(resolveSpecDir(wsId));

    // 完整正确路径落地（P1-5 核心断言：修复前完整路径无法落地——截断 name 误用导致
    // 文件落错位置，本 fixture 中还与截断目录条目同路径冲突直接 EISDIR 抛错）。
    const full = join(r!, ...longFile.split('/'));
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full, 'utf-8')).toBe('deep content\n');

    // 截断路径（前 100 字节，终止于 y 第 51 个，无 /deep-file.md）不得作为文件落盘。
    const truncated = join(r!, ...truncateName(longFile).split('/'));
    expect(existsSync(truncated)).toBe(false);
  });

  it('ustar prefix 字段（345-500）：name = prefix + "/" + name 拼接后落地', async () => {
    const wsId = 'ws-ustar-prefix';
    const bundle = tarBuf([
      buildTarEntry('changes/', '', '5', true),
      // prefix='changes/prefix-demo' + name='file.md' → 'changes/prefix-demo/file.md'
      buildTarEntry('file.md', 'prefix member\n', '0', false, 'changes/prefix-demo'),
    ]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(bundle) } as any;

    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(resolveSpecDir(wsId));
    // 修复前不读 prefix → 文件误落顶层 file.md；正确路径必须拼接 prefix 后落地。
    expect(readFileSync(join(r!, 'changes', 'prefix-demo', 'file.md'), 'utf-8')).toBe(
      'prefix member\n',
    );
    expect(existsSync(join(r!, 'file.md'))).toBe(false);
  });

  it('GNU LongLink（typeflag "L"）：长名 data 应用到下一实体头（daemon 打包侧 buildLongLinkHeader 对偶）', async () => {
    const wsId = 'ws-gnu-longlink';
    const longFile = 'docs/' + 'z'.repeat(80) + '/' + 'w'.repeat(40) + '/long-name.md'; // >100 字节
    const bundle = tarBuf([
      buildGnuLongLinkEntry(longFile),
      buildTarEntry(truncateName(longFile), 'gnu longlink content\n', '0'),
    ]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(bundle) } as any;

    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(resolveSpecDir(wsId));
    const full = join(r!, ...longFile.split('/'));
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full, 'utf-8')).toBe('gnu longlink content\n');
  });

  it('typeflag "g" 全局扩展头忽略跳过：不落盘、不告警、后续成员照常解包', async () => {
    const wsId = 'ws-pax-global-header';
    const bundle = tarBuf([
      buildTarEntry('././@PaxHeader', paxRecord('comment', 'global ext header'), 'g'),
      buildTarEntry('docs/', '', '5', true),
      buildTarEntry('docs/CONVENTIONS.md', '# conventions\n', '0'),
    ]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(bundle) } as any;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await pullSpecBundle(client, wsId, {});
      expect(r).toBe(resolveSpecDir(wsId));
      expect(readFileSync(join(r!, 'docs', 'CONVENTIONS.md'), 'utf-8')).toBe('# conventions\n');
      expect(existsSync(join(r!, '././@PaxHeader'))).toBe(false);
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
