// ============================================================================
// task-13（2026-09-03-agent-provider-abstraction / FR-04 / D-001@v1）：
// 双路径渲染等价 fixture 测试（Claude 零回归判据，design §2 目标 2）。
//
// 判据：同一 Claude 会话事件序列生成的两种载荷（fixtures/dual-path-session.json）——
//   legacy      旧文本协议行（[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT] 前缀
//              + tool_call 双写行 + 结构化列，backend _extract_sdk_messages 产物形态）
//   agent_event 同行对象 + 顶层 agent_event 字段（backend _persist_agent_event 双写
//              现实——文本行保留，事件形状对齐 daemon ClaudeEventNormalizer）
// 分别过 normalizeLogs 两条路径（旧文本协议解析 vs fromAgentEvent 结构化轨），
// 剥离白名单字段后深比较渲染模型树（逐块对照），断言结构等价。
//
// 剥离白名单（task 卡 constraints 固定）：log_id/timestamp/dedup_key/segment_id，
// 其余全比。另剥 agent_event（含 metadata.agent_event）——它是双轨的**输入判别
// 字段**（一边有一边无，不属渲染模型），与白名单同列声明。
//
// 已知差异豁免（fixture 不构造的病理载荷；见 fixture _comment 与 task-13 交付报告）：
//   1. tool_result 内容内嵌 [TOOL_USE]/[ASSISTANT] 等协议前缀行——旧轨
//      extractToolResultBody 在内嵌前缀处截断、新轨取 ev.content 全文；
//   2. 主 agent 的 Task tool_result 行（golden msg21 形态：无 parent 归属、call_id
//      指向 Task 卡、行序在子代理工具行之后）——旧轨邻近退化配对落【子代理最后
//      一张工具卡】，新轨按验收指令梯级（无 parent → call_id 精确配对）落【Task
//      卡】，两轨不等价；本 fixture 不构造该行（Task 卡 result 由子代理 parent
//      配对 result 承载），待仲裁；
//   3. turn_result 行双轨 backend 均不落行，fixture 按批量旧轨 [RESULT:success]
//      形态构造，覆盖防御性映射等价。
//
// 验收回修锚（本轮验收指令）：
//   - 差异 A：tool_result 带 parent_tool_use_id（子代理归属）→ 按 parent 配对进
//     父 Task 卡（对齐旧轨 D-007 梯级），不按 call_id 并进子代理自己的工具卡；
//   - 差异 B：text 行重置 thinking 合并指针（对齐旧轨非 thinking-only stdout 行）。
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizeLogs } from "../normalize";
import type { AgentRunLogEntry } from "@/lib/agent";
import fixture from "./fixtures/dual-path-session.json";

// JSON 导入无 AgentRunLogEntry 类型上下文（channel 等是宽 string），统一 cast。
const legacyRows = fixture.legacy as unknown as AgentRunLogEntry[];
const agentEventRows = fixture.agent_event as unknown as AgentRunLogEntry[];

/**
 * 剥离白名单字段：log_id(id)/timestamp/dedup_key/segment_id（constraints 固定），
 * 另剥双轨输入判别字段 agent_event（顶层 + metadata 内）。其余字段全保留参与比较。
 */
function stripRow(log: AgentRunLogEntry): Record<string, unknown> {
  const rec: Record<string, unknown> = { ...log };
  for (const key of ["id", "timestamp", "dedup_key", "segment_id", "agent_event"]) {
    delete rec[key];
  }
  if (rec["metadata"] != null && typeof rec["metadata"] === "object") {
    const meta = { ...(rec["metadata"] as Record<string, unknown>) };
    delete meta["agent_event"];
    if (Object.keys(meta).length === 0) delete rec["metadata"];
    else rec["metadata"] = meta;
  }
  return rec;
}

/** 渲染模型树节点：ProcessedLog 全部渲染字段 + 剥离后的 log 本体。 */
type RenderNode = Record<string, unknown> & { log: Record<string, unknown> };

/**
 * 渲染模型树快照：normalizeLogs 全量输出（ProcessedLog 所有渲染字段 + 剥离后的
 * log 本体）。不用挑选式快照——"其余全比"，漏加字段即漏比。
 */
function renderTree(logs: AgentRunLogEntry[]): RenderNode[] {
  return normalizeLogs(logs).map((p) => {
    const { log, ...renderFields } = p;
    return { ...renderFields, log: stripRow(log) } as RenderNode;
  });
}

/** 回归锚用最小行构造（fixture 之外的独立小场景）。 */
function makeRow(
  channel: AgentRunLogEntry["channel"],
  content: string,
  id: string,
  extra: Record<string, unknown> = {},
): AgentRunLogEntry {
  return {
    id,
    run_id: "run-anchor",
    timestamp: "2026-09-03T10:00:00.000Z",
    channel,
    content_redacted: content,
    ...extra,
  } as AgentRunLogEntry;
}

describe("task-13: 双路径渲染等价（Claude 零回归判据，design §2 目标 2）", () => {
  it("fixture 自身对齐：两载荷行数一致且逐行同源（agent_event 载荷 = 旧行 + agent_event 字段）", () => {
    // 守护 fixture 完整性——等价断言的前提是两载荷确为"同一事件序列"。
    expect(agentEventRows).toHaveLength(legacyRows.length);
    for (let i = 0; i < legacyRows.length; i++) {
      expect(
        stripRow(agentEventRows[i]!),
        `第 ${i} 行两载荷应在剥离输入判别字段后完全一致`,
      ).toEqual(stripRow(legacyRows[i]!));
    }
  });

  it("SSE 入口（顶层 agent_event）：两种载荷 normalize 渲染模型树结构等价（逐块对照）", () => {
    const legacyTree = renderTree(legacyRows);
    const agentEventTree = renderTree(agentEventRows);
    expect(agentEventTree).toHaveLength(legacyTree.length);
    // 深比较（toEqual 递归逐块）：除白名单字段外全部渲染字段相等。
    expect(agentEventTree).toEqual(legacyTree);
  });

  it("回放入口（metadata.agent_event）：与顶层 agent_event 入口产出同一渲染模型树", () => {
    // backend 落库行经 REST 回放时事件挂在 metadata_['agent_event']（schema.py
    // validation_alias 直映）；extractRowAgentEvent 双入口识别，两入口渲染等价。
    const replayRows: AgentRunLogEntry[] = agentEventRows.map((row) => {
      const { agent_event, ...rest } = row;
      if (!agent_event) return rest;
      return {
        ...rest,
        metadata: { ...(rest.metadata ?? {}), agent_event },
      };
    });
    expect(renderTree(replayRows)).toEqual(renderTree(legacyRows));
  });

  // ── 非空判据（防"两边同塌成回退态"的空洞等价）──
  // legacy 轨是现状锚：它的深功能必须真实产出，等价断言才有意义。
  it("现状锚：legacy 轨产出预期可见块序列（user/thinking/assistant/tool×4/子代理/result）", () => {
    const tree = renderTree(legacyRows);
    expect(tree).toHaveLength(21);
    const visibleCategories = tree
      .filter((b) => !b.hidden)
      .map((b) => b.semanticCategory);
    expect(visibleCategories).toEqual([
      "user", // lg-001 用户输入
      "thinking", // lg-002 主 agent thinking（partial×2 + override 合并块）
      "assistant", // lg-005 主 agent 文本（partial + override 合并块）
      "tool_call", // lg-008 Bash 卡（stdout 回显 lg-007 hidden + result lg-009 并卡）
      "assistant", // lg-010 工具间隙文本
      "tool_call", // lg-012 Edit 卡（含 edit_patch 深功能）
      "tool_call", // lg-015 Task 卡（子代理 tool_result 经 parent 配对并卡）
      "thinking", // lg-016 子代理 thinking（parent_tool_use_id+depth=1）
      "tool_call", // lg-018 子代理 Read 卡（不收自己的 result——见差异 A 锚）
      "assistant", // lg-020 子代理文本（parent_tool_use_id+depth=1）
      "result", // lg-021 turn result
    ]);
  });

  it("深功能锚：thinking partial+override 完整段覆盖（无双份拼接）", () => {
    const tree = renderTree(legacyRows);
    expect(tree[1]?.mergedThinkingContent).toBe(
      "用户想要先检查容器，再派子代理计算，得到结果后直接汇报。",
    );
    expect(tree[2]?.hidden).toBe(true); // partial 2 并入块首
    expect(tree[3]?.hidden).toBe(true); // override 完整行并入块首
  });

  it("深功能锚：assistant 文本 partial+override 覆盖语义", () => {
    const tree = renderTree(legacyRows);
    expect(tree[4]?.mergedAssistantContent).toBe("我先检查容器状态，随后派子代理计算。");
    expect(tree[5]?.hidden).toBe(true);
  });

  it("深功能锚：tool_use+result 配对（stdout 回显 hidden / 卡片收 result / 耗时预算）", () => {
    const tree = renderTree(legacyRows);
    // Bash 卡（lg-008）：回显行 lg-007 hidden、result lg-009 并卡 + toolDurationMs=3000
    expect(tree[6]?.hidden).toBe(true);
    expect(tree[7]?.toolUseId).toBe("toolu_bash01");
    expect(tree[7]?.mergedToolResult).toBe("sillyhub-backend\nsillyhub-daemon");
    expect(tree[7]?.toolDurationMs).toBe(3000);
    expect(tree[8]?.hidden).toBe(true);
    // Edit 卡（lg-012）：result lg-013 并卡；edit_patch（structuredPatch JSON）随
    // result 行本体保留（lg-013，hidden 但行字段不丢，渲染器直读）。
    expect(tree[11]?.toolUseId).toBe("toolu_edit01");
    expect(tree[11]?.mergedToolResult).toContain("updated successfully");
    expect(tree[11]?.toolDurationMs).toBe(3000);
    expect(String(tree[12]?.log?.edit_patch)).toContain("oldStart");
    expect(tree[12]?.hidden).toBe(true);
  });

  it("差异 A 回修锚：子代理 tool_result（parent_tool_use_id）并进父 Task 卡而非自己的 Read 卡（两轨一致）", () => {
    const tree = renderTree(legacyRows);
    // Task 卡（lg-015）：子代理 Read 的 result（lg-019）经 parent_tool_use_id 配对
    // 并入 Task 卡 + 耗时预算（29s−23s=6000ms）——旧轨 D-007 梯级。
    expect(tree[13]?.hidden).toBe(true); // Task stdout 回显 hidden
    expect(tree[14]?.toolUseId).toBe("toolu_task01");
    expect(tree[14]?.mergedToolResult).toBe("17 * 23 = 391 (precomputed in notes)");
    expect(tree[14]?.toolDurationMs).toBe(6000);
    // 子代理 Read 卡（lg-018）：**不**收自己的 result（差异 A 修复前按 call_id
    // 会并到这里，与旧轨分叉）。
    expect(tree[16]?.hidden).toBe(true); // Read stdout 回显 hidden
    expect(tree[17]?.toolUseId).toBe("toolu_read01");
    expect(tree[17]?.mergedToolResult).toBeUndefined();
    expect(tree[17]?.toolDurationMs).toBeUndefined();
    expect(tree[17]?.hidden).toBe(false);
    // result 行（lg-019）hidden（已并入 Task 卡）
    expect(tree[18]?.hidden).toBe(true);
  });

  it("差异 A 回修锚（最小场景）：parent 归属优先于 call_id，与旧轨同卡", () => {
    // 独立于 fixture 的最小场景：Task 卡 + 子代理 Read 卡 + 子代理 result（行与
    // 事件都带 parent_tool_use_id）→ 两轨都并进 Task 卡。
    const tcTask = JSON.stringify({
      tool: "Task",
      args: { description: "Compute" },
      timestamp: "2026-09-03T10:00:00.000Z",
      status: "allowed",
      success: true,
      tool_use_id: "toolu_task01",
    });
    const tcRead = JSON.stringify({
      tool: "Read",
      args: { file_path: "<REDACTED>/NOTES.md" },
      timestamp: "2026-09-03T10:00:01.000Z",
      status: "allowed",
      success: true,
      tool_use_id: "toolu_read01",
    });
    const subAttr = { parent_tool_use_id: "toolu_task01", subagent_type: "general-purpose", depth: 1 };
    const useEvent = {
      type: "tool_use",
      tool_name: "Task",
      call_id: "toolu_task01",
      content: "{\"description\":\"Compute\"}",
      metadata: { tool_kind: "task" },
    };
    const legacy = [
      makeRow("tool_call", tcTask, "a1"),
      makeRow("tool_call", tcRead, "a2", subAttr),
      makeRow("stdout", "[TOOL_RESULT] sub result", "a3", subAttr),
    ];
    const structured = [
      { ...makeRow("tool_call", tcTask, "a1"), agent_event: useEvent },
      {
        ...makeRow("tool_call", tcRead, "a2", subAttr),
        agent_event: {
          type: "tool_use",
          tool_name: "Read",
          call_id: "toolu_read01",
          content: "{\"file_path\":\"<REDACTED>/NOTES.md\"}",
          metadata: { tool_kind: "read" },
          ...subAttr,
        },
      },
      {
        ...makeRow("stdout", "[TOOL_RESULT] sub result", "a3", subAttr),
        agent_event: { type: "tool_result", call_id: "toolu_read01", content: "sub result", ...subAttr },
      },
    ];
    const legacyTree = renderTree(legacy);
    const structuredTree = renderTree(structured);
    expect(structuredTree).toEqual(legacyTree);
    // 两轨都并进 Task 卡（a1），Read 卡（a2）不收 result。
    expect(legacyTree[0]?.mergedToolResult).toBe("sub result");
    expect(structuredTree[0]?.mergedToolResult).toBe("sub result");
    expect(legacyTree[1]?.mergedToolResult).toBeUndefined();
    expect(structuredTree[1]?.mergedToolResult).toBeUndefined();
  });

  it("差异 B 回修锚：text 行重置 thinking 合并指针——text 后 thinking 另起新块（两轨一致）", () => {
    // 旧轨：[ASSISTANT] 行（非 thinking-only stdout）重置 lastThinkingIdx → 后继
    // [THINKING] 另起新块。修复前结构化轨 text 分支保留 thinking 指针 → 会把后继
    // thinking 并入前块（分叉）。修复后两轨一致。
    const legacy = [
      makeRow("stdout", "[THINKING] 块1", "b1"),
      makeRow("stdout", "[ASSISTANT] 文本", "b2"),
      makeRow("stdout", "[THINKING] 块2", "b3"),
    ];
    const structured = [
      { ...makeRow("stdout", "[THINKING] 块1", "b1"), agent_event: { type: "thinking", content: "块1" } },
      { ...makeRow("stdout", "[ASSISTANT] 文本", "b2"), agent_event: { type: "text", content: "文本" } },
      { ...makeRow("stdout", "[THINKING] 块2", "b3"), agent_event: { type: "thinking", content: "块2" } },
    ];
    const legacyTree = renderTree(legacy);
    const structuredTree = renderTree(structured);
    expect(structuredTree).toEqual(legacyTree);
    // 后继 thinking 另起新块（未并入块1）
    expect(legacyTree[0]?.mergedThinkingContent).toBe("块1");
    expect(legacyTree[2]?.mergedThinkingContent).toBe("块2");
    expect(structuredTree[2]?.mergedThinkingContent).toBe("块2");
    // 三块全可见
    expect(legacyTree.filter((b) => !b.hidden)).toHaveLength(3);
    expect(structuredTree.filter((b) => !b.hidden)).toHaveLength(3);
  });

  it("深功能锚：子代理归属行不降级（parent_tool_use_id/subagent_type/depth 保留）", () => {
    const tree = renderTree(legacyRows);
    const subThinking = tree[15];
    expect(subThinking?.hidden).toBe(false);
    expect(subThinking?.mergedThinkingContent).toBe("这是一道简单乘法，先读项目笔记再作答。");
    expect(subThinking?.log?.parent_tool_use_id).toBe("toolu_task01");
    expect(subThinking?.log?.subagent_type).toBe("general-purpose");
    expect(subThinking?.log?.depth).toBe(1);
    const subText = tree[19];
    expect(subText?.hidden).toBe(false);
    expect(subText?.mergedAssistantContent).toBe("17 × 23 = 391");
    expect(subText?.log?.depth).toBe(1);
    // 子代理 Read 卡也带归属三列（工具卡归属渲染）
    expect(tree[17]?.log?.parent_tool_use_id).toBe("toolu_task01");
    expect(tree[17]?.log?.depth).toBe(1);
  });

  it("深功能锚：turn result 行防御性映射为 result 块（[RESULT 前缀 ↔ turn_result 事件等价）", () => {
    const tree = renderTree(legacyRows);
    expect(tree[20]?.semanticCategory).toBe("result");
    expect(tree[20]?.hidden).toBe(false);
  });
});
