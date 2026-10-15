// 2026-10-15-change-detail-redesign / task-05（FR-10 / D-014@v1 / D-016@v1）：
// 任务进度清单测试——勾选比、三态时刻（checked/unchecked/broken）、提交锚、
// 空清单不渲染、断链 MUST NOT 显示裸问号。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangeTaskChecklist } from "@/components/changes/detail/change-task-checklist";
import { inferTaskTimeStatus } from "@/components/changes/detail/merge-change-timeline";
import type { TimelineTask } from "@/components/changes/detail/merge-change-timeline";

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return { id: "task-01", checked: true, desc: "描述", commit_sha: null, time: null, ...over };
}

describe("ChangeTaskChecklist", () => {
  it("勾选比：卡头与脚注显示 checked/total", () => {
    render(
      <ChangeTaskChecklist
        tasks={[
          task({ id: "task-01", checked: true }),
          task({ id: "task-02", checked: false }),
          task({ id: "task-03", checked: true }),
        ]}
        timeStatus={[
          { status: "checked", at: "2026-10-16T01:00:00Z" },
          { status: "unchecked", at: null },
          { status: "checked", at: "2026-10-16T02:00:00Z" },
        ]}
      />,
    );
    expect(screen.getByText(/勾选 2\/3 · 勾选时间 ≈ 为推断值/)).toBeInTheDocument();
  });

  it("三态时刻渲染：checked → ≈时刻、unchecked → 空、broken → 断链文案（非裸问号）", () => {
    render(
      <ChangeTaskChecklist
        tasks={[
          task({ id: "task-01", checked: true, time: "2026-10-16T01:30:00Z" }),
          task({ id: "task-02", checked: false, time: null }),
          task({ id: "task-03", checked: true, time: null }),
        ]}
        timeStatus={[
          { status: "checked", at: "2026-10-16T01:30:00Z" },
          { status: "unchecked", at: null },
          { status: "broken", at: null },
        ]}
      />,
    );
    expect(screen.getByText(/^≈\d{2}-\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText("时刻不可推断（观测断链）")).toBeInTheDocument();
    expect(screen.queryByText("?")).not.toBeInTheDocument();
    expect(screen.queryByText("？")).not.toBeInTheDocument();
  });

  it("真实链路：inferTaskTimeStatus 输出直接驱动三态（断链起点之后的勾选任务标 broken）", () => {
    const tasks = [
      task({ id: "task-01", checked: true, time: "2026-10-16T01:00:00Z" }),
      task({ id: "task-02", checked: true, time: null }),
    ];
    const status = inferTaskTimeStatus(tasks, [
      {
        ts: "2026-10-16T01:00:00Z",
        kind: "task-done",
        label: "tasks · checked 0→1",
        rule: "",
        severity: "info",
        provisional: true,
        commit_title: null,
      },
      {
        ts: "2026-10-16T02:00:00Z",
        kind: "task-done",
        label: "tasks · checked 3→4", // 游标断裂（1 → 3）
        rule: "",
        severity: "info",
        provisional: true,
        commit_title: null,
      },
    ]);
    render(<ChangeTaskChecklist tasks={tasks} timeStatus={status} />);
    expect(screen.getByText(/^≈\d{2}-\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText("时刻不可推断（观测断链）")).toBeInTheDocument();
  });

  it("提交锚渲染为等宽短哈希；无锚不占位", () => {
    const { container } = render(
      <ChangeTaskChecklist
        tasks={[task({ id: "task-06", commit_sha: "a1b2c3d" }), task({ id: "task-07" })]}
        timeStatus={[
          { status: "checked", at: "2026-10-16T01:00:00Z" },
          { status: "unchecked", at: null },
        ]}
      />,
    );
    expect(screen.getByText("a1b2c3d")).toBeInTheDocument();
    expect(container.querySelectorAll(".font-mono.text-\\[11px\\].text-brand-600")).toHaveLength(1);
  });

  it("空清单整卡不渲染", () => {
    const { container } = render(<ChangeTaskChecklist tasks={[]} timeStatus={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
