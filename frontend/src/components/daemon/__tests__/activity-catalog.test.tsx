// ql-20260826-010：ActivityCatalog（后台活动目录）单测。
//
// 覆盖：
//   1. 全空（无 bash / 无后台任务 / 无 mission）→ 整体不渲染；
//   2. 有内容 → 触发按钮带计数；默认收起（三类卡片不渲染——不占会话窗口）；
//   3. 点击展开 → bash 卡 / 后台任务卡 / 团队任务块三类渲染；
//   4. Escape 收起；
//   5. 运行中（bash running）→ 触发按钮带脉冲点 + aria-label 提示。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ActivityCatalog,
  type AgentTaskEntry,
  type ActivityBashProgress,
} from "../activity-catalog";
import type { TeamMissionSummary } from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const noop = () => {};

const BASH_RUNNING: ActivityBashProgress = {
  command: "pnpm test",
  status: "running",
  exitCode: null,
  elapsedMs: 1200,
  chunks: [{ channel: "stdout", content: "ok", is_final: false }],
};

const TASK_RUNNING: AgentTaskEntry = {
  taskId: "t-1",
  taskName: "跑回归",
  status: "running",
  progress: 40,
  message: null,
};

function makeMission(): TeamMissionSummary {
  return {
    mission_id: "m-1",
    status: "running",
    objective: "目标-m1",
    scope_workspace_ids: [],
    budget_usd: null,
    workers: [],
  };
}

describe("ActivityCatalog（后台活动目录，ql-20260826-010）", () => {
  it("全空 → 整体不渲染", () => {
    const { container } = render(
      <ActivityCatalog
        bashProgress={null}
        agentTasks={[]}
        missions={[]}
        onRefreshMissions={noop}
        onOpenWorkerSession={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("有内容 → 默认收起；点击展开三类卡片；计数徽标正确", () => {
    render(
      <ActivityCatalog
        bashProgress={BASH_RUNNING}
        agentTasks={[TASK_RUNNING]}
        missions={[makeMission()]}
        onRefreshMissions={noop}
        onOpenWorkerSession={noop}
      />,
    );

    // 触发按钮计数 = bash 1 + 后台任务 1 + 团队任务 1。
    const trigger = screen.getByRole("button", {
      name: /^后台任务目录，共 3 项，有运行中$/,
    });
    // 默认收起：三类卡片均不渲染（不挤占会话窗口）。
    expect(screen.queryByTestId("bash-progress-card")).toBeNull();
    expect(screen.queryByTestId("agent-task-card")).toBeNull();
    expect(screen.queryByLabelText("团队任务")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByTestId("bash-progress-card")).toBeInTheDocument();
    expect(screen.getByTestId("agent-task-card")).toBeInTheDocument();
    expect(screen.getByLabelText("团队任务")).toBeInTheDocument();
  });

  it("Escape 收起下拉", () => {
    render(
      <ActivityCatalog
        bashProgress={BASH_RUNNING}
        agentTasks={[]}
        missions={[]}
        onRefreshMissions={noop}
        onOpenWorkerSession={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^后台任务目录/ }));
    expect(screen.getByTestId("bash-progress-card")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("bash-progress-card")).toBeNull();
  });

  it("containment 收起（ql-20260826-014）：目录内点击不收起，外部 mousedown 才收起", () => {
    render(
      <ActivityCatalog
        bashProgress={null}
        agentTasks={[]}
        missions={[makeMission()]}
        onRefreshMissions={noop}
        onOpenWorkerSession={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^后台任务目录/ }));
    const block = screen.getByLabelText("团队任务");
    expect(block).toBeInTheDocument();

    // 目录内点击团队块（含其展开行——真实事件序列 mousedown+click 落点都在
    // 目录内）→ 不收起。
    fireEvent.mouseDown(block);
    fireEvent.click(block);
    expect(screen.getByLabelText("团队任务")).toBeInTheDocument();

    // 外部 mousedown（落点在目录根容器外）→ 收起。
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("团队任务")).toBeNull();
  });

  it("bash completed（无运行项）→ aria-label 不带「有运行中」", () => {
    render(
      <ActivityCatalog
        bashProgress={{ ...BASH_RUNNING, status: "completed", exitCode: 0 }}
        agentTasks={[]}
        missions={[]}
        onRefreshMissions={noop}
        onOpenWorkerSession={noop}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^后台任务目录，共 1 项$/ }),
    ).toBeInTheDocument();
  });
});
