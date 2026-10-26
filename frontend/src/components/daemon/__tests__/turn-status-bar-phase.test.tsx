/**
 * 2026-10-26-session-stage-progress task-04（FR-04/FR-05 / D-001/D-003/D-007/D-008）：
 * TurnStatusBar 阶段展示单测。
 *
 * 锁定：
 *   1. PHASE_LABEL 九值文案与 design 词表逐字一致（导出常量锚定）；
 *   2. 阶段停留 ≥30s 切警示样式（warning token）+「已等待 N 秒」；<30s 不警示；
 *   3. first_event 退位：标签回退 STATUS_LABEL、不警示（超时计时失效，D-008）；
 *   4. 无 currentPhase 渲染与现状一致（零回归锚定——STATUS_LABEL + 无警示类）；
 *   5. 未知 phase 值显示原始字符串（兼容策略兜底）。
 *
 * 测试纪律：fake timers 下 waitFor 不推进——用 advanceTimersByTimeAsync 排干
 * （testing-gotchas 既有坑）；组件每秒 tick 是局部 state，推进由
 * advanceTimersByTimeAsync 驱动。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

import {
  PHASE_LABEL,
  PHASE_TIMEOUT_MS,
  TurnStatusBar,
} from "../turn-status-bar";
import type { TurnSegment } from "../session-log-assembler";

const SEGMENTS: TurnSegment[] = [];

afterEach(() => {
  vi.useRealTimers();
});

function renderBar(props: Partial<Parameters<typeof TurnStatusBar>[0]> = {}) {
  return render(
    <TurnStatusBar
      turnStartedAt={null}
      segments={SEGMENTS}
      turnStatus="running"
      {...props}
    />,
  );
}

describe("PHASE_LABEL 词表（design 九值逐字）", () => {
  it("九个词表值文案与 design.md 阶段词表逐字一致", () => {
    expect(PHASE_LABEL).toEqual({
      dispatched: "已发送 · 等待执行器领取",
      delivered: "执行器已接收",
      skills_sync: "正在准备技能环境",
      spec_sync: "正在同步规范文件",
      mcp_prefetch: "正在加载工具配置",
      spawning: "正在启动 AI 进程",
      ready: "已就绪 · 等待 AI 响应",
      inject_received: "消息已送达 AI",
      first_event: "AI 开始响应",
    });
  });

  it("有 currentPhase 时标签位显示词表文案（替代笼统执行中）", () => {
    vi.useFakeTimers();
    const now = Date.now();
    renderBar({ currentPhase: { phase: "spec_sync", at: now } });
    expect(screen.getByText("正在同步规范文件")).toBeInTheDocument();
  });
});

describe("阶段超时警示（FR-05 / D-003 / D-007）", () => {
  it("≥30s 切警示样式并追加「已等待 N 秒」", async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const { container } = renderBar({
      currentPhase: { phase: "spawning", at },
    });
    // 推进 31s（跨 30 次 tick + 余量），排干微任务（testing-gotchas 坑）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_TIMEOUT_MS + 1_000);
    });
    expect(screen.getByText(/已等待 31 秒/)).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain(
      "border-warning/40",
    );
    expect(container.firstElementChild?.className).toContain("bg-warning/10");
  });

  it("30s 内不警示（现状样式）", () => {
    vi.useFakeTimers();
    const at = Date.now();
    const { container } = renderBar({
      currentPhase: { phase: "spawning", at: at - 5_000 },
    });
    expect(screen.queryByText(/已等待/)).not.toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain(
      "border-primary/[0.18]",
    );
    expect(container.firstElementChild?.className).not.toContain("warning");
  });
});

describe("first_event 退位（D-008）", () => {
  it("first_event 后标签回退状态文案且不警示（超时计时失效）", async () => {
    vi.useFakeTimers();
    const at = Date.now() - 60_000; // 远超 30s——退位后不得出现警示
    const { container } = renderBar({
      currentPhase: { phase: "first_event", at },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.queryByText(/已等待/)).not.toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain(
      "border-primary/[0.18]",
    );
  });
});

describe("零回归锚定（D-010）与未知值兜底", () => {
  it("无 currentPhase 渲染与现状一致（STATUS_LABEL + 主色样式）", () => {
    vi.useFakeTimers();
    const { container } = renderBar();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.queryByText(/已等待/)).not.toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain(
      "border-primary/[0.18]",
    );
    expect(container.firstElementChild?.className).not.toContain("warning");
  });

  it("currentPhase null 显式传入同样走现状分支", () => {
    vi.useFakeTimers();
    renderBar({ currentPhase: null });
    expect(screen.getByText("执行中")).toBeInTheDocument();
  });

  it("未知 phase 值显示原始字符串（兼容策略兜底）", () => {
    vi.useFakeTimers();
    renderBar({
      currentPhase: { phase: "future_phase_x", at: Date.now() },
    });
    expect(screen.getByText("future_phase_x")).toBeInTheDocument();
  });
});
