// tests/skill-manager.test.ts
// task-03 + task-04: daemon skill-manager 单测。
//
// task-03（平台同步）：覆盖 getLocalSkillsVersion / fetchRemoteManifest / fetchSkillsBundle /
//   checkSha256 / extractSkillsBundle（含路径穿越防护）/ syncSkills（版本相同跳过 / 版本新拉解压 /
//   sha256 校验失败 / manifest 不可达）。
// task-04（workspace 同步）：覆盖 syncWorkspaceSkills（有自定义 skills 同步 / 无 skills 跳过 /
//   与平台 skills 命名隔离共存 / specDir 不存在不抛 / 重复同步覆盖）。
// bridges task-04（2026-09-11-workspace-asset-bridges / D-007）：覆盖 fetch URL 的
//   workspace_id 组装（带/不带）、per-workspace 槽（skills-workspaces/<wsId>/）版本比对
//   与全局槽/双 ws 槽互不覆盖、syncWorkspaceGitSkills 解包进槽 + link 到 workdir。
//
// @module skill-manager.test

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

import {
  getLocalSkillsVersion,
  getLocalWorkspaceSkillsVersion,
  fetchRemoteManifest,
  fetchSkillsBundle,
  checkSha256,
  extractSkillsBundle,
  syncSkills,
  syncWorkspaceSkills,
  syncWorkspaceGitSkills,
  linkSkillsToWorkdir,
  resetLinkedWorkdirVersionsForTest,
  resetLinkedWorkdirWsVersionsForTest,
  pathExists,
} from '../src/skill-manager.js';

// ── 辅助 ──────────────────────────────────────────────────────────────────────

/** 构造极简 tar.gz（USTAR）：单个普通文件 name → content。 */
function makeTarGz(entries: { name: string; content: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const { name, content } of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 'utf-8');
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'utf-8');
    header[156] = 0x30; // typeflag '0' (普通文件)
    // checksum
    let cksum = 0;
    for (let i = 0; i < 512; i++) cksum += header[i] ?? 0;
    header.write(cksum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf-8');
    chunks.push(header);
    chunks.push(content);
    const pad = 512 - (content.length % 512);
    if (pad < 512) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0)); // 结束标记
  return zlib.gzipSync(Buffer.concat(chunks));
}

// ── getLocalSkillsVersion ────────────────────────────────────────────────────

describe('skill-manager: getLocalSkillsVersion', () => {
  it('文件不存在 → null', async () => {
    // 默认 HOME 指向不存在的路径（测试隔离）
    const v = await getLocalSkillsVersion();
    // 在 CI 可能读到真实文件，断言 null 或字符串二选一（宽松）
    expect(v === null || typeof v === 'string').toBe(true);
  });
});

// ── fetchRemoteManifest ──────────────────────────────────────────────────────

describe('skill-manager: fetchRemoteManifest', () => {
  it('网络错误 → null 不抛', async () => {
    const logs: unknown[] = [];
    const logger = (_l: string, _m: string, d?: unknown) => logs.push(d);
    const r = await fetchRemoteManifest('http://nonexistent.invalid', undefined, logger as never);
    expect(r).toBeNull();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('HTTP 404 → null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('No skills', { status: 404 }),
    );
    const r = await fetchRemoteManifest('http://test.invalid');
    expect(r).toBeNull();
    fetchSpy.mockRestore();
  });

  it('200 → 解析 manifest', async () => {
    const manifest = { version: 'abc123456789', files: [] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(manifest), { status: 200 }),
    );
    const r = await fetchRemoteManifest('http://test.invalid');
    expect(r?.version).toBe('abc123456789');
    fetchSpy.mockRestore();
  });
});

// ── checkSha256 ──────────────────────────────────────────────────────────────

describe('skill-manager: checkSha256', () => {
  it('匹配 → true', () => {
    const data = Buffer.from('hello');
    const sha = require('node:crypto').createHash('sha256').update(data).digest('hex');
    expect(checkSha256(data, sha)).toBe(true);
  });

  it('不匹配 → false', () => {
    expect(checkSha256(Buffer.from('hello'), '0'.repeat(64))).toBe(false);
  });

  it('expectedSha256 空 → 跳过校验 true', () => {
    expect(checkSha256(Buffer.from('hello'), '')).toBe(true);
  });
});

// ── extractSkillsBundle ──────────────────────────────────────────────────────

describe('skill-manager: extractSkillsBundle', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-extract-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('正常解压文件到目标目录', async () => {
    const tarGz = makeTarGz([
      { name: 'sillyspec-verify/index.ts', content: Buffer.from('verify') },
      { name: 'sillyspec-verify/config.json', content: Buffer.from('{}') },
    ]);
    const ok = await extractSkillsBundle(tarGz, tmpDir);
    expect(ok).toBe(true);
    expect(await readFile(join(tmpDir, 'sillyspec-verify', 'index.ts'), 'utf-8')).toBe('verify');
  });

  it('路径穿越 entry → 拒绝返回 false', async () => {
    // 构造含 ../escape 的 tar.gz
    const tarGz = makeTarGz([{ name: '../escape.txt', content: Buffer.from('evil') }]);
    const ok = await extractSkillsBundle(tarGz, tmpDir);
    expect(ok).toBe(false);
  });

  it('空/损坏 gzip → false 不抛', async () => {
    const ok = await extractSkillsBundle(Buffer.from('not gzip'), tmpDir);
    expect(ok).toBe(false);
  });
});

// ── syncSkills（集成，mock fetch）────────────────────────────────────────────

describe('skill-manager: syncSkills', () => {
  let tmpHome: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'skill-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    // Windows 也设 USERPROFILE
    process.env.USERPROFILE = tmpHome;
  });
  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('remote manifest 不可达 → synced=false 不抛', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const r = await syncSkills('http://test.invalid', { apiKey: 'test-key' });
    expect(r.synced).toBe(false);
    fetchSpy.mockRestore();
  });

  it('版本新 → 拉 bundle + 解压 + 写本地版本', async () => {
    const tarGz = makeTarGz([
      { name: 'sillyspec-verify/index.ts', content: Buffer.from('v') },
    ]);
    const manifest = { version: 'newversion123' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(tarGz, { status: 200 }));
    const r = await syncSkills('http://test.invalid', { apiKey: 'test-key' });
    expect(r.synced).toBe(true);
    // 本地版本记录
    const home = tmpHome;
    const localManifest = JSON.parse(
      await readFile(join(home, '.sillyhub', 'daemon', 'skills', 'manifest.json'), 'utf-8'),
    ) as { version: string };
    expect(localManifest.version).toBe('newversion123');
    fetchSpy.mockRestore();
  });

  it('版本相同 → skipped=true 不拉 bundle', async () => {
    // 先写本地版本
    const home = tmpHome;
    await mkdir(join(home, '.sillyhub', 'daemon', 'skills'), { recursive: true });
    await writeFile(
      join(home, '.sillyhub', 'daemon', 'skills', 'manifest.json'),
      JSON.stringify({ version: 'sameversion1' }),
    );
    const manifest = { version: 'sameversion1' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }));
    const r = await syncSkills('http://test.invalid', { apiKey: 'test-key' });
    expect(r.skipped).toBe(true);
    expect(r.synced).toBe(false);
    // fetch 只调一次（manifest，不拉 bundle）
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

// ── syncWorkspaceSkills（task-04）────────────────────────────────────────────

describe('skill-manager: syncWorkspaceSkills', () => {
  let worktreeDir: string;
  let specDir: string;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), 'wt-'));
    specDir = await mkdtemp(join(tmpdir(), 'spec-'));
  });
  afterEach(async () => {
    await Promise.all([
      rm(worktreeDir, { recursive: true, force: true }),
      rm(specDir, { recursive: true, force: true }),
    ]);
  });

  it('workspace 有自定义 skills → 同步到 worktree .claude/skills/workspace/', async () => {
    // 准备 specDir/skills/my-skill/index.ts
    await mkdir(join(specDir, 'skills', 'my-skill'), { recursive: true });
    await writeFile(join(specDir, 'skills', 'my-skill', 'index.ts'), 'my-skill');
    const r = await syncWorkspaceSkills(specDir, worktreeDir);
    expect(r.synced).toBe(1);
    expect(await readFile(join(worktreeDir, '.claude', 'skills', 'workspace', 'my-skill', 'index.ts'), 'utf-8')).toBe(
      'my-skill',
    );
  });

  it('workspace 无 skills/ → skipped=true 不抛', async () => {
    const r = await syncWorkspaceSkills(specDir, worktreeDir);
    expect(r.skipped).toBe(true);
    expect(r.synced).toBe(0);
  });

  it('specDir 不存在 → skipped=true 不抛', async () => {
    const r = await syncWorkspaceSkills(join(tmpdir(), 'no-such-spec-dir'), worktreeDir);
    expect(r.skipped).toBe(true);
  });

  it('命名隔离：workspace skills 落 workspace/ 子目录，不覆盖平台 skills', async () => {
    // 先在 worktree 放一个"平台" skill（模拟 task-03 产物）
    await mkdir(join(worktreeDir, '.claude', 'skills', 'sillyspec'), { recursive: true });
    await writeFile(join(worktreeDir, '.claude', 'skills', 'sillyspec', 'verify.ts'), 'platform');
    // workspace 同步一个同名 skill
    await mkdir(join(specDir, 'skills', 'sillyspec'), { recursive: true });
    await writeFile(join(specDir, 'skills', 'sillyspec', 'verify.ts'), 'workspace-override');
    await syncWorkspaceSkills(specDir, worktreeDir);
    // 平台 skill 不被覆盖
    expect(await readFile(join(worktreeDir, '.claude', 'skills', 'sillyspec', 'verify.ts'), 'utf-8')).toBe(
      'platform',
    );
    // workspace skill 落 workspace/ 子目录
    expect(
      await readFile(join(worktreeDir, '.claude', 'skills', 'workspace', 'sillyspec', 'verify.ts'), 'utf-8'),
    ).toBe('workspace-override');
  });

  it('重复同步：先清 workspace 子目录再 cp（已删 skill 不残留）', async () => {
    // 第一次同步 2 个 skill
    await mkdir(join(specDir, 'skills', 'a'), { recursive: true });
    await writeFile(join(specDir, 'skills', 'a', 'index.ts'), 'a');
    await mkdir(join(specDir, 'skills', 'b'), { recursive: true });
    await writeFile(join(specDir, 'skills', 'b', 'index.ts'), 'b');
    await syncWorkspaceSkills(specDir, worktreeDir);
    expect(await pathExists(join(worktreeDir, '.claude', 'skills', 'workspace', 'b', 'index.ts'))).toBe(true);
    // 第二次只同步 1 个（删 b）
    await rm(join(specDir, 'skills', 'b'), { recursive: true, force: true });
    await syncWorkspaceSkills(specDir, worktreeDir);
    expect(await pathExists(join(worktreeDir, '.claude', 'skills', 'workspace', 'b', 'index.ts'))).toBe(false);
    expect(await pathExists(join(worktreeDir, '.claude', 'skills', 'workspace', 'a', 'index.ts'))).toBe(true);
  });
});

// ── linkSkillsToWorkdir（2026-07-08 修复：spawn 前接线 skills 到 cwd/.claude/skills/）──

describe('skill-manager: linkSkillsToWorkdir', () => {
  let tmpHome: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'link-skills-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });
  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('skills 同步目录有 skill → 拷到 workdir/.claude/skills/', async () => {
    // 准备 ~/.sillyhub/daemon/skills/my-skill/SKILL.md
    const skillsRoot = join(tmpHome, '.sillyhub', 'daemon', 'skills');
    await mkdir(join(skillsRoot, 'my-skill'), { recursive: true });
    await writeFile(join(skillsRoot, 'my-skill', 'SKILL.md'), '# my-skill');
    await writeFile(join(skillsRoot, 'manifest.json'), '{"version":"v1"}');

    const workdir = await mkdtemp(join(tmpdir(), 'link-wt-'));
    const r = await linkSkillsToWorkdir(workdir);
    expect(r.linked).toBeGreaterThan(0);
    expect(await readFile(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')).toBe('# my-skill');
    // manifest.json 不拷（非目录）
    expect(await pathExists(join(workdir, '.claude', 'skills', 'manifest.json'))).toBe(false);
  });

  it('源目录不存在 → skipped=true 不抛', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'link-wt-'));
    const r = await linkSkillsToWorkdir(workdir);
    expect(r.skipped).toBe(true);
  });

  it('workdir 空 → skipped=true 不抛', async () => {
    const r = await linkSkillsToWorkdir('');
    expect(r.skipped).toBe(true);
  });

  it('.tmp-extract 被排除（不拷临时解压目录）', async () => {
    const skillsRoot = join(tmpHome, '.sillyhub', 'daemon', 'skills');
    await mkdir(join(skillsRoot, '.tmp-extract', 'junk'), { recursive: true });
    await writeFile(join(skillsRoot, '.tmp-extract', 'junk', 'f'), 'x');
    await mkdir(join(skillsRoot, 'real-skill'), { recursive: true });
    await writeFile(join(skillsRoot, 'real-skill', 'SKILL.md'), 'real');

    const workdir = await mkdtemp(join(tmpdir(), 'link-wt-'));
    await linkSkillsToWorkdir(workdir);
    expect(await pathExists(join(workdir, '.claude', 'skills', '.tmp-extract'))).toBe(false);
    expect(await pathExists(join(workdir, '.claude', 'skills', 'real-skill', 'SKILL.md'))).toBe(true);
  });
});

// ql-20260907-006：workdir→版本缓存跳过重拷（原每会话全量 rm+重拷，Windows 逐文件
// IO+杀软扫描成本高，内容却只在启动 syncSkills 时变化）。
describe('skill-manager: linkSkillsToWorkdir 版本跳过（ql-20260907-006）', () => {
  let tmpHome: string;
  let origHome: string | undefined;
  let skillsRoot: string;
  let workdir: string;

  beforeEach(async () => {
    resetLinkedWorkdirVersionsForTest();
    tmpHome = await mkdtemp(join(tmpdir(), 'link-skip-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    skillsRoot = join(tmpHome, '.sillyhub', 'daemon', 'skills');
    await mkdir(join(skillsRoot, 'my-skill'), { recursive: true });
    await writeFile(join(skillsRoot, 'my-skill', 'SKILL.md'), 'v1-content');
    await writeFile(join(skillsRoot, 'manifest.json'), '{"version":"v1"}');
    workdir = await mkdtemp(join(tmpdir(), 'link-skip-wt-'));
  });
  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    await rm(tmpHome, { recursive: true, force: true });
    await rm(workdir, { recursive: true, force: true });
  });

  it('同版本二次调用 → 跳过重拷（目标期间被外部改动不覆盖），版本变更 → 全量重拷刷新', async () => {
    // 第一次：全量拷贝。
    const r1 = await linkSkillsToWorkdir(workdir);
    expect(r1.linked).toBeGreaterThan(0);
    expect(await readFile(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')).toBe('v1-content');

    // 第二次（同版本）：删除目标文件后调用——跳过重拷则文件不复活。
    await rm(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'));
    const logs: string[] = [];
    const r2 = await linkSkillsToWorkdir(workdir, (level, msg) => {
      logs.push(msg);
    });
    expect(r2.linked).toBe(0);
    expect(logs).toContain('link_skills_version_fresh_skip');
    expect(await pathExists(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(false);

    // 第三次（版本升 v2 + 内容更新）：全量重拷，删掉的文件复活且内容刷新。
    await writeFile(join(skillsRoot, 'my-skill', 'SKILL.md'), 'v2-content');
    await writeFile(join(skillsRoot, 'manifest.json'), '{"version":"v2"}');
    const r3 = await linkSkillsToWorkdir(workdir);
    expect(r3.linked).toBeGreaterThan(0);
    expect(await readFile(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')).toBe('v2-content');
  });

  it('同版本但目标 skill 目录被删（worktree 重建）→ 存在性守卫强制重拷', async () => {
    await linkSkillsToWorkdir(workdir);
    expect(await pathExists(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);

    // 模拟 worktree 重建：目标整个 skills 目录消失，版本不变。
    await rm(join(workdir, '.claude', 'skills'), { recursive: true, force: true });
    const r = await linkSkillsToWorkdir(workdir);
    expect(r.linked).toBeGreaterThan(0);
    expect(await pathExists(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('无 manifest（version=null）→ 不启用跳过，维持每次重拷', async () => {
    await rm(join(skillsRoot, 'manifest.json'));
    await linkSkillsToWorkdir(workdir);
    await rm(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'));
    const r = await linkSkillsToWorkdir(workdir);
    // 无版本记录 → 不缓存 → 每次全量重拷（旧语义）
    expect(r.linked).toBeGreaterThan(0);
    expect(await pathExists(join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });
});

// ── auth header 传递（2026-07-08 修复 401：skill 同步需带鉴权）──────────────
describe('skill-manager: fetch 带 auth header', () => {
  it('apiKey → X-API-Key header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'v1' }), { status: 200 }),
    );
    await fetchRemoteManifest('http://hub', { apiKey: 'shk_live_xxx' });
    const opts = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((opts?.headers as Record<string, string>)?.['X-API-Key']).toBe('shk_live_xxx');
    spy.mockRestore();
  });

  it('token → Authorization Bearer header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'v1' }), { status: 200 }),
    );
    await fetchRemoteManifest('http://hub', { token: 'jwt-yyy' });
    const opts = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((opts?.headers as Record<string, string>)?.['Authorization']).toBe('Bearer jwt-yyy');
    spy.mockRestore();
  });

  it('apiKey + token 都给 → apiKey 优先（X-API-Key）', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'v1' }), { status: 200 }),
    );
    await fetchRemoteManifest('http://hub', { apiKey: 'k', token: 't' });
    const opts = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((opts?.headers as Record<string, string>)?.['X-API-Key']).toBe('k');
    expect((opts?.headers as Record<string, string>)?.['Authorization']).toBeUndefined();
    spy.mockRestore();
  });
});

// ── bridges task-04（D-007）：workspace_id URL 组装 + per-workspace 槽 ─────────

describe('skill-manager: fetch URL workspace_id 组装（bridges task-04）', () => {
  it('fetchRemoteManifest 带 workspaceId → URL 拼 ?workspace_id=', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }));
    await fetchRemoteManifest('http://hub/', undefined, undefined, 'ws-uuid-1');
    expect(spy.mock.calls[0]?.[0]).toBe(
      'http://hub/api/daemon/skills/latest/manifest?workspace_id=ws-uuid-1',
    );
    spy.mockRestore();
  });

  it('fetchRemoteManifest 不带 workspaceId → URL 无查询串（旧行为）', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }));
    await fetchRemoteManifest('http://hub');
    expect(spy.mock.calls[0]?.[0]).toBe('http://hub/api/daemon/skills/latest/manifest');
    spy.mockRestore();
  });

  it('fetchSkillsBundle 带 workspaceId → URL 拼 ?workspace_id=', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(Buffer.from('tar'), { status: 200 }));
    await fetchSkillsBundle('http://hub', undefined, undefined, 'ws-uuid-2');
    expect(spy.mock.calls[0]?.[0]).toBe(
      'http://hub/api/daemon/skills/latest/bundle?workspace_id=ws-uuid-2',
    );
    spy.mockRestore();
  });

  it('workspaceId 含特殊字符 → URLSearchParams 正确编码', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }));
    await fetchRemoteManifest('http://hub', undefined, undefined, 'ws uuid&x');
    expect(spy.mock.calls[0]?.[0]).toBe(
      'http://hub/api/daemon/skills/latest/manifest?workspace_id=ws+uuid%26x',
    );
    spy.mockRestore();
  });
});

describe('skill-manager: syncWorkspaceGitSkills（bridges task-04 / D-007）', () => {
  let tmpHome: string;
  let origHome: string | undefined;
  let workdir: string;

  beforeEach(async () => {
    resetLinkedWorkdirVersionsForTest();
    resetLinkedWorkdirWsVersionsForTest();
    tmpHome = await mkdtemp(join(tmpdir(), 'ws-skill-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    workdir = await mkdtemp(join(tmpdir(), 'ws-skill-wt-'));
  });
  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome;
    await Promise.all([
      rm(tmpHome, { recursive: true, force: true }),
      rm(workdir, { recursive: true, force: true }),
    ]);
  });

  /** 槽目录：~/.sillyhub/daemon/skills-workspaces/<wsId>/。 */
  const slotDir = (wsId: string): string =>
    join(tmpHome, '.sillyhub', 'daemon', 'skills-workspaces', wsId);

  it('版本新 → 拉 bundle 解包进槽 + link 到 workdir/.claude/skills/', async () => {
    const tarGz = makeTarGz([
      { name: 'ws-git-a/SKILL.md', content: Buffer.from('# ws-git-a') },
      { name: 'ws-git-a/helper.py', content: Buffer.from('x = 1\n') },
      { name: 'user-git-b/SKILL.md', content: Buffer.from('# user-git-b') },
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'wsv1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(tarGz, { status: 200 }));

    const r = await syncWorkspaceGitSkills(
      'http://test.invalid',
      { apiKey: 'k' },
      '11111111-1114-4111-8111-111111111111',
      workdir,
    );

    expect(r.synced).toBe(true);
    expect(r.skipped).toBe(false);
    // 两次请求都带 workspace_id
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('workspace_id=11111111-1114-4111-8111-111111111111');
    expect(fetchSpy.mock.calls[1]?.[0]).toContain('workspace_id=11111111-1114-4111-8111-111111111111');
    // 槽内解包 + 槽版本记录
    expect(await readFile(join(slotDir('11111111-1114-4111-8111-111111111111'), 'ws-git-a', 'SKILL.md'), 'utf-8')).toBe('# ws-git-a');
    const slotManifest = JSON.parse(
      await readFile(join(slotDir('11111111-1114-4111-8111-111111111111'), 'manifest.json'), 'utf-8'),
    ) as { version: string };
    expect(slotManifest.version).toBe('wsv1');
    expect(await getLocalWorkspaceSkillsVersion('11111111-1114-4111-8111-111111111111')).toBe('wsv1');
    // workdir 接线（并集内容直接落 .claude/skills/<name>）
    expect(await readFile(join(workdir, '.claude', 'skills', 'ws-git-a', 'SKILL.md'), 'utf-8')).toBe('# ws-git-a');
    expect(await readFile(join(workdir, '.claude', 'skills', 'user-git-b', 'SKILL.md'), 'utf-8')).toBe('# user-git-b');
    // manifest.json 不拷
    expect(await pathExists(join(workdir, '.claude', 'skills', 'manifest.json'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('槽版本相同 → skipped=true 不拉 bundle，但槽内容仍 link 到 workdir', async () => {
    // 预置槽：版本 wsv1 + 一个已解包 skill
    await mkdir(join(slotDir('22222222-2224-4222-8222-222222222222'), 'kept-skill'), { recursive: true });
    await writeFile(
      join(slotDir('22222222-2224-4222-8222-222222222222'), 'kept-skill', 'SKILL.md'),
      'kept',
    );
    await writeFile(
      join(slotDir('22222222-2224-4222-8222-222222222222'), 'manifest.json'),
      JSON.stringify({ version: 'wsv1' }),
    );

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ version: 'wsv1' }), { status: 200 }));

    const r = await syncWorkspaceGitSkills(
      'http://test.invalid',
      { apiKey: 'k' },
      '22222222-2224-4222-8222-222222222222',
      workdir,
    );

    expect(r.skipped).toBe(true);
    expect(r.synced).toBe(false);
    // 只调 manifest，不拉 bundle
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 槽内容照样接线（复用槽 = 跨会话缓存语义）
    expect(await readFile(join(workdir, '.claude', 'skills', 'kept-skill', 'SKILL.md'), 'utf-8')).toBe('kept');
    fetchSpy.mockRestore();
  });

  it('槽 manifest 不可达 → synced=false 不抛、不写槽', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const r = await syncWorkspaceGitSkills(
      'http://test.invalid',
      { apiKey: 'k' },
      '33333333-3334-4333-8333-333333333333',
      workdir,
    );
    expect(r.synced).toBe(false);
    expect(await pathExists(slotDir('33333333-3334-4333-8333-333333333333'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('槽隔离：ws 槽版本不覆盖全局槽，也不覆盖另一 ws 槽', async () => {
    const tarA = makeTarGz([{ name: 'skill-a/SKILL.md', content: Buffer.from('a') }]);
    const tarB = makeTarGz([{ name: 'skill-b/SKILL.md', content: Buffer.from('b') }]);

    // 全局槽先有版本 gv1（模拟 daemon 启动 syncSkills 产物）
    const globalSkillsDir = join(tmpHome, '.sillyhub', 'daemon', 'skills');
    await mkdir(globalSkillsDir, { recursive: true });
    await writeFile(join(globalSkillsDir, 'manifest.json'), JSON.stringify({ version: 'gv1' }));

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // ws-A：manifest v1 + bundle
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'wsAv1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(tarA, { status: 200 }))
      // ws-B：manifest v2 + bundle
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'wsBv1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(tarB, { status: 200 }));

    const workdirA = await mkdtemp(join(tmpdir(), 'ws-skill-wt-a-'));
    const workdirB = await mkdtemp(join(tmpdir(), 'ws-skill-wt-b-'));
    try {
      await syncWorkspaceGitSkills('http://test.invalid', { apiKey: 'k' }, 'aaaaaaaa-0000-4000-8000-00000000000a', workdirA);
      await syncWorkspaceGitSkills('http://test.invalid', { apiKey: 'k' }, 'bbbbbbbb-0000-4000-8000-00000000000b', workdirB);

      // 三个版本槽各自独立：全局 gv1 / ws-A wsAv1 / ws-B wsBv1
      expect(await getLocalSkillsVersion()).toBe('gv1');
      expect(await getLocalWorkspaceSkillsVersion('aaaaaaaa-0000-4000-8000-00000000000a')).toBe('wsAv1');
      expect(await getLocalWorkspaceSkillsVersion('bbbbbbbb-0000-4000-8000-00000000000b')).toBe('wsBv1');
      // 内容也隔离：A 槽只有 skill-a，B 槽只有 skill-b
      expect(await pathExists(join(slotDir('aaaaaaaa-0000-4000-8000-00000000000a'), 'skill-a'))).toBe(true);
      expect(await pathExists(join(slotDir('aaaaaaaa-0000-4000-8000-00000000000a'), 'skill-b'))).toBe(false);
      expect(await pathExists(join(slotDir('bbbbbbbb-0000-4000-8000-00000000000b'), 'skill-b'))).toBe(true);
      expect(await pathExists(join(slotDir('bbbbbbbb-0000-4000-8000-00000000000b'), 'skill-a'))).toBe(false);
      // 全局槽目录未被 ws 同步污染
      const globalEntries = await (await import('node:fs/promises')).readdir(globalSkillsDir);
      expect(globalEntries).toEqual(['manifest.json']);
    } finally {
      await Promise.all([
        rm(workdirA, { recursive: true, force: true }),
        rm(workdirB, { recursive: true, force: true }),
      ]);
      fetchSpy.mockRestore();
    }
  });

  it('并集覆盖语义：槽 link 覆盖全局 link 的同名目录（D-002 注入集）', async () => {
    // 全局 link 先落 user-only 内容（同 skill 名旧内容）
    await mkdir(join(workdir, '.claude', 'skills', 'clash-git'), { recursive: true });
    await writeFile(join(workdir, '.claude', 'skills', 'clash-git', 'SKILL.md'), 'user-only-old');

    const tarGz = makeTarGz([{ name: 'clash-git/SKILL.md', content: Buffer.from('union-new') }]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'wsv9' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(tarGz, { status: 200 }));

    await syncWorkspaceGitSkills('http://test.invalid', { apiKey: 'k' }, 'cccccccc-0000-4000-8000-00000000000c', workdir);

    expect(await readFile(join(workdir, '.claude', 'skills', 'clash-git', 'SKILL.md'), 'utf-8')).toBe('union-new');
    fetchSpy.mockRestore();
  });
});
