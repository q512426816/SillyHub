// 2026-10-23-turn-file-diff-dialog task-01：轮文件变更弹窗纯映射单测。
//
// 锁定契约（design「接口契约」）：
//   1. tool_call 行（channel=tool_call，content_redacted=JSON）与 tool_result 行
//      （edit_patch 列）按 tool_use_id 配对，命中目标路径 → 补丁段（工具名 + DiffRow[]）；
//   2. 绝对路径（含 Windows 反斜杠）按后缀匹配仓根相对 posix 路径；
//   3. 同一文件多次编辑按日志序逐段返回（FR-02 改N次多段）；
//   4. edit_patch JSON 形状不可解析 → 段保留 rows=null（占位说明，不静默丢弃、不伪造）；
//   5. result 无 tool_use_id 的遗留行按序回退配对（优先同工具名、须路径命中）；
//   6. 其他文件 / Bash 等无路径工具的补丁不入选；subagent 行（带归属列）同样参与。

import { describe, expect, it } from "vitest";

import type { AgentRunLogEntry } from "@/lib/agent";

import {
  collectTurnFilePatches,
  diffRowsToText,
  matchesRepoPath,
  toolCallFilePath,
} from "../turn-file-diff";

function callLog(overrides: {
  toolUseId?: string;
  tool?: string;
  filePath?: string | null;
  raw?: string;
}): AgentRunLogEntry {
  const args: Record<string, unknown> =
    overrides.filePath === null
      ? { command: "rm -rf dist" }
      : { file_path: overrides.filePath ?? "frontend/src/a.ts" };
  return {
    id: overrides.toolUseId ?? "log-call-1",
    run_id: "run-1",
    timestamp: "2026-10-23T08:00:00Z",
    channel: "tool_call",
    content_redacted:
      overrides.raw ??
      JSON.stringify({
        tool: overrides.tool ?? "Edit",
        args,
        tool_use_id: overrides.toolUseId ?? "tu-1",
      }),
    tool_use_id: overrides.toolUseId ?? "tu-1",
  };
}

function resultLog(overrides: {
  toolUseId?: string | null;
  patch?: string | null;
  id?: string;
}): AgentRunLogEntry {
  return {
    id: overrides.id ?? "log-result-1",
    run_id: "run-1",
    timestamp: "2026-10-23T08:00:01Z",
    channel: "stdout",
    content_redacted: "[TOOL_RESULT] ok",
    edit_patch:
      overrides.patch === undefined
        ? JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["-old", "+new"] }])
        : overrides.patch,
    ...(overrides.toolUseId === null ? {} : { tool_use_id: overrides.toolUseId ?? "tu-1" }),
  };
}

describe("matchesRepoPath / toolCallFilePath（路径匹配基元）", () => {
  it("全等与后缀（posix / Windows 反斜杠 / ./ 前缀）命中，其余不命中", () => {
    expect(matchesRepoPath("frontend/src/a.ts", "frontend/src/a.ts")).toBe(true);
    expect(matchesRepoPath("C:\\proj\\frontend/src/a.ts", "frontend/src/a.ts")).toBe(true);
    expect(matchesRepoPath("./frontend/src/a.ts", "frontend/src/a.ts")).toBe(true);
    expect(matchesRepoPath("frontend/src/ab.ts", "frontend/src/a.ts")).toBe(false);
    expect(matchesRepoPath("src/a.ts", "frontend/src/a.ts")).toBe(false);
  });

  it("toolCallFilePath 按 file_path / notebook_path / path 顺序取第一个字符串", () => {
    expect(toolCallFilePath({ file_path: "a.ts" })).toBe("a.ts");
    expect(toolCallFilePath({ notebook_path: "n.ipynb" })).toBe("n.ipynb");
    expect(toolCallFilePath({ path: "p.txt" })).toBe("p.txt");
    expect(toolCallFilePath({ file_path: 123 })).toBeNull();
    expect(toolCallFilePath({})).toBeNull();
  });
});

describe("collectTurnFilePatches（日志 → 按序补丁段）", () => {
  it("tool_use_id 配对：命中路径出一段，工具名与 diff 行齐全", () => {
    const sections = collectTurnFilePatches(
      [callLog({ toolUseId: "tu-1", filePath: "frontend/src/a.ts" }), resultLog({ toolUseId: "tu-1" })],
      "frontend/src/a.ts",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.toolName).toBe("Edit");
    expect(sections[0]?.rows).toEqual([
      { type: "del", oldNo: 1, newNo: null, text: "old" },
      { type: "add", oldNo: null, newNo: 1, text: "new" },
    ]);
  });

  it("Windows 绝对路径入参按后缀匹配仓根相对路径", () => {
    const sections = collectTurnFilePatches(
      [
        callLog({ toolUseId: "tu-1", filePath: "C:\\repo\\frontend\\src\\a.ts" }),
        resultLog({ toolUseId: "tu-1" }),
      ],
      "frontend/src/a.ts",
    );
    expect(sections).toHaveLength(1);
  });

  it("同一文件多次编辑按日志序逐段返回（FR-02）", () => {
    const sections = collectTurnFilePatches(
      [
        callLog({ toolUseId: "tu-1", filePath: "frontend/src/a.ts" }),
        resultLog({ toolUseId: "tu-1", id: "r1", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["-one"] }]) }),
        callLog({ toolUseId: "tu-2", filePath: "frontend/src/a.ts" }),
        resultLog({ toolUseId: "tu-2", id: "r2", patch: JSON.stringify([{ oldStart: 5, newStart: 5, lines: ["+two"] }]) }),
      ],
      "frontend/src/a.ts",
    );
    expect(sections.map((s) => s.rows)).toEqual([
      [{ type: "del", oldNo: 1, newNo: null, text: "one" }],
      [{ type: "add", oldNo: null, newNo: 5, text: "two" }],
    ]);
  });

  it("其他文件与无路径工具（Bash）的补丁不入选", () => {
    const sections = collectTurnFilePatches(
      [
        callLog({ toolUseId: "tu-1", filePath: "frontend/src/other.ts" }),
        resultLog({ toolUseId: "tu-1", id: "r1" }),
        callLog({ toolUseId: "tu-2", tool: "Bash", filePath: null }),
        resultLog({ toolUseId: "tu-2", id: "r2" }),
      ],
      "frontend/src/a.ts",
    );
    expect(sections).toEqual([]);
  });

  it("edit_patch JSON 形状不可解析 → 段保留 rows=null（不静默丢弃）", () => {
    const sections = collectTurnFilePatches(
      [callLog({ toolUseId: "tu-1" }), resultLog({ toolUseId: "tu-1", patch: "{not-json" })],
      "frontend/src/a.ts",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.rows).toBeNull();
  });

  it("遗留 result（无 tool_use_id）按序回退配对：优先同工具名，且只落路径命中的调用", () => {
    const sections = collectTurnFilePatches(
      [
        callLog({ toolUseId: "tu-a", filePath: "frontend/src/a.ts", raw: JSON.stringify({ tool: "Write", args: { file_path: "frontend/src/a.ts" } }) }),
        resultLog({ toolUseId: null, id: "r1", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+w"] }]) }),
      ],
      "frontend/src/a.ts",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.toolName).toBe("Write");
  });

  it("遗留 result 回退配对不串到路径不符的调用", () => {
    const sections = collectTurnFilePatches(
      [
        callLog({ toolUseId: "tu-b", filePath: "frontend/src/other.ts" }),
        resultLog({ toolUseId: null, id: "r1" }),
      ],
      "frontend/src/a.ts",
    );
    expect(sections).toEqual([]);
  });

  it("subagent 行（带 parent_tool_use_id 归属列）同样参与配对", () => {
    const sub = {
      ...callLog({ toolUseId: "tu-sub", filePath: "frontend/src/a.ts" }),
      parent_tool_use_id: "tu-parent",
      depth: 1,
    };
    const sections = collectTurnFilePatches(
      [sub, resultLog({ toolUseId: "tu-sub" })],
      "frontend/src/a.ts",
    );
    expect(sections).toHaveLength(1);
  });

  it("空日志 / 无 tool_call 行 → 空数组（不抛错）", () => {
    expect(collectTurnFilePatches([], "a.ts")).toEqual([]);
    expect(collectTurnFilePatches([resultLog({ toolUseId: "tu-1" })], "a.ts")).toEqual([]);
  });
});

// 2026-10-23-diff-dialog-copy-fallback task-01：diffRowsToText 纯映射。
describe("diffRowsToText（DiffRow → unified 前缀文本）", () => {
  it("按行类型重建前缀：del=-、add=+、ctx=空格，行序保持", () => {
    const text = diffRowsToText([
      { type: "ctx", oldNo: 1, newNo: 1, text: "keep" },
      { type: "del", oldNo: 2, newNo: null, text: "gone" },
      { type: "add", oldNo: null, newNo: 2, text: "fresh" },
    ]);
    expect(text).toBe(" keep\n-gone\n+fresh");
  });

  it("hunk 分隔伪行（oldNo/newNo 均 null 的 ctx）被剔除，不污染复制文本", () => {
    const text = diffRowsToText([
      { type: "del", oldNo: 1, newNo: null, text: "a" },
      { type: "ctx", oldNo: null, newNo: null, text: "…" },
      { type: "add", oldNo: null, newNo: 5, text: "b" },
    ]);
    expect(text).toBe("-a\n+b");
    expect(text).not.toContain(" …");
  });

  it("内容自带前导空格/符号时原样保留（只加类型前缀一次）", () => {
    expect(diffRowsToText([{ type: "ctx", oldNo: 3, newNo: 3, text: "  indented" }])).toBe(
      "   indented",
    );
    expect(diffRowsToText([{ type: "add", oldNo: null, newNo: 1, text: "-not-a-del" }])).toBe(
      "+-not-a-del",
    );
  });

  it("不截断：2500 行 rows 全量输出（渲染 2000 行上限不进复制面）", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      type: "add" as const,
      oldNo: null,
      newNo: i + 1,
      text: `line-${i}`,
    }));
    const text = diffRowsToText(rows);
    expect(text.split("\n")).toHaveLength(2500);
    expect(text.endsWith("+line-2499")).toBe(true);
  });

  it("空数组 → 空串", () => {
    expect(diffRowsToText([])).toBe("");
  });
});
