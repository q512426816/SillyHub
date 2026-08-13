// tests/d004-no-taskkill-source-gate.test.ts
// task-15 验收项 (3) / decisions D-004：硬门禁 —— sillyhub-daemon/src 源码不得出现
// ``taskkill /IM`` 通杀调用（CONVENTIONS 已知陷阱：会杀掉当前会话自身）。Windows 下
// 常规进程清理交给 SDK ``query.close()``（win32 走 stdin.end → 5s 后 TerminateProcess；
// 非 win32 走 SIGTERM → SIGKILL），daemon 不自建 kill 逻辑（D-003 / D-004）。
//
// **门禁粒度（ql-20260813-006 修订）**：D-004 真禁令是「/IM image-name 通配杀」，
// 因为它按进程名匹配会误杀当前 daemon 会话自身。``/PID`` 定点杀（含 ``/T`` 杀进程树）
// 按 PID 精确命中、不会误伤会话——preflight.runWithTreeKill（ql-20260812-007）即用
// ``spawn('taskkill', ['/PID', pid, '/T', '/F'])`` 修 Windows preflight 卡死，属合法定点
// 清理。故本门禁从「可执行代码 0 次 taskkill」放宽为「可执行代码 0 次 ``/IM`` taskkill」，
// ``/PID`` 定点调用放行（透明 surface 计数），注释中文档化提及照常不计。
//
// 本文件为「源码静态扫描」断言（跨平台，纯 fs 读取 + TypeScript 词法分析，无 subprocess）：
//   1. 递归扫描 ``sillyhub-daemon/src/**/*.ts``；
//   2. 用 TypeScript 官方 Scanner 把每个文件的注释区间（行注释 ``//`` + 块注释
//      ``/* */`` + JSDoc）权威地标出来——TS 词法器正确区分正则字面量 / 字符串 / 注释；
//   3. 对每个非注释 ``taskkill`` 命中，按 ``/IM`` vs ``/PID`` 分类：``/IM`` → 违规，
//      ``/PID`` → 放行（定点），无明确 flag → 违规（无法确认定点）。
//
// 与 task-15 其它测试分工：
//   - claude-sdk-driver-mcp-kill-cleanup.test.ts：mock 验证 close→query.close 钩子。
//   - 本文件：静态守「daemon 代码无 taskkill /IM 通杀」（验收项 3 的硬门禁）。

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
  /** ql-20260813-006：定点 /PID（放行） vs 通杀 /IM（违规） vs 无 flag（违规：无法确认定点）。 */
  kind: 'pid' | 'im' | 'unflagged';
}

/**
 * ql-20260813-006：判定一次非注释 taskkill 命中是定点（/PID，放行）还是通杀
 *（/IM，违规）。看命中所在行 + 后续 1 行是否含 ``/PID`` 或 ``/IM`` flag
 *（``spawn('taskkill', ['/PID', pid, '/T', '/F'])`` 跨参数，需往后看一行兜底）。
 */
function classifyTaskkill(text: string, nextLine: string): 'pid' | 'im' | 'unflagged' {
  const look = `${text}\n${nextLine}`;
  if (/\/PID\b/i.test(look)) return 'pid';
  if (/\/IM\b/i.test(look)) return 'im';
  return 'unflagged';
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

describe('task-15 / D-004 硬门禁：sillyhub-daemon/src 无 taskkill /IM 通杀', () => {
  const tsFiles = listTsFiles(SRC_ROOT);

  it('扫描覆盖到 src 目录（非空，防止扫描路径漂移让门禁空转）', () => {
    expect(tsFiles.length, 'src/**/*.ts 应扫到文件').toBeGreaterThan(0);
    const driverAbs = join(SRC_ROOT, 'interactive', 'claude-sdk-driver.ts');
    expect(tsFiles, 'claude-sdk-driver.ts 必在扫描集').toContain(driverAbs);
  });

  it('非注释 taskkill 调用均为 /PID 定点（0 次 /IM 通杀 —— D-004 硬门禁，ql-20260813-006 放行 /PID）', () => {
    const allHits: Hit[] = [];
    const imViolations: Hit[] = []; // /IM 通杀 = 真违规

    for (const abs of tsFiles) {
      const rel = relative(SRC_ROOT, abs).split(sep).join('/');
      const content = readFileSync(abs, 'utf8');
      const commentRanges = collectCommentRanges(content).sort((a, b) => a.start - b.start);
      const offsets = findTaskkillOffsets(content);
      for (const off of offsets) {
        const lc = offsetToLineCol(content, off);
        const inComment = isInsideComment(off, commentRanges);
        let kind: Hit['kind'] = 'pid';
        if (!inComment) {
          // 看命中行 + 下一行判 /PID vs /IM（spawn 跨参数兜底看下一行）
          const nlStart = content.indexOf('\n', off) + 1;
          const nlEnd = content.indexOf('\n', nlStart);
          const nextLine = content.slice(nlStart, nlEnd === -1 ? content.length : nlEnd);
          kind = classifyTaskkill(lc.text, nextLine);
        }
        const hit: Hit = { file: rel, line: lc.line, col: lc.col, text: lc.text, inComment, kind };
        allHits.push(hit);
        // 违规 = 非注释 + (/IM 通杀 或 无 flag 无法确认定点)
        if (!inComment && kind !== 'pid') imViolations.push(hit);
      }
    }

    // 透明打印所有命中（注释中文档化提及 + /PID 定点放行 + /IM 违规）—— 便于审计。
    if (allHits.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[D-004 gate] 源码 taskkill 命中 ${allHits.length} 处（注释提及 + /PID 定点放行，/IM 应为 0）：\n` +
          allHits
            .map(
              (h) =>
                `  ${h.file}:${h.line}:${h.col} ${h.inComment ? '注释' : h.kind.toUpperCase()}  ${h.text.trim()}`,
            )
            .join('\n'),
      );
    }

    expect(
      imViolations,
      'D-004 违规：可执行代码中发现 taskkill /IM 通杀或无 flag 调用——/IM 会误杀当前会话自身，' +
        '必须改为 /PID 定点（如 preflight.runWithTreeKill）或 SDK query.close()。命中：\n' +
        imViolations.map((h) => `  ${h.file}:${h.line}  ${h.text.trim()}`).join('\n'),
    ).toEqual([]);
  });

  it('交叉校验：非注释 taskkill 调用均为 /PID 定点（0 次 /IM/unflagged）', () => {
    // 第二条独立交叉校验：把所有命中按 inComment + kind 分桶，断言「非注释 & 非 /PID」桶为空。
    const buckets = { comment: 0, pid: 0, im: 0, unflagged: 0 };
    for (const abs of tsFiles) {
      const content = readFileSync(abs, 'utf8');
      const commentRanges = collectCommentRanges(content);
      const lines = content.split('\n');
      for (const off of findTaskkillOffsets(content)) {
        if (isInsideComment(off, commentRanges)) {
          buckets.comment++;
          continue;
        }
        const lc = offsetToLineCol(content, off);
        const nextLine = lines[lc.line] ?? ''; // line 是 1-based，下一行 = lines[lc.line]
        const kind = classifyTaskkill(lc.text, nextLine);
        if (kind === 'pid') buckets.pid++;
        else buckets[kind]++;
      }
    }
    const violations = buckets.im + buckets.unflagged;
    expect(
      violations,
      '非注释 taskkill 违规数（/IM 通杀 + 无 flag）应为 0（D-004）；/PID 定点放行 = ' +
        buckets.pid +
        '，注释提及 = ' +
        buckets.comment,
    ).toBe(0);
    // eslint-disable-next-line no-console
    console.log(
      `[D-004 gate] 分桶：注释=${buckets.comment}，/PID 定点=${buckets.pid}，/IM+无flag 违规=${violations}`,
    );
  });
});
