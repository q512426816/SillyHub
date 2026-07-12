// task-08（2026-07-12-team-main-agent-orchestration / FR-8）：StageTeamConfig 组件测试。
//
// 覆盖：
//   - stage=execute 默认 worker（role=impl） / stage=verify 默认 role=verify
//   - 添加 / 删除 worker
//   - 编辑 worker 字段（agent_type / role / model / objective）
//   - 主 agent 参考信息展示（provider + model）

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StageTeamConfig } from "../stage-team-config";
import type { StageWorkerPreset } from "../stage-team-config";

describe("StageTeamConfig", () => {
  it("stage=execute 默认塞入 1 个 impl worker（mount effect 触发）", () => {
    const onChange = vi.fn();
    render(
      <StageTeamConfig
        stage="execute"
        workers={[]}
        onWorkersChange={onChange}
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
      />,
    );

    const preset = (onChange.mock.calls[0]?.[0] ?? []) as StageWorkerPreset[];
    expect(preset[0]?.role).toBe("verify");
    expect(preset[0]?.objective).toContain("核验");
  });

  it("workers 非空时不重复初始化（保留用户编辑）", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { agent_type: "codex", model: "gpt-4o", objective: "已存在", role: "test" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
      />,
    );

    // 已有 worker，effect 不再触发 onChange
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("已存在")).toBeInTheDocument();
  });

  it("添加 worker 按钮 → 追加 stage 默认 worker", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { agent_type: "claude_code", model: "", objective: "W1", role: "impl" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
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
      agent_type: "claude_code",
      model: "",
      objective: "保留",
      role: "impl",
    };
    const w2: StageWorkerPreset = {
      agent_type: "codex",
      model: "",
      objective: "删除我",
      role: "test",
    };
    render(
      <StageTeamConfig
        stage="execute"
        workers={[w1, w2]}
        onWorkersChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("删除 worker 2"));

    expect(onChange).toHaveBeenCalledWith([w1]);
  });

  it("编辑 worker agent_type → onWorkersChange 更新对应字段", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { agent_type: "claude_code", model: "", objective: "x", role: "impl" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
      />,
    );
    const select = screen.getByLabelText("stage worker 1 agent 类型") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "codex" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ agent_type: "codex" }),
    ]);
  });

  it("编辑 worker role → 更新", () => {
    const onChange = vi.fn();
    const initial: StageWorkerPreset[] = [
      { agent_type: "claude_code", model: "", objective: "x", role: "impl" },
    ];
    render(
      <StageTeamConfig
        stage="execute"
        workers={initial}
        onWorkersChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("stage worker 1 角色"), {
      target: { value: "test" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ role: "test" }),
    ]);
  });

  it("主 agent 参考信息渲染（provider + model）", () => {
    render(
      <StageTeamConfig
        stage="execute"
        workers={[
          { agent_type: "claude_code", model: "", objective: "x", role: "impl" },
        ]}
        onWorkersChange={vi.fn()}
        provider="claude"
        model="claude-sonnet-4-6"
      />,
    );

    expect(screen.getByText(/claude · claude-sonnet-4-6/)).toBeInTheDocument();
  });

  it("主 agent 无 provider → 显示「跟随工作区默认」", () => {
    render(
      <StageTeamConfig
        stage="execute"
        workers={[
          { agent_type: "claude_code", model: "", objective: "x", role: "impl" },
        ]}
        onWorkersChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/跟随工作区默认/)).toBeInTheDocument();
  });
});
