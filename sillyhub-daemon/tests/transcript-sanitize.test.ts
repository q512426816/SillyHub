/**
 * interactive/transcript-sanitize 单测（2026-10-16-provider-switch-transcript-sanitize
 * / FR-01 / FR-04）。
 *
 * 覆盖：
 *   - 同一条 assistant 消息内成对（实证形态：server_tool_use + 同 id tool_result）→ 两块都被
 *     替换为等价 text 块，正文保留；记录条数与 uuid/parentUuid 链不变；
 *   - 跨记录成对（调用在 A 记录、结果在 B 记录）→ 同口径命中（顺序无关）；
 *   - mcp_tool_use / `*_tool_result` 家族（带 tool_use_id 指向私有 id）→ 命中；
 *   - 正常客户端工具对（tool_use ↔ tool_result）零触碰；
 *   - 无脏块 → changed=false、零写盘零备份；幂等（清洗后再跑 changed=false）；
 *   - 备份文件存在且内容=清洗前原文；
 *   - 文件不存在 / 非 JSON 行 / content 非数组 → 不抛、原样透传。
 *
 * @module transcript-sanitize.test
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROVIDER_PRIVATE_TOOL_BLOCK_TYPES,
  SANITIZE_TEXT_PREFIX,
  planTranscriptSanitize,
  sanitizeClaudeTranscriptForReplay,
} from '../src/interactive/transcript-sanitize.js';

const { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync } = fs;

let root: string;
const createdRoots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sillyhub-sanitize-'));
  createdRoots.push(root);
});

afterAll(() => {
  // 临时目录逐个清理（断言失败也照清，避免本机 temp 残留）。
  for (const dir of createdRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort：Windows 上偶发被占用，忽略。
    }
  }
});

/** 记录构造：只带本模块关心的字段 + 链路字段（uuid/parentUuid 用于链路完整性断言）。 */
function record(opts: {
  uuid: string;
  parentUuid: string | null;
  role: 'assistant' | 'user';
  content: unknown;
}): Record<string, unknown> {
  return {
    parentUuid: opts.parentUuid,
    isSidechain: false,
    type: opts.role,
    uuid: opts.uuid,
    timestamp: '2026-10-16T08:00:00.000Z',
    message: { id: `msg_${opts.uuid}`, role: opts.role, content: opts.content },
  };
}

function writeJsonl(filePath: string, records: unknown[]): void {
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 实证形态：同一条 assistant 消息里 server_tool_use + 同 id tool_result。 */
function userWithServerToolPair(): Array<Record<string, unknown>> {
  return [
    record({
      uuid: 'u1',
      parentUuid: null,
      role: 'user',
      content: '你直接看图吧',
    }),
    record({
      uuid: 'a1',
      parentUuid: 'u1',
      role: 'assistant',
      content: [
        { type: 'text', text: '先分析截图。' },
        { type: 'server_tool_use', id: 'call_0a26', name: 'analyze_image', input: {} },
        { type: 'tool_result', tool_use_id: 'call_0a26', content: '# 截图分析正文\n竖条可见' },
      ],
    }),
    record({
      uuid: 'u2',
      parentUuid: 'a1',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_normal', content: 'ok' }],
    }),
  ];
}

describe('planTranscriptSanitize — 纯函数（FR-01）', () => {
  it('成对私有块（同消息）：两块替换为 text，正文保留，记录条数与链路字段不变', () => {
    const records = userWithServerToolPair();
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const planned = planTranscriptSanitize(jsonl);

    expect(planned.replacedBlocks).toBe(2);
    const after = planned.text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    // 记录条数不变（不删记录 → uuid/parentUuid 链不断）。
    expect(after).toHaveLength(records.length);
    expect(after.map((r) => r.uuid)).toEqual(['u1', 'a1', 'u2']);
    expect(after.map((r) => r.parentUuid)).toEqual([null, 'u1', 'a1']);

    const blocks = (after[1]!.message as { content: Array<Record<string, unknown>> }).content;
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.type).toBe('text');
    // 调用块 → 说明性 text（含工具名）
    expect(blocks[1]!.type).toBe('text');
    expect(String(blocks[1]!.text)).toContain(SANITIZE_TEXT_PREFIX);
    expect(String(blocks[1]!.text)).toContain('server_tool_use');
    expect(String(blocks[1]!.text)).toContain('analyze_image');
    // 结果块 → 正文全量保留
    expect(blocks[2]!.type).toBe('text');
    expect(String(blocks[2]!.text)).toContain('截图分析正文');
    expect(String(blocks[2]!.text)).toContain('竖条可见');
    // 私有 id 不再出现在清洗结果里（新供应商不会看到孤儿 tool_use_id）。
    expect(planned.text).not.toContain('call_0a26');
  });

  it('跨记录成对（调用在 A 记录、结果在 B 记录）：与顺序无关，同口径命中', () => {
    const records = [
      record({
        uuid: 'a1',
        parentUuid: null,
        role: 'assistant',
        content: [{ type: 'server_tool_use', id: 'call_x', name: 'analyze_image', input: {} }],
      }),
      record({
        uuid: 'a2',
        parentUuid: 'a1',
        role: 'assistant',
        content: [{ type: 'tool_result', tool_use_id: 'call_x', content: '分析正文' }],
      }),
    ];
    const planned = planTranscriptSanitize(records.map((r) => JSON.stringify(r)).join('\n'));
    expect(planned.replacedBlocks).toBe(2);
    expect(planned.text).toContain('分析正文');
    expect(planned.text).not.toContain('call_x');
  });

  it('mcp_tool_use 与 *_tool_result 家族（带私有 tool_use_id）：命中', () => {
    const records = [
      record({
        uuid: 'a1',
        parentUuid: null,
        role: 'assistant',
        content: [
          { type: 'mcp_tool_use', id: 'toolu_srv', name: 'server_mcp', input: { q: 'x' } },
          { type: 'web_search_tool_result', tool_use_id: 'toolu_srv', content: '搜索结果' },
        ],
      }),
    ];
    const planned = planTranscriptSanitize(records.map((r) => JSON.stringify(r)).join('\n'));
    expect(planned.replacedBlocks).toBe(2);
    expect(planned.text).toContain('搜索结果');
    expect(planned.text).toContain('server_mcp');
    expect(planned.text).not.toContain('toolu_srv');
  });

  it('正常客户端工具对（tool_use ↔ tool_result）零触碰', () => {
    const records = [
      record({
        uuid: 'a1',
        parentUuid: null,
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_ok', name: 'Read', input: { file_path: 'x.md' } },
          { type: 'thinking', thinking: '看一下' },
        ],
      }),
      record({
        uuid: 'u1',
        parentUuid: 'a1',
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_ok', content: 'file body' }],
      }),
    ];
    const original = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const planned = planTranscriptSanitize(original);
    expect(planned.replacedBlocks).toBe(0);
    expect(planned.text).toBe(original);
  });

  it('非 JSON 行 / content 非数组：原样透传不抛', () => {
    const raw = '{"uuid":"x"}\nnot-json-line\n{"uuid":"y","message":{"content":"plain string"}}\n';
    const planned = planTranscriptSanitize(raw);
    expect(planned.replacedBlocks).toBe(0);
    expect(planned.text).toBe(raw);
  });

  it('私有块集合含 server_tool_use 与 mcp_tool_use（判据单一源）', () => {
    expect([...PROVIDER_PRIVATE_TOOL_BLOCK_TYPES].sort()).toEqual(['mcp_tool_use', 'server_tool_use']);
  });
});

describe('sanitizeClaudeTranscriptForReplay — 文件级（FR-01 / FR-04）', () => {
  it('脏文件：备份存在且等于原文、文件被原子改写、命中计数正确', async () => {
    const file = join(root, 'session.jsonl');
    writeJsonl(file, userWithServerToolPair());
    const before = readFileSync(file, 'utf-8');

    const result = await sanitizeClaudeTranscriptForReplay(file);
    expect(result.changed).toBe(true);
    expect(result.replacedBlocks).toBe(2);
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readFileSync(result.backupPath!, 'utf-8')).toBe(before);

    const after = readJsonl(file);
    expect(after).toHaveLength(3);
    expect(readFileSync(file, 'utf-8')).not.toContain('call_0a26');
  });

  it('幂等：清洗后再跑 changed=false 且不产生第二个备份', async () => {
    const file = join(root, 'session.jsonl');
    writeJsonl(file, userWithServerToolPair());
    await sanitizeClaudeTranscriptForReplay(file);
    const backupsAfterFirst = readdirSync(root).filter((f) => f.includes('.bak-sillyhub-'));

    const second = await sanitizeClaudeTranscriptForReplay(file);
    expect(second.changed).toBe(false);
    expect(second.replacedBlocks).toBe(0);
    expect(readdirSync(root).filter((f) => f.includes('.bak-sillyhub-'))).toHaveLength(
      backupsAfterFirst.length,
    );
  });

  it('干净文件：零写盘零备份（mtime 语义由 changed=false 承载）', async () => {
    const file = join(root, 'clean.jsonl');
    writeJsonl(file, [
      record({ uuid: 'a1', parentUuid: null, role: 'assistant', content: [{ type: 'text', text: 'hi' }] }),
    ]);
    const result = await sanitizeClaudeTranscriptForReplay(file);
    expect(result).toEqual({ filePath: file, changed: false, replacedBlocks: 0, backupPath: null });
    expect(readdirSync(root).filter((f) => f.includes('.bak-sillyhub-'))).toHaveLength(0);
  });

  it('文件不存在：changed=false 不抛（resume 是否可行交 CLI 报错）', async () => {
    const result = await sanitizeClaudeTranscriptForReplay(join(root, 'nope.jsonl'));
    expect(result.changed).toBe(false);
    expect(result.backupPath).toBeNull();
  });

  it('备份文件名不含冒号（Windows 文件名合法性）', async () => {
    const file = join(root, 'session.jsonl');
    writeJsonl(file, userWithServerToolPair());
    const result = await sanitizeClaudeTranscriptForReplay(file);
    const backupName = result.backupPath!.split(/[\\/]/).pop()!;
    expect(backupName).toContain('session.jsonl.bak-sillyhub-');
    expect(backupName).not.toContain(':');
  });

  it('评审 P2-2：读写之间被并发追加 → 放弃清洗（不吞追加、不备份、文件原样）', async () => {
    const file = join(root, 'session.jsonl');
    writeJsonl(file, userWithServerToolPair());
    const baseline = readFileSync(file, 'utf-8');

    // Act：在「读盘 → 计划」与「写盘」之间插入一次外部追加（模拟仍存活的旧 CLI 写盘）。
    const result = await sanitizeClaudeTranscriptForReplay(file, {
      beforeWrite: () => {
        writeFileSync(
          file,
          baseline + JSON.stringify(record({ uuid: 'a9', parentUuid: 'u2', role: 'assistant', content: [{ type: 'text', text: '并发追加轮' }] })) + '\n',
          'utf-8',
        );
      },
    });

    // Assert：放弃清洗（降级），并发追加与脏块都原样保留；零备份。
    expect(result).toEqual({ filePath: file, changed: false, replacedBlocks: 0, backupPath: null });
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(baseline + JSON.stringify(record({ uuid: 'a9', parentUuid: 'u2', role: 'assistant', content: [{ type: 'text', text: '并发追加轮' }] })) + '\n');
    expect(after).toContain('call_0a26');
    expect(readdirSync(root).filter((f) => f.includes('.bak-sillyhub-'))).toHaveLength(0);
  });

  it('评审 P3-2：结果块含非文本内容/无文本 → 如实标注（不谎称全量文本化）', () => {
    const records = [
      record({
        uuid: 'a1',
        parentUuid: null,
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'call_img', name: 'analyze_image', input: {} },
          {
            type: 'tool_result',
            tool_use_id: 'call_img',
            content: [
              { type: 'text', text: '文本部分' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            ],
          },
          { type: 'server_tool_use', id: 'call_empty', name: 'analyze_image', input: {} },
          { type: 'tool_result', tool_use_id: 'call_empty', content: [] },
        ],
      }),
    ];
    const planned = planTranscriptSanitize(records.map((r) => JSON.stringify(r)).join('\n'));
    expect(planned.replacedBlocks).toBe(4);
    expect(planned.droppedRecords).toBe(0); // 只替换块、绝不删记录（自证字段）
    expect(planned.text).toContain('文本部分');
    expect(planned.text).toContain('另含 1 个非文本内容块');
    expect(planned.text).toContain('该结果无文本内容');
  });
});
