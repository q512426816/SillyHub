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
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CONFIG_DIR } from '../config.js';

/** transcript 探测结果。 */
export type ClaudeTranscriptLocation = 'isolated' | 'host' | 'unknown';

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
): Promise<ClaudeTranscriptLocation> {
  if (!SAFE_SESSION_ID.test(agentSessionId)) return 'unknown';
  const fileName = `${agentSessionId}.jsonl`;
  const isolatedRoot = join(CLAUDE_CONFIG_DIR, 'projects');
  const hostRoot = join(homedir(), '.claude', 'projects');
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
): Promise<void> {
  const location = agentSessionId
    ? await locateClaudeTranscript(agentSessionId)
    : 'unknown';
  if (location === 'host') {
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR;
  }
}
