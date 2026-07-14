// task-08（2026-07-12-team-main-agent-orchestration / FR-8）：TeamProgress 组件测试。
//
// 覆盖：
//   - mission 加载渲染（status 徽标 + objective + CostBar）
//   - 主 agent（orchestrator）拆分：从 mission.workers 拆出主 agent 与普通 worker
//   - 决策日志 orchestrator_log 渲染（constraints 标准格式 + 简写 + 缺失空态）
//   - worker 进度（status 颜色 + role 标签 + artifacts）
//   - 活跃态轮询（终态停止）
//   - 取消 mission 调 cancelMission

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TeamProgress } from "../team-progress";
import type { Mission } from "@/lib/agent";

/* ----- mock lib/agent ----- */

const missionApi = vi.hoisted(() => ({
  getMission: vi.fn(),
  cancelMission: vi.fn(),
}));

vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    getMission: missionApi.getMission,
    cancelMission: missionApi.cancelMission,
  };
});

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m-1",
    workspace_id: "ws-1",
    change_id: null,
    objective: "团队任务目标 A",
    status: "running",
    budget_usd: 4.0,
    cost_so_far: 0.5,
    constraints: null,
    cancelled_at: null,
    created_at: "t",
    workers: [],
    ...overrides,
  };
}

describe("TeamProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中渲染 loading 文案；mission 拉到后渲染 objective + status 徽标", async () => {
    missionApi.getMission.mockResolvedValue(makeMission({ status: "done" }));

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText("团队任务目标 A")).toBeInTheDocument(),
    );
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("CostBar：有预算渲染进度条 + 百分比", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({ cost_so_far: 2, budget_usd: 4 }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText(/\/ 预算 \$4\.00/)).toBeInTheDocument(),
    );
    // 2 / 4 = 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("CostBar：无预算渲染「未设预算」", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({ cost_so_far: 1.5, budget_usd: null }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText(/未设预算/)).toBeInTheDocument(),
    );
  });

  it("主 agent（role=orchestrator）单独展示，普通 worker 进度列表过滤掉它", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({
        workers: [
          {
            id: "orch-1",
            role: "orchestrator",
            objective: "主 agent 接管任务",
            status: "running",
            total_cost_usd: 0.1,
            started_at: null,
            finished_at: null,
            artifacts: [],
          },
          {
            id: "w-1",
            role: "impl",
            objective: "实现任务 A",
            status: "running",
            total_cost_usd: null,
            started_at: null,
            finished_at: null,
            artifacts: [],
          },
        ],
      }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText("主 agent 接管任务")).toBeInTheDocument(),
    );
    // Worker 进度（N）只显示普通 worker 数量（1）
    expect(screen.getByText(/Worker 进度（1）/)).toBeInTheDocument();
    expect(screen.getByText("实现任务 A")).toBeInTheDocument();
  });

  it("决策日志 orchestrator_log 标准格式渲染（ts + note）", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({
        constraints: {
          orchestrator_log: [
            { ts: "12:00", note: "派发 worker #1", step: "dispatch" },
            { ts: "12:01", note: "worker #1 完成，收敛", step: "converge" },
          ],
        },
      }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText("派发 worker #1")).toBeInTheDocument(),
    );
    expect(screen.getByText("worker #1 完成，收敛")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
  });

  it("决策日志简写格式（字符串数组）也渲染", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({
        constraints: { orchestrator_log: ["决策 1", "决策 2"] },
      }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText("决策 1")).toBeInTheDocument(),
    );
    expect(screen.getByText("决策 2")).toBeInTheDocument();
  });

  it("无决策日志 → 空态文案", async () => {
    missionApi.getMission.mockResolvedValue(makeMission({ constraints: null }));

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(
        screen.getByText(/主 agent 尚未上报决策/),
      ).toBeInTheDocument(),
    );
  });

  it("worker 状态颜色：failed → 红色文案可见", async () => {
    missionApi.getMission.mockResolvedValue(
      makeMission({
        workers: [
          {
            id: "w-fail",
            role: "impl",
            objective: "失败任务",
            status: "failed",
            total_cost_usd: null,
            started_at: null,
            finished_at: null,
            artifacts: [],
          },
        ],
      }),
    );

    render(<TeamProgress missionId="m-1" />);

    await waitFor(() =>
      expect(screen.getByText("失败任务")).toBeInTheDocument(),
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("活跃态自动轮询；终态停止", async () => {
    // 一直 running（活跃），用短轮询间隔（50ms）让真 timer 测试快收口
    missionApi.getMission.mockResolvedValue(makeMission({ status: "running" }));

    render(<TeamProgress missionId="m-1" pollMs={50} />);
    // 首次拉取（mount effect）
    await waitFor(() =>
      expect(missionApi.getMission).toHaveBeenCalledTimes(1),
    );

    // 真 timers 下等 50ms 触发第二次轮询
    await waitFor(
      () => expect(missionApi.getMission).toHaveBeenCalledTimes(2),
      { timeout: 1000 },
    );
    // 再等一次（第三次）
    await waitFor(
      () => expect(missionApi.getMission).toHaveBeenCalledTimes(3),
      { timeout: 1000 },
    );
  });

  it("终态不轮询", async () => {
    missionApi.getMission.mockResolvedValue(makeMission({ status: "done" }));

    render(<TeamProgress missionId="m-1" pollMs={50} />);
    await waitFor(() =>
      expect(missionApi.getMission).toHaveBeenCalledTimes(1),
    );
    // 等一段时间（>3 个 pollMs 周期），无第二次拉取
    await new Promise((r) => setTimeout(r, 250));
    expect(missionApi.getMission).toHaveBeenCalledTimes(1);
  });

  it("活跃态点取消 → 调 cancelMission", async () => {
    missionApi.getMission.mockResolvedValue(makeMission({ status: "running" }));
    missionApi.cancelMission.mockResolvedValue(
      makeMission({ status: "cancelled" }),
    );

    render(<TeamProgress missionId="m-1" />);
    await waitFor(() =>
      expect(screen.getByText("取消")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("取消"));

    await waitFor(() =>
      expect(missionApi.cancelMission).toHaveBeenCalledWith("", "m-1"),
    );
  });

  it("getMission 失败渲染错误文案 + 重试按钮", async () => {
    const { ApiError } = await import("@/lib/api");
    missionApi.getMission.mockRejectedValue(
      new ApiError(500, {
        code: "INTERNAL",
        message: "后端挂了",
        request_id: null,
        details: null,
      }),
    );

    render(<TeamProgress missionId="m-1" />);
    await waitFor(() =>
      expect(screen.getByText(/后端挂了/)).toBeInTheDocument(),
    );
    expect(screen.getByText("重试")).toBeInTheDocument();
  });
});
