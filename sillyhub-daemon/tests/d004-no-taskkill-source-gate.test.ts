// tests/d004-no-taskkill-source-gate.test.ts
// task-15 验收项 (3) / decisions D-004：硬门禁 —— sillyhub-daemon/src 源码不得出现
// 任何 ``taskkill`` 调用（含 ``taskkill /IM`` 通杀，CONVENTIONS 已知陷阱：会杀掉
// 当前会话自身）。Windows 下进程清理一律交给 SDK ``query.close()``（win32 走
// stdin.end → 5s 后 TerminateProcess；非 win32 走 SIGTERM → SIGKILL），daemon 不自建
// kill 逻辑（D-003 / D-004）。
//
// 本文件为「源码静态扫描」断言（跨平台，纯 fs 读取 + TypeScript 词法分析，无 subprocess）：
//   1. 递归扫描 ``sillyhub-daemon/src/**/*.ts``；
//   2. 用 TypeScript 官方 Scanner 把每个文件的注释区间（行注释 ``//`` + 块注释
//      ``/* */`` + JSDoc）权威地标出来——TS 词法器正确区分正则字面量 / 字符串 / 注释，
//      不会像手写 strip 那样被正则里的 ``"'`` / ``//`` 字符误导；
//   3. 断言每个 ``taskkill`` 命中位置都落在注释区间内（即「可执行代码中 0 次 taskkill」）。
//
// 决策说明（task-15 约束「comment 合法提及要 surface」）：源码里允许在**注释**中
// 出现 ``taskkill`` 字样用于文档化禁令本身（如 claude-sdk-driver.ts 的 close 注释
// 「daemon 不自己 taskkill」「禁止 taskkill /IM 通杀」）。这些是 D-004 的现场说明，
// 删除会丢失关键上下文。故本测试断言「所有 taskkill 命中均在注释内」而非「裸文本
// 零命中」——既守住硬门禁（无任何可执行 taskkill 调用 / 命令字符串），又保留禁令
// 文档。所有裸命中（含注释）在下方 ``rawHits`` 汇总打印，透明可见、可审。
//
// 与 task-15 其它测试分工：
//   - claude-sdk-driver-mcp-kill-cleanup.test.ts：mock 验证 close→query.close 钩子在
//     mcpServers 注入场景仍接线（验收项 1/2 的 hook 证据）。
//   - 本文件：静态守「daemon 代码无自建 taskkill」（验收项 3 的硬门禁）。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');
const SRC_ROOT = join(PKG_ROOT, 'src');

/** 递归收集 dir 下所有 .ts 文件（绝对路径）。 */
function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.ts')) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

interface Range {
  start: number;
  end: number;
}

/**
 * 用 TypeScript AST 收集文件里所有注释区间（行注释 `//` + C 风格跨行块注释
 * + JSDoc）。TS 词法器权威区分注释 / 字符串 / 正则字面量 / 模板串，不受
 * 正则内 `"'` 或行注释序列字符干扰（手写 strip 的坑）。
 *
 * 实现：``createSourceFile`` 解析 AST，遍历每个节点，取其 leading（``getFullStart``）
 * 与 trailing（``getEnd``）comment ranges。每条注释必属于某节点的 leading 或 trailing
 * trivia，故全覆盖。
 */
function collectCommentRanges(text: string): Range[] {
  const sf = ts.createSourceFile(
    'x.ts',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const ranges: Range[] = [];
  const visit = (node: ts.Node): void => {
    const fullStart = node.getFullStart();
    const leading = ts.getLeadingCommentRanges(text, fullStart);
    if (leading) {
      for (const r of leading) ranges.push({ start: r.pos, end: r.end });
    }
    const end = node.getEnd();
    const trailing = ts.getTrailingCommentRanges(text, end);
    if (trailing) {
      for (const r of trailing) ranges.push({ start: r.pos, end: r.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ranges;
}

/** 二分判断 offset 是否落在任一注释区间内（ranges 已按 start 升序）。 */
function isInsideComment(offset: number, ranges: Range[]): boolean {
  // ranges 来自 scanner 顺序 push，基本有序；这里保守用线性扫（文件注释数不大）。
  for (const r of ranges) {
    if (offset >= r.start && offset < r.end) return true;
  }
  return false;
}

interface Hit {
  file: string; // 相对 SRC_ROOT 的展示路径（正斜杠）
  line: number;
  col: number;
  text: string;
  inComment: boolean;
}

/** 找出 content 里所有 ``taskkill``（大小写不敏感）命中的位置。 */
function findTaskkillOffsets(content: string): number[] {
  const re = /taskkill/gi;
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    offsets.push(m.index);
    re.lastIndex = m.index + m.length;
  }
  return offsets;
}

function offsetToLineCol(content: string, offset: number): { line: number; col: number; text: string } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  // 取所在行文本用于展示。
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = content.indexOf('\n', offset);
  const text = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
  return { line, col, text };
}

describe('task-15 / D-004 硬门禁：sillyhub-daemon/src 无 taskkill 调用', () => {
  const tsFiles = listTsFiles(SRC_ROOT);

  it('扫描覆盖到 src 目录（非空，防止扫描路径漂移让门禁空转）', () => {
    expect(tsFiles.length, 'src/**/*.ts 应扫到文件').toBeGreaterThan(0);
    const driverAbs = join(SRC_ROOT, 'interactive', 'claude-sdk-driver.ts');
    expect(tsFiles, 'claude-sdk-driver.ts 必在扫描集').toContain(driverAbs);
  });

  it('所有 taskkill 命中均落在注释区间内（可执行代码中 0 次 taskkill —— D-004 硬门禁）', () => {
    const allHits: Hit[] = [];
    const codeHits: Hit[] = [];

    for (const abs of tsFiles) {
      const rel = relative(SRC_ROOT, abs).split(sep).join('/');
      const content = readFileSync(abs, 'utf8');
      const commentRanges = collectCommentRanges(content).sort((a, b) => a.start - b.start);
      const offsets = findTaskkillOffsets(content);
      for (const off of offsets) {
        const lc = offsetToLineCol(content, off);
        const inComment = isInsideComment(off, commentRanges);
        const hit: Hit = { file: rel, line: lc.line, col: lc.col, text: lc.text, inComment };
        allHits.push(hit);
        if (!inComment) codeHits.push(hit);
      }
    }

    // 透明打印所有命中（含注释中文档化提及）—— 便于审计「保留注释」决策。
    if (allHits.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[D-004 gate] 源码 taskkill 命中 ${allHits.length} 处（均应 inComment=true）：\n` +
          allHits
            .map((h) => `  ${h.file}:${h.line}:${h.col} inComment=${h.inComment}  ${h.text.trim()}`)
            .join('\n'),
      );
    }

    expect(
      codeHits,
      'D-004 违规：可执行代码（非注释）中发现 taskkill——必须改为 SDK query.close()，' +
        '禁止 taskkill /IM 通杀（CONVENTIONS 陷阱：会杀当前会话自身）。命中：\n' +
        codeHits.map((h) => `  ${h.file}:${h.line}  ${h.text.trim()}`).join('\n'),
    ).toEqual([]);
  });

  it('裸命中若不为 0，则全部 inComment=true（交叉校验：未绕过「注释内」判定）', () => {
    // 第二条独立交叉校验：把所有命中按 inComment 分桶，断言「非注释」桶为空。
    // 与上一条等价但措辞不同，便于失败时一眼看出「是命中了真代码还是判定逻辑挂了」。
    const buckets = { comment: 0, code: 0 };
    for (const abs of tsFiles) {
      const content = readFileSync(abs, 'utf8');
      const commentRanges = collectCommentRanges(content);
      for (const off of findTaskkillOffsets(content)) {
        if (isInsideComment(off, commentRanges)) buckets.comment++;
        else buckets.code++;
      }
    }
    expect(
      buckets.code,
      '非注释 taskkill 命中数应为 0（D-004）；注释中提及数 = ' + buckets.comment,
    ).toBe(0);
    // 透明记录注释提及总数（当前 = 3，全部在 claude-sdk-driver.ts 文档化禁令）。
    // eslint-disable-next-line no-console
    console.log(
      `[D-004 gate] 分桶：注释中提及=${buckets.comment}，可执行代码中=${buckets.code}`,
    );
  });
});
