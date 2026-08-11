import { render, screen } from "@testing-library/react";

import {
  ChangeReviewHistoryCard,
  normalizeReviewHistory,
} from "@/components/changes/detail/change-review-history-card";

describe("normalizeReviewHistory", () => {
  it("非数组返回空", () => {
    expect(normalizeReviewHistory(undefined)).toEqual([]);
    expect(normalizeReviewHistory(null)).toEqual([]);
    expect(normalizeReviewHistory({})).toEqual([]);
  });

  it("gate 形状按 decision 映射中文标签与 tone", () => {
    const items = normalizeReviewHistory([
      { decision: "approve", submitted_at: "2026-08-11T01:00:00Z" },
      { decision: "bug", submitted_at: "2026-08-11T02:00:00Z" },
      { decision: "revise", submitted_at: "2026-08-11T03:00:00Z" },
    ]);
    expect(items).toHaveLength(3);
    const byDecision = Object.fromEntries(items.map((i) => [i.label, i.tone]));
    expect(byDecision["确认通过"]).toBe("success");
    expect(byDecision["发现 BUG"]).toBe("danger");
    expect(byDecision["需要修改"]).toBe("warning");
    items.forEach((i) => expect(i.kind).toBe("gate"));
  });

  it("rerun 异构形状（有 action 无 decision）归一化为重跑中性条目", () => {
    const items = normalizeReviewHistory([
      { action: "rerun", stage: "brainstorm", comment: "返工", at: "2026-08-11T01:00:00Z" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("rerun");
    expect(items[0]?.label).toBe("重跑 brainstorm");
    expect(items[0]?.tone).toBe("neutral");
    expect(items[0]?.comment).toBe("返工");
    expect(items[0]?.at).toBe("2026-08-11T01:00:00Z");
    expect(items[0]?.fromStage).toBe("brainstorm");
  });

  it("gate 与 rerun 混合并按时间倒序（at 缺失置底）", () => {
    const items = normalizeReviewHistory([
      { decision: "approve", submitted_at: "2026-08-11T01:00:00Z" },
      { action: "rerun", stage: "plan", at: "2026-08-11T03:00:00Z" },
      { decision: "bug", submitted_at: "2026-08-11T02:00:00Z" },
      { decision: "approve" }, // 无 submitted_at → 置底
    ]);
    expect(items.map((i) => i.at)).toEqual([
      "2026-08-11T03:00:00Z",
      "2026-08-11T02:00:00Z",
      "2026-08-11T01:00:00Z",
      null,
    ]);
  });

  it("未知 decision 兜底显示原文中性 tone", () => {
    const items = normalizeReviewHistory([
      { decision: "weird_decision", submitted_at: "2026-08-11T01:00:00Z" },
    ]);
    expect(items[0]?.label).toBe("weird_decision");
    expect(items[0]?.tone).toBe("neutral");
  });

  it("字段缺失宽容兜底不崩", () => {
    const items = normalizeReviewHistory([{}, null, { decision: "approve" }]);
    expect(items).toHaveLength(3);
  });
});

describe("ChangeReviewHistoryCard", () => {
  it("空数组显示空态", () => {
    render(<ChangeReviewHistoryCard reviewHistory={[]} />);
    expect(screen.getByText("暂无审核历史。")).toBeInTheDocument();
  });

  it("渲染审核条目（标签 + 时间 + 意见）", () => {
    render(
      <ChangeReviewHistoryCard
        reviewHistory={[
          {
            kind: "gate",
            label: "确认通过",
            tone: "success",
            comment: "需求清晰",
            at: "2026-08-11T01:00:00Z",
            fromStage: "brainstorm",
          },
        ]}
      />,
    );
    expect(screen.getByText("确认通过")).toBeInTheDocument();
    expect(screen.getByText("需求清晰")).toBeInTheDocument();
    expect(screen.getByText(/brainstorm/)).toBeInTheDocument();
  });
});
