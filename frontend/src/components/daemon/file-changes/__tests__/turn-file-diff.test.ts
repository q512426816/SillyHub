// 2026-10-23-turn-file-diff-dialog task-01：轮文件变更弹窗纯映射单测。
//
// 锁定契约（design「接口契约」）：
//   1. tool_call 行（channel=tool_call，content_redacted=JSON）与 edit_patch 行
//      **按配对键精确配对**——主来源 metadata.agent_event.call_id（新轨逐行落库；
//      DB 无顶层 tool_use_id 列），回退顶层 slim tool_use_id / content JSON 内键；
//      命中目标路径 → 补丁段（工具名 + DiffRow[]）；
//   2. 绝对路径（含 Windows 反斜杠）按后缀匹配仓根相对 posix 路径；
//   3. 同一文件多次编辑按日志序逐段返回（FR-02 改N次多段）；
//   4. edit_patch JSON 形状不可解析 → 段保留 rows=null（占位说明，不静默丢弃、不伪造）；
//   5. 两侧均无配对键时按②回退：**同轨（parent_tool_use_id）唯一未消费编辑族调用**
//      才配，否则诚实丢弃（跨轨/多悬置/有 id 但调用行缺失均不猜）；
//   6. 其他文件 / Bash 等无路径工具的补丁不入选；subagent 行（带归属列）按轨道隔离。

import { describe, expect, it } from "vitest";

import type { AgentRunLogEntry } from "@/lib/agent";

import {
  collectTurnFilePatches,
  diffRowsToText,
  matchesRepoPath,
  toolCallFilePath,
} from "../turn-file-diff";

function callLog(overrides: {
  toolUseId?: string | null;
  /** metadata.agent_event.call_id（新轨真实配对键；2026-10-23 评审修正后的主来源）。 */
  eventCallId?: string | null;
  tool?: string;
  filePath?: string | null;
  raw?: string;
  parentToolUseId?: string;
}): AgentRunLogEntry {
  const args: Record<string, unknown> =
    overrides.filePath === null
      ? { command: "rm -rf dist" }
      : { file_path: overrides.filePath ?? "frontend/src/a.ts" };
  // toolUseId=null = 调用行顶层无 id；缺省 = 默认 id "tu-1"。
  const tuid = overrides.toolUseId ?? "tu-1";
  const withId = overrides.toolUseId !== null;
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
        ...(withId ? { tool_use_id: tuid } : {}),
      }),
    ...(withId ? { tool_use_id: tuid } : {}),
    ...(overrides.eventCallId != null
      ? { metadata: { agent_event: { call_id: overrides.eventCallId } } }
      : {}),
    ...(overrides.parentToolUseId != null
      ? { parent_tool_use_id: overrides.parentToolUseId }
      : {}),
  } as AgentRunLogEntry;
}

function resultLog(overrides: {
  toolUseId?: string | null;
  /** metadata.agent_event.call_id（新轨真实配对键）。 */
  eventCallId?: string | null;
  patch?: string | null;
  id?: string;
  parentToolUseId?: string;
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
    ...(overrides.eventCallId != null
      ? { metadata: { agent_event: { call_id: overrides.eventCallId } } }
      : {}),
    ...(overrides.parentToolUseId != null
      ? { parent_tool_use_id: overrides.parentToolUseId }
      : {}),
  } as AgentRunLogEntry;
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

  it("遗留 result（无配对键）回退：同轨唯一未消费编辑调用即其归属，只落路径命中的文件", () => {
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

  // 2026-10-23-diff-dialog-pairing-fix（评审修正后）：
  // 配对键主来源 = metadata.agent_event.call_id（新轨逐行落库，DB 无顶层 tool_use_id 列）；
  // ①精确配对恢复后，多文件编辑轮各归其位。②回退仅在「同轨唯一悬置」时兜底。
  it("metadata.agent_event.call_id 精确配对：多文件各归其位，目标文件弹窗不再吃到他文件内容（实证复现）", () => {
    const designPatch = JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+design-body"] }]);
    const reqPatch = JSON.stringify([{ oldStart: 2, newStart: 2, lines: ["+requirements-body"] }]);
    const testPatch1 = JSON.stringify([{ oldStart: 3, newStart: 3, lines: ["+test-1"] }]);
    const testPatch2 = JSON.stringify([{ oldStart: 4, newStart: 4, lines: ["+test-2"] }]);
    const logs: AgentRunLogEntry[] = [
      // 真实链路形态：顶层 tool_use_id 恒无（非 slim），id 在 metadata.agent_event。
      callLog({ toolUseId: null, eventCallId: "tu-d", tool: "Write", filePath: "design.md" }),
      resultLog({ toolUseId: null, eventCallId: "tu-d", id: "r-d", patch: designPatch }),
      callLog({ toolUseId: null, eventCallId: "tu-q", tool: "Write", filePath: "requirements.md" }),
      resultLog({ toolUseId: null, eventCallId: "tu-q", id: "r-q", patch: reqPatch }),
      callLog({ toolUseId: null, eventCallId: "tu-t1", tool: "Edit", filePath: "tests/task-runner.test.ts" }),
      resultLog({ toolUseId: null, eventCallId: "tu-t1", id: "r-t1", patch: testPatch1 }),
      callLog({ toolUseId: null, eventCallId: "tu-t2", tool: "Edit", filePath: "tests/task-runner.test.ts" }),
      resultLog({ toolUseId: null, eventCallId: "tu-t2", id: "r-t2", patch: testPatch2 }),
    ];
    expect(collectTurnFilePatches(logs, "tests/task-runner.test.ts").map((s) => s.rows?.[0]?.text)).toEqual([
      "test-1",
      "test-2",
    ]);
    expect(collectTurnFilePatches(logs, "design.md").map((s) => s.rows?.[0]?.text)).toEqual(["design-body"]);
  });

  it("②回退同轨唯一悬置：完全无 id 的串行编辑轮仍各归其位（FR-02）", () => {
    const logs: AgentRunLogEntry[] = [
      callLog({ toolUseId: null, tool: "Write", filePath: "design.md" }),
      resultLog({ toolUseId: null, id: "r-d", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+d"] }]) }),
      callLog({ toolUseId: null, tool: "Edit", filePath: "tests/x.test.ts" }),
      resultLog({ toolUseId: null, id: "r-x", patch: JSON.stringify([{ oldStart: 2, newStart: 2, lines: ["+x"] }]) }),
    ];
    expect(collectTurnFilePatches(logs, "tests/x.test.ts").map((s) => s.rows?.[0]?.text)).toEqual(["x"]);
    expect(collectTurnFilePatches(logs, "design.md").map((s) => s.rows?.[0]?.text)).toEqual(["d"]);
  });

  it("子代理轨道隔离：主/子代理交错且无 id 时不跨轨错配（FR-02 并发面）", () => {
    const logs: AgentRunLogEntry[] = [
      // 主代理 call A 悬置 → 子代理 call S（不同 parent_tool_use_id）→ 主代理 result A。
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/main.ts" }),
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/sub.ts", parentToolUseId: "tu-p" }),
      resultLog({ toolUseId: null, id: "r-a", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+main"] }]) }),
    ];
    // 主轨唯一悬置 = A → 正确配 A；子轨的 S 不被主代理补丁吃掉。
    expect(collectTurnFilePatches(logs, "frontend/src/main.ts").map((s) => s.rows?.[0]?.text)).toEqual(["main"]);
    expect(collectTurnFilePatches(logs, "frontend/src/sub.ts")).toEqual([]);
  });

  it("同轨多个悬置（同执行体并行 tool_use）无法确证归属 → 诚实丢弃", () => {
    const logs: AgentRunLogEntry[] = [
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/a.ts" }),
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/b.ts" }),
      resultLog({ toolUseId: null, id: "r-amb", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+amb"] }]) }),
    ];
    expect(collectTurnFilePatches(logs, "frontend/src/a.ts")).toEqual([]);
    expect(collectTurnFilePatches(logs, "frontend/src/b.ts")).toEqual([]);
  });

  it("悬空调用（补丁丢失）使同轨出现两个未消费调用 → 后续补丁诚实丢弃，不错配", () => {
    const logs: AgentRunLogEntry[] = [
      // call A 的补丁超 64KB 未附着（悬空）→ 后续 call B + result B 时同轨悬置 = [A,B]。
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/lost.ts" }),
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/b.ts" }),
      resultLog({ toolUseId: null, id: "r-b", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+b"] }]) }),
    ];
    // 无法确证 B 的补丁归属 → 两文件都不展示（不把 B 的补丁挂到 lost.ts）。
    expect(collectTurnFilePatches(logs, "frontend/src/b.ts")).toEqual([]);
    expect(collectTurnFilePatches(logs, "frontend/src/lost.ts")).toEqual([]);
  });

  it("无 id 补丁不配给非编辑族调用（Bash 不入回退候选面，诚实丢弃）", () => {
    const logs: AgentRunLogEntry[] = [
      callLog({ toolUseId: null, tool: "Bash", filePath: null }),
      resultLog({ toolUseId: null, id: "r-bash", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+x"] }]) }),
    ];
    expect(collectTurnFilePatches(logs, "frontend/src/a.ts")).toEqual([]);
  });

  it("乱序批次：补丁行先于其调用行，①按全量预建索引仍精确命中（评审 P3a）", () => {
    const logs: AgentRunLogEntry[] = [
      resultLog({ toolUseId: null, eventCallId: "tu-x", id: "r-x", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+x"] }]) }),
      callLog({ toolUseId: null, eventCallId: "tu-x", tool: "Edit", filePath: "frontend/src/x.ts" }),
    ];
    expect(collectTurnFilePatches(logs, "frontend/src/x.ts").map((s) => s.rows?.[0]?.text)).toEqual(["x"]);
  });

  it("有 id 但调用行缺失（content 截断不可解析）：禁止回落②错挂到同轨其他悬置（评审 P3b）", () => {
    const logs: AgentRunLogEntry[] = [
      // 同轨一个编辑调用（无补丁结果，保持未消费）——旧逻辑会把它当②候选。
      callLog({ toolUseId: null, tool: "Edit", filePath: "frontend/src/other.ts" }),
      // 孤儿补丁：有 id、但其调用行不存在（模拟 content 超 50KB 被截断后解析失败）。
      resultLog({ toolUseId: null, eventCallId: "tu-missing", id: "r-orphan", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+orphan"] }]) }),
    ];
    // 归属已由 id 语境确定（调用行缺失）→ 丢弃，不挂给 other.ts。
    expect(collectTurnFilePatches(logs, "frontend/src/other.ts")).toEqual([]);
  });

  it("①已消费的调用不参与②候选（同 id 重复补丁行丢弃不回退）", () => {
    const logs: AgentRunLogEntry[] = [
      callLog({ toolUseId: null, eventCallId: "tu-a", tool: "Edit", filePath: "frontend/src/a.ts" }),
      resultLog({ toolUseId: null, eventCallId: "tu-a", id: "r1", patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["+first"] }]) }),
      resultLog({ toolUseId: null, eventCallId: "tu-a", id: "r2", patch: JSON.stringify([{ oldStart: 2, newStart: 2, lines: ["+dup"] }]) }),
    ];
    // 只出①命中的第一段；重复补丁行 id 已消费 → 不回退、不重复展示。
    expect(collectTurnFilePatches(logs, "frontend/src/a.ts").map((s) => s.rows?.[0]?.text)).toEqual(["first"]);
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
