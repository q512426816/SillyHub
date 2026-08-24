/**
 * claude-transcript-dir —— resume/reload 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定。
 *
 * ql-20260822-009：修复「已结束会话点重新打开后立刻被打回 ended」。create 路径
 * （spawn-env buildSpawnEnv）仅在 provider_config 存在时隔离 CLAUDE_CONFIG_DIR
 * （ql-20260729-002：未配供应商不隔离，claude 回退宿主机 ~/.claude 登录态）——因此
 * **未绑供应商会话的 transcript 写在 ~/.claude/projects/，绑了供应商的写在 daemon
 * 隔离目录**。而 resume（restoreAndReconnect）/ reload（_reloadSession）原先无条件
 * 强制隔离目录（ql-20260807-002 防「停止供应商后 jsonl 找不到」），两规则不对称：
 * 未绑供应商的会话重开时去隔离目录找 transcript → claude 报错退出 → fail → 会话
 * 被打回 ended，用户「不能继续对话」。
 *
 * 会话 id 在两处的文件名相同（<agentSessionId>.jsonl），且 SDK resume 只会在
 * $CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/ 下查找——所以正确做法是探测文件实际
 * 在哪边，而不是按 provider_config 现值推断（热切换后 provider_config 是现值而非
 * 创建值，推断不出 transcript 位置）。
 *
 * 判定表（applyTranscriptConfigDir）：
 *   - 隔离目录下找到 → 设 env.CLAUDE_CONFIG_DIR（ql-20260807-002 语义保留）；
 *   - 仅宿主机 ~/.claude 下找到 → 删除 env.CLAUDE_CONFIG_DIR（本修复新增）；
 *   - 都没有 / 探测失败 / agentSessionId 非法 → 保持强制隔离（修复前默认，best-effort）。
 *
 * 所有 fs 访问吞错（权限 / 目录不存在 → 按 unknown 处理），探测绝不阻断 resume。
 */

import { readdir } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CLAUDE_CONFIG_DIR } from '../config.js';

/** transcript 探测结果。 */
export type ClaudeTranscriptLocation = 'isolated' | 'host' | 'unknown';

/**
 * ql-20260822-001：transcript 探测/迁移共用的目录对。测试注入 tmp 目录对，
 * 可完整覆盖「home jsonl → 切供应商 → 迁移到隔离目录」链路而不触碰真实
 * ~/.claude。缺省 daemon 隔离目录 + 宿主机 ~/.claude。
 */
export interface TranscriptDirs {
  isolated: string;
  home: string;
}

/** 缺省目录对（生产路径）。 */
export function defaultTranscriptDirs(): TranscriptDirs {
  return { isolated: CLAUDE_CONFIG_DIR, home: join(homedir(), '.claude') };
}

/**
 * agentSessionId 合法性守卫：SDK 生成的是 UUID 形态。含路径分隔符 / 点点等可疑
 * 字符时直接 unknown（不探测），杜绝 join 出越界路径。
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/**
 * projects 根目录下是否存在目标 transcript（扫一层子目录，免复刻 claude 的
 * cwd→目录名编码规则——目录名只作容器，匹配文件名 <sid>.jsonl）。
 */
async function projectsDirHas(
  projectsRoot: string,
  transcriptFileName: string,
): Promise<boolean> {
  let dirs;
  try {
    dirs = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    try {
      const files = await readdir(join(projectsRoot, entry.name), {
        withFileTypes: true,
      });
      if (files.some((f) => f.isFile() && f.name === transcriptFileName)) {
        return true;
      }
    } catch {
      // 单个子目录不可读 → 跳过继续扫
    }
  }
  return false;
}

/**
 * 定位 claude transcript 实际所在的配置目录。
 *
 * 两侧都命中时优先 isolated（create 带供应商必然写隔离目录；双侧同 id 属极端
 * 脏数据，取与 ql-20260807-002 语义一致的一侧）。
 */
export async function locateClaudeTranscript(
  agentSessionId: string,
  dirs: TranscriptDirs = defaultTranscriptDirs(),
): Promise<ClaudeTranscriptLocation> {
  if (!SAFE_SESSION_ID.test(agentSessionId)) return 'unknown';
  const fileName = `${agentSessionId}.jsonl`;
  const isolatedRoot = join(dirs.isolated, 'projects');
  const hostRoot = join(dirs.home, 'projects');
  if (await projectsDirHas(isolatedRoot, fileName)) return 'isolated';
  if (await projectsDirHas(hostRoot, fileName)) return 'host';
  return 'unknown';
}

/**
 * 按 transcript 实际位置写 env.CLAUDE_CONFIG_DIR（就地修改）。unknown 保持强制
 * 隔离（修复前默认行为，best-effort：resume 是否失败交给 claude 自行报错）。
 */
export async function applyTranscriptConfigDir(
  env: NodeJS.ProcessEnv,
  agentSessionId: string | undefined,
  dirs: TranscriptDirs = defaultTranscriptDirs(),
): Promise<void> {
  const location = agentSessionId
    ? await locateClaudeTranscript(agentSessionId, dirs)
    : 'unknown';
  if (location === 'host') {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = dirs.isolated;
  }
}

/**
 * ql-20260822-001（移植自本地 resolveResumeConfigDir 演化线）：在
 * <configDir>/projects/<encoded-cwd>/ 下按文件名定位 <sid>.jsonl，命中返回
 * 绝对路径，未命中/IO 异常返回 null。
 *
 * encoded-cwd 编码规则非公开契约，故线性扫 projects 一层子目录（子目录数 =
 * 历史 cwd 数，个位数；existsSync 开销可忽略）。同步版供迁移路径使用（迁移
 * 本身是同步 fs，混入 async 探测会让调用链无谓拉长）。
 */
export function findClaudeTranscriptPath(
  configDir: string,
  agentSessionId: string,
): string | null {
  if (!SAFE_SESSION_ID.test(agentSessionId)) return null;
  try {
    const projects = join(configDir, 'projects');
    if (!existsSync(projects)) return null;
    for (const entry of readdirSync(projects)) {
      const p = join(projects, entry, `${agentSessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
    return null;
  } catch {
    // 目录不可读等 IO 异常按「不存在」处理（fallback 由调用方决定）。
    return null;
  }
}

/**
 * ql-20260822-001：home transcript 迁移（复制）到 daemon 隔离目录，让
 * reload/restore 后的 env 隔离（CLAUDE_CONFIG_DIR=隔离目录）重新生效。
 *
 * 为什么必须迁移（E2E 实锤 BigModel 400[1214]）：本机默认创建的会话 jsonl
 * 在 ~/.claude，仅「回本机目录 resume」（ql-20260822-009 语义）会把 claude
 * 暴露给用户真实的 ~/.claude/settings.json——其 env 块（cc-switch 手配）
 * **优先于进程注入的供应商 env**，切了供应商流量却跑到本机默认网关。唯一能
 * 同时满足「resume 找得到历史」+「供应商 env 不被污染」的办法是把历史搬进
 * 隔离目录再回隔离 env。
 *
 * 语义（自门控，调用方无需先探测）：
 *   - isolated 已命中 → false 跳过（isolated 是新真相源——迁移成功后新 turn
 *     写隔离副本，回灌 home 旧副本会丢增量；与 locateClaudeTranscript 的
 *     「双侧命中取 isolated」一致）；
 *   - home 无源 → false（迁移降级语义，调用方保持 home resume）；
 *   - home 有且 isolated 无 → 复制（非移动：~/.claude 是用户数据 daemon 不删
 *     不改，原件停留档；子目录名沿用源的 encoded-cwd 保证 resume 定位命中）。
 *
 * @returns true=迁移成功（applyTranscriptConfigDir 将命中 isolated）；
 *   false=无需迁移或复制失败（权限/磁盘等 → 调用方降级 home resume：会话
 *   可用但供应商 env 可能被本机 settings.json 污染，R-01 降级语义，绝不因
 *   迁移失败破坏会话）。
 */
export function migrateClaudeTranscriptToIsolated(
  agentSessionId: string,
  dirs: TranscriptDirs = defaultTranscriptDirs(),
): boolean {
  if (!SAFE_SESSION_ID.test(agentSessionId)) return false;
  if (findClaudeTranscriptPath(dirs.isolated, agentSessionId)) return false;
  const src = findClaudeTranscriptPath(dirs.home, agentSessionId);
  if (!src) return false;
  try {
    const dst = join(
      dirs.isolated,
      'projects',
      basename(dirname(src)),
      `${agentSessionId}.jsonl`,
    );
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    return true;
  } catch {
    // 复制失败（权限/磁盘等）→ 降级 home resume（调用方据 false 处理）。
    return false;
  }
}

/**
 * ql-20260824-016：isolated transcript 迁移回宿主机 ~/.claude（migrate-
 * ClaudeTranscriptToIsolated 的反向，切回本机默认时调用）。
 *
 * 为什么必须回迁：会话用平台供应商期间 jsonl 写在 daemon 隔离目录，切回本机后
 * 仅清掉供应商 env 不够——applyTranscriptConfigDir 按 jsonl 实际位置判定
 * （ql-20260822-009），隔离目录命中 → 强制 CLAUDE_CONFIG_DIR 隔离 → claude 读
 * 不到宿主机 ~/.claude/settings.json（cc-switch / OpenCode Go 等本机供应商配置），
 * 「本机默认」名不副实。回迁后 jsonl 仅在 home → 不隔离 → 本机会话语义闭环
 * （与 create 未配供应商的会话一致）。
 *
 * 语义（自门控，调用方无需先探测；与正向迁移镜像）：
 *   - isolated 无源 → false（本来就在 home，无需迁移）；
 *   - home 已有旧副本（正向迁移是复制非移动，home 停留档）→ **覆盖**：该文件是
 *     本会话自己的 transcript（UUID 文件名），isolated 副本含供应商期间新增 turn，
 *     是最新真相源，旧副本回灌会丢增量；
 *   - 复制成功后**删除 isolated 原件**——locateClaudeTranscript 双侧命中取
 *     isolated，不删则永远回不到 home；isolated 是 daemon 自管目录，删除无用户
 *     数据风险（home 侧从不删除，正向迁移同款约束）。
 *
 * @returns true=迁移成功且 isolated 原件已删（applyTranscriptConfigDir 将命中
 *   home）；false=无需迁移或失败（复制/删除失败 → 调用方降级 isolated resume：
 *   会话可用但读不到本机 settings.json，R-01 降级语义，绝不因迁移失败破坏会话）。
 */
export function migrateClaudeTranscriptToHost(
  agentSessionId: string,
  dirs: TranscriptDirs = defaultTranscriptDirs(),
): boolean {
  if (!SAFE_SESSION_ID.test(agentSessionId)) return false;
  const src = findClaudeTranscriptPath(dirs.isolated, agentSessionId);
  if (!src) return false;
  try {
    const dst = join(
      dirs.home,
      'projects',
      basename(dirname(src)),
      `${agentSessionId}.jsonl`,
    );
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    rmSync(src);
    return true;
  } catch {
    // 复制或删除失败（权限/磁盘等）→ 降级 isolated resume（调用方据 false 处理；
    // 复制成功但删除失败的中间态双侧命中取 isolated，同样落在 isolated 语义）。
    return false;
  }
}
