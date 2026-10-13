/**
 * interactive/turn-anchor 单测——轮锚点快照（2026-10-13-daemon-turn-anchor-snapshot）。
 *
 * Route B 真相源最小闭环的核心算法面：真实临时 git 仓跑锚点全链（copy index →
 * add -A → write-tree → diff-tree --numstat），不 mock git/child_process（daemon
 * 测试惯例：host-fs-handler 等同样真子进程；testTimeout 30s 覆盖 git init 开销）。
 *
 * 覆盖（= 成功标准逐条）：
 *   1. 首轮（有基线提交）：tracked 修改 + untracked 新文件都进锚与 diff
 *      （untracked 覆盖 = 评审 Gap1：stash create 不含未跟踪是雷，add -A 天然覆盖）；
 *   2. 零变化轮去重（treeSha 相同 → deduped=true 且不追加 JSONL）；
 *   3. 增量轮（第二个非零锚）prevTreeSha 链正确、files 只含本轮变化；
 *   4. 二进制文件 additions/deletions 记 null（numstat '-' 列）；
 *   5. 非 git 目录返回 null 永不抛（失败安全）；
 *   6. 「重启续锚」：模块状态清空后从 JSONL 尾行恢复 prev 锚（daemon 重启场景）；
 *   7. 中文文件名不转义（core.quotePath=false，numstat 原样 UTF-8 路径）。
 *
 * 模块级状态（per-session 串行链 + prev 锚内存）隔离手法：每个用例独立
 * sessionId + 关键用例 vi.resetModules 后动态重导入（等价 daemon 重启）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

/** 真 git 命令（测试夹具自用；被测模块自己持有 git 实现）。 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 20_000, windowsHide: true });
  return stdout;
}

/** 造一个带一次基线提交的临时 git 仓（config 本地化，GPG 关，跨平台 CI 可跑）。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'turn-anchor-'));
  try {
    await git(dir, ['init', '-b', 'main']);
  } catch {
    await git(dir, ['init']); // 旧版 git 无 -b，默认分支名无关紧要
  }
  await git(dir, ['config', 'user.email', 't@t.local']);
  await git(dir, ['config', 'user.name', 't']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'base.txt'), 'line1\nline2\n', 'utf-8');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'base']);
  return dir;
}

/** 夹具级 anchorsDir（隔离 daemonStateDir 默认值，测试不碰真实 ~/.sillyhub）。 */
async function makeAnchorsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'turn-anchor-store-'));
}

async function readRecords(
  anchorsDir: string,
  sessionId: string,
): Promise<unknown[]> {
  const text = await readFile(join(anchorsDir, `${sessionId}.jsonl`), 'utf-8');
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

interface AnchorModule {
  recordTurnAnchor(opts: {
    cwd: string;
    sessionId: string;
    runId?: string | null;
    anchorsDir?: string;
  }): Promise<{
    sessionId: string;
    runId: string | null;
    treeSha: string;
    prevTreeSha: string | null;
    headSha: string | null;
    deduped: boolean;
    files: Array<{ path: string; additions: number | null; deletions: number | null }>;
  } | null>;
}

/** 动态导入被测模块（vi.resetModules 后调用 = 模块级状态清零，模拟 daemon 重启）。 */
async function loadModule(): Promise<AnchorModule> {
  return (await import('../../src/interactive/turn-anchor.js')) as AnchorModule;
}

beforeEach(() => {
  vi.resetModules();
});

describe('interactive/turn-anchor 轮锚点快照', () => {
  it('首轮（有基线提交）：tracked 修改与 untracked 新文件都进 diff；JSONL 落一条；prevTreeSha=null', async () => {
    const mod = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-first-${randomUUID().slice(0, 8)}`;
    try {
      // 轮内改动：改 tracked + 新建 untracked（agent 产出的主要形态）。
      await writeFile(join(repo, 'base.txt'), 'line1\nline2\nline3\n', 'utf-8');
      await writeFile(join(repo, 'new-untracked.ts'), 'export const x = 1;\n', 'utf-8');

      const rec = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, runId: 'run-1', anchorsDir: anchors });
      expect(rec).not.toBeNull();
      expect(rec!.deduped).toBe(false);
      expect(rec!.prevTreeSha).toBeNull();
      expect(rec!.headSha).toMatch(/^[0-9a-f]{7,40}$/);
      expect(rec!.treeSha).toMatch(/^[0-9a-f]{7,40}$/);
      const byPath = new Map(rec!.files.map((f) => [f.path, f]));
      expect(byPath.get('base.txt')).toEqual({ path: 'base.txt', additions: 1, deletions: 0 });
      expect(byPath.get('new-untracked.ts')).toEqual({ path: 'new-untracked.ts', additions: 1, deletions: 0 });

      const records = await readRecords(anchors, sid);
      expect(records).toHaveLength(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('零变化轮去重：treeSha 与上一锚相同 → deduped=true 且不追加 JSONL', async () => {
    const mod = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-dedup-${randomUUID().slice(0, 8)}`;
    try {
      const first = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      expect(first!.deduped).toBe(false);

      const second = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      expect(second!.deduped).toBe(true);
      expect(second!.treeSha).toBe(first!.treeSha);
      expect(second!.files).toEqual([]);

      const records = await readRecords(anchors, sid);
      expect(records).toHaveLength(1); // 去重轮不落盘
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('增量轮：prevTreeSha 链到上一锚，files 只含本轮变化文件', async () => {
    const mod = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-incr-${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(join(repo, 'turn1.txt'), 'a\n', 'utf-8');
      const first = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });

      await writeFile(join(repo, 'turn2.txt'), 'b\n', 'utf-8');
      const second = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      expect(second!.prevTreeSha).toBe(first!.treeSha);
      expect(second!.files).toEqual([{ path: 'turn2.txt', additions: 1, deletions: 0 }]);

      const records = await readRecords(anchors, sid);
      expect(records).toHaveLength(2);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('二进制文件：additions/deletions 记 null（numstat "-" 列）', async () => {
    const mod = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-bin-${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
      const rec = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      const entry = rec!.files.find((f) => f.path === 'blob.bin');
      expect(entry).toEqual({ path: 'blob.bin', additions: null, deletions: null });
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('非 git 目录：返回 null 且不抛错（失败安全）', async () => {
    const mod = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), 'turn-anchor-nogit-'));
    const anchors = await makeAnchorsDir();
    const sid = `s-nogit-${randomUUID().slice(0, 8)}`;
    try {
      const rec = await mod.recordTurnAnchor({ cwd: dir, sessionId: sid, anchorsDir: anchors });
      expect(rec).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('重启续锚：模块状态清空后从 JSONL 尾行恢复 prev 锚（内存 miss → 尾行兜底）', async () => {
    const mod1 = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-restart-${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(join(repo, 'turn1.txt'), 'a\n', 'utf-8');
      const first = await mod1.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });

      // 「重启」：模块级 Map 清零（vi.resetModules + 重新动态导入），prev 锚只能来自 JSONL 尾行。
      vi.resetModules();
      const mod2 = await loadModule();
      await writeFile(join(repo, 'turn2.txt'), 'b\n', 'utf-8');
      const second = await mod2.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      expect(second!.prevTreeSha).toBe(first!.treeSha);
      expect(second!.files).toEqual([{ path: 'turn2.txt', additions: 1, deletions: 0 }]);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });

  it('中文文件名：numstat 路径原样 UTF-8（core.quotePath=false 不转义）', async () => {
    const mod = await loadModule();
    const repo = await makeRepo();
    const anchors = await makeAnchorsDir();
    const sid = `s-cjk-${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(join(repo, '中文文件.md'), '# 你好\n', 'utf-8');
      const rec = await mod.recordTurnAnchor({ cwd: repo, sessionId: sid, anchorsDir: anchors });
      const entry = rec!.files.find((f) => f.path === '中文文件.md');
      expect(entry).toEqual({ path: '中文文件.md', additions: 1, deletions: 0 });
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(anchors, { recursive: true, force: true });
    }
  });
});
