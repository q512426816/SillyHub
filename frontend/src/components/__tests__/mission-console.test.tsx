// tests/components/__tests__/mission-console.test.tsx
// task-07 / FR-2 / FR-6 / D-002@v2 / D-003@v2：team 配置面板单测。
//
// 依据：
//   - tasks/task-07.md acceptance（team 面板可配主 agent 类型/模型 + 增删 worker 行；
//     CreateMissionInput 携带 worker_preset/main_agent_config 调 create_mission）
//   - design.md §3 主 agent + worker 自由组合（D-003@v2）
//   - design.md §6 D-002@v2（worker 用户预设，非主 agent 自动拆解）
//
// 覆盖：
//   - mode=single 默认：不展开 team 配置面板（零回归）
//   - mode=team 选中：展开主 agent 配置 + worker 列表
//   - worker 增删：添加 / 删除按钮改列表长度
//   - submit(team)：createMission 收到 worker_preset + main_agent_config
//   - submit(single)：createMission 不带 worker_preset/main_agent_config（零回归）

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Mission } from "@/lib/agent";

// ────────────────────────────────────────────────────────────────────────────
// hoisted：createMission mock，捕获 payload 用于断言 worker_preset/main_agent_config。
// ────────────────────────────────────────────────────────────────────────────
const hoisted = vi.hoisted(() => {
  return {
    createMissionMock: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  };
});

// mock @/lib/agent：只替换 createMission，其余保留 actual（类型等）
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    createMission: hoisted.createMissionMock,
  };
});

// mock next/navigation（mission-console 不直接用，但间接依赖防告警）
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {} }),
}));

import { MissionConsole } from "@/components/mission-console";

// 最小 Mission 返回值（createMission resolve 用）
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

function mockCreateResolve() {
  hoisted.createMissionMock.mockResolvedValue(FAKE_MISSION);
}

describe("MissionConsole team 配置面板（task-07）", () => {
  beforeEach(() => {
    cleanup();
    hoisted.createMissionMock.mockReset();
    mockCreateResolve();
  });

  it("mode=single 默认：不渲染 team 配置面板（主 agent / worker 列表不可见）", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    expect(screen.queryByText(/主 Agent/i)).toBeNull();
    expect(screen.queryByText(/Worker 列表/i)).toBeNull();
    expect(screen.queryByLabelText("主 agent 类型")).toBeNull();
  });

  it("mode=team 选中：展开主 agent 配置 + worker 列表（含默认 1 条 worker）", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    // 切到 team（ModeCard aria-label="模式 team"）
    fireEvent.click(screen.getByRole("button", { name: "模式 team" }));
    // team 面板渲染（用 label 锚点，避免多文本节点冲突）
    expect(screen.getByLabelText("主 agent 类型")).toBeTruthy();
    expect(screen.getByLabelText("主 agent provider")).toBeTruthy();
    expect(screen.getByLabelText("主 agent 模型")).toBeTruthy();
    // 默认 1 条 worker（label "worker 1 分工目标" 存在）
    expect(screen.getByLabelText("worker 1 分工目标")).toBeTruthy();
  });

  it("worker 增删：添加按钮加 1 条，删除按钮减 1 条", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "模式 team" }));
    // 默认 1 条
    expect(screen.getAllByLabelText(/分工目标/).length).toBe(1);
    // 添加 → 2 条
    fireEvent.click(screen.getByRole("button", { name: /添加 Worker/ }));
    expect(screen.getAllByLabelText(/分工目标/).length).toBe(2);
    // 删除第 1 条 → 剩 1 条（剩余 worker 重编号为 #1）
    fireEvent.click(screen.getByLabelText("删除 worker 1"));
    expect(screen.getAllByLabelText(/分工目标/).length).toBe(1);
  });

  it("submit(team)：createMission payload 携带 mode=team + main_agent_config + worker_preset", async () => {
    render(<MissionConsole workspaceId="ws-1" />);
    // 填 objective
    fireEvent.change(screen.getByPlaceholderText(/分析 backend/i), {
      target: { value: "扫描架构" },
    });
    // 切 team
    fireEvent.click(screen.getByRole("button", { name: "模式 team" }));
    // 改主 agent 模型
    fireEvent.change(screen.getByLabelText("主 agent 模型"), {
      target: { value: "claude-opus-4-1" },
    });
    // 改默认 worker 的 objective
    fireEvent.change(screen.getByLabelText("worker 1 分工目标"), {
      target: { value: "分析架构" },
    });
    // 提交
    fireEvent.click(screen.getByRole("button", { name: /启动团队/ }));

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
      model: "claude-opus-4-1",
    });
    expect(Array.isArray(p.worker_preset)).toBe(true);
    const preset = p.worker_preset as Array<{ objective: string }>;
    expect(preset.length).toBe(1);
    expect(preset[0]?.objective).toBe("分析架构");
  });

  it("submit(single)：createMission payload 不带 worker_preset/main_agent_config（零回归）", async () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/分析 backend/i), {
      target: { value: "简单问答" },
    });
    // 保持默认 single
    fireEvent.click(screen.getByRole("button", { name: /启动团队/ }));

    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = hoisted.createMissionMock.mock.calls[0] as [
      string,
      unknown,
    ];
    const p = payload as Record<string, unknown>;
    expect(p.mode).toBe("single");
    expect(p.worker_preset).toBeUndefined();
    expect(p.main_agent_config).toBeUndefined();
  });

  it("详情渲染：主 agent 与 worker 分开（主 agent 不混入 worker 列表）", async () => {
    // 诊断 36b9b475：前端把主 agent（role=orchestrator）也当 worker 渲染，标题写死
    // "Worker 日志"误导。修复后主 agent 单独区块，worker 列表只含真 worker。
    const missionWithMain: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "main-1",
          role: "orchestrator",
          objective: "主 agent 调度",
          status: "running",
          total_cost_usd: 0.1,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
        {
          id: "w-1",
          role: "impl",
          objective: "写实现",
          status: "pending",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    hoisted.createMissionMock.mockResolvedValue(missionWithMain);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/分析 backend/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /启动团队/ }));
    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    // 主 agent 单独区块出现
    expect(screen.getByText(/🧠\s*主 Agent/)).toBeTruthy();
    // Worker 列表标题，只算真 worker（1 个，主 agent 不计入）
    expect(screen.getByText(/Worker（1）/)).toBeTruthy();
  });
});
