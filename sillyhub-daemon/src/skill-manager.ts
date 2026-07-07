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
 * 所有网络/IO 操作失败不抛错（返回 null/false），daemon 启动不阻塞。
 *
 * @module skill-manager
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';

// ── 常量 ──────────────────────────────────────────────────────────────────────

/**
 * 平台 skills 全局存储（所有 worktree 共享）。
 * 懒计算（运行时读 homedir）——模块加载时不固化，测试改 HOME/USERPROFILE 即时生效。
 */
function skillsDir(): string {
  return join(homedir(), '.sillyhub', 'daemon', 'skills');
}
/** 本地已同步版本记录。 */
function localManifestPath(): string {
  return join(skillsDir(), 'manifest.json');
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

// ── 远程 manifest ─────────────────────────────────────────────────────────────

/**
 * 从 backend 拉 skills manifest（`GET /api/daemon/skills/latest/manifest`）。
 * 网络错误/非 200 → null（不抛）。
 */
export async function fetchRemoteManifest(
  serverUrl: string,
  logger?: SkillManagerLogger,
): Promise<SkillsManifest | null> {
  const url = `${serverUrl.replace(/\/$/, '')}/api/daemon/skills/latest/manifest`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      logger?.('warn', 'skill_manifest_fetch_failed', { url, status: resp.status });
      return null;
    }
    return (await resp.json()) as SkillsManifest;
  } catch (e) {
    logger?.('warn', 'skill_manifest_unreachable', { url, error: String(e) });
    return null;
  }
}

// ── bundle 拉取 ───────────────────────────────────────────────────────────────

/**
 * 从 backend 拉 skills bundle（`GET /api/daemon/skills/latest/bundle`）。
 * 返回 ArrayBuffer（tar.gz）。网络错误/非 200 → null。
 */
export async function fetchSkillsBundle(
  serverUrl: string,
  logger?: SkillManagerLogger,
): Promise<ArrayBuffer | null> {
  const url = `${serverUrl.replace(/\/$/, '')}/api/daemon/skills/latest/bundle`;
  try {
    const resp = await fetch(url);
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
    tarBytes = gunzipSync(Buffer.from(bundleBytes));
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
  logger?: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }>;
export async function syncSkills(
  serverUrl: string,
  logger: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }>;
export async function syncSkills(
  serverUrl: string,
  logger?: SkillManagerLogger,
): Promise<{ synced: boolean; skipped: boolean }> {
  const log = logger ?? (() => undefined);

  // 1. 拉 remote manifest
  const remote = await fetchRemoteManifest(serverUrl, log);
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
  const bundle = await fetchSkillsBundle(serverUrl, log);
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
