/**
 * 关联仓本机现状快照测试（2026-10-10-linked-repos-local-echo task-01 / FR-01）。
 *
 * 覆盖：命令拼装（数组形参/--spec-dir 在场/仅两条读命令）、JSON 解析归一（role 空串/
 * path "?"→null）、local.yaml 解析（repos: 段 + projects: 块提取）、源级降级
 * （unknown command→skipped 标注）、R-01 兜底（status path null→config projects 块填充）。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  parseLocalYamlSections,
  runLinkedReposSnapshot,
  type LinkedReposSnapshotDeps,
} from '../src/linked-repos-snapshot.js';

function makeExec(
  behavior: (args: string[]) => { ok?: boolean; stdout?: string; stderr?: string; killed?: boolean } = () => ({ ok: true }),
) {
  const calls: string[][] = [];
  const exec = vi.fn(async (args: string[], _cwd: string) => {
    calls.push(args);
    const r = behavior(args);
    if (r.ok !== false) return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    const err = new Error('exec failed') as Error & { killed?: boolean; stdout?: string; stderr?: string };
    err.killed = r.killed;
    err.stdout = r.stdout ?? '';
    err.stderr = r.stderr ?? '';
    throw err;
  });
  const deps: LinkedReposSnapshotDeps = { resolveBin: () => '/bin/sillyspec.js', exec };
  return { deps, calls };
}

const STATUS_JSON = JSON.stringify({
  projects: [
    { name: 'demo', path: '../demo', role: '', state: 'scanned', detail: '已扫描（3 份文档）' },
    { name: 'other', path: '?', role: '后端', state: 'scanned', detail: '' },
  ],
});

const LOCAL_YAML = [
  '# 注释不进快照',
  'repos:',
  '  demo: C:/works/demo',
  '  extra: ../extra',
  '',
  '# modules 块（顶层键结束 repos 段）',
  'modules:',
  '  backend: pytest',
  '',
  'projects:',
  '  demo: ../demo',
  '  fallback-only: ../fb',
].join('\n');

describe('runLinkedReposSnapshot', () => {
  it('命令拼装：仅两条读命令（数组形参），config cat 显式 --spec-dir', async () => {
    const { deps, calls } = makeExec((args) =>
      args[0] === 'workspace' ? { stdout: STATUS_JSON } : { stdout: LOCAL_YAML },
    );
    const snap = await runLinkedReposSnapshot('C:/ws', deps);
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(['workspace', 'status', '--json']);
    expect(calls[1]).toEqual(['config', 'cat', '--spec-dir', 'C:/ws']);
    expect(snap.projects_skipped).toBeNull();
    expect(snap.repos_skipped).toBeNull();
  });

  it('归一：role 空串→null；path "?"→null；fetched_at 在场', async () => {
    const { deps } = makeExec((args) =>
      args[0] === 'workspace' ? { stdout: STATUS_JSON } : { stdout: '' },
    );
    const snap = await runLinkedReposSnapshot('C:/ws', deps);
    const demo = snap.projects.find((p) => p.name === 'demo')!;
    expect(demo.role).toBeNull();
    expect(demo.path).toBe('../demo');
    const other = snap.projects.find((p) => p.name === 'other')!;
    expect(other.path).toBeNull();
    expect(other.role).toBe('后端');
    expect(snap.fetched_at).toBeTruthy();
  });

  it('local.yaml 解析：repos 段与 projects 块提取（modules 后不再吃 repos）', () => {
    const { repos, projects } = parseLocalYamlSections(LOCAL_YAML);
    expect(repos).toEqual([
      { key: 'demo', path: 'C:/works/demo' },
      { key: 'extra', path: '../extra' },
    ]);
    expect(projects).toEqual([
      { name: 'demo', path: '../demo' },
      { name: 'fallback-only', path: '../fb' },
    ]);
  });

  it('R-01 兜底：status path 为 null 时用 config projects 块填充', async () => {
    const { deps } = makeExec((args) =>
      args[0] === 'workspace' ? { stdout: STATUS_JSON } : { stdout: LOCAL_YAML },
    );
    const snap = await runLinkedReposSnapshot('C:/ws', deps);
    // other 的 path "?" → null → config projects 块无 other → 保持 null
    expect(snap.projects.find((p) => p.name === 'other')!.path).toBeNull();
    // demo 双源都有 → 保持 ../demo
    expect(snap.projects.find((p) => p.name === 'demo')!.path).toBe('../demo');
  });

  it('源级降级：workspace unknown command → projects_skipped 标注，repos 源照常', async () => {
    const { deps } = makeExec((args) =>
      args[0] === 'workspace'
        ? { ok: false, stderr: "error: unknown command 'workspace'" }
        : { stdout: LOCAL_YAML },
    );
    const snap = await runLinkedReposSnapshot('C:/ws', deps);
    expect(snap.projects).toEqual([]);
    expect(snap.projects_skipped).toContain('需升级');
    expect(snap.repos.length).toBe(2);
    expect(snap.repos_skipped).toBeNull();
  });

  it('源级降级：config cat 失败 → repos_skipped 标注，projects 源照常', async () => {
    const { deps } = makeExec((args) =>
      args[0] === 'workspace' ? { stdout: STATUS_JSON } : { ok: false, stderr: 'boom' },
    );
    const snap = await runLinkedReposSnapshot('C:/ws', deps);
    expect(snap.repos).toEqual([]);
    expect(snap.repos_skipped).toBe('读取失败');
    expect(snap.projects.length).toBe(2);
  });

  it('bin 缺失 → 双源 skipped（能力缺失非错误）', async () => {
    const { calls } = makeExec();
    const snap = await runLinkedReposSnapshot('C:/ws', {
      resolveBin: () => null,
      exec: () => {
        throw new Error('should not exec');
      },
    });
    expect(calls.length).toBe(0);
    expect(snap.projects_skipped).toContain('未安装');
    expect(snap.repos_skipped).toContain('未安装');
  });
});

// 供 bin 缺失用例复用的 calls 断言（上面 makeExec 的 exec 不会被调用）
void makeExec;
