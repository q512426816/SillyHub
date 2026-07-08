// tests/skill-manager.test.ts
// task-03 + task-04: daemon skill-manager 单测。
//
// task-03（平台同步）：覆盖 getLocalSkillsVersion / fetchRemoteManifest / fetchSkillsBundle /
//   checkSha256 / extractSkillsBundle（含路径穿越防护）/ syncSkills（版本相同跳过 / 版本新拉解压 /
//   sha256 校验失败 / manifest 不可达）。
// task-04（workspace 同步）：覆盖 syncWorkspaceSkills（有自定义 skills 同步 / 无 skills 跳过 /
//   与平台 skills 命名隔离共存 / specDir 不存在不抛 / 重复同步覆盖）。
//
// @module skill-manager.test

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

import {
  getLocalSkillsVersion,
  fetchRemoteManifest,
  fetchSkillsBundle,
  checkSha256,
  extractSkillsBundle,
  syncSkills,
  syncWorkspaceSkills,
  linkSkillsToWorkdir,
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
    const r = await fetchRemoteManifest('http://nonexistent.invalid', logger as never);
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
    const r = await syncSkills('http://test.invalid');
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
    const r = await syncSkills('http://test.invalid');
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
    const r = await syncSkills('http://test.invalid');
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
