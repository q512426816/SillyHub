// task-08（2026-07-12-team-main-agent-orchestration / FR-8）：StageTeamConfig 组件测试。
// 2026-08-12-dispatch-bind-agent-profile：worker 改选档案（profile_id 替换 agent_type/model），
// 主 agent 参考改为 mainProfileId。
//
// 覆盖：
//   - stage=execute 默认 worker（role=impl） / stage=verify 默认 role=verify
//   - 添加 / 删除 worker
//   - 编辑 worker 字段（role / objective）+ worker 档案选择器渲染
//   - 主 agent 档案参考信息展示

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StageTeamConfig } from "../stage-team-config";
import type { StageWorkerPreset } from "../stage-team-config";

// AgentProfileSelect 黑盒 mock（避免拉网络 + 隔离测本组件逻辑）
vi.mock("@/components/agent-profile-select", () => ({
  AgentProfileSelect: ({ value }: { value: string | null }) => (
    <div data-testid="profile-select" data-value={value ?? ""} />
  ),
}));

describe("StageTeamConfig", () => {
  it("stage=execute 默认塞入 1 个 impl worker（mount effect 触发）", () => {
    const onChange = vi.fn();
    render(
      <StageTeamConfig
        stage="execute"
        workers={[]}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const preset = (onChange.mock.calls[0]?.[0] ?? []) as StageWorkerPreset[];
    expect(preset).toHaveLength(1);
    expect(preset[0]?.role).toBe("impl");
    expect(preset[0]?.objective).toContain("执行");
  });

  it("stage=verify 默认塞入 1 个 verify worker", () => {
    const onChange = vi.fn();
    render(
      <StageTeamConfig
        stage="verify"
        workers={[]}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );

    const preset = (onChange.mock.calls[0]?.[0] ?? []) as StageWorkerPreset[];
    expect(preset[0]?.role).toBe("verify");
    expect(preset[0]?.objective).toContain("核验");
  });

  it("workers 非空时不重复初始化（保留用户编辑）", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { profile_id: "p1", objective: "已存在", role: "test" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );

    // 已有 worker，effect 不再触发 onChange
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("已存在")).toBeInTheDocument();
  });

  it("添加 worker 按钮 → 追加 stage 默认 worker", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { profile_id: "p1", objective: "W1", role: "impl" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );
    fireEvent.click(screen.getByText("+ 添加 Worker"));

    expect(onChange).toHaveBeenCalledWith([
      initial[0],
      expect.objectContaining({ role: "impl" }),
    ]);
  });

  it("删除 worker 按钮 → 过滤对应索引", () => {
    const onChange = vi.fn();
    const w1: StageWorkerPreset = {
      profile_id: "p1",
      objective: "保留",
      role: "impl",
    };
    const w2: StageWorkerPreset = {
      profile_id: "p2",
      objective: "删除我",
      role: "test",
    };
    render(
      <StageTeamConfig
        stage="execute"
        workers={[w1, w2]}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );
    fireEvent.click(screen.getByLabelText("删除 worker 2"));

    expect(onChange).toHaveBeenCalledWith([w1]);
  });

  it("每个 worker 渲染一个档案选择器（profile-select）", () => {
    render(
      <StageTeamConfig
        stage="execute"
        workers={[
          { profile_id: "p1", objective: "x", role: "impl" },
          { profile_id: "p2", objective: "y", role: "test" },
        ]}
        onWorkersChange={vi.fn()}
        workspaceId="ws-1"
      />,
    );

    // 2 个 worker → 2 个 profile-select（worker 档案）
    expect(screen.getAllByTestId("profile-select")).toHaveLength(2);
  });

  it("编辑 worker role → 更新", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { profile_id: "p1", objective: "x", role: "impl" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
        workspaceId="ws-1"
      />,
    );
    fireEvent.change(screen.getByLabelText("stage worker 1 角色"), {
      target: { value: "test" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ role: "test" }),
    ]);
  });

  it("主 agent 有 mainProfileId → 显示「已选档案」", () => {
    render(
      <StageTeamConfig
        stage="execute"
        workers={[
          { profile_id: "p1", objective: "x", role: "impl" },
        ]}
        onWorkersChange={vi.fn()}
        workspaceId="ws-1"
        mainProfileId="main-p"
      />,
    );

    expect(screen.getByText(/已选档案/)).toBeInTheDocument();
  });

  it("主 agent 无 mainProfileId → 显示「跟随工作区默认」", () => {
    render(
      <StageTeamConfig
        stage="execute"
        workers={[
          { profile_id: "p1", objective: "x", role: "impl" },
        ]}
        onWorkersChange={vi.fn()}
        workspaceId="ws-1"
      />,
    );

    expect(screen.getByText(/跟随工作区默认/)).toBeInTheDocument();
  });
});
