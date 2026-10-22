// 2026-10-20-session-awaiting-answer-status：行首状态指示器「等待你回答」问号
// 形态单测——agent 提问（SessionDialogRequest pending）期间 run 仍 running，
// 左栏必须显示问号而非转圈，让用户看出交互停在自己身上。
//
// 覆盖：
//   1. pending_dialog_kind 非空 + run running → question（压过转圈）；
//   2. 终态权威优先：ended/failed 即使残留 pending_dialog_kind 也走绿点/红点；
//   3. 回答后（kind=None）run 仍 running → 回归转圈；
//   4. None 时既有五分类零回归（pending_approval 琥珀 / running 转圈 /
//      working 转圈 / blocked 琥珀 / reconnecting 转圈 / idle+unread 绿点 /
//      全无信号留白）。
import { describe, it, expect } from "vitest";

import { sessionStatusIndicator } from "../session-list-panel";

describe("sessionStatusIndicator 等待回答问号（2026-10-20-session-awaiting-answer-status）", () => {
  it("pending_dialog_kind 非空 + run running → 问号「等待你回答」（压过转圈）", () => {
    const ind = sessionStatusIndicator(
      "active",
      "working",
      false,
      "running",
      "AskUserQuestion",
    );
    expect(ind).toEqual({ kind: "question", label: "等待你回答" });
  });

  it("终态 ended 权威优先：残留 pending_dialog_kind 仍显示绿点", () => {
    const ind = sessionStatusIndicator("ended", "idle", false, null, "AskUserQuestion");
    expect(ind).toEqual({ kind: "dot", cls: "bg-success", label: "执行完成" });
  });

  it("终态 failed 权威优先：残留 pending_dialog_kind 仍显示红点", () => {
    const ind = sessionStatusIndicator("failed", "blocked", false, null, "AskUserQuestion");
    expect(ind).toEqual({ kind: "dot", cls: "bg-destructive", label: "异常失败" });
  });

  it("回答后 kind=None + run 仍 running → 回归转圈「正在执行」", () => {
    const ind = sessionStatusIndicator("active", "working", false, "running", null);
    expect(ind).toEqual({ kind: "spinner", label: "正在执行" });
  });

  it("零回归：None 时既有分类逐一不变", () => {
    // run 等审批 → 琥珀
    expect(sessionStatusIndicator("active", "working", false, "pending_approval", null)).toEqual(
      { kind: "dot", cls: "bg-warning-500", label: "在等你" },
    );
    // run pending/running → 转圈
    expect(sessionStatusIndicator("active", null, false, "pending", null)).toEqual({
      kind: "spinner",
      label: "正在执行",
    });
    // 活性兜底 working → 转圈
    expect(sessionStatusIndicator("active", "working", false, null, undefined)).toEqual({
      kind: "spinner",
      label: "正在执行",
    });
    // 活性 blocked → 琥珀
    expect(sessionStatusIndicator("active", "blocked", false, null, undefined)).toEqual({
      kind: "dot",
      cls: "bg-warning-500",
      label: "在等你",
    });
    // reconnecting → 转圈
    expect(sessionStatusIndicator("reconnecting", null, false, null, null)).toEqual({
      kind: "spinner",
      label: "恢复中",
    });
    // idle + 完成未读 → 绿点
    expect(sessionStatusIndicator("active", "idle", true, null, null)).toEqual({
      kind: "dot",
      cls: "bg-success",
      label: "执行完成",
    });
    // 全无信号 → 留白
    expect(sessionStatusIndicator("active", "idle", false, null, null)).toBeNull();
  });
});
