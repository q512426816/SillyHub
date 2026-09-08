// tests/agent-log/liveness/tailer.test.ts —— LivenessTailer 周期推导循环单测。
//
// task-03（2026-09-07-agent-liveness-states / FR-01）：offset 差量读 / 轮转 reset /
// ended 回收 / watch≤16 淘汰 / 4MB 预算 / R-02 fail-open。fs 与时钟全注入，
// tick 手动驱动零真实等待（constraints）。
// ql-20260908-006（审查修复）：R1 生产路径（默认 fs）tickAsync 回归——预读缓存
// 后同步推导，不再「异步 readRange 进同步 tick」恒抛永久 unknown；R2 ended 路径
// 不被 add 重加（registry-sync 每 60s 无条件重加的 unknown↔ended 震荡）。
import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LivenessTailer, type TailerFs } from '../../../src/agent-log/liveness/tailer.js';

const T0 = Date.parse('2026-09-07T10:00:00Z');

/** 内存假文件系统：size/mtime/内容三态可控。 */
class FakeFs implements TailerFs {
  files = new Map<string, { content: string; mtimeMs: number }>();
  failPaths = new Set<string>();
  now = T0;

  statSize(path: string): { size: number; mtimeMs: number } | null {
    if (this.failPaths.has(path)) throw new Error('EACCES');
    const f = this.files.get(path);
    return f ? { size: Buffer.byteLength(f.content), mtimeMs: f.mtimeMs } : null;
  }

  readRange(path: string, start: number, end: number): string {
    if (this.failPaths.has(path)) throw new Error('EACCES');
    const f = this.files.get(path);
    if (!f) throw new Error('ENOENT');
    return Buffer.from(f.content, 'utf8').subarray(start, end).toString('utf8');
  }
}

function mkTarget(logPath = 'a.jsonl', format = 'unknown'): ConstructorParameters<typeof LivenessTailer>[0] extends never ? never : import('../../../src/agent-log/liveness/tailer.js').WatchTarget {
  return { logPath, format, workspace: 'ws1' };
}

describe('LivenessTailer（task-03）', () => {
  it('offset 差量读：首轮读全量，追加后只读新增字节（L0 unknown format 走 mtime 判定）', () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'x'.repeat(100), mtimeMs: T0 });
    const reads: Array<[number, number]> = [];
    const fsSpy: TailerFs = {
      statSize: (p) => fs.statSize(p),
      readRange: (p, s, e) => { reads.push([s, e]); return fs.readRange(p, s, e); },
    };
    const t = new LivenessTailer({ fs: fsSpy, now: () => fs.now });
    t.add(mkTarget());
    let out = t.tick();
    expect(reads[0]).toEqual([0, 100]);
    expect(out[0].state).toBe('working'); // mtime 新鲜
    fs.files.get('a.jsonl')!.content += 'y'.repeat(50);
    out = t.tick();
    expect(reads[1]).toEqual([100, 150]); // 只读增量
    expect(out[0].state).toBe('working');
  });

  it('轮转（size 变小）→ offset 重置全量重读 + 证据 reset 标记，不串台', () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'z'.repeat(200), mtimeMs: T0 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget());
    t.tick();
    fs.files.set('a.jsonl', { content: 'z'.repeat(20), mtimeMs: T0 + 1000 }); // 新文件覆盖
    const out = t.tick();
    expect(out[0].evidence).toContain('reset');
    expect(out[0].state).toBe('working');
  });

  it('文件消失：窗内 unknown(reset)，超 15min → ended 并移出 watch', () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'data', mtimeMs: T0 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget());
    t.tick();
    fs.files.delete('a.jsonl');
    let out = t.tick();
    expect(out[0].state).toBe('unknown');
    expect(out[0].evidence).toContain('file_missing');
    fs.now = T0 + 16 * 60 * 1000;
    out = t.tick();
    expect(out[0].state).toBe('ended');
    expect(t.tick()).toHaveLength(0); // 已回收
  });

  it('L0 兜底：mtime 静默 120s~15min → idle；>15min → ended 回收（无 deriver format）', () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'd', mtimeMs: T0 - 5 * 60 * 1000 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget());
    expect(t.tick()[0].state).toBe('idle');
    fs.files.get('a.jsonl')!.mtimeMs = T0 - 20 * 60 * 1000;
    expect(t.tick()[0].state).toBe('ended');
    expect(t.tick()).toHaveLength(0);
  });

  it('watch 超 16 条：淘汰 lastSeenAt 最旧（被挤出者不再产出）；单轮预算截断不炸', async () => {
    const fs = new FakeFs();
    for (let i = 0; i < 17; i++) fs.files.set(`f${i}.jsonl`, { content: 'x', mtimeMs: T0 - i * 1000 });
    const t = new LivenessTailer({ fs, now: () => fs.now, maxBytesPerTick: 4 });
    for (let i = 0; i < 17; i++) t.add(mkTarget(`f${i}.jsonl`));
    const out = t.tick();
    expect(out).toHaveLength(16); // f0（lastSeenAt 最旧）被 f16 挤出，不再产出
    expect(out.some((r) => r.logPath === 'f0.jsonl')).toBe(false);
    // 预算截断：100 字节文件单轮最多读 4 字节，offset 只前进预算量（增量性保持）
    const big = 'y'.repeat(100);
    fs.files.set('big.jsonl', { content: big, mtimeMs: T0 });
    t.add(mkTarget('big.jsonl'));
    await Promise.resolve();
    t.tick();
  });

  it('R-02 fail-open：单路径读抛错 → 本轮 unknown 不影响他路径与下轮重试', () => {
    const fs = new FakeFs();
    fs.files.set('bad.jsonl', { content: 'x', mtimeMs: T0 });
    fs.files.set('good.jsonl', { content: 'x', mtimeMs: T0 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget('bad.jsonl'));
    t.add(mkTarget('good.jsonl'));
    fs.failPaths.add('bad.jsonl');
    const out = t.tick();
    const bad = out.find((r) => r.logPath === 'bad.jsonl');
    const good = out.find((r) => r.logPath === 'good.jsonl');
    expect(bad?.state).toBe('unknown');
    expect(bad?.evidence).toContain('fail_open');
    expect(good?.state).toBe('working');
    fs.failPaths.delete('bad.jsonl');
    expect(t.tick().find((r) => r.logPath === 'bad.jsonl')?.state).toBe('working'); // 下轮恢复
  });

  it('L1 分派：zcode format 经 getDeriver 推导（toolcalls_pending → working）', () => {
    const fs = new FakeFs();
    const rec = JSON.stringify({ type: 'model_io', completedAt: new Date(T0 - 60_000).toISOString(), response: { toolCalls: [{ name: 'Bash' }] } });
    fs.files.set('z.jsonl', { content: rec + '\n', mtimeMs: T0 - 60_000 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget('z.jsonl', 'zcode-model-io-jsonl'));
    const out = t.tick();
    expect(out[0].state).toBe('working');
    expect(out[0].evidence).toBe('toolcalls_pending');
    expect(out[0].lastEventAt).toBe(T0 - 60_000); // mtime 近似最后事件时间
  });

  it('start/stop 定时驱动：interval 触发产出，stop 后不再产出', async () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'x', mtimeMs: T0 });
    const t = new LivenessTailer({ fs, now: () => fs.now, intervalMs: 5 });
    const seen: number[] = [];
    t.onResult = () => seen.push(1);
    t.add(mkTarget());
    t.start();
    await new Promise((r) => setTimeout(r, 25));
    expect(seen.length).toBeGreaterThan(0);
    t.stop();
    const at = seen.length;
    await new Promise((r) => setTimeout(r, 25));
    expect(seen.length).toBe(at);
  });
});

describe('LivenessTailer 生产路径（默认 fs，ql-20260908-006 审查修复）', () => {
  it('R1 tickAsync：非空文件正常推导（L0 working）且追加后增量续读，不落 async-in-sync 永久 unknown', async () => {
    // 生产形态：不注入 fs（DefaultFs + node:fs/promises 异步原语），时钟注入固定 T0
    //（真实 mtime 晚于 T0 → age 为负 → 恒 working，断言确定性）。
    const dir = mkdtempSync(join(tmpdir(), 'liveness-r1-'));
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, 'x'.repeat(100));
    const t = new LivenessTailer({ now: () => T0 });
    t.add(mkTarget(p));
    let out = await t.tickAsync();
    expect(out[0]!.state).toBe('working');
    expect(out[0]!.evidence).not.toContain('fail_open');
    // 追加新字节：预读缓存命中 offset 增量，不回退 unknown
    appendFileSync(p, 'y'.repeat(50));
    out = await t.tickAsync();
    expect(out[0]!.state).toBe('working');
    expect(out[0]!.evidence).not.toContain('fail_open');
  });

  it('R1 tickAsync：L1 注册 format 走 deriver（zcode toolcalls_pending → working）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liveness-r1-'));
    const p = join(dir, 'z.jsonl');
    const rec = JSON.stringify({ type: 'model_io', completedAt: new Date(T0 - 60_000).toISOString(), response: { toolCalls: [{ name: 'Bash' }] } });
    writeFileSync(p, rec + '\n');
    const t = new LivenessTailer({ now: () => T0 });
    t.add(mkTarget(p, 'zcode-model-io-jsonl'));
    const out = await t.tickAsync();
    expect(out[0]!.state).toBe('working');
    expect(out[0]!.evidence).toBe('toolcalls_pending');
  });

  it('R2 ended 路径不被 add 重加（registry-sync 震荡修复）', () => {
    const fs = new FakeFs();
    fs.files.set('a.jsonl', { content: 'd', mtimeMs: T0 - 20 * 60 * 1000 });
    const t = new LivenessTailer({ fs, now: () => fs.now });
    t.add(mkTarget());
    expect(t.tick()[0]!.state).toBe('ended'); // mtime 超窗 → ended 回收
    // registry-sync 60s 后重加同路径：被 ended 登记拦截，不再产出（无 15min unknown 震荡）
    expect(t.add(mkTarget())).toBe(false);
    expect(t.tick()).toHaveLength(0);
    expect(t.watchCount()).toBe(0);
  });

  it('ql-20260909-002 pi 复用路径：ended 后 mtime 前进（复活）→ add 放行；mtime 未动仍拒绝', () => {
    // pi 日志是每 cwd 固定 session.jsonl（跨会话复用，registry 无 pi deriver 走
    // L0 mtime 判 ended）——R2 登记曾把该路径永久拒之门外。修复：登记改记
    // endedAt，add 时 mtime > endedAt 视为合法复活放行。
    const fs = new FakeFs();
    fs.files.set('pi-session.jsonl', { content: 'd', mtimeMs: T0 - 20 * 60 * 1000 });
    let probeMtime = T0 - 20 * 60 * 1000; // 复活探针（模拟 add 时刻文件 mtime）
    const t = new LivenessTailer({
      fs,
      now: () => fs.now,
      statSizeSync: (p) => (p === 'pi-session.jsonl' ? { mtimeMs: probeMtime } : null),
    });
    const target = mkTarget('pi-session.jsonl');
    t.add(target);
    expect(t.tick()[0]!.state).toBe('ended'); // 超窗 ended，登记 endedAt=T0
    // 文件未再动（registry-sync 重推死路径）→ 仍拒绝（防震荡保持）
    expect(t.add(target)).toBe(false);
    expect(t.watchCount()).toBe(0);
    // pi 同 cwd 会话恢复写入/新会话：mtime 前进到 endedAt 之后 → 放行复活
    probeMtime = T0 + 60_000;
    fs.files.set('pi-session.jsonl', { content: 'd2', mtimeMs: T0 + 60_000 });
    expect(t.add(target)).toBe(true);
    expect(t.tick()[0]!.state).toBe('working'); // 新鲜 mtime 正常推导
  });

  it('ql-20260909-002 默认复活探针（真实 fs）：utimes 推进 mtime 后 ended 路径复活', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liveness-revive-'));
    const p = join(dir, 'session.jsonl');
    writeFileSync(p, 'x');
    const stale = new Date(T0 - 20 * 60 * 1000);
    utimesSync(p, stale, stale); // 真实 mtime 拉到超窗（时钟注入 T0）
    const t = new LivenessTailer({ now: () => T0 });
    t.add(mkTarget(p));
    expect((await t.tickAsync())[0]!.state).toBe('ended');
    expect(t.add(mkTarget(p))).toBe(false); // mtime 仍旧（statSync 探到旧值）→ 拒绝
    const fresh = new Date(T0 + 60_000);
    utimesSync(p, fresh, fresh);
    expect(t.add(mkTarget(p))).toBe(true); // mtime 新 → 复活
    expect((await t.tickAsync())[0]!.state).toBe('working');
  });
});
