/**
 * task-01（2026-10-14-session-turn-preview-cards / FR-01 / FR-04 / D-004@v1）：
 * mergePreviewIntoDisplayTurns 归并纯函数单测——轮序 / 原位替换无双块 / 孤儿 /
 * 降级 / preview 缺省五组语义。
 */
import { describe, expect, it } from "vitest";

import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import {
  mergePreviewIntoDisplayTurns,
  previewTurnStatusOf,
} from "@/components/daemon/session-panel/preview-merge";
import type { SessionTurnOutlineItem, SessionTurnOutlineRead } from "@/lib/daemon";

function outlineItem(over: Partial<SessionTurnOutlineItem> & { run_id: string; seq: number }): SessionTurnOutlineItem {
  return {
    created_at: "2026-10-08T10:00:00Z",
    status: "completed",
    ...over,
  } as SessionTurnOutlineItem;
}

function outline(items: SessionTurnOutlineItem[]): SessionTurnOutlineRead {
  return { session_id: "s1", total_turns: items.length, items } as SessionTurnOutlineRead;
}

function turn(over: Partial<SessionTurnView> & { runId: string }): SessionTurnView {
  return {
    turn: null,
    prompt: "",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    errorDetail: null,
    ...over,
  };
}

describe("mergePreviewIntoDisplayTurns 降级", () => {
  it("outline 为 null 原样返回同一引用", () => {
    const turns = [turn({ runId: "a", prompt: "hi" })];
    expect(mergePreviewIntoDisplayTurns(null, turns)).toBe(turns);
  });

  it("outline items 为空原样返回同一引用", () => {
    const turns = [turn({ runId: "a", prompt: "hi" })];
    expect(mergePreviewIntoDisplayTurns(outline([]), turns)).toBe(turns);
  });
});

describe("mergePreviewIntoDisplayTurns 轮序与预览条目", () => {
  it("全部未加载：条目数=大纲轮数，按 seq 定序，预览条目带摘要且正文为空", () => {
    const ol = outline([
      outlineItem({ run_id: "b", seq: 2, prompt_summary: "第二条提问", answer_summary: "第二条答复" }),
      outlineItem({ run_id: "a", seq: 1, prompt_summary: "第一条提问" }),
    ]);
    const merged = mergePreviewIntoDisplayTurns(ol, []);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.runId).toBe("a");
    expect(merged[0]!.turn).toBe(1);
    expect(merged[0]!.preview?.promptSummary).toBe("第一条提问");
    expect(merged[0]!.preview?.answerSummary).toBeUndefined();
    expect(merged[1]!.runId).toBe("b");
    expect(merged[1]!.preview?.answerSummary).toBe("第二条答复");
    expect(merged[1]!.prompt).toBe("");
    expect(merged[1]!.output).toBe("");
  });

  it("已加载真实轮落在大纲 seq 位置（轮号盖章 defect-fixes：null→seq 产生新引用）", () => {
    const loaded = turn({ runId: "a", prompt: "用户消息", output: "agent 答复" });
    const ol = outline([
      outlineItem({ run_id: "a", seq: 1, prompt_summary: "大纲摘要（应被真实轮取代）" }),
      outlineItem({ run_id: "b", seq: 2 }),
    ]);
    const merged = mergePreviewIntoDisplayTurns(ol, [loaded]);
    // turn: null → 盖章为 seq 1（新引用）；同 seq 重复派生保持同引用（盖章缓存）。
    expect(merged[0]!.turn).toBe(1);
    expect(mergePreviewIntoDisplayTurns(ol, [loaded])[0]).toBe(merged[0]);
    expect(merged[1]!.preview).toBeDefined();
  });
});

describe("mergePreviewIntoDisplayTurns 原位替换与孤儿", () => {
  it("孤儿空块（静默配置行）命中大纲 → 被预览条目原位替换，无双块", () => {
    const orphan = turn({
      runId: "__attach_history_7__",
      realRunId: "a",
      whoLine: { profileName: null, agentName: "X", providerName: null },
      replyAt: "2026-10-08T10:00:00Z",
    });
    const ol = outline([
      outlineItem({ run_id: "a", seq: 1, prompt_summary: "摘要" }),
    ]);
    const merged = mergePreviewIntoDisplayTurns(ol, [orphan]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.preview).toBeDefined();
    expect(merged[0]!.realRunId).toBe("a");
  });

  it("大纲外有内容轮尾部追加（实时新轮）", () => {
    const live = turn({ runId: "live", prompt: "新消息", status: "running" });
    const ol = outline([outlineItem({ run_id: "a", seq: 1 })]);
    const merged = mergePreviewIntoDisplayTurns(ol, [live]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.preview).toBeDefined();
    expect(merged[1]).toBe(live);
  });

  it("大纲外孤儿空块原样保留（降级保守，不吞 enrich 窗口语义）", () => {
    const orphan = turn({
      runId: "orphan-x",
      whoLine: { profileName: null, agentName: "X", providerName: null },
    });
    const ol = outline([outlineItem({ run_id: "a", seq: 1 })]);
    const merged = mergePreviewIntoDisplayTurns(ol, [orphan]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toBe(orphan);
  });
});

describe("mergePreviewIntoDisplayTurns 实质内容判定", () => {
  it("活跃轮（running 无内容）保留，不被预览卡取代（盖章对齐 seq）", () => {
    const running = turn({ runId: "a", status: "running" });
    const ol = outline([outlineItem({ run_id: "a", seq: 1 })]);
    const merged = mergePreviewIntoDisplayTurns(ol, [running]);
    // defect-fixes：轮号盖章后非原引用（null→1），但「保留不替换」语义以内容判定。
    expect(merged[0]!.status).toBe("running");
    expect(merged[0]!.preview).toBeUndefined();
    expect(merged[0]!.turn).toBe(1);
  });

  it("失败轮（errorDetail 非空无 output）保留（盖章对齐 seq）", () => {
    const failed = turn({
      runId: "a",
      status: "failed",
      errorDetail: { type: "unknown", code: null, message: "x", retryable: false, hint: null, raw: null },
    });
    const ol = outline([outlineItem({ run_id: "a", seq: 1, status: "failed" })]);
    const merged = mergePreviewIntoDisplayTurns(ol, [failed]);
    expect(merged[0]!.errorDetail).toBeTruthy();
    expect(merged[0]!.preview).toBeUndefined();
    expect(merged[0]!.turn).toBe(1);
  });

  it("重入安全：已带 preview 的条目继续按大纲对齐不重复包皮", () => {
    const prev = mergePreviewIntoDisplayTurns(
      outline([outlineItem({ run_id: "a", seq: 1, prompt_summary: "s" })]),
      [],
    );
    const merged = mergePreviewIntoDisplayTurns(
      outline([outlineItem({ run_id: "a", seq: 1, prompt_summary: "s" })]),
      prev,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.preview?.promptSummary).toBe("s");
  });
});

describe("mergePreviewIntoDisplayTurns 轮号盖章（2026-10-14-session-preview-defect-fixes）", () => {
  it("已加载块轮号与大纲 seq 不一致时盖章为 seq（logsToTurns 批次局部编号对齐权威轮序）", () => {
    // 初始窗口末块批次局部编号 12，大纲权威 seq 3 → 盖成 3（RoundDivider 轮号修复）。
    const loaded = turn({ runId: "a", turn: 12, prompt: "用户消息", output: "答复" });
    const ol = outline([outlineItem({ run_id: "a", seq: 3 })]);
    const merged = mergePreviewIntoDisplayTurns(ol, [loaded]);
    expect(merged[0]!.turn).toBe(3);
    expect(merged[0]).not.toBe(loaded); // 盖章产生新引用
  });

  it("盖章引用稳定：同输入重复派生保持同引用（不击穿 TurnRow memo）", () => {
    const loaded = turn({ runId: "a", turn: 1, prompt: "用户消息", output: "答复" });
    const ol = outline([outlineItem({ run_id: "a", seq: 7 })]);
    const m1 = mergePreviewIntoDisplayTurns(ol, [loaded]);
    const m2 = mergePreviewIntoDisplayTurns(ol, [loaded]);
    expect(m2[0]).toBe(m1[0]);
  });

  it("轮号已一致时透传原引用（零克隆）", () => {
    const ok = turn({ runId: "z", turn: 5, prompt: "x", output: "y" });
    const ol = outline([outlineItem({ run_id: "z", seq: 5 })]);
    expect(mergePreviewIntoDisplayTurns(ol, [ok])[0]).toBe(ok);
  });
});

describe("previewTurnStatusOf", () => {
  it("词表映射：completed/finished→completed，failed→failed，运行族→running，中止族→killed，未知→pending", () => {
    expect(previewTurnStatusOf("completed")).toBe("completed");
    expect(previewTurnStatusOf("finished")).toBe("completed");
    expect(previewTurnStatusOf("failed")).toBe("failed");
    expect(previewTurnStatusOf("running")).toBe("running");
    expect(previewTurnStatusOf("pending_approval")).toBe("running");
    expect(previewTurnStatusOf("killed")).toBe("killed");
    expect(previewTurnStatusOf("stopped")).toBe("killed");
    expect(previewTurnStatusOf("cancelled")).toBe("killed");
    expect(previewTurnStatusOf(null)).toBe("pending");
    expect(previewTurnStatusOf("whatever")).toBe("pending");
  });
});
