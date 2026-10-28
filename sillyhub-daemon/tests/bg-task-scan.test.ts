// 2026-10-28-bg-scan-tailread-eviction：扫描环纯函数件单测。
//
// 背景：daemon.ts `_bgTaskFinalLoop`（cdcb97fdb）两缺陷——①readFile 全量读入
// 再 subarray 取 64KB 尾段（内存峰值与日志全大小成正比，本仓有 OOM 前科）；
// ②_bgTaskSnapshots 清理只删空内层 Map，而内层一旦有条目永不为空，实为空
// 操作（Map 只增不减）。本文件对抽取的两纯函数各锁三形态：
// - readFileTailBytes：大于窗口只取尾 / 小于窗口整读 / 缺失文件拒判（抛错，
//   由扫描环 catch→continue 兜底语义）；
// - evictUnseenSnapshotPaths：可见集外移除（含非空内层）/ 全不可见清空 /
//   可见集内全保留。

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  evictUnseenSnapshotPaths,
  readFileTailBytes,
} from '../src/bg-task-scan.js';

let dir: string;

async function freshDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'bg-task-scan-'));
  return dir;
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('readFileTailBytes', () => {
  it('文件大于窗口时只取末尾窗口字节', async () => {
    const d = await freshDir();
    const marker = 'TAIL-MARKER-42';
    const body = 'a'.repeat(200_000) + marker;
    const p = join(d, 'big.jsonl');
    await writeFile(p, body, 'utf8');
    const tail = await readFileTailBytes(p, 1024);
    expect(tail.length).toBe(1024);
    expect(tail.endsWith(marker)).toBe(true);
  });

  it('文件小于窗口时整读', async () => {
    const d = await freshDir();
    const body = '短文件内容-short';
    const p = join(d, 'small.jsonl');
    await writeFile(p, body, 'utf8');
    const tail = await readFileTailBytes(p, 64 * 1024);
    expect(tail).toBe(body);
  });

  it('文件缺失时抛错（调用方 catch→continue 兜底）', async () => {
    const d = await freshDir();
    const p = join(d, 'missing.jsonl');
    await expect(readFileTailBytes(p, 1024)).rejects.toThrow();
  });
});

describe('evictUnseenSnapshotPaths', () => {
  it('移除可见集外条目（含内层非空者）并返回计数', () => {
    const snapshots = new Map<string, Map<string, string>>([
      ['/logs/a.jsonl', new Map([['t1', 'completed']])],
      ['/logs/b.jsonl', new Map([['t2', 'failed']])],
      ['/logs/c.jsonl', new Map()],
    ]);
    const evicted = evictUnseenSnapshotPaths(
      snapshots,
      new Set(['/logs/a.jsonl']),
    );
    expect(evicted).toBe(2);
    expect([...snapshots.keys()]).toEqual(['/logs/a.jsonl']);
    expect(snapshots.get('/logs/a.jsonl')?.get('t1')).toBe('completed');
  });

  it('全部不可见时清空', () => {
    const snapshots = new Map<string, Map<string, string>>([
      ['/logs/a.jsonl', new Map([['t1', 'completed']])],
      ['/logs/b.jsonl', new Map([['t2', 'stopped']])],
    ]);
    const evicted = evictUnseenSnapshotPaths(snapshots, new Set());
    expect(evicted).toBe(2);
    expect(snapshots.size).toBe(0);
  });

  it('可见集内条目全保留', () => {
    const snapshots = new Map<string, Map<string, string>>([
      ['/logs/a.jsonl', new Map([['t1', 'completed']])],
      ['/logs/b.jsonl', new Map([['t2', 'failed']])],
    ]);
    const evicted = evictUnseenSnapshotPaths(
      snapshots,
      new Set(['/logs/a.jsonl', '/logs/b.jsonl']),
    );
    expect(evicted).toBe(0);
    expect(snapshots.size).toBe(2);
    expect(snapshots.get('/logs/b.jsonl')?.get('t2')).toBe('failed');
  });
});
