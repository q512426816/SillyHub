// tests/cursor-version.test.ts
// ql-20260620-002-f8c1：cursor-agent 版本目录解析器测试。
// fixture：真实临时目录构造 versions/<ver>/{node.exe,index.js}，纯 fs 逻辑跨平台（CI Linux 可跑）。

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCursorVersionEntry } from '../src/cursor-version';

const tmpRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cursor-version-test-'));
  tmpRoots.push(root);
  return root;
}

/** 在 root/versions/<ver>/ 下创建 node.exe + index.js 占位文件，返回版本目录。 */
function makeVersion(root: string, ver: string): string {
  const vDir = join(root, 'versions', ver);
  mkdirSync(vDir, { recursive: true });
  writeFileSync(join(vDir, 'node.exe'), '');
  writeFileSync(join(vDir, 'index.js'), '');
  return vDir;
}

afterEach(() => {
  while (tmpRoots.length) {
    const d = tmpRoots.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe('resolveCursorVersionEntry', () => {
  it('仅新格式目录 → 返回该版本入口 + 目录名作版本', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.16-20-30-07-a07d3ac');
    const entry = resolveCursorVersionEntry(root);
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('2026.06.16-20-30-07-a07d3ac');
    expect(entry!.nodeExe).toBe(join(root, 'versions', '2026.06.16-20-30-07-a07d3ac', 'node.exe'));
    expect(entry!.indexJs).toBe(join(root, 'versions', '2026.06.16-20-30-07-a07d3ac', 'index.js'));
    expect(existsSync(entry!.nodeExe)).toBe(true);
    expect(existsSync(entry!.indexJs)).toBe(true);
  });

  it('仅旧格式目录（YYYY.MM.DD-commit）→ 也能识别', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.10-6f5a2cf');
    const entry = resolveCursorVersionEntry(root);
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('2026.06.10-6f5a2cf');
  });

  it('新旧混合 → 取日期最新（06.16 新格式 > 06.15）', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.15-18-00-12-6f5a2cf');
    makeVersion(root, '2026.06.16-20-30-07-a07d3ac');
    const entry = resolveCursorVersionEntry(root);
    expect(entry!.version).toBe('2026.06.16-20-30-07-a07d3ac');
  });

  it('同日多个版本 → 取时分秒字典序最大（最新时间）', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.16-09-00-00-aaaaaaa');
    makeVersion(root, '2026.06.16-15-00-00-bbbbbbb');
    makeVersion(root, '2026.06.16-20-30-07-a07d3ac');
    const entry = resolveCursorVersionEntry(root);
    expect(entry!.version).toBe('2026.06.16-20-30-07-a07d3ac');
  });

  it('传入 .cmd 路径 → 自动取其所在目录的 versions/', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.16-20-30-07-a07d3ac');
    const cmdPath = join(root, 'cursor-agent.cmd');
    writeFileSync(cmdPath, '@echo off\n');
    const entry = resolveCursorVersionEntry(cmdPath);
    expect(entry).not.toBeNull();
    expect(entry!.version).toBe('2026.06.16-20-30-07-a07d3ac');
  });

  it('空 versions 目录 → null', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'versions'), { recursive: true });
    expect(resolveCursorVersionEntry(root)).toBeNull();
  });

  it('无 versions 目录 → null', () => {
    const root = makeRoot();
    expect(resolveCursorVersionEntry(root)).toBeNull();
  });

  it('版本目录缺 node.exe → null', () => {
    const root = makeRoot();
    const vDir = join(root, 'versions', '2026.06.16-20-30-07-a07d3ac');
    mkdirSync(vDir, { recursive: true });
    writeFileSync(join(vDir, 'index.js'), '');
    // 无 node.exe
    expect(resolveCursorVersionEntry(root)).toBeNull();
  });

  it('版本目录缺 index.js → null', () => {
    const root = makeRoot();
    const vDir = join(root, 'versions', '2026.06.16-20-30-07-a07d3ac');
    mkdirSync(vDir, { recursive: true });
    writeFileSync(join(vDir, 'node.exe'), '');
    expect(resolveCursorVersionEntry(root)).toBeNull();
  });

  it('versions 下混入非版本目录（不匹配 YYYY.MM.DD）→ 忽略', () => {
    const root = makeRoot();
    makeVersion(root, '2026.06.16-20-30-07-a07d3ac');
    mkdirSync(join(root, 'versions', 'not-a-version'), { recursive: true });
    mkdirSync(join(root, 'versions', '.cache'), { recursive: true });
    const entry = resolveCursorVersionEntry(root);
    expect(entry!.version).toBe('2026.06.16-20-30-07-a07d3ac');
  });

  it('路径不存在 → null（不抛错）', () => {
    expect(resolveCursorVersionEntry('Z:\\nonexistent\\cursor-agent.cmd')).toBeNull();
  });
});
