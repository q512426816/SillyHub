/**
 * 本地缓存清理逻辑（sillyhub-daemon/cleanup）。
 *
 * 按 CLEANABLE_DIRS + bin 备份 + 根目录日志黑名单删除 ~/.sillyhub/daemon/ 下的
 * 缓存；未列入黑名单的内容一律保留（config.json、locks/、workspaces/、
 * claude-config/.claude.json 活跃配置、outbox/、runs/ 等）。
 * 支持 dry-run 模式（仅统计不删除）。
 *
 * @module cleanup
 */

import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** 每个清理目标的统计结果。 */
export interface CleanupEntry {
  /** 目标描述：目录条目为相对路径，文件类条目为汇总描述（如 `bin/*.bak* (3 个文件)`）。 */
  path: string;
  /** 删除前的大小（字节）。 */
  freedBytes: number;
}

/** performCleanup 返回值。 */
export interface CleanupResult {
  /** 各目标的清理统计。 */
  entries: CleanupEntry[];
  /** 总释放字节数。 */
  totalFreedBytes: number;
  /** dry-run 模式标志。 */
  dryRun: boolean;
}

/**
 * 需要整目录删除的子路径（相对于 baseDir）。
 * 这些目录可被 daemon 或 sync 过程重新创建。
 *
 * 注意：outbox/（断线补发队列，resilience/outbox.ts FR-06/FR-09）与
 * runs/（活跃任务终端日志，terminal-observer.ts 另有 7 天保留期清理）
 * 绝不在此列——删除会丢未投递消息 / 活跃任务日志。
 */
const CLEANABLE_DIRS = [
  'specs',
  join('claude-config', 'projects'),
  join('claude-config', 'backups'),
  'manifests',
  'skills',
] as const;

/**
 * 递归统计目录大小（字节）。
 * 失败时静默返回 0（目录可能不存在）。
 */
async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await dirSize(full);
        } else {
          const s = await stat(full);
          total += s.size;
        }
      } catch {
        // 跳过无法 stat 的文件（权限等）
      }
    }
  } catch {
    // 目录不存在或无权限
  }
  return total;
}

/**
 * 按 glob 模式匹配文件名（简易实现，支持 * 通配符）。
 */
function matchesGlob(name: string, pattern: string): boolean {
  // 转换 glob 为正则：* → [^/]*，其余转义
  const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$';
  return new RegExp(regexStr).test(name);
}

/**
 * 执行本地缓存清理。
 *
 * @param baseDir daemon 数据根目录（如 ~/.sillyhub/daemon/）
 * @param options.dryRun 仅统计不删除（默认 false）
 * @returns 清理统计结果
 */
export async function performCleanup(
  baseDir: string,
  options?: { dryRun?: boolean },
): Promise<CleanupResult> {
  const dryRun = options?.dryRun ?? false;
  const entries: CleanupEntry[] = [];

  // 1. 整目录删除
  for (const dirRel of CLEANABLE_DIRS) {
    const dirPath = join(baseDir, dirRel);
    const size = await dirSize(dirPath);
    if (size > 0 || (await dirExists(dirPath))) {
      entries.push({ path: dirRel, freedBytes: size });
      if (!dryRun) {
        await rm(dirPath, { recursive: true, force: true });
      }
    }
  }

  // 2. bin 目录下的 .bak 文件
  const binDir = join(baseDir, 'bin');
  const bakFiles = await globFiles(binDir, '*.bak*');
  let bakSize = 0;
  for (const f of bakFiles) {
    try {
      const s = await stat(f);
      bakSize += s.size;
      if (!dryRun) {
        await rm(f, { force: true });
      }
    } catch {
      // skip
    }
  }
  if (bakFiles.length > 0) {
    entries.push({ path: `bin/*.bak* (${bakFiles.length} 个文件)`, freedBytes: bakSize });
  }

  // 3. 根目录下的日志和备份文件
  const rootLogFilePatterns = ['*.log', '*.out', '*.err', 'config*.json.bak*'];
  let rootLogSize = 0;
  let rootLogCount = 0;
  try {
    const rootFiles = await readdir(baseDir, { withFileTypes: true });
    for (const entry of rootFiles) {
      if (!entry.isFile()) continue;
      if (entry.name === 'config.json') continue; // 保留主配置
      const matched = rootLogFilePatterns.some(p => matchesGlob(entry.name, p));
      if (matched) {
        const full = join(baseDir, entry.name);
        try {
          const s = await stat(full);
          rootLogSize += s.size;
          rootLogCount++;
          if (!dryRun) {
            await rm(full, { force: true });
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }
  if (rootLogCount > 0) {
    entries.push({ path: `根目录日志/备份 (${rootLogCount} 个文件)`, freedBytes: rootLogSize });
  }

  const totalFreedBytes = entries.reduce((sum, e) => sum + e.freedBytes, 0);

  return { entries, totalFreedBytes, dryRun };
}

/** 辅助：目录是否存在。 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** 辅助：列出目录下匹配 glob 模式的文件。 */
async function globFiles(dirPath: string, pattern: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && matchesGlob(entry.name, pattern)) {
        files.push(join(dirPath, entry.name));
      }
    }
  } catch {
    // 目录不存在
  }
  return files;
}
