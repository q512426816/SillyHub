// tests/components/__tests__/mission-console.test.tsx
// task-10 重写（2026-07-14-missions-page-redesign）：对齐重设计后的组件。
//
// 依据：
//   - plan.md task-01/02/03/04/05/06/07/08/09/10 + design.md §4/5/6/7
//   - decisions.md D-001~008@v1（固定 team / 高级默认折叠 / 总览卡+AI结论 / 藏黑话 / 折叠）
//
// 覆盖：
//   - 固定 team：无 single/team 选择卡片；启动按钮文案「启动」
//   - 高级默认折叠（details open=false）；展开后主控配置+分身列表可见，添加分身生效
//   - submit 固定 mode="team" + main_agent_config(默认) + worker_preset(默认[])
//   - 详情总览卡：中文状态（不露英文 status）+ 成败统计（排除主控）+ AI 最终结论(summary)
//   - 分工目标默认折叠（全文不直接露出）
//   - 藏黑话：UI 不出现 Coordinator/Worker/daemon 英文术语

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { Mission } from "@/lib/agent";

const hoisted = vi.hoisted(() => {
  return {
    createMissionMock: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  };
});

vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    createMission: hoisted.createMissionMock,
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {} }),
}));

import { MissionConsole } from "@/components/mission-console";

const FAKE_MISSION: Mission = {
  id: "miss-1",
  workspace_id: "ws-1",
  change_id: null,
  objective: "test",
  status: "planning",
  budget_usd: null,
  cost_so_far: 0,
  constraints: null,
  cancelled_at: null,
  created_at: "2026-07-12T00:00:00Z",
  workers: [],
};

function mockCreateResolve(m: Mission = FAKE_MISSION) {
  hoisted.createMissionMock.mockResolvedValue(m);
}

/** 工具：拿到「高级」details 的 open 状态。 */
function advancedDetailsOpen(): boolean {
  const summary = screen.queryByText(/高级：手动配分身/);
  const details = summary?.closest("details") ?? null;
  return details?.open ?? false;
}

describe("MissionConsole 重设计（2026-07-14-missions-page-redesign）", () => {
  beforeEach(() => {
    cleanup();
    hoisted.createMissionMock.mockReset();
    mockCreateResolve();
  });

  it("固定 team：无 single/team 选择卡片，启动按钮文案「启动」", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    expect(screen.queryByRole("button", { name: "模式 team" })).toBeNull();
    expect(screen.queryByRole("button", { name: "模式 single" })).toBeNull();
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy();
  });

  it("输入框 placeholder 为人话（无代码路径）", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    const ta = screen.getByPlaceholderText(/描述你要 AI 团队做什么/);
    expect(ta).toBeTruthy();
  });

  it("高级默认折叠：details open=false", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    expect(advancedDetailsOpen()).toBe(false);
  });

  it("展开高级后：主控配置+分身列表可见，添加分身增加一行", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.click(screen.getByText(/高级：手动配分身/));
    expect(advancedDetailsOpen()).toBe(true);
    expect(screen.getByLabelText("主控 AI 类型")).toBeTruthy();
    expect(screen.getByLabelText("主控模型")).toBeTruthy();
    // 初始 0 条分身（默认主控自动拆）
    expect(screen.getByText(/分身列表（0）/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /添加分身/ }));
    expect(screen.getByText(/分身列表（1）/)).toBeTruthy();
    expect(screen.getByLabelText("分身 1 分工目标")).toBeTruthy();
  });

  it("submit：固定 mode=team + main_agent_config(默认) + worker_preset(默认空数组)", async () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "扫描架构" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));

    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = hoisted.createMissionMock.mock.calls[0] as [
      string,
      unknown,
    ];
    const p = payload as Record<string, unknown>;
    expect(p.mode).toBe("team");
    expect(p.main_agent_config).toEqual({
      agent_type: "claude_code",
      provider: "claude",
      model: "claude-sonnet-4-6",
    });
    expect(Array.isArray(p.worker_preset)).toBe(true);
    expect((p.worker_preset as unknown[]).length).toBe(0);
  });

  it("详情总览卡：中文状态 + 成败统计(排除主控) + AI 最终结论", async () => {
    const missionDegraded: Mission = {
      ...FAKE_MISSION,
      status: "degraded",
      cost_so_far: 0.4712,
      budget_usd: null,
      workers: [
        {
          id: "main-1",
          role: "orchestrator",
          objective: "主控调度",
          status: "completed",
          total_cost_usd: 0.1,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
        {
          id: "w-1",
          role: "arch",
          objective: "架构分析（长指令原文示例）",
          status: "completed",
          total_cost_usd: 0.2,
          started_at: null,
          finished_at: null,
          artifacts: [
            {
              id: "art-summary",
              kind: "summary",
              content_ref: "本次分析了会话上下文架构。",
              created_at: "2026-07-12T00:00:00Z",
            },
          ],
        },
        {
          id: "w-2",
          role: "verify",
          objective: "核查",
          status: "failed",
          total_cost_usd: 0.17,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(missionDegraded);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    // 中文状态（部分完成），英文 degraded 不露出
    expect(screen.getByText("部分完成")).toBeTruthy();
    expect(screen.queryByText("degraded")).toBeNull();
    // 成败统计：2 个真分身（排除主控），成功 1
    expect(screen.getByText(/2 个分身/)).toBeTruthy();
    // AI 最终结论（summary artifact content_ref）
    expect(screen.getByText("本次分析了会话上下文架构。")).toBeTruthy();
  });

  it("分工目标默认折叠：worker objective 全文不直接露出", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "超长分工指令原文不应该默认露出",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    // 折叠触发器可见
    expect(screen.getByText(/分工目标（点开看完整）/)).toBeTruthy();
    // 全文默认不露出（条件渲染，close 时不在 DOM）
    expect(
      screen.queryByText("超长分工指令原文不应该默认露出"),
    ).toBeNull();
  });

  it("藏黑话：UI 不出现 Coordinator/Worker/daemon 英文术语", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "x",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(/\bCoordinator\b/)).toBeNull();
    expect(screen.queryByText(/\bWorker\b/)).toBeNull();
    expect(screen.queryByText(/\bdaemon\b/i)).toBeNull();
  });

  it("分身中文角色：详情显示「架构分析」而非 [arch] 方括号代号", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "x",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    expect(screen.getAllByText("架构分析").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[arch\]/)).toBeNull();
  });
});
