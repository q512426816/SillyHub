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
  DELIVERY_STALL_LABEL,
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

describe("投递阶段停滞文案（2026-10-27-turn-phase-stall-honest-ui）", () => {
  // 超时态 span 内多文本节点（标签 + 「· 已等待 N 秒」），字符串精确匹配
  // 匹不到前缀节点——统一前缀正则（锚定 DELIVERY_STALL_LABEL 常量）。
  const stallLabelRe = () => new RegExp(`^${DELIVERY_STALL_LABEL}`);

  it("delivered 停留 ≥30s → 排队语义文案 + 警示样式 + 已等待秒数", async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const { container } = renderBar({
      currentPhase: { phase: "delivered", at },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_TIMEOUT_MS + 1_000);
    });
    expect(screen.getByText(stallLabelRe())).toBeInTheDocument();
    expect(screen.getByText(/已等待 31 秒/)).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("border-warning/40");
  });

  it("dispatched 停留 ≥30s → 同款排队语义文案", async () => {
    vi.useFakeTimers();
    const at = Date.now();
    renderBar({ currentPhase: { phase: "dispatched", at } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_TIMEOUT_MS + 1_000);
    });
    expect(screen.getByText(stallLabelRe())).toBeInTheDocument();
  });

  it("delivered 30s 内仍显词表文案（不提前切排队语义）", () => {
    vi.useFakeTimers();
    renderBar({
      currentPhase: { phase: "delivered", at: Date.now() - 5_000 },
    });
    expect(screen.getByText("执行器已接收")).toBeInTheDocument();
    expect(screen.queryByText(stallLabelRe())).not.toBeInTheDocument();
  });

  it("执行期阶段（spawning）停滞 ≥30s 仍显词表文案——排队语义只限投递两阶段", async () => {
    vi.useFakeTimers();
    const at = Date.now();
    renderBar({ currentPhase: { phase: "spawning", at } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_TIMEOUT_MS + 1_000);
    });
    expect(screen.getByText(/正在启动 AI 进程/)).toBeInTheDocument();
    expect(screen.getByText(/已等待 31 秒/)).toBeInTheDocument();
    expect(screen.queryByText(stallLabelRe())).not.toBeInTheDocument();
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

/* ───────── 模型重试活动文案（2026-10-28-model-retry-visible） ───────── */

describe("TurnStatusBar × model_retry 段（2026-10-28-model-retry-visible）", () => {
  it("最新段为 model_retry（无 streaming 段）时活动位显示重试文案，替代恒「思考中」", () => {
    vi.useFakeTimers();
    const segments: TurnSegment[] = [
      {
        kind: "model_retry",
        id: "seg:mr-status",
        text: JSON.stringify({
          attempt: 3,
          max_retries: 10,
          retry_delay_ms: 8000,
          error_status: 429,
          error: "Request rejected (429) · [1311]",
        }),
        ts: 1_000,
      },
    ];
    render(
      <TurnStatusBar
        turnStartedAt={1_000}
        segments={segments}
        turnStatus="running"
      />,
    );
    act(() => {
      void vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTitle("模型限流重试中 第3/10次…")).toBeInTheDocument();
    expect(screen.getByText("模型限流重试中 第3/10次…")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("流式文本段更新（ts 更晚）时回退「正在输出文本」（重试行不遮蔽真实输出活动）", () => {
    vi.useFakeTimers();
    const segments: TurnSegment[] = [
      {
        kind: "model_retry",
        id: "seg:mr-status2",
        text: JSON.stringify({ attempt: 5, max_retries: 10, error_status: 429 }),
        ts: 1_000,
      },
      {
        kind: "text",
        id: "seg:tx-status",
        text: "恢复输出",
        streaming: true,
        startedAt: 2_000,
      },
    ];
    render(
      <TurnStatusBar
        turnStartedAt={1_000}
        segments={segments}
        turnStatus="running"
      />,
    );
    act(() => {
      void vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTitle("正在输出文本")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
