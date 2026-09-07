// tests/agent-log/liveness/discovery.test.ts —— 自发现通道（最小版）单测。
//
// task-04（2026-09-07-agent-liveness-states / FR-02）：三层数据源（spawn 记录 /
// sessions.json 恢复 / 窗口重扫兜底）× 直算定位档（claude/pi，布局规则自
// sillyspec agent-session-log.js 移植）。假目录树全注入，零真实文件系统。
import { describe, expect, it } from 'vitest';

import { discoverLivenessWatchTargets, type DiscoveryFs } from '../../../src/agent-log/liveness/discovery.js';

const T0 = Date.parse('2026-09-07T10:00:00Z');
const CWD = 'C:\\Users\\qinyi\\IdeaProjects\\demo';
const CLAUDE_DIR = 'C:/Users/qinyi/.claude/projects/C--Users-qinyi-IdeaProjects-demo';
const PI_FILE = 'C:/Users/qinyi/.pi/agent/sessions/--C--Users-qinyi-IdeaProjects-demo--/session.jsonl';

/** 内存假目录树：dirs[path] = 文件名→mtime；stat 独立表。 */
class FakeFs implements DiscoveryFs {
  dirs = new Map<string, Map<string, number>>();
  stats = new Map<string, number>();
  heads = new Map<string, string>();
  now = T0;

  addDir(path: string, files: Record<string, number>): void {
    this.dirs.set(path, new Map(Object.entries(files)));
    for (const [name, mtime] of Object.entries(files)) {
      this.stats.set(`${path}/${name}`, mtime);
    }
  }

  homeDir(): string {
    return 'C:/Users/qinyi';
  }

  env(): undefined {
    return undefined;
  }

  listDir(path: string): Array<{ name: string; mtimeMs: number }> | null {
    const d = this.dirs.get(path);
    if (!d) return null;
    return [...d.entries()].map(([name, mtimeMs]) => ({ name, mtimeMs }));
  }

  stat(p: string): { mtimeMs: number } | null {
    const m = this.stats.get(p);
    return m === undefined ? null : { mtimeMs: m };
  }

  readHead(p: string, maxBytes: number): string | null {
    const h = this.heads.get(p);
    return h === undefined ? null : h.slice(0, maxBytes);
  }
}

function freshFs(): FakeFs {
  const fs = new FakeFs();
  fs.addDir(CLAUDE_DIR, { 'sess-aaa.jsonl': T0 - 30_000, 'old.jsonl': T0 - 30 * 60 * 1000 });
  // 布局根目录（rescan 兜底扫描入口）：项目目录以条目形态挂在根下
  fs.addDir('C:/Users/qinyi/.claude/projects', { [CLAUDE_DIR.split('/').pop()!]: T0 - 30_000 });
  fs.stats.set(PI_FILE, T0 - 30_000);
  fs.addDir('C:/Users/qinyi/.pi/agent/sessions', { '--C--Users-qinyi-IdeaProjects-demo--': T0 - 30_000 });
  return fs;
}

describe('discoverLivenessWatchTargets（task-04 最小版：直算档）', () => {
  it('① spawn 记录：claude provider 由 cwd 直算项目目录，窗口内最新 jsonl 命中；sessionId 已知则精确匹配', () => {
    const fs = freshFs();
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: false,
      spawnRecords: [{ provider: 'claude', cwd: CWD, agentSessionId: 'sess-aaa' }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      logPath: `${CLAUDE_DIR}/sess-aaa.jsonl`,
      format: 'claude-code-jsonl',
      source: 'spawn-record',
      workspace: 'ws1',
    });
  });

  it('② sessions.json 恢复：pi provider 直算 session.jsonl（cwd 编码规则移植），来源标记 sessions-json', () => {
    const fs = freshFs();
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: false,
      persistedSessions: [{ provider: 'pi', cwd: CWD }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ logPath: PI_FILE, format: 'pi-session-jsonl', source: 'sessions-json' });
  });

  it('③ 窗口重扫兜底：布局根目录下窗口内文件命中（来源 rescan），过期文件不进', () => {
    const fs = freshFs();
    fs.addDir('C:/Users/qinyi/.pi/agent/sessions/--C--Users-qinyi-IdeaProjects-other--', { 'session.jsonl': T0 - 60_000 });
    fs.dirs.get('C:/Users/qinyi/.pi/agent/sessions')!.set('--C--Users-qinyi-IdeaProjects-other--', T0 - 60_000);
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: true,
      resolveWorkspace: () => 'ws1',
    });
    // claude demo 项目目录（old.jsonl 过期不入）+ pi other 项目（窗口内）
    expect(out.some((t) => t.logPath === `${CLAUDE_DIR}/sess-aaa.jsonl` && t.source === 'rescan')).toBe(true);
    expect(out.some((t) => t.logPath === `${CLAUDE_DIR}/old.jsonl`)).toBe(false);
    expect(out.some((t) => t.logPath.endsWith('IdeaProjects-other--/session.jsonl'))).toBe(true);
  });

  it('cwd 不匹配（目录不存在）不进；未知 provider 跳过（codex/zcode 窄扫归 task-05）', () => {
    const fs = freshFs();
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: false,
      spawnRecords: [
        { provider: 'claude', cwd: 'D:\\not-exist' },
        { provider: 'codex', cwd: CWD },
        { provider: 'zcode', cwd: CWD },
      ],
      resolveWorkspace: () => 'ws1',
    });
    expect(out).toHaveLength(0);
  });

  it('去重：同一 logPath 多源发现只保留一条（spawn-record 优先级最高）', () => {
    const fs = freshFs();
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: false,
      spawnRecords: [{ provider: 'claude', cwd: CWD }],
      persistedSessions: [{ provider: 'claude', cwd: CWD }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out.filter((t) => t.logPath === `${CLAUDE_DIR}/sess-aaa.jsonl`)).toHaveLength(1);
    expect(out[0].source).toBe('spawn-record');
  });

  it('format 串与落库串逐字一致（claude-code-jsonl / pi-session-jsonl）', () => {
    const fs = freshFs();
    const out = discoverLivenessWatchTargets({
      fs,
      now: () => fs.now,
      rescan: false,
      spawnRecords: [{ provider: 'claude', cwd: CWD }],
      persistedSessions: [{ provider: 'pi', cwd: CWD }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out.map((t) => t.format).sort()).toEqual(['claude-code-jsonl', 'pi-session-jsonl']);
  });
});

// ── task-05：窄扫档（codex 日目录 + session_meta.cwd 精确匹配 / zcode 共享 rollout + workdir 标记）──

describe('discoverLivenessWatchTargets 窄扫档（task-05）', () => {
  const ZCODE_DIR = 'C:/Users/qinyi/.zcode/cli/rollout';
  const CODEX_DAY = `C:/Users/qinyi/.codex/sessions/2026/09/07`;

  function narrowFs(): FakeFs {
    const fs = new FakeFs();
    // codex：今日目录两个 rollout（一个 cwd 匹配、一个他项目）
    fs.dirs.set(CODEX_DAY, new Map([
      ['rollout-2026-09-07T09-00-00-match.jsonl', T0 - 30_000],
      ['rollout-2026-09-07T09-05-00-other.jsonl', T0 - 30_000],
    ]));
    fs.stats.set(`${CODEX_DAY}/rollout-2026-09-07T09-00-00-match.jsonl`, T0 - 30_000);
    fs.stats.set(`${CODEX_DAY}/rollout-2026-09-07T09-05-00-other.jsonl`, T0 - 30_000);
    fs.heads.set(`${CODEX_DAY}/rollout-2026-09-07T09-00-00-match.jsonl`, JSON.stringify({ type: 'session_meta', payload: { cwd: CWD, session_id: 's1' } }) + '\n');
    fs.heads.set(`${CODEX_DAY}/rollout-2026-09-07T09-05-00-other.jsonl`, JSON.stringify({ type: 'session_meta', payload: { cwd: 'D:/other-project' } }) + '\n');
    // zcode：共享 rollout 目录两个会话（workdir 标记区分，含转义路径）
    fs.dirs.set(ZCODE_DIR, new Map([
      ['model-io-sess_mine.jsonl', T0 - 30_000],
      ['model-io-sess_theirs.jsonl', T0 - 30_000],
      ['model-io-sess_nomarker.jsonl', T0 - 30_000],
    ]));
    fs.stats.set(`${ZCODE_DIR}/model-io-sess_mine.jsonl`, T0 - 30_000);
    fs.stats.set(`${ZCODE_DIR}/model-io-sess_theirs.jsonl`, T0 - 30_000);
    fs.stats.set(`${ZCODE_DIR}/model-io-sess_nomarker.jsonl`, T0 - 30_000);
    fs.heads.set(`${ZCODE_DIR}/model-io-sess_mine.jsonl`, 'prefix Working directory: ' + JSON.stringify(CWD).slice(1, -1) + '\\n"tail"');
    fs.heads.set(`${ZCODE_DIR}/model-io-sess_theirs.jsonl`, 'Working directory: D:/other\nmore');
    fs.heads.set(`${ZCODE_DIR}/model-io-sess_nomarker.jsonl`, 'no marker here');
    return fs;
  }

  it('codex 窄扫：今日/昨日目录 rollout 候选按 session_meta.cwd 精确匹配，他会话不串台', () => {
    const fs = narrowFs();
    const out = discoverLivenessWatchTargets({
      fs, now: () => fs.now, rescan: false,
      spawnRecords: [{ provider: 'codex', cwd: CWD }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ logPath: `${CODEX_DAY}/rollout-2026-09-07T09-00-00-match.jsonl`, format: 'codex-rollout-jsonl', harness: 'codex', source: 'spawn-record' });
  });

  it('zcode 窄扫：workdir 标记（JSON 转义还原）等值匹配，无标记/他会话丢弃（fail-closed）', () => {
    const fs = narrowFs();
    const out = discoverLivenessWatchTargets({
      fs, now: () => fs.now, rescan: false,
      spawnRecords: [{ provider: 'zcode', cwd: CWD }],
      resolveWorkspace: () => 'ws1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ logPath: `${ZCODE_DIR}/model-io-sess_mine.jsonl`, format: 'zcode-model-io-jsonl', harness: 'zcode', agentSessionId: 'mine' });
  });

  it('窗口外的窄扫候选不进；fs 无 readHead 时窄扫档整体跳过不误报', () => {
    const fs = narrowFs();
    fs.dirs.get(CODEX_DAY)!.set('rollout-old.jsonl', T0 - 30 * 60 * 1000);
    fs.stats.set(`${CODEX_DAY}/rollout-old.jsonl`, T0 - 30 * 60 * 1000);
    fs.heads.set(`${CODEX_DAY}/rollout-old.jsonl`, JSON.stringify({ type: 'session_meta', payload: { cwd: CWD } }) + '\n');
    let out = discoverLivenessWatchTargets({ fs, now: () => fs.now, rescan: false, spawnRecords: [{ provider: 'codex', cwd: CWD }], resolveWorkspace: () => 'ws1' });
    expect(out).toHaveLength(1); // 仅 match 那个，old 不进
    const noHead = {
      homeDir: () => fs.homeDir(),
      env: (k: string) => fs.env(k),
      listDir: (d: string) => fs.listDir(d),
      stat: (p2: string) => fs.stat(p2),
    };
    out = discoverLivenessWatchTargets({ fs: noHead as never, now: () => fs.now, rescan: false, spawnRecords: [{ provider: 'zcode', cwd: CWD }], resolveWorkspace: () => 'ws1' });
    expect(out).toHaveLength(0);
  });
});
