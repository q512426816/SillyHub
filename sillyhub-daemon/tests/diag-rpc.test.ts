/**
 * diag-rpc.test.ts — daemon 诊断 RPC 纯逻辑单元测试。
 *
 * 覆盖（design 接口定义 + D-001@v2 / D-002@v1）：
 * - readLogTail：尾部行正确性 / 行数超文件行数 / 空文件 / 文件不存在五字段兜底 /
 *   字节上限 262144B 截断 truncated / UTF-8 中文边界（无残缺字符）/ 参数 clamp 1..5000
 * - getMaskedConfig：掩码公式 len<16 全掩 / len≥16 前4***后4 / 空串与缺失原样 /
 *   字段清单仅 token+api_key / reveal 明文与 masked_fields
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMaskedConfig, readLogTail, SENSITIVE_CONFIG_FIELDS } from '../src/diag-rpc.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'diag-rpc-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('readLogTail', () => {
  it('返回尾部 N 行（100 行文件取 10 行）', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}`);
    const file = join(tmpDir, 'a.log');
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    const r = await readLogTail(file, 10);
    expect(r.exists).toBe(true);
    expect(r.path).toBe(file);
    expect(r.line_count).toBe(10);
    expect(r.truncated).toBe(false);
    expect(r.lines[0]).toBe('line-090');
    expect(r.lines[9]).toBe('line-099');
    expect(r.size).toBeGreaterThan(0);
    expect(r.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('请求行数超过文件行数时返回全部且不标记截断', async () => {
    const file = join(tmpDir, 'b.log');
    await writeFile(file, 'l1\nl2\nl3\n', 'utf8');
    const r = await readLogTail(file, 10);
    expect(r.lines).toEqual(['l1', 'l2', 'l3']);
    expect(r.line_count).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('空文件返回 exists=true 且零行', async () => {
    const file = join(tmpDir, 'empty.log');
    await writeFile(file, '', 'utf8');
    const r = await readLogTail(file, 100);
    expect(r.exists).toBe(true);
    expect(r.lines).toEqual([]);
    expect(r.line_count).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('文件不存在时五字段兜底（exists:false / size:0 / mtime:"" / lines:[] / truncated:false）', async () => {
    const r = await readLogTail(join(tmpDir, 'nope.log'), 100);
    expect(r).toEqual({
      path: join(tmpDir, 'nope.log'),
      size: 0,
      mtime: '',
      exists: false,
      lines: [],
      line_count: 0,
      truncated: false,
    });
  });

  it('超过字节上限 262144B 时截断并标记 truncated（行内容与文件尾部一致）', async () => {
    // 每行 1001 字节（1000 字符 + \n）× 300 行 = 300300B > 262144B。
    const row = 'x'.repeat(1000);
    const lines = Array.from({ length: 300 }, (_, i) => `${row}-${i}`);
    const file = join(tmpDir, 'big.log');
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    const r = await readLogTail(file, 5000);
    expect(r.truncated).toBe(true);
    expect(r.line_count).toBeGreaterThan(250);
    expect(r.line_count).toBeLessThan(300);
    expect(r.lines[r.lines.length - 1]).toBe(lines[299]);
    // 每个返回行都应是完整行（1000 字符本体 + "-N" 后缀，长度随行号位数 1002..1004）
    for (const l of r.lines) expect(l.startsWith(`${row}-`)).toBe(true);
  });

  it('字节上限触发且窗口起点切在多字节 UTF-8 序列中间时，返回行无残缺字符（无 �）', async () => {
    // 每行约 60 字节（中文）× 6000 行 ≈ 360KB，超过 256KB 上限；
    // 窗口起点大概率落在某中文字符的 UTF-8 多字节序列中间——丢弃不完整首行后应无乱码。
    const cn = '日志中文行内容补齐到大约六十字节左右用于跨越字节上限边界测试场景';
    const lines = Array.from({ length: 6000 }, (_, i) => `${cn}-${i}`);
    const file = join(tmpDir, 'cn.log');
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    const r = await readLogTail(file, 5000);
    expect(r.truncated).toBe(true);
    expect(r.line_count).toBeGreaterThan(0);
    for (const l of r.lines) {
      expect(l).not.toContain('\uFFFD');
      expect(l.startsWith(cn)).toBe(true);
    }
    expect(r.lines[r.lines.length - 1]).toBe(lines[5999]);
  });

  it('参数 clamp：0 / 负数 / NaN 取默认 500，超过 5000 收敛到 5000', async () => {
    const lines = Array.from({ length: 8000 }, (_, i) => `n${i}`);
    const file = join(tmpDir, 'clamp.log');
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    for (const bad of [0, -5, Number.NaN]) {
      const r = await readLogTail(file, bad);
      expect(r.line_count).toBe(500);
    }
    const r2 = await readLogTail(file, 50000);
    expect(r2.line_count).toBe(5000);
    expect(r2.lines[0]).toBe('n3000');
  });

  it('文件尾部无换行符时最后一行仍完整返回', async () => {
    const file = join(tmpDir, 'nonl.log');
    await writeFile(file, 'a\nb\nc', 'utf8'); // 尾行 c 无 \n
    const r = await readLogTail(file, 2);
    expect(r.lines).toEqual(['b', 'c']);
  });
});

describe('getMaskedConfig', () => {
  const base = {
    server_url: 'https://hub.example.com',
    token: 'sk-live-abcdefgh', // 16 位
    api_key: 'sh-0123456789abcdef012345', // 24 位
    short8: '12345678',
    short15: '123456789012345',
    empty: '',
    poll_interval: 30,
  };

  it('掩码公式：len<16 全掩为 ***，len≥16 前4+***+后4（D-001@v2）', () => {
    expect(getMaskedConfig({ token: '12345678' }, { reveal: false }).config.token).toBe('***');
    expect(getMaskedConfig({ token: '123456789' }, { reveal: false }).config.token).toBe('***');
    expect(getMaskedConfig({ token: '123456789012345' }, { reveal: false }).config.token).toBe(
      '***',
    );
    expect(getMaskedConfig({ token: 'sk-live-abcdefgh' }, { reveal: false }).config.token).toBe(
      'sk-l***efgh',
    );
    expect(
      getMaskedConfig({ api_key: 'sh-0123456789abcdef012345' }, { reveal: false }).config.api_key,
    ).toBe('sh-0***2345');
  });

  it('字段清单仅掩 token/api_key，其余字段原样（空串/数字/非清单字段不动）', () => {
    const r = getMaskedConfig(base, { reveal: false });
    expect(SENSITIVE_CONFIG_FIELDS).toEqual(['token', 'api_key']);
    expect(r.config.token).toBe('sk-l***efgh');
    expect(r.config.server_url).toBe(base.server_url);
    expect(r.config.empty).toBe('');
    expect(r.config.poll_interval).toBe(30);
    expect(r.config.short8).toBe('12345678'); // 非清单字段不掩
    expect(r.config.short15).toBe('123456789012345');
  });

  it('masked_fields 列出实际被掩码的字段；空串的清单字段不列入且值原样', () => {
    const r = getMaskedConfig({ ...base, api_key: '' }, { reveal: false });
    expect(r.masked_fields).toEqual(['token']);
    expect(r.config.api_key).toBe('');
  });

  it('reveal=true 返回明文且 masked_fields 为空', () => {
    const r = getMaskedConfig(base, { reveal: true });
    expect(r.config).toEqual(base);
    expect(r.masked_fields).toEqual([]);
  });
});
