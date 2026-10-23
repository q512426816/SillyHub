// tests/interactive/pi-edit-patch-synth.test.ts
// 2026-10-24-pi-edit-patch-synth：pi 编辑补丁合成纯函数单测 + pi-events 接线用例。
//
// 覆盖矩阵（FR-01/02/03）：
//   - edit 单块合成（行号由改后文件实盘定位，newStart 精确）
//   - edit 多块合成（顺序定位不误配首现 + oldStart 净行偏移累积）
//   - write 全新增 hunk（oldStart=1/newStart=1，覆盖写旧行不可知的如实口径）
//   - 放弃矩阵：形态不符 / 读盘失败 / newText 定位不到 / 64KB 超限 / is_error 不附着
//   - pi-events 接线：edit/write 成功挂 edit_patch、bash 不挂、turn_end 清登记
//
// @module pi-edit-patch-synth.test

import { describe, expect, it } from 'vitest';

import {
  synthesizePiEditPatch,
  synthesizePiWritePatch,
} from '../../src/interactive/pi-edit-patch-synth.js';

/** 固定文件内容的同步读注入。 */
const fileOf = (text: string) => (_path: string): string | null => text;
const failRead = (_path: string): string | null => null;

describe('pi-edit-patch-synth: synthesizePiEditPatch（FR-01）', () => {
  it('单块替换：-旧行/+新行，newStart 实盘定位精确', () => {
    // 改后文件：newText "a\nc" 出现在第 3 行起（前缀两行）。
    const file = 'l1\nl2\na\nc\nl5\n';
    const json = synthesizePiEditPatch(
      { path: 'f.ts', edits: [{ oldText: 'a\nb', newText: 'a\nc' }] },
      fileOf(file),
    );
    expect(json).toBe(JSON.stringify([
      { oldStart: 3, newStart: 3, lines: ['-a', '-b', '+a', '+c'] },
    ]));
  });

  it('多块替换：顺序定位（同内容后块不吃首现）+ oldStart 净行偏移累积', () => {
    // 原文件 'x\nkeep\nx\n'；块1 'x\nkeep'→'x'（净 -1 行）、块2 第二个 'x'→'x\ny'。
    // end 时读到的改后文件 = 'x\nx\ny\n'（两块都已执行）。
    const file = 'x\nx\ny\n';
    const json = synthesizePiEditPatch(
      {
        path: 'f.ts',
        edits: [
          { oldText: 'x\nkeep', newText: 'x' },
          { oldText: 'x', newText: 'x\ny' },
        ],
      },
      fileOf(file),
    );
    const hunks = JSON.parse(json as string) as { oldStart: number; newStart: number; lines: string[] }[];
    expect(hunks).toHaveLength(2);
    // 块1：newText "x" 首现在行1（顺序游标从 0 起）。
    expect(hunks[0]).toEqual({ oldStart: 1, newStart: 1, lines: ['-x', '-keep', '+x'] });
    // 块2：改后文件里块2 的 "x\ny" 起于行2（块1 净删 1 行已把它提升）；偏移 -1 →
    // oldStart = 2+1 = 3（旧文件中该 x 原在行3）。
    expect(hunks[1]).toEqual({ oldStart: 3, newStart: 2, lines: ['-x', '+x', '+y'] });
  });

  it('newText 定位不到（并发改动）→ null 整体放弃（FR-03）', () => {
    expect(
      synthesizePiEditPatch(
        { path: 'f.ts', edits: [{ oldText: 'a', newText: 'zzz-not-in-file' }] },
        fileOf('a\nb\n'),
      ),
    ).toBeNull();
  });

  it('读盘失败 → null；形态不符（edits 非数组/块缺字符串）→ null（FR-03）', () => {
    const args = { path: 'f.ts', edits: [{ oldText: 'a', newText: 'b' }] };
    expect(synthesizePiEditPatch(args, failRead)).toBeNull();
    expect(synthesizePiEditPatch({ path: 'f.ts', edits: [] }, fileOf('a'))).toBeNull();
    expect(synthesizePiEditPatch({ path: 'f.ts', edits: 'x' }, fileOf('a'))).toBeNull();
    expect(
      synthesizePiEditPatch({ path: 'f.ts', edits: [{ oldText: 1, newText: 'b' }] }, fileOf('a')),
    ).toBeNull();
    expect(synthesizePiEditPatch({ edits: [{ oldText: 'a', newText: 'b' }] }, fileOf('a'))).toBeNull();
  });

  it('合成超 64KB → null（不截半补丁，FR-03）', () => {
    const big = 'x'.repeat(70 * 1024);
    expect(
      synthesizePiEditPatch(
        { path: 'f.ts', edits: [{ oldText: 'a', newText: big }] },
        fileOf(big),
      ),
    ).toBeNull();
  });
});

describe('pi-edit-patch-synth: synthesizePiWritePatch（FR-02）', () => {
  it('全 add 行 hunk：oldStart=1/newStart=1，content 逐行 + 前缀（含末行空串）', () => {
    const json = synthesizePiWritePatch({ path: 'f.ts', content: 'x\ny\n' });
    expect(json).toBe(JSON.stringify([
      { oldStart: 1, newStart: 1, lines: ['+x', '+y', '+'] },
    ]));
  });

  it('content 空/非字符串/args 形态不符 → null（FR-03）', () => {
    expect(synthesizePiWritePatch({ path: 'f.ts', content: '' })).toBeNull();
    expect(synthesizePiWritePatch({ path: 'f.ts', content: 1 })).toBeNull();
    expect(synthesizePiWritePatch(null)).toBeNull();
    expect(synthesizePiWritePatch({})).toBeNull();
  });
});

describe('pi-edit-patch-synth: pi-events 接线（FR-01/02/03 集成面）', () => {
  it('edit 成功 → tool_result 挂合成 edit_patch；bash 结果不挂（既有断言语义保持）', async () => {
    const { PiEventNormalizer } = await import('../../src/interactive/pi-events.js');
    const norm = new PiEventNormalizer();
    // 覆写同步读盘（测试不触真实文件系统）。
    (PiEventNormalizer as unknown as { readEditedFile: (p: string) => string | null }).readEditedFile =
      () => 'l1\na\nc\n';
    const startEv = norm.normalizeRpcLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call-e1',
        toolName: 'edit',
        args: { path: 'f.ts', edits: [{ oldText: 'a\nb', newText: 'a\nc' }] },
      }),
    );
    expect(startEv[0]?.type).toBe('tool_use');
    const endEv = norm.normalizeRpcLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call-e1',
        toolName: 'edit',
        result: { content: [{ text: 'Successfully replaced 1 block(s) in f.ts.' }] },
      }),
    );
    const result = endEv.find((ev) => ev.type === 'tool_result');
    expect(result?.edit_patch).toBe(
      JSON.stringify([{ oldStart: 2, newStart: 2, lines: ['-a', '-b', '+a', '+c'] }]),
    );
  });

  it('is_error=true / 未知 call_id / turn_end 后登记清空 → 不附着', async () => {
    const { PiEventNormalizer } = await import('../../src/interactive/pi-events.js');
    const norm = new PiEventNormalizer();
    norm.normalizeRpcLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call-e2',
        toolName: 'write',
        args: { path: 'f.ts', content: 'x\n' },
      }),
    );
    const errEv = norm.normalizeRpcLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call-e2',
        toolName: 'write',
        isError: true,
        result: { content: [{ text: 'boom' }] },
      }),
    );
    expect(errEv.find((ev) => ev.type === 'tool_result')?.edit_patch).toBeUndefined();
    // 未知 call_id 的 write end（无登记）→ 不附着。
    const orphanEv = norm.normalizeRpcLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call-unknown',
        toolName: 'write',
        result: { content: [{ text: 'ok' }] },
      }),
    );
    expect(orphanEv.find((ev) => ev.type === 'tool_result')?.edit_patch).toBeUndefined();
  });
});
