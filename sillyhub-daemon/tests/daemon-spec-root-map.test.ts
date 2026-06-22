// tests/daemon-spec-root-map.test.ts
// 2026-06-22-agent-run-pipeline-fix task-02：SPEC_ROOT_MAP prompt 翻译器纯函数。
// design §4.1 A1 第 2 层：daemon 在 prompt 透传给 SessionManager.create 前，
// 按 spec_root_map（"from:to"）把容器内路径（如 /data/spec-workspaces/xxx）
// 翻译成宿主机路径（如 C:/data/spec-workspaces/xxx），避免 Windows Git Bash
// 把 /data/... 转成 C:\Program Files\Git\data\... 导致 EPERM。
//
// 关键修正（task-02 边界 3 / AC-07）：旧实现 daemon.ts:1701 `split(':', 2)` 在
// Windows 盘符场景会把 to 截断成 'C'（因 split(':',2) 只取前两段，'C:/data/...'
// 中首个 ':' 是 from:to 分隔符，split 后 ['from', 'C']）。改用 indexOf(':') +
// slice 按首个 ':' 分割，to 含盘符冒号。

import { describe, it, expect } from 'vitest';
import { translateSpecRoot } from '../src/daemon.js';

describe('translateSpecRoot（task-02，FR-01 / D-001@v1 A1）', () => {
  // ── AC-02 / AC-03 / AC-07：核心翻译 + Windows 盘符 ──

  it('AC-07 Windows 盘符场景：from=/data/spec-workspaces, to=C:/data/spec-workspaces（to 不被截成 "C"）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc-123/docs/';
    const out = translateSpecRoot(prompt, '/data/spec-workspaces:C:/data/spec-workspaces');
    expect(out).toBe('请扫描 C:/data/spec-workspaces/abc-123/docs/');
    // 原始 from 字面（前导空格 + /data/spec-workspaces）不再出现（AC-03 无残留）。
    // 注：to 值 "C:/data/spec-workspaces" 本身含 "/data/"，故不能断言 not.toContain('/data/')。
    expect(out).not.toContain(' /data/spec-workspaces');
    expect(out).toContain('C:/data/spec-workspaces/abc-123/docs/');
  });

  it('AC-02/AC-03 prompt 含 from 字面，replaceAll 全量替换（多次出现）', () => {
    const prompt = '扫描 /data/spec-workspaces/a，再扫描 /data/spec-workspaces/b';
    const out = translateSpecRoot(prompt, '/data/spec-workspaces:C:/data/spec-workspaces');
    expect(out).toBe('扫描 C:/data/spec-workspaces/a，再扫描 C:/data/spec-workspaces/b');
    // 原始 from（前导空格 + /data/spec-workspaces）无残留。
    expect(out).not.toContain(' /data/spec-workspaces');
  });

  it('to 含多个冒号也只按首个 ":" 分割（容忍 to 理论上含 ":"）', () => {
    // 极端用例：to 本身含冒号（如某些自定义映射），首个 ':' 后全部归 to
    const out = translateSpecRoot('x:from', 'from:to:with:colons');
    expect(out).toBe('x:to:with:colons');
  });

  // ── 边界：specRootMap 空串 / 无冒号 / 仅冒号 ──

  it('AC-04 specRootMap 空串 → 原样返回（向后兼容旧 daemon）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc';
    expect(translateSpecRoot(prompt, '')).toBe(prompt);
  });

  it('AC-06 specRootMap 无冒号（如 "abc"）→ 原样返回（无法分割 from/to）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc';
    expect(translateSpecRoot(prompt, 'abc')).toBe(prompt);
  });

  it('AC-05 specRootMap 仅冒号 ":" → 原样返回（from/to 空，短路跳过）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc';
    expect(translateSpecRoot(prompt, ':')).toBe(prompt);
  });

  it('specRootMap 仅 from 无 to（"from:"）→ 原样返回（to 空，短路）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc';
    expect(translateSpecRoot(prompt, '/data/spec-workspaces:')).toBe(prompt);
  });

  it('specRootMap 仅 to 无 from（":to"）→ 原样返回（from 空，短路）', () => {
    const prompt = '请扫描 /data/spec-workspaces/abc';
    expect(translateSpecRoot(prompt, ':C:/data/spec-workspaces')).toBe(prompt);
  });

  // ── 边界：prompt 不含 from ──

  it('AC-02 反向 prompt 不含 from → 原样返回（不记 info 日志）', () => {
    const prompt = '请扫描 /other/path/abc';
    expect(translateSpecRoot(prompt, '/data/spec-workspaces:C:/data/spec-workspaces')).toBe(prompt);
  });

  // ── 边界：路径含空格 ──

  it('路径含空格（Windows Program Files）→ replaceAll 字面替换不受影响', () => {
    const prompt = '扫描 /data/spec-workspaces/abc/Program Files/x';
    const out = translateSpecRoot(prompt, '/data/spec-workspaces:C:/Program Files/data');
    expect(out).toBe('扫描 C:/Program Files/data/abc/Program Files/x');
  });
});
