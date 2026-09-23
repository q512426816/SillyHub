// tests/turn-control-attachment-atomic.test.ts
// ql-20260922-001（24h 审查五修②）：writeAttachmentFile 落盘原子化 + 复用前
// size 完整性校验。
//
// 背景：旧实现 ``writeFile({flag:'wx'})`` 直接写最终路径——进程崩溃/断电会在
// 内容寻址路径 ``attachments/{sha256}.{ext}`` 上留下半截文件；同内容附件再发送
// 时 sha256 相同 → EEXIST 被当「同内容已落盘」直接复用，半截损坏被永久固化且
// 无告警（cursor 附件 disk-only 无 block 通道兜底，本函数是其唯一投递通道）。
// 修复后：目标存在且 size 相符 → 复用；缺失/不符（半截）→ tmp+rename 原子落位。
//
// 用例矩阵：
//   - 首次写：内容完整、返回内容寻址相对路径、无 tmp 残留
//   - 同内容再写：size 相符 → 复用既有文件（mtime 不变）
//   - 核心回归：同 sha256 路径上的半截文件 → 重写自愈为完整内容（旧实现
//     EEXIST 永久复用半截）
//   - 并发同内容双写：均成功且最终内容完整、无 tmp 残留

import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeAttachmentFile } from '../src/interactive/session-manager/turn-control.js';

/** 与实现同式的内容寻址相对路径（attachments/{sha256}.{ext}）。 */
const relOf = (buf: Buffer, ext: string): string =>
  `attachments/${createHash('sha256').update(buf).digest('hex')}.${ext}`;

async function freshCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'turn-control-att-'));
}

describe('ql-20260922-001 writeAttachmentFile 落盘原子化 + size 校验自愈', () => {
  it('首次写：内容完整、返回内容寻址相对路径、无 tmp 残留', async () => {
    const cwd = await freshCwd();
    const buf = Buffer.from('# hello attachment\n'.repeat(10));

    const rel = await writeAttachmentFile(null as never, cwd, 'note.md', buf);

    expect(rel).toBe(relOf(buf, 'md'));
    expect(await readFile(join(cwd, rel))).toEqual(buf);
    const files = await readdir(join(cwd, 'attachments'));
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('同内容再写：size 相符 → 复用既有文件（mtime 不变）', async () => {
    const cwd = await freshCwd();
    const buf = Buffer.from('same content');
    await writeAttachmentFile(null as never, cwd, 'a.txt', buf);
    const dest = join(cwd, relOf(buf, 'txt'));
    // 拨回 10s 前防同秒精度，复用路径不触碰 mtime
    const past = new Date(Date.now() - 10_000);
    await utimes(dest, past, past);

    await writeAttachmentFile(null as never, cwd, 'b-different-name.txt', buf);

    expect((await stat(dest)).mtimeMs).toBe(past.getTime());
  });

  it('核心回归：同 sha256 路径上的半截文件 → 重写自愈为完整内容', async () => {
    const cwd = await freshCwd();
    const buf = Buffer.alloc(1024, 0xab);
    const rel = relOf(buf, 'md');
    // 预置「崩溃残留」：同路径但只有前 16 字节（截断只会更小）
    await mkdir(join(cwd, 'attachments'), { recursive: true });
    await writeFile(join(cwd, rel), buf.subarray(0, 16));

    const got = await writeAttachmentFile(null as never, cwd, 'truncated.md', buf);

    expect(got).toBe(rel);
    expect(await readFile(join(cwd, rel))).toEqual(buf);
  });

  it('并发同内容双写：均成功、最终内容完整、无 tmp 残留', async () => {
    const cwd = await freshCwd();
    const buf = Buffer.from('concurrent payload'.repeat(64));

    const rels = await Promise.all([
      writeAttachmentFile(null as never, cwd, 'a.md', buf),
      writeAttachmentFile(null as never, cwd, 'b.md', buf),
    ]);

    expect(rels[0]).toBe(rels[1]);
    expect(await readFile(join(cwd, rels[0]!))).toEqual(buf);
    const files = await readdir(join(cwd, 'attachments'));
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
