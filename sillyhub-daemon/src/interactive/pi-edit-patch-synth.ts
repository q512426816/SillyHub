/**
 * pi-edit-patch-synth.ts —— pi 运行时编辑补丁合成（2026-10-24-pi-edit-patch-synth）。
 *
 * 背景：pi 的 edit/write 工具结果只有「Successfully replaced/wrote …」确认文本，
 * 无任何 diff 数据（pi-events.ts 设计期把 edit_patch 列为非目标）——轮文件变更
 * 弹窗对 pi 会话恒「无补丁」。但 **入参本身就是完整变更内容**：
 *   - edit：`{path, edits: [{oldText, newText}, …]}`
 *   - write：`{path, content}`
 * 本模块把入参合成 structuredPatch JSON 串（前端 parseStructuredPatch 既有格式
 * `[{oldStart, newStart, lines: ["-old", "+new", …]}]`），挂 tool_result 事件的
 * edit_patch——backend 字符串透传、前端零改动消费。
 *
 * 行号口径（诚实披露）：
 *   - newStart（新文件行号，弹窗主体信息）：工具执行后实盘定位——end 时读改后
 *     文件，按块顺序（前块结束位之后）搜 newText 首次出现，前缀换行计数得行号，
 *     **恒精确**；
 *   - oldStart（旧文件行号）：`newStart + 前面各块净行偏移累积` 推算——块之前
 *     的内容若被并发他源改动，旧行号可能偏几行（diff 内容本身仍真实，来自入参）。
 *
 * 放弃条件（一律返回 null，宁缺不伪造，FR-03）：入参形态不符 / is_error /
 * 读盘失败 / newText 在改后文件定位不到 / 合成 JSON 超 64KB（对齐 claude 轨道
 * 附着上限惯例）。
 *
 * @module interactive/pi-edit-patch-synth
 */

/** structuredPatch 单 hunk（与前端 parseStructuredPatch 契约逐字对齐）。 */
export interface SynthHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

/**
 * 合成补丁 JSON 串的附着上限（超出整体放弃，不截半补丁）——UTF-8 字节口径，
 * 逐字对齐 claude 轨道（parse-claude-code-jsonl.ts EDIT_PATCH_MAX_BYTES=64_000）。
 */
export const SYNTH_PATCH_MAX_BYTES = 64_000;

/** 文本按行拆分（行数 = 段数；末尾空串保留为独立行，与 diff 行语义一致）。 */
function splitLines(text: string): string[] {
  return text.split('\n');
}

/** 位置区间的换行计数（[from,to) 逐字符；增量调用时总体单遍，避免每块全量重扫）。 */
function countNewlines(fileText: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (fileText.charCodeAt(i) === 10) count += 1; // '\n'
  }
  return count;
}

/** hunk 数组 → JSON 串（含上限判定；空数组/超限 → null）。 */
function stringifyHunks(hunks: SynthHunk[]): string | null {
  if (hunks.length === 0) return null;
  const json = JSON.stringify(hunks);
  // 评审 P3 修正：口径对齐 claude 轨道（parse-claude-code-jsonl.ts）——UTF-8 字节
  // 数（Buffer.byteLength）而非 UTF-16 码元长度（中文内容下两者差约 3 倍）。
  if (Buffer.byteLength(json, 'utf8') > SYNTH_PATCH_MAX_BYTES) return null;
  return json;
}

/**
 * edit 入参 → structuredPatch JSON 串（或 null）。
 *
 * **同步读盘**：pi-events 的 dispatch 是同步事件链（逐帧返回 AgentEvent[]），
 * 合成在 handler 内联执行——单次本地读、大小护栏（`readFile` 注入方负责），
 * 同步开销毫秒级可接受。
 *
 * @param args 工具入参（`{path, edits}` 形态；edits 块需含字符串 oldText/newText）
 * @param readFile 同步读改后文件全文的注入函数（生产 = readFileSync + 大小护栏）。
 *   签名 (path) => string | null（失败/超大 → null 整体放弃）。
 */
export function synthesizePiEditPatch(
  args: unknown,
  readFile: (path: string) => string | null,
): string | null {
  if (args == null || typeof args !== 'object') return null;
  const record = args as { path?: unknown; edits?: unknown };
  if (typeof record.path !== 'string' || record.path === '') return null;
  if (!Array.isArray(record.edits) || record.edits.length === 0) return null;

  // 形态预检（任一块不符 → 整体放弃，不产半份补丁）。
  const blocks: { oldText: string; newText: string }[] = [];
  for (const raw of record.edits) {
    if (raw == null || typeof raw !== 'object') return null;
    const block = raw as { oldText?: unknown; newText?: unknown };
    if (typeof block.oldText !== 'string' || typeof block.newText !== 'string') {
      return null;
    }
    blocks.push({ oldText: block.oldText, newText: block.newText });
  }

  const fileText = readFile(record.path);
  if (fileText === null) return null;

  const hunks: SynthHunk[] = [];
  // 顺序定位游标：后块只在前块结束位置之后搜（同内容多块不误配首现）。
  let searchFrom = 0;
  // 增量行号（评审 P3：从游标位置单遍累积，不每块全量重扫——2MB 文件多块的
  // 最坏扫描从 O(块数×文件字节) 收敛到 O(文件字节)）。
  let lineAtCursor = 1;
  // 旧行号偏移累积：前面各块 (newLines - oldLines) 的和（oldStart = newStart - 偏移）。
  let oldLineDrift = 0;
  for (const block of blocks) {
    const at = fileText.indexOf(block.newText, searchFrom);
    if (at < 0) return null; // 定位不到（并发改动/非全量替换）→ 整体放弃
    lineAtCursor += countNewlines(fileText, searchFrom, at);
    const newStart = lineAtCursor;
    const oldStart = newStart - oldLineDrift;
    const lines = [
      ...splitLines(block.oldText).map((l) => `-${l}`),
      ...splitLines(block.newText).map((l) => `+${l}`),
    ];
    hunks.push({ oldStart: Math.max(1, oldStart), newStart, lines });
    // 游标推进到本块 newText 末尾（行号增量同步数区间换行）；偏移按净行差累积。
    searchFrom = at + block.newText.length;
    lineAtCursor += countNewlines(fileText, at, searchFrom);
    oldLineDrift +=
      splitLines(block.newText).length - splitLines(block.oldText).length;
  }
  return stringifyHunks(hunks);
}

/**
 * write 入参 → 全 add 行 hunk（或 null）。
 *
 * 覆盖写的旧行不可知——全 add 行（oldStart=1/newStart=1）是如实口径：弹窗展示
 * 「写入后全文」。新建文件语义即全量新增；修改型覆盖写同理展示最终内容。
 */
export function synthesizePiWritePatch(args: unknown): string | null {
  if (args == null || typeof args !== 'object') return null;
  const record = args as { content?: unknown };
  if (typeof record.content !== 'string' || record.content === '') return null;
  const lines = splitLines(record.content).map((l) => `+${l}`);
  return stringifyHunks([{ oldStart: 1, newStart: 1, lines }]);
}
