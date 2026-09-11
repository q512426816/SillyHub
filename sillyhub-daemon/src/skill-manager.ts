/**
 * skill-manager.ts —— daemon 平台 + workspace skills 同步（task-03 + task-04）。
 *
 * task-03（FR-03 / D-002 / D-008）：平台 sillyspec skills 同步。daemon 启动时查
 *   `GET /api/daemon/skills/latest/manifest`（backend task-06 分发）比对本地版本，
 *   新则拉 bundle（tar.gz）校验 sha256 后解压到 `~/.sillyhub/daemon/skills/`。
 *   借鉴 daemon self-update（preflight.ts）的 bundle 下载模式。
 *
 * task-04（FR-04 / D-002 / D-004）：workspace 自定义 skills 同步。workspace 绑定/lease
 *   时从 specDir 的 skills/ 拉到 worktree `.claude/skills/workspace/`（命名隔离，不覆盖
 *   平台 skills）。复用 daemon-client spec sync 框架（specDir 已 pull 到本地）。
 *
 * bridges task-04（2026-09-11-workspace-asset-bridges / FR-01 / D-007）：per-workspace
 *   git skills 分发槽。fetchRemoteManifest/fetchSkillsBundle 增可选 workspaceId（URL 拼
 *   `?workspace_id=` 拉 user ∪ workspace 并集）；per-workspace 槽
 *   `<daemonStateDir>/skills-workspaces/<wsId>/`（manifest.json + 解包目录）与全局槽
 *   `<daemonStateDir>/skills/` 并存互不覆盖；syncWorkspaceGitSkills 按槽版本比对 →
 *   拉 bundle → 解包进槽 → link 槽内 skills 到 workdir `.claude/skills/`（会话/任务
 *   带 workspace 绑定时在全局 link 之后调用，并集内容覆盖同名目录 = 注入集语义）。
 *
 * 所有网络/IO 操作失败不抛错（返回 null/false），daemon 启动不阻塞。
 *
 * @module skill-manager
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { parseJsonFromResponse } from './hub-client.js';
import { daemonStateDir } from './config.js';

// Wave C 续：gunzip 移出事件循环（bundle 解压在 async extractSkillsBundle 内）。
const gunzipAsync = promisify(gunzip);

// ── 常量 ──────────────────────────────────────────────────────────────────────

/**
 * 平台 skills 全局存储（所有 worktree 共享）。
 * 懒计算（运行时读 env/homedir）——模块加载时不固化，测试改 SILLYHUB_DAEMON_DIR /
 * HOME / USERPROFILE 即时生效。
 */
function skillsDir(): string {
  return join(daemonStateDir(), 'skills');
}
/** 本地已同步版本记录（全局 user-only 槽）。 */
function localManifestPath(): string {
  return join(skillsDir(), 'manifest.json');
}

/**
 * per-workspace 槽目录（bridges task-04 / D-007）：`<daemonStateDir>/skills-workspaces/<wsId>/`。
 *
 * 刻意放 skillsDir() 的**兄弟**目录而非子目录——全局 syncSkills 提升阶段会清
 * skillsDir() 下除 manifest.json/.tmp-extract 外的全部条目、linkSkillsToWorkdir 会
 * 把 skillsDir() 下全部子目录当 skill 拷走，子目录形态会被全局路径误清/误拷。
 */
function workspaceSkillsDir(workspaceId: string): string {
  return join(daemonStateDir(), 'skills-workspaces', workspaceId);
}
/** per-workspace 槽本地版本记录。 */
function workspaceLocalManifestPath(workspaceId: string): string {
  return join(workspaceSkillsDir(workspaceId), 'manifest.json');
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface SkillsManifest {
  version: string;
  files?: { path: string; sha256: string }[];
  sha256?: string;
  published_at?: string;
}

interface LocalManifest {
  version: string;
}

/**
 * skill-manager 调 backend skills/MCP 端点的鉴权凭证（对齐 hub-client HubClientAuth）。
 * apiKey → X-API-Key（daemon 长期凭证，--api-key）；token → Authorization: Bearer。
 * 两者都给时 apiKey 优先（与 hub-client._headers 一致）。
 */
export interface SkillAuth {
  apiKey?: string | null;
  token?: string | null;
}

/** 构造鉴权 headers（apiKey 优先 X-API-Key，否则 token Bearer；都无 → 空）。 */
function skillAuthHeaders(auth?: SkillAuth): Record<string, string> {
  const h: Record<string, string> = {};
  if (auth?.apiKey) {
    h['X-API-Key'] = auth.apiKey;
  } else if (auth?.token) {
    h['Authorization'] = `Bearer ${auth.token}`;
  }
  return h;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type SkillManagerLogger = (
  level: LogLevel,
  msg: string,
  data?: Record<string, unknown>,
) => void;

// ── 本地版本 ──────────────────────────────────────────────────────────────────

/**
 * 读本地已同步的 skills 版本（从 LOCAL_MANIFEST_PATH）。
 * 文件不存在/解析失败 → null（视为未同步，触发首次拉取）。
 */
export async function getLocalSkillsVersion(): Promise<string | null> {
  try {
    const content = await readFile(localManifestPath(), 'utf-8');
    const manifest = JSON.parse(content) as LocalManifest;
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

/**
 * 读 per-workspace 槽已同步版本（bridges task-04 / D-007）。
 * 槽 manifest 不存在/解析失败 → null（视为未同步，触发首次拉取）；与全局槽
 * （getLocalSkillsVersion）互不读写，天然隔离。
 */
export async function getLocalWorkspaceSkillsVersion(
  workspaceId: string,
): Promise<string | null> {
  try {
    const content = await readFile(workspaceLocalManifestPath(workspaceId), 'utf-8');
    const manifest = JSON.parse(content) as LocalManifest;
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

// ── 远程 manifest ─────────────────────────────────────────────────────────────

/**
 * 从 backend 拉 skills manifest（`GET /api/daemon/skills/latest/manifest`）。
 * 网络错误/非 200 → null（不抛）。
 *
 * 可选 workspaceId（bridges task-04 / D-007）：带值时 URL 拼 `?workspace_id=`
 * 查询串，backend 按授权后的 user ∪ workspace 并集渲染（含该 ws 启用的 git
 * 技能）；缺省 = user-only（旧行为逐字不变）。
 */
export async function fetchRemoteManifest(
  serverUrl: string,
  auth?: SkillAuth,
  logger?: SkillManagerLogger,
  workspaceId?: string,
): Promise<SkillsManifest | null> {
  const url = withWorkspaceQueryParam(
    `${serverUrl.replace(/\/$/, '')}/api/daemon/skills/latest/manifest`,
    workspaceId,
  );
  try {
    const resp = await fetch(url, { headers: skillAuthHeaders(auth) });
    if (!resp.ok) {
      logger?.('warn', 'skill_manifest_fetch_failed', { url, status: resp.status });
      return null;
    }
    return await parseJsonFromResponse<SkillsManifest>(resp);
  } catch (e) {
    logger?.('warn', 'skill_manifest_unreachable', { url, error: String(e) });
    return null;
  }
}

/** 拼 `?workspace_id=` 查询串（workspaceId 空/未传 → 原样返回，零参数不变）。 */
function withWorkspaceQueryParam(base: string, workspaceId?: string): string {
  if (!workspaceId) return base;
  return `${base}?${new URLSearchParams({ workspace_id: workspaceId }).toString()}`;
}

// ── bundle 拉取 ───────────────────────────────────────────────────────────────

/**
 * 从 backend 拉 skills bundle（`GET /api/daemon/skills/latest/bundle`）。
 * 返回 ArrayBuffer（tar.gz）。网络错误/非 200 → null。
 *
 * 可选 workspaceId（bridges task-04 / D-007）：语义同 fetchRemoteManifest——
 * 带 `?workspace_id=` 拉并集 bundle；缺省 = user-only（旧行为逐字不变）。
 */
export async function fetchSkillsBundle(
  serverUrl: string,
  auth?: SkillAuth,
  logger?: SkillManagerLogger,
  workspaceId?: string,
): Promise<ArrayBuffer | null> {
  const url = withWorkspaceQueryParam(
    `${serverUrl.replace(/\/$/, '')}/api/daemon/skills/latest/bundle`,
    workspaceId,
  );
  try {
    const resp = await fetch(url, { headers: skillAuthHeaders(auth) });
    if (!resp.ok) {
      logger?.('warn', 'skill_bundle_fetch_failed', { url, status: resp.status });
      return null;
    }
    return await resp.arrayBuffer();
  } catch (e) {
    logger?.('warn', 'skill_bundle_unreachable', { url, error: String(e) });
    return null;
  }
}

// ── sha256 校验 ───────────────────────────────────────────────────────────────

/**
 * 校验 bundle 字节的 sha256。expectedSha256 空串 → 跳过校验返回 true（容忍旧 manifest）。
 */
export function checkSha256(bundleBytes: Uint8Array, expectedSha256: string): boolean {
  if (!expectedSha256) return true;
  const computed = createHash('sha256').update(bundleBytes).digest('hex');
  return computed === expectedSha256;
}

// ── bundle 解压 ───────────────────────────────────────────────────────────────

/**
 * 解压 tar.gz bundle 到目标目录。含路径穿越防护（entry 越界 → 抛错拒绝）。
 * 失败 → 返回 false（不抛到调用方，调用方应 try/catch）。
 */
export async function extractSkillsBundle(
  bundleBytes: Uint8Array,
  targetDir: string,
  logger?: SkillManagerLogger,
): Promise<boolean> {
  // gunzip → tar 字节
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzipAsync(Buffer.from(bundleBytes));
  } catch (e) {
    logger?.('error', 'skill_bundle_gunzip_failed', { error: String(e) });
    return false;
  }

  // 极简 tar 解析（USTAR header）：每条目 512B header + 数据 padded 到 512B。
  // 仅支持普通文件（typeflag '0' 或 '\0'）。路径穿越防护。
  await mkdir(targetDir, { recursive: true });
  let offset = 0;
  try {
    while (offset + 512 <= tarBytes.length) {
      const header = tarBytes.subarray(offset, offset + 512);
      const nameField = Buffer.from(header.subarray(0, 100)).toString('utf-8').replace(/\0/g, '');
      if (!nameField) break; // 空 name = 结束
      const typeflag = String.fromCharCode(header[156] ?? 0);
      // size 字段（octal，12 字节）
      const sizeStr = Buffer.from(header.subarray(124, 136)).toString('utf-8').replace(/\0/g, ' ').trim();
      const size = parseInt(sizeStr || '0', 8) || 0;

      if (typeflag === '0' || typeflag === '\0') {
        // 普通文件
        const dataStart = offset + 512;
        const fileData = Buffer.from(tarBytes.subarray(dataStart, dataStart + size));
        const fullPath = join(targetDir, nameField);
        const rel = relative(targetDir, fullPath);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
          logger?.('error', 'skill_bundle_path_traversal_rejected', { entry: nameField });
          return false;
        }
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, fileData);
      }
      // 下一条目（header + 数据 padded 到 512B）
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    return true;
  } catch (e) {
    logger?.('error', 'skill_bundle_extract_failed', { error: String(e) });
    return false;
  }
}

// ── 主入口：平台 skills 同步（task-03）──────────────────────────────────────

/**
 * 平台 skills 同步主入口（task-03 / FR-03）。
 *   1. 拉 remote manifest
 *   2. 比对本地版本（相同 → 跳过，NFR-02 不重复下载）
 *   3. 版本新 → 拉 bundle + 校验 + 解压到 SKILLS_DIR
 *   4. 写本地 manifest 记录版本
 *
 * 全程失败不抛（返回 false），daemon 启动不阻塞。
 */
export async function syncSkills(
  serverUrl: string,
  auth: SkillAuth,
  logger?: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }>;
export async function syncSkills(
  serverUrl: string,
  auth: SkillAuth,
  logger: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }>;
export async function syncSkills(
  serverUrl: string,
  auth: SkillAuth,
  logger?: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }> {
  const log = logger ?? (() => undefined);

  // 1. 拉 remote manifest
  const remote = await fetchRemoteManifest(serverUrl, auth, log);
  if (!remote) {
    return { synced: false, skipped: false };
  }

  // 2. 比对版本
  const local = await getLocalSkillsVersion();
  if (local && local === remote.version) {
    log('info', 'skill_version_unchanged_skip', { version: local });
    return { synced: false, skipped: true };
  }

  // 3. 拉 bundle
  const bundle = await fetchSkillsBundle(serverUrl, auth, log);
  if (!bundle) {
    return { synced: false, skipped: false };
  }
  const bundleBytes = new Uint8Array(bundle);

  // 4. sha256 校验（manifest 顶层 sha256，若存在）
  if (remote.sha256 && !checkSha256(bundleBytes, remote.sha256)) {
    log('error', 'skill_bundle_sha256_mismatch');
    return { synced: false, skipped: false };
  }

  // 5. 解压到临时目录，成功后原子替换最终目录（task-07 / FR-06：删除同步）。
  //    旧实现解压到 tmpDir 后从不提升到 skillsDir()——skills 实际从未安装 + 删除不清理。
  //    现改为：tmp 解压成功 → 清 skillsDir() 下旧 skill 子目录（保留 manifest.json + .tmp-extract）
  //    → 把 tmpDir/* 移入 skillsDir()/。tmp 失败不影响现有 skills（零回归）。
  const tmpDir = join(skillsDir(), '.tmp-extract');
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  const ok = await extractSkillsBundle(bundleBytes, tmpDir, log);
  if (!ok) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    return { synced: false, skipped: false };
  }

  // 5.5 提升 tmpDir → skillsDir()（清旧 + 移新）
  try {
    await mkdir(skillsDir(), { recursive: true });
    // 清 skillsDir() 下旧 skill 子目录（保留 manifest.json 文件 + .tmp-extract 目录）
    const existing = await readdir(skillsDir(), { withFileTypes: true }).catch(() => []);
    for (const entry of existing) {
      if (entry.name === '.tmp-extract' || entry.name === 'manifest.json') continue;
      const p = join(skillsDir(), entry.name);
      await rm(p, { recursive: true, force: true }).catch(() => undefined);
    }
    // 移 tmpDir/* → skillsDir()/
    const extracted = await readdir(tmpDir, { withFileTypes: true }).catch(() => []);
    for (const entry of extracted) {
      await rename(join(tmpDir, entry.name), join(skillsDir(), entry.name));
    }
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  } catch (e) {
    log('error', 'skill_promote_failed', { error: String(e) });
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    return { synced: false, skipped: false };
  }

  // 6. 写本地 manifest（记录版本）
  try {
    await mkdir(skillsDir(), { recursive: true });
    await writeFile(
      localManifestPath(),
      JSON.stringify({ version: remote.version } satisfies LocalManifest),
      'utf-8',
    );
    log('info', 'skill_sync_completed', { version: remote.version });
    return { synced: true, skipped: false };
  } catch (e) {
    log('error', 'skill_local_manifest_write_failed', { error: String(e) });
    return { synced: false, skipped: false };
  }
}

// ── workspace git skills 按槽分发（bridges task-04 / D-007）─────────────────

/**
 * workspace 绑定的会话/任务 spawn 前按槽分发其 git 技能（bridges task-04 / FR-01）。
 *
 * 调用时机：全局 linkSkillsToWorkdir **之后**（全局 user skills 先落 workdir，
 * 并集槽内容随后覆盖同名目录 = user ∪ workspace 注入集）；profile skillRefs
 * 裁剪（pruneSkillsToSubset，batch 路径）在更外层之后跑，本函数不感知。
 *
 * 流程（照 syncSkills 既有「manifest 比对 → 拉 bundle → tmp 解包 → 原子提升
 * → 写槽版本」路径模式）：
 *   1. `?workspace_id=` 拉该 workspace 的并集 manifest
 *   2. 比对 per-workspace 槽版本（skills-workspaces/<wsId>/manifest.json，
 *      与全局槽互不读写）；一致且槽目录仍在 → 跳过拉取
 *   3. 版本新 → 拉并集 bundle + sha256 校验 + 解包进槽（清旧提升）
 *   4. link：槽内 skill 目录拷到 <workdir>/.claude/skills/（版本缓存照
 *      ql-20260907-006 模式，键 `<wsId>::<workdir>`——UUID 前缀天然无歧义）
 *
 * 全程失败不抛（返回 synced=false），不阻塞 spawn。
 */
export async function syncWorkspaceGitSkills(
  serverUrl: string,
  auth: SkillAuth,
  workspaceId: string,
  workdir: string,
  logger?: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean; linked: number }> {
  const log = logger ?? (() => undefined);

  // 1. 拉该 workspace 的并集 manifest（403 非成员/网络错 → null 静默降级）
  const remote = await fetchRemoteManifest(serverUrl, auth, log, workspaceId);
  if (!remote) {
    return { synced: false, skipped: false, linked: 0 };
  }

  // 2. 比对该槽版本（槽目录被外部清空时视为未同步强制重拉，自愈）
  const local = await getLocalWorkspaceSkillsVersion(workspaceId);
  const slotDir = workspaceSkillsDir(workspaceId);
  const slotReady = local !== null && (await pathExists(slotDir));
  let synced = false;
  if (slotReady && local === remote.version) {
    log('info', 'ws_skill_version_unchanged_skip_pull', {
      workspace_id: workspaceId,
      version: local,
    });
  } else {
    // 3. 拉 bundle（同 workspace_id 并集形态）
    const bundle = await fetchSkillsBundle(serverUrl, auth, log, workspaceId);
    if (!bundle) {
      return { synced: false, skipped: false, linked: 0 };
    }
    const bundleBytes = new Uint8Array(bundle);
    if (remote.sha256 && !checkSha256(bundleBytes, remote.sha256)) {
      log('error', 'ws_skill_bundle_sha256_mismatch', { workspace_id: workspaceId });
      return { synced: false, skipped: false, linked: 0 };
    }

    // 3.5 解包到槽 tmp，成功后原子提升（照 syncSkills 步骤 5/5.5 的既有模式）
    const tmpDir = join(slotDir, '.tmp-extract');
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    const ok = await extractSkillsBundle(bundleBytes, tmpDir, log);
    if (!ok) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      return { synced: false, skipped: false, linked: 0 };
    }
    try {
      await mkdir(slotDir, { recursive: true });
      // 清槽内旧 skill 子目录（保留 manifest.json + .tmp-extract）
      const existing = await readdir(slotDir, { withFileTypes: true }).catch(() => []);
      for (const entry of existing) {
        if (entry.name === '.tmp-extract' || entry.name === 'manifest.json') continue;
        await rm(join(slotDir, entry.name), { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      // 移 tmpDir/* → slotDir/
      const extracted = await readdir(tmpDir, { withFileTypes: true }).catch(() => []);
      for (const entry of extracted) {
        await rename(join(tmpDir, entry.name), join(slotDir, entry.name));
      }
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    } catch (e) {
      log('error', 'ws_skill_promote_failed', {
        workspace_id: workspaceId,
        error: String(e),
      });
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      return { synced: false, skipped: false, linked: 0 };
    }

    // 3.6 写槽 manifest（记录该槽版本——per-workspace 独立演进，不碰全局槽）
    try {
      await mkdir(slotDir, { recursive: true });
      await writeFile(
        workspaceLocalManifestPath(workspaceId),
        JSON.stringify({ version: remote.version } satisfies LocalManifest),
        'utf-8',
      );
      log('info', 'ws_skill_sync_completed', {
        workspace_id: workspaceId,
        version: remote.version,
      });
      synced = true;
    } catch (e) {
      log('error', 'ws_skill_local_manifest_write_failed', {
        workspace_id: workspaceId,
        error: String(e),
      });
      return { synced: false, skipped: false, linked: 0 };
    }
  }

  // 4. link：槽内 skill 目录 → <workdir>/.claude/skills/（失败仅 warn）
  const linked = await linkWorkspaceSlotToWorkdir(workspaceId, workdir, log);
  return { synced, skipped: slotReady && local === remote.version, linked };
}

/** 槽 link 版本缓存（ql-20260907-006 同模式，键 `<wsId>::<workdir>`）。 */
const linkedWorkdirWsVersions = new Map<string, string>();

/** 清空 workspace 槽 link 版本缓存（测试隔离用；生产无调用点）。 */
export function resetLinkedWorkdirWsVersionsForTest(): void {
  linkedWorkdirWsVersions.clear();
}

/**
 * 把 per-workspace 槽内同步好的并集 skills 拷到 `<workdir>/.claude/skills/`。
 *
 * - 源：槽目录下每个 skill 目录（排除 manifest.json / .tmp-extract / 隐藏项）
 * - 目标：<workdir>/.claude/skills/<name> 覆盖（并集渲染为权威源——同名目录
 *   覆盖全局 link 的 user-only 拷贝 = D-002 注入集语义）
 * - 版本缓存跳过 / 存在性守卫 / 部分失败不自愈记版本：均照 linkSkillsToWorkdir
 *   同款（ql-20260907-006）
 * - 槽不存在（从未同步）/ workdir 空 → 静默返回 0
 */
async function linkWorkspaceSlotToWorkdir(
  workspaceId: string,
  workdir: string,
  logger: SkillManagerLogger,
): Promise<number> {
  if (!workdir) {
    logger('debug', 'link_ws_skills_no_workdir');
    return 0;
  }
  const srcDir = workspaceSkillsDir(workspaceId);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    logger('debug', 'link_ws_skills_src_missing', { src: srcDir });
    return 0;
  }
  const targetBase = join(workdir, '.claude', 'skills');
  await mkdir(targetBase, { recursive: true }).catch(() => undefined);
  const version = await getLocalWorkspaceSkillsVersion(workspaceId);
  const cacheKey = `${workspaceId}::${workdir}`;
  const versionFresh = version !== null && linkedWorkdirWsVersions.get(cacheKey) === version;
  let linked = 0;
  let freshSkipped = 0;
  let passClean = true;
  for (const entry of entries) {
    // 仅拷 skill 目录（排除 manifest.json / .tmp-extract / 隐藏）
    if (!entry.isDirectory()) continue;
    if (entry.name === '.tmp-extract' || entry.name.startsWith('.')) continue;
    const src = join(srcDir, entry.name);
    const dest = join(targetBase, entry.name);
    if (versionFresh) {
      // 存在性守卫：worktree 重建/外部删除的单个 skill 目录 → 该 skill 重拷
      let destOk = false;
      try {
        const s = await stat(dest);
        destOk = s.isDirectory();
      } catch {
        destOk = false;
      }
      if (destOk) {
        freshSkipped += 1;
        continue;
      }
    }
    try {
      await rm(dest, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dest, { recursive: true });
      linked += await copyDirBestEffort(src, dest, logger);
    } catch (e) {
      passClean = false;
      logger('warn', 'link_ws_skill_failed', {
        workspace_id: workspaceId,
        skill: entry.name,
        error: String(e),
      });
    }
  }
  if (version !== null && passClean) {
    linkedWorkdirWsVersions.set(cacheKey, version);
  }
  if (freshSkipped > 0) {
    logger('info', 'link_ws_skills_version_fresh_skip', {
      workspace_id: workspaceId,
      workdir,
      skills_skipped: freshSkipped,
      skills_copied: linked,
    });
  }
  logger('info', 'link_ws_skills_to_workdir_done', {
    workspace_id: workspaceId,
    workdir,
    files: linked,
  });
  return linked;
}

// ── workspace 自定义 skills 同步（task-04）──────────────────────────────────

/**
 * 同步 workspace 自定义 skills 到 worktree（task-04 / FR-04）。
 *
 * 从 workspace specDir 的 skills/ 子目录拉到 worktree `.claude/skills/workspace/`。
 * **命名隔离**：workspace skills 放 `workspace/` 子目录，与平台 skills（`.claude/skills/sillyspec/`）
 * 共存不冲突。每次同步先清空 workspace 子目录再 cp（已删 skill 不残留）。
 *
 * specDir 不存在 / 无 skills/ → 静默跳过（skipped: true，不抛）。
 * 单 skill 复制失败不中断其余（best-effort）。
 */
export async function syncWorkspaceSkills(
  workspaceSpecDir: string,
  worktreeDir: string,
  logger?: SkillManagerLogger,
): Promise<{ synced: number; skipped: boolean }>;
export async function syncWorkspaceSkills(
  workspaceSpecDir: string,
  worktreeDir: string,
  logger: SkillManagerLogger,
): Promise<{ synced: number; skipped: boolean }>;
export async function syncWorkspaceSkills(
  workspaceSpecDir: string,
  worktreeDir: string,
  logger?: SkillManagerLogger,
): Promise<{ synced: number; skipped: boolean }> {
  const log = logger ?? (() => undefined);

  // workspace skills 源目录
  const srcDir = join(workspaceSpecDir, 'skills');
  let srcExists = false;
  try {
    const s = await stat(srcDir);
    srcExists = s.isDirectory();
  } catch {
    srcExists = false;
  }
  if (!srcExists) {
    // workspace 无自定义 skills → 静默跳过
    return { synced: 0, skipped: true };
  }

  // 目标：worktree .claude/skills/workspace/（命名隔离，不覆盖平台 skills）
  const targetBase = join(worktreeDir, '.claude', 'skills', 'workspace');
  // 先清空 workspace 子目录（已删 skill 不残留），mkdir 重建
  await rm(targetBase, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(targetBase, { recursive: true });

  // 递归复制 srcDir/* → targetBase/（best-effort）
  let synced = 0;
  try {
    synced = await copyDirBestEffort(srcDir, targetBase, log);
  } catch (e) {
    log('error', 'workspace_skills_sync_failed', { error: String(e) });
  }
  log('info', 'workspace_skills_synced', { count: synced });
  return { synced, skipped: synced === 0 };
}

/** 递归复制目录（best-effort，单文件失败不中断）。返回成功复制的文件数。 */
async function copyDirBestEffort(
  src: string,
  dest: string,
  logger: SkillManagerLogger,
): Promise<number> {
  let count = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    try {
      if (entry.isDirectory()) {
        await mkdir(destPath, { recursive: true });
        count += await copyDirBestEffort(srcPath, destPath, logger);
      } else if (entry.isFile()) {
        await mkdir(dirname(destPath), { recursive: true });
        await copyFile(srcPath, destPath);
        count++;
      }
    } catch (e) {
      logger('warn', 'workspace_skill_copy_failed', { file: entry.name, error: String(e) });
    }
  }
  return count;
}

// ── 工具：路径存在检测（供测试复用）─────────────────────────────────────────

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ── linkSkillsToWorkdir：把同步的平台 skills 接到 claude 工作目录 ─────────────
// 2026-07-08 修复：syncSkills 把 skills 放 ~/.sillyhub/daemon/skills/，但 claude
// 只读 <cwd>/.claude/skills/ + ~/.claude/skills/，从没接线 → 交互式/batch 会话
// 看不到 sillyspec/custom skills。spawn 前调本函数把同步的 skills 拷到工作目录。
// 用 copy（跨平台安全，Windows symlink 需开发者模式）；幂等覆盖（同步版本新则更新）。

// ql-20260907-006：workdir → 已接线版本缓存（进程内）。原实现每会话对每个
// skill 全量 rm+重拷——Windows 逐文件 IO 叠加杀软扫描（spec-sync 同源实测
// ~8ms/文件），而内容只在 daemon 启动 syncSkills 时变化。版本（manifest.json
// 的 version）不变 + 目标目录仍在 → 跳过重拷；daemon 重启缓存即空（首会话
// 重拷一次，可接受）；worktree 重建/目标被外部删除 → 存在性守卫强制重拷；
// 版本变更（下次启动 syncSkills 更新）→ 全量重拷刷新内容。
const linkedWorkdirVersions = new Map<string, string>();

/** 清空 workdir 接线版本缓存（测试隔离用；生产无调用点）。 */
export function resetLinkedWorkdirVersionsForTest(): void {
  linkedWorkdirVersions.clear();
}

/**
 * 把 `~/.sillyhub/daemon/skills/` 下同步好的平台 skills 拷到 `<workdir>/.claude/skills/`，
 * 让 claude（cwd=workdir）能加载。spawn 前调用（交互式 + batch）。
 *
 * - 源：skillsDir() 下每个 skill 目录（排除 manifest.json / .tmp-extract / 隐藏项）
 * - 目标：<workdir>/.claude/skills/<name>，覆盖（daemon 同步为权威源）
 * - ql-20260907-006：manifest 版本未变 + 目标目录仍在 → 跳过重拷（见缓存注释）
 * - workdir 不可写/源空 → 静默跳过（不阻塞 spawn）
 * - 失败仅 warn（skill 缺失不应让会话挂掉）
 */
export async function linkSkillsToWorkdir(
  workdir: string,
  logger?: SkillManagerLogger,
): Promise<{ linked: number; skipped: boolean }>;
export async function linkSkillsToWorkdir(
  workdir: string,
  logger: SkillManagerLogger,
): Promise<{ linked: number; skipped: boolean }>;
export async function linkSkillsToWorkdir(
  workdir: string,
  logger?: SkillManagerLogger,
): Promise<{ linked: number; skipped: boolean }> {
  const log = logger ?? (() => undefined);
  if (!workdir) {
    log('debug', 'link_skills_no_workdir');
    return { linked: 0, skipped: true };
  }
  const srcDir = skillsDir();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    // 源目录不存在（syncSkills 从未跑）→ 静默跳过
    log('debug', 'link_skills_src_missing', { src: srcDir });
    return { linked: 0, skipped: true };
  }
  const targetBase = join(workdir, '.claude', 'skills');
  await mkdir(targetBase, { recursive: true }).catch(() => undefined);
  // ql-20260907-006：版本未变 + 该 workdir 已完成过接线 → 逐 skill 存在性校验后跳过。
  const version = await getLocalSkillsVersion();
  const versionFresh = version !== null && linkedWorkdirVersions.get(workdir) === version;
  let linked = 0;
  let freshSkipped = 0;
  let passClean = true;
  for (const entry of entries) {
    // 仅拷 skill 目录（排除 manifest.json / .tmp-extract / 隐藏）
    if (!entry.isDirectory()) continue;
    if (entry.name === '.tmp-extract' || entry.name.startsWith('.')) continue;
    const src = join(srcDir, entry.name);
    const dest = join(targetBase, entry.name);
    if (versionFresh) {
      // 存在性守卫：worktree 重建/外部删除的单个 skill 目录 → 该 skill 重拷
      let destOk = false;
      try {
        const s = await stat(dest);
        destOk = s.isDirectory();
      } catch {
        destOk = false;
      }
      if (destOk) {
        freshSkipped += 1;
        continue;
      }
    }
    try {
      // 清旧再拷（保证删除的文件不残留 + 内容更新）
      await rm(dest, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dest, { recursive: true });
      linked += await copyDirBestEffort(src, dest, log);
    } catch (e) {
      passClean = false;
      log('warn', 'link_skill_failed', { skill: entry.name, error: String(e) });
    }
  }
  // 本轮无失败才记版本（部分失败时不记，下轮全量重拷自愈——对齐旧「每次重拷」的
  // 跨会话自愈语义；copyDirBestEffort 的单文件 best-effort 失败不可见，接受）。
  if (version !== null && passClean) {
    linkedWorkdirVersions.set(workdir, version);
  }
  if (freshSkipped > 0) {
    log('info', 'link_skills_version_fresh_skip', {
      workdir,
      version,
      skills_skipped: freshSkipped,
      skills_copied: linked,
    });
  }
  log('info', 'link_skills_to_workdir_done', { workdir, files: linked });
  return { linked, skipped: linked === 0 };
}

