/**
 * ChangeProgressRow 测试（2026-10-26-session-change-progress-hover task-08）。
 * 覆盖：双分支主路径 / 异常态映射（D-002）/ 升厚切换（D-007）/ 分流标注（D-006）/
 * 三分降级（FR-07）/ 盲区 #1 #2 #8 #9 #10（plan Review Focus）。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ChangeProgressRow,
  formatDurationSeconds,
  type ChangeSummaryWithProgress,
} from "@/components/daemon/change-progress-row";

function makeChange(over: Partial<ChangeSummaryWithProgress>): ChangeSummaryWithProgress {
  return {
    change_key: "2026-10-26-demo",
    is_thin: false,
    updated_at: "2026-10-26T12:00:00Z",
    change_type: "feature",
    ...over,
  } as ChangeSummaryWithProgress;
}

const stageEntry = (stage: string, status: string, extra = {}) => ({
  stage,
  status,
  steps_total: 4,
  steps_completed: 0,
  started_at: null,
  completed_at: null,
  duration_seconds: null,
  revision: null,
  ...extra,
});

describe("全量支（FR-01/FR-02）", () => {
  it("主路径：完成打勾 / 进行中占比 / pending 空圈 / execute 任务 n/m / 耗时文案", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          stage_progress: [
            stageEntry("brainstorm", "completed", { steps_completed: 8, duration_seconds: 1920 }),
            stageEntry("plan", "in-progress", { steps_completed: 2, duration_seconds: 3600 }),
            stageEntry("execute", "in-progress", { steps_completed: 1 }),
            stageEntry("verify", "pending"),
            stageEntry("archive", "pending"),
          ],
          task_progress: { total: 12, done: 8 },
        })}
      />,
    );
    expect(screen.getByTestId("change-progress-row").dataset.variant).toBe("full");
    // brainstorm 完成打勾；plan 圈带 2/4 占比锚；execute 旁任务计数
    expect(screen.getByTestId("progress-circle-brainstorm").textContent).toBe("✓");
    expect(screen.getByTestId("progress-circle-plan").dataset.progress).toBe("2/4");
    expect(screen.getByTestId("progress-task-count").textContent).toBe("8/12 任务");
    expect(screen.getByTestId("progress-duration-brainstorm").textContent).toBe("32分");
    expect(screen.getByTestId("progress-duration-plan").textContent).toBe("1.0时");
  });

  it("异常态映射（D-002）：waiting/revising=warning 文案、failed=error 文案，revising 带 revision", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          stage_progress: [
            stageEntry("brainstorm", "completed"),
            stageEntry("plan", "completed"),
            stageEntry("execute", "waiting"),
            stageEntry("verify", "revising", { revision: 2 }),
            stageEntry("archive", "failed"),
          ],
        })}
      />,
    );
    expect(screen.getByTestId("progress-status-execute").textContent).toBe("等待中");
    expect(screen.getByTestId("progress-status-verify").textContent).toBe("修订2");
    expect(screen.getByTestId("progress-status-archive").textContent).toBe("失败");
  });

  it("盲区#1：阶段行在而 steps 空（steps_total=0）→ 占比锚为 0 不除零", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          stage_progress: [stageEntry("brainstorm", "in-progress", { steps_total: 0, steps_completed: 0 })],
        })}
      />,
    );
    expect(screen.getByTestId("progress-circle-brainstorm").dataset.progress).toBe("0");
  });

  it("盲区#2：task_progress.total=0（全 cancelled）→ 任务位显 —", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          stage_progress: [stageEntry("execute", "in-progress")],
          task_progress: { total: 0, done: 0 },
        })}
      />,
    );
    expect(screen.getByTestId("progress-task-count").textContent).toBe("—");
  });

  it("盲区#10：未知 stage 状态新枚举 → 灰圈 + 原值文字，不崩", () => {
    render(
      <ChangeProgressRow
        change={makeChange({ stage_progress: [stageEntry("plan", "quarantined")] })}
      />,
    );
    expect(screen.getByTestId("progress-circle-plan").dataset.unknown).toBe("quarantined");
    expect(screen.getByTestId("progress-status-plan").textContent).toBe("quarantined");
  });
});

describe("轻量支（FR-03/FR-04）", () => {
  const thin = (over = {}) => ({
    phase: "executing",
    approved: true,
    autopilot: false,
    tasks_total: 12,
    tasks_done: 4,
    substeps_done: 0,
    substeps_total: 8,
    upgraded: false,
    adopted_from: null,
    ...over,
  });

  it("主路径：executing 相位高亮 + 已批准徽标 + 任务 n/m + 总时长", () => {
    render(
      <ChangeProgressRow
        change={makeChange({ is_thin: true, thin_flow: thin() })}
        createdAt="2026-10-26T09:00:00Z"
      />,
    );
    const row = screen.getByTestId("change-progress-row");
    expect(row.dataset.variant).toBe("thin");
    expect(screen.getByTestId("progress-thin-phase-executing").className).toContain("font-semibold");
    expect(screen.getByTestId("progress-thin-approval").textContent).toBe("已批准");
    expect(screen.getByTestId("progress-thin-tasks").textContent).toBe("任务 4/12");
    expect(screen.getByTestId("progress-thin-duration").textContent).toBe("总时长 3.0时");
  });

  it("awaiting_approval 子态：①位高亮带待批准字样 + 未批准徽标", () => {
    render(
      <ChangeProgressRow
        change={makeChange({ is_thin: true, thin_flow: thin({ phase: "awaiting_approval", approved: false }) })}
      />,
    );
    expect(screen.getByTestId("progress-thin-phase-spec").textContent).toContain("待批准");
    expect(screen.getByTestId("progress-thin-approval").textContent).toBe("未批准");
  });

  it("closing 相位：③高亮 + 子步 n/8；盲区#8 executing 且 tasks_total=0 不显任务", () => {
    const { rerender } = render(
      <ChangeProgressRow
        change={makeChange({
          is_thin: true,
          thin_flow: thin({ phase: "executing", tasks_total: 0, tasks_done: 0 }),
        })}
      />,
    );
    expect(screen.queryByTestId("progress-thin-tasks")).toBeNull();
    rerender(
      <ChangeProgressRow
        change={makeChange({ is_thin: true, thin_flow: thin({ phase: "closing", substeps_done: 5 }) })}
      />,
    );
    expect(screen.getByTestId("progress-thin-phase-closing").className).toContain("font-semibold");
    expect(screen.getByTestId("progress-thin-substeps").textContent).toBe("子步 5/8");
  });

  it("盲区#9 升厚（D-007）：upgraded=true → 走全量支 + 已升厚标注，忽略 thin 相位", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          is_thin: true,
          thin_flow: thin({ upgraded: true, phase: "closing", substeps_done: 7 }),
          stage_progress: [stageEntry("brainstorm", "completed"), stageEntry("plan", "in-progress")],
        })}
      />,
    );
    expect(screen.getByTestId("change-progress-row").dataset.variant).toBe("full");
    expect(screen.getByTestId("progress-upgraded-tag").textContent).toBe("已升厚→走全量");
    expect(screen.queryByTestId("progress-thin-substeps")).toBeNull();
  });

  it("分流标注（D-006）：adopted_from=brainstorm → 自头脑风暴转入小字", () => {
    render(
      <ChangeProgressRow
        change={makeChange({ is_thin: true, thin_flow: thin({ adopted_from: "brainstorm" }) })}
      />,
    );
    expect(screen.getByTestId("progress-thin-adopted").textContent).toBe("自头脑风暴转入");
  });

  it("change_type=quick 存量出身独立判 thin 场景 → 强制全量支", () => {
    render(
      <ChangeProgressRow
        change={makeChange({
          is_thin: true,
          change_type: "quick",
          thin_flow: thin(),
          stage_progress: [stageEntry("brainstorm", "in-progress")],
        })}
      />,
    );
    expect(screen.getByTestId("change-progress-row").dataset.variant).toBe("full");
  });
});

describe("降级（FR-07）", () => {
  it("盲区#5：is_thin=true 但 thin_flow 缺失（旧 daemon）→ 不渲染", () => {
    const { container } = render(<ChangeProgressRow change={makeChange({ is_thin: true })} />);
    expect(container.firstChild).toBeNull();
  });

  it("全量支 stage_progress 缺失/空数组 → 不渲染", () => {
    const { container } = render(<ChangeProgressRow change={makeChange({})} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(
      <ChangeProgressRow change={makeChange({ stage_progress: [] })} />,
    );
    expect(c2.firstChild).toBeNull();
  });
});

describe("formatDurationSeconds", () => {
  it("秒/分/时自适应与畸形输入", () => {
    expect(formatDurationSeconds(45)).toBe("45秒");
    expect(formatDurationSeconds(1920)).toBe("32分");
    expect(formatDurationSeconds(3600)).toBe("1.0时");
    expect(formatDurationSeconds(null)).toBe("");
    expect(formatDurationSeconds(-1)).toBe("");
  });
});
