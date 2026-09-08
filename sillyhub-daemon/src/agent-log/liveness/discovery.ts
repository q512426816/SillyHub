/**
 * `agent-log/liveness/discovery.ts` —— daemon 会话日志自发现（最小版）。
 *
 * task-04（2026-09-07-agent-liveness-states / FR-02 + D-003@v1）：daemon 作为
 * spawn 方知道每个托管会话的 provider/cwd/sessionId，无需经 CLI 登记绕行即可
 * 定位日志（design §5.2 自发现段）。三层数据源：
 *   ① 运行期 spawn 记录（内存，主路径）
 *   ② sessions.json 重启恢复（`PersistedSessionRecord` 的 provider/cwd，batch
 *      worker 不落盘——由③兜底）
 *   ③ 窗口重扫（sessions.json 缺失/损坏或 worker 未落盘时扫布局根目录，
 *      mtime 15min 窗口内文件）
 * 定位两档（design §5.2）：claude/pi 目录名由 cwd 确定性编码 → 直算路径
 * （本模块）；codex（uuid 文件名）/ zcode（rollout 目录全局共享）→ 窄扫 +
 * 标记匹配（task-05 扩展，本模块遇之跳过）。
 *
 * 布局编码规则自 sillyspec `src/agent-session-log.js` 移植（JS→TS 近乎 1:1）：
 *   claude: `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<cwd 非字母数字→'-' >/<sessionId>.jsonl`
 *   pi:     `~/.pi/agent/sessions/--<cwd 去盘符前导斜杠、/\\:→'-' >--/session.jsonl`
 *
 * @module agent-log/liveness/discovery
 */

import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

import type { WatchTarget } from './tailer.js';

/** 发现层 fs 原语（注入；默认实现走 node:fs，测试假目录树零真实 IO）。 */
export interface DiscoveryFs {
  homeDir(): string;
  env(key: string): string | undefined;
  /** @returns 目录下文件条目；目录不存在返回 null。 */
  listDir(path: string): Array<{ name: string; mtimeMs: number }> | null;
  stat(path: string): { mtimeMs: number } | null;
  /** 读文件头部 maxBytes 文本（窄扫标记匹配，task-05）；不支持返回 undefined。 */
  readHead?(path: string, maxBytes: number): string | null;
}

/** 运行期 spawn 记录（daemon 内存持有；task-06 接线注入）。 */
export interface SpawnRecord {
  provider: string;
  cwd: string;
  agentSessionId?: string | null;
}

/** sessions.json 恢复用的最小字段视图（PersistedSessionRecord 子集，避免耦合 interactive 层）。 */
export interface PersistedSessionLite {
  provider?: string;
  cwd?: string;
}

export interface DiscoveryInput {
  fs?: DiscoveryFs;
  now?: () => number;
  /** 重扫兜底开关（默认开：sessions.json 缺失场景的覆盖面）。 */
  rescan?: boolean;
  spawnRecords?: SpawnRecord[];
  persistedSessions?: PersistedSessionLite[];
  /** cwd → workspace 归属解析（daemon 侧 workspace 表；缺省 'default'）。 */
  resolveWorkspace?: (cwd: string | undefined) => string;
}

/** 窗口：mtime 15min 内视为活跃（对齐协议 §1.3 会话结束口径）。 */
const WINDOW_MS = 15 * 60 * 1000;

/** claude 项目目录名编码（移植 agent-session-log.js mungeClaudeProjectDir）。 */
export function mungeClaudeProjectDir(cwd: string): string {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

/** pi safePath 目录名编码（移植 agent-session-log.js mungePiSafePath，dist/migrations.js:101 实证规则）。 */
export function mungePiSafePath(cwd: string): string {
  return `--${String(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function joinPosix(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

/** 发现结果去重键：logPath（双源发现同一文件按来源优先级保留一条，spawn-record 最高）。 */
const SOURCE_PRIORITY: Record<string, number> = {
  'spawn-record': 0,
  'sessions-json': 1,
  rescan: 2,
  'registry-sync': 3,
};

/**
 * 发现 watch 目标（三层数据源合并 + 去重，spawn-record 优先）。
 *
 * 定位两档（design §5.2）：claude/pi 直算（cwd 确定性编码）；codex/zcode 窄扫
 * + 标记匹配（task-05：session_meta.cwd 精确等值 / workdir 标记转义还原，
 * 均按 cwd 归属判定防串台，标记读不出 fail-closed 丢弃）。窗口外文件不进。
 */
export function discoverLivenessWatchTargets(input: DiscoveryInput): WatchTarget[] {
  const now = (input.now ?? Date.now)();
  const fs: DiscoveryFs = input.fs ?? (getDefaultDiscoveryFs() as DiscoveryFs);
  const windowMs = WINDOW_MS;
  const resolveWorkspace = input.resolveWorkspace ?? (() => 'default');
  const byPath = new Map<string, WatchTarget>();

  const push = (t: WatchTarget): void => {
    const existing = byPath.get(t.logPath);
    if (existing && (SOURCE_PRIORITY[existing.source ?? 'rescan'] ?? 9) <= (SOURCE_PRIORITY[t.source ?? 'rescan'] ?? 9)) {
      return;
    }
    byPath.set(t.logPath, t);
  };

  const home = toPosix(fs.homeDir());
  const claudeRoot = toPosix(fs.env('CLAUDE_CONFIG_DIR') ?? joinPosix(home, '.claude'));

  /** claude 直算：项目目录下 sessionId 精确或窗口内最新 jsonl。 */
  const locateClaude = (cwd: string, sessionId: string | null | undefined, source: WatchTarget['source']): void => {
    const projectDir = joinPosix(claudeRoot, 'projects', mungeClaudeProjectDir(cwd));
    if (sessionId) {
      const exact = `${projectDir}/${sessionId}.jsonl`;
      const st = fs.stat(exact);
      if (st && now - st.mtimeMs <= windowMs) {
        push({ logPath: exact, format: 'claude-code-jsonl', workspace: resolveWorkspace(cwd), harness: 'claude-code', agentSessionId: sessionId, source, agentCwd: cwd });
      }
      return;
    }
    const files = fs.listDir(projectDir);
    if (!files) return;
    const active = files
      .filter((f) => f.name.endsWith('.jsonl') && now - f.mtimeMs <= windowMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (active) {
      push({ logPath: `${projectDir}/${active.name}`, format: 'claude-code-jsonl', workspace: resolveWorkspace(cwd), harness: 'claude-code', agentSessionId: active.name.replace(/\.jsonl$/, ''), source, agentCwd: cwd });
    }
  };

  /** pi 直算：safePath 目录下 session.jsonl。 */
  const locatePi = (cwd: string, source: WatchTarget['source']): void => {
    const file = joinPosix(home, '.pi', 'agent', 'sessions', mungePiSafePath(cwd), 'session.jsonl');
    const st = fs.stat(file);
    if (st && now - st.mtimeMs <= windowMs) {
      push({ logPath: file, format: 'pi-session-jsonl', workspace: resolveWorkspace(cwd), harness: 'pi', agentSessionId: null, source, agentCwd: cwd });
    }
  };

  /** 读文件头（窄扫标记匹配；fs 未提供 readHead 时跳过该档）。 */
  const readHead = (path: string, maxBytes: number): string | null => fs.readHead?.(path, maxBytes) ?? null;

  /**
   * codex 窄扫（task-05）：`<CODEX_HOME|~/.codex>/sessions/YYYY/MM/DD/rollout-*.jsonl`
   * 文件名含 uuid 无法由 cwd 直算——扫今天/昨天两个日期目录（15min 窗口跨零点至多
   * 两天，sillyspec detectCodex 同款剪枝），逐候选读首行 `session_meta.payload.cwd`
   * **精确等值**匹配（防并发其他项目的会话串台，fail-closed：标记读不出即丢弃）。
   */
  const locateCodex = (cwd: string, source: WatchTarget['source']): void => {
    const codexRoot = toPosix(fs.env('CODEX_HOME') ?? joinPosix(home, '.codex'));
    const dayDirs = [...new Set([new Date(now), new Date(now - 24 * 60 * 60 * 1000)].map(
      (d) => joinPosix(codexRoot, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')),
    ))];
    for (const dir of dayDirs) {
      const files = fs.listDir(dir);
      if (!files) continue;
      const candidates = files
        .filter((f) => f.name.startsWith('rollout-') && f.name.endsWith('.jsonl') && now - f.mtimeMs <= windowMs)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const f of candidates) {
        const full = `${dir}/${f.name}`;
        const head = readHead(full, 4096);
        if (!head) continue;
        const firstLine = head.split('\n', 1)[0] ?? '';
        try {
          const meta = JSON.parse(firstLine) as { type?: unknown; payload?: { cwd?: unknown } };
          if (meta?.type === 'session_meta' && meta.payload?.cwd === cwd) {
            push({ logPath: full, format: 'codex-rollout-jsonl', workspace: resolveWorkspace(cwd), harness: 'codex', agentSessionId: null, source, agentCwd: cwd });
          }
        } catch {
          /* 首行非 JSON：跳过该候选 */
        }
      }
    }
  };

  /** zcode workdir 标记（sillyspec ZCODE_WORKDIR_RE 同源）。 */
  const ZCODE_WORKDIR_RE = /[Ww]orking directory: /;

  /** 还原标记后的 JSON 字符串片段值（转义序列按 JSON 语义解码到行尾）。 */
  function unescapeJsonFragment(s: string): string {
    let out = '';
    for (let j = 0; j < s.length;) {
      const c = s[j];
      if (c !== '\\') { out += c; j += 1; continue; }
      const e = s[j + 1];
      if (e === undefined || e === 'n') break; // 行尾换行转义 → 值结束
      if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(j + 2, j + 6))) {
        out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16));
        j += 6;
      } else if (e === 'r') { out += '\r'; j += 2; }
      else if (e === 't') { out += '\t'; j += 2; }
      else { out += e === '/' ? '/' : e; j += 2; } // \\ \" \/ 等：取转义次字符
    }
    return out;
  }

  /**
   * zcode 窄扫（task-05）：`~/.zcode/cli/rollout/model-io-sess_*.jsonl` rollout 目录
   * 全局共享（跨项目混存）——窗口内候选逐个读头 64KB 提取 `[Ww]orking directory: `
   * 标记并按 JSON 转义还原，与 cwd 等值比较（fail-closed：标记读不出丢弃，
   * sillyspec extractZcodeWorkdir 同源移植）。
   */
  const locateZcode = (cwd: string, source: WatchTarget['source']): void => {
    const rolloutDir = joinPosix(home, '.zcode', 'cli', 'rollout');
    const files = fs.listDir(rolloutDir);
    if (!files) return;
    const candidates = files
      .filter((f) => f.name.startsWith('model-io-sess_') && f.name.endsWith('.jsonl') && now - f.mtimeMs <= windowMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of candidates) {
      const full = `${rolloutDir}/${f.name}`;
      const head = readHead(full, 64 * 1024);
      if (!head) continue;
      const m = ZCODE_WORKDIR_RE.exec(head);
      if (!m) continue;
      const workdir = unescapeJsonFragment(head.slice(m.index + m[0].length));
      if (workdir === cwd) {
        push({ logPath: full, format: 'zcode-model-io-jsonl', workspace: resolveWorkspace(cwd), harness: 'zcode', agentSessionId: f.name.replace(/^model-io-sess_/, '').replace(/\.jsonl$/, ''), source, agentCwd: cwd });
      }
    }
  };

  const locate = (provider: string, cwd: string, sessionId: string | null | undefined, source: WatchTarget['source']): void => {
    if (provider === 'claude') locateClaude(cwd, sessionId, source);
    else if (provider === 'pi') locatePi(cwd, source);
    else if (provider === 'codex') locateCodex(cwd, source); // task-05 窄扫档
    else if (provider === 'zcode') locateZcode(cwd, source); // task-05 窄扫档
  };

  for (const r of input.spawnRecords ?? []) {
    locate(r.provider, r.cwd, r.agentSessionId ?? null, 'spawn-record');
  }
  for (const s of input.persistedSessions ?? []) {
    if (s.provider && s.cwd) locate(s.provider, s.cwd, null, 'sessions-json');
  }

  if (input.rescan !== false) {
    // ③ 兜底重扫：布局根目录下窗口内文件（无法反解 cwd，workspace 交 resolver(default)）
    const claudeProjects = fs.listDir(joinPosix(claudeRoot, 'projects'));
    if (claudeProjects) {
      for (const dir of claudeProjects) {
        const files = fs.listDir(joinPosix(claudeRoot, 'projects', dir.name));
        const active = files
          ?.filter((f) => f.name.endsWith('.jsonl') && now - f.mtimeMs <= windowMs)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
        if (active) {
          push({ logPath: joinPosix(claudeRoot, 'projects', dir.name, active.name), format: 'claude-code-jsonl', workspace: resolveWorkspace(undefined), harness: 'claude-code', agentSessionId: active.name.replace(/\.jsonl$/, ''), source: 'rescan' });
        }
      }
    }
    const piSessions = fs.listDir(joinPosix(home, '.pi', 'agent', 'sessions'));
    if (piSessions) {
      for (const dir of piSessions) {
        const file = joinPosix(home, '.pi', 'agent', 'sessions', dir.name, 'session.jsonl');
        const st = fs.stat(file);
        if (st && now - st.mtimeMs <= windowMs) {
          push({ logPath: file, format: 'pi-session-jsonl', workspace: resolveWorkspace(undefined), harness: 'pi', agentSessionId: null, source: 'rescan' });
        }
      }
    }
  }

  return [...byPath.values()];
}

/** 默认 fs（node:fs 同步原语 + try/catch 容错；仅生产路径使用，测试注入假树）。 */
function getDefaultDiscoveryFs(): DiscoveryFs {
  return {
    homeDir: () => homedir(),
    env: (key: string) => process.env[key],
    listDir(path: string): Array<{ name: string; mtimeMs: number }> | null {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => ({ name: e.name, mtimeMs: statSync(`${path}/${e.name}`).mtimeMs }));
      } catch {
        return null;
      }
    },
    stat(path: string): { mtimeMs: number } | null {
      try {
        return { mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    },
    readHead(path: string, maxBytes: number): string | null {
      // R8（ql-20260908-006）：fd 必须 close——旧实现把 openSync 返回值内联传给
      // readSync 后即弃，每候选泄漏 1 fd（60s 一轮 discovery × 候选数，长跑 EMFILE，
      // Windows 上还会卡住 rollout 文件无法删除/轮转）。
      let fd: number | undefined;
      try {
        fd = openSync(path, 'r');
        const buf = Buffer.alloc(maxBytes);
        const n = readSync(fd, buf, 0, maxBytes, 0);
        return buf.subarray(0, n).toString('utf8');
      } catch {
        return null;
      } finally {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            /* 已关闭/不可关闭：不掩盖主路径返回值 */
          }
        }
      }
    },
  };
}
