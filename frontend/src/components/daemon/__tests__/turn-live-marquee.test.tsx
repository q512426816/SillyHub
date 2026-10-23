/**
 * 2026-10-22-conversation-live-marquee（FR-01~FR-07）：
 * 对话视图运行中轮尾实时活动跑马灯——纯函数派生 + 连续轨道组件 +
 * TurnTimeline 接入门控。
 *
 * 2026-10-23 用户裁决：连续流动、不循环、只流到最新一条（纯感知不交互）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import {
  TurnLiveMarquee,
  deriveLiveMarqueeEntries,
  formatMarqueeDuration,
  LIVE_MARQUEE_MAX_ENTRIES,
} from "@/components/daemon/turn-live-marquee";
import {
  TurnTimeline,
  type SessionTurnView,
} from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ children }: { children: string }) => (
    <div data-testid="markdown-text">{children}</div>
  ),
}));

function thinking(id: string, text: string, streaming = false): TurnSegment {
  return { kind: "thinking", id, text, streaming, ts: 0 };
}

function tool(
  id: string,
  over: Partial<Extract<TurnSegment, { kind: "tool" }>> = {},
): TurnSegment {
  return {
    kind: "tool",
    id,
    raw: "",
    status: "ok",
    toolName: "Bash",
    primary: "pnpm vitest",
    startedAt: 0,
    endedAt: 1,
    children: [],
    subagentType: null,
    ...over,
  };
}

function fileSeg(id: string, name: string): TurnSegment {
  return {
    kind: "file",
    id,
    fileId: `f-${id}`,
    name,
    size: 100,
    mime: "text/markdown",
    description: "",
    ts: 0,
  };
}

function makeTurn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "继续任务",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    apiDurationMs: null,
    errorDetail: null,
    processItems: [],
    segments: [thinking("think-1", "正在分析登录超时")],
    turnStartedAt: 0,
    ...over,
  };
}

function renderTimeline(
  turns: SessionTurnView[],
  viewMode: "conversation" | "all" | "trajectory" = "conversation",
) {
  return render(
    <TurnTimeline
      turns={turns}
      viewMode={viewMode}
      errorMsg={null}
      sessionStatus="active"
      dialogHistory={[]}
      onResend={vi.fn()}
      onSwitchProvider={vi.fn()}
      hasOnlineProvider
      emptyProviderLabel="Claude"
    />,
  );
}

afterEach(() => cleanup());

describe("deriveLiveMarqueeEntries 纯函数（FR-01 / FR-03）", () => {
  it("按段文档序产出条目，跳过 text 答复段", () => {
    const entries = deriveLiveMarqueeEntries([
      thinking("t1", "先看登录链路"),
      { kind: "text", id: "x1", text: "答复正文", streaming: true, startedAt: 0 },
      tool("tool-1", { toolName: "Read", primary: "src/lib/auth.ts" }),
      fileSeg("f1", "report.md"),
    ]);

    expect(entries.map((e) => e.id)).toEqual(["t1", "tool-1", "f1"]);
    expect(entries[0]).toMatchObject({ icon: "thinking", status: "done" });
    expect(entries[1]!.text).toContain("读写文件 · Read");
    expect(entries[1]!.status).toBe("done");
    expect(entries[2]!.text).toContain("report.md");
  });

  it("同一段 id 的流式更新就地覆盖文本，不重复入队（FR-03）", () => {
    const first = deriveLiveMarqueeEntries([thinking("t1", "分析", true)]);
    const second = deriveLiveMarqueeEntries([thinking("t1", "分析完成，准备修复", true)]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe("t1");
    expect(second[0]!.text).toContain("分析完成，准备修复");
    expect(second[0]!.status).toBe("running");
  });

  it("工具段状态翻转就地更新状态，不新增条目（FR-03）", () => {
    const running = deriveLiveMarqueeEntries([tool("tool-1", { status: "running" })]);
    const done = deriveLiveMarqueeEntries([tool("tool-1", { status: "ok" })]);

    expect(running).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(running[0]!.status).toBe("running");
    expect(done[0]!.status).toBe("done");
  });

  it("子代理内部工具递归进入同一轨道（FR-01）", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("agent-1", {
        toolName: "Agent",
        primary: "排查后端超时",
        subagentType: "Explore",
        children: [tool("inner-1", { toolName: "Grep", primary: "keepalive" })],
      }),
    ]);

    expect(entries.map((e) => e.id)).toEqual(["agent-1", "agent-1/inner-1"]);
    expect(entries[0]!.icon).toBe("subagent");
    expect(entries[1]!.text).toContain("keepalive");
  });

  it("条目超过上限时只保留最近 200 条", () => {
    const many = Array.from({ length: LIVE_MARQUEE_MAX_ENTRIES + 10 }, (_, i) =>
      thinking(`t-${i}`, `事件 ${i}`),
    );
    const entries = deriveLiveMarqueeEntries(many);

    expect(entries).toHaveLength(LIVE_MARQUEE_MAX_ENTRIES);
    expect(entries[0]!.id).toBe("t-10");
    expect(entries[entries.length - 1]!.id).toBe(`t-${LIVE_MARQUEE_MAX_ENTRIES + 9}`);
  });

  it("工具段用真实 startedAt/endedAt 计算耗时，thinking 不伪造（FR-03）", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("tool-1", { startedAt: 1000, endedAt: 2500 }),
      thinking("think-1", "只有开始时刻"),
    ]);

    expect(entries[0]!.durationMs).toBe(1500);
    expect(entries[1]!.durationMs).toBeNull();
    expect(entries[1]!.endedAt).toBeNull();
  });

  it("耗时格式化：毫秒 / 一位小数秒 / 分钟（FR-02）", () => {
    expect(formatMarqueeDuration(820)).toBe("820ms");
    expect(formatMarqueeDuration(1500)).toBe("1.5s");
    expect(formatMarqueeDuration(2000)).toBe("2s");
    expect(formatMarqueeDuration(65_000)).toBe("1m 05s");
  });
});

describe("TurnLiveMarquee 连续轨道（FR-01 / FR-02 / FR-05）", () => {
  const entries = deriveLiveMarqueeEntries([
    thinking("t1", "分析登录链路"),
    tool("tool-1", { toolName: "Read", primary: "src/lib/auth.ts" }),
    fileSeg("f1", "report.md"),
  ]);

  it("轨道按顺序完整渲染全部条目，不复制内容循环", () => {
    const { getByTestId } = render(<TurnLiveMarquee entries={entries} />);
    const track = getByTestId("turn-live-marquee-track");

    expect(track.children).toHaveLength(entries.length);
    const texts = Array.from(track.children).map((el) => el.textContent ?? "");
    expect(texts[0]).toContain("分析登录链路");
    expect(texts[1]).toContain("读写文件");
    expect(texts[texts.length - 1]).toContain("report.md");
  });

  it("运行中条目渲染 lucide 图标与转圈，文本区带内部滚动（FR-01）", () => {
    const runningEntries = deriveLiveMarqueeEntries([
      thinking("t-run", "先分析登录链路再检查 token 刷新策略最后补测试", true),
    ]);
    const { getByTestId, getAllByTestId, container } = render(
      <TurnLiveMarquee entries={runningEntries} />,
    );

    const item = getByTestId("marquee-item");
    expect(item.querySelector("svg")).not.toBeNull();
    expect(getAllByTestId("marquee-spinner")).toHaveLength(1);
    expect(container.querySelector(".sh-live-marquee-ticker")).not.toBeNull();
    expect(item.textContent).toContain("先分析登录链路");
  });

  it("完成条目显示 Timer 图标与耗时（FR-02）", () => {
    const doneEntries = deriveLiveMarqueeEntries([
      tool("tool-done", { startedAt: 1000, endedAt: 2500 }),
    ]);
    const { getByTestId, queryByTestId } = render(
      <TurnLiveMarquee entries={doneEntries} />,
    );

    const duration = getByTestId("marquee-duration");
    expect(duration.textContent).toContain("1.5s");
    expect(duration.querySelector("svg")).not.toBeNull();
    expect(queryByTestId("marquee-spinner")).toBeNull();
  });

  it("进行中条目不显示耗时（FR-02）", () => {
    const runningEntries = deriveLiveMarqueeEntries([
      tool("tool-run", { status: "running", endedAt: null }),
    ]);
    const { getByTestId, queryByTestId } = render(
      <TurnLiveMarquee entries={runningEntries} />,
    );

    expect(getByTestId("marquee-spinner")).not.toBeNull();
    expect(queryByTestId("marquee-duration")).toBeNull();
  });

  it("历史已完成且无时长的条目不显示耗时（FR-03）", () => {
    const historical = deriveLiveMarqueeEntries([thinking("t-old", "历史思考")]);
    const { getByTestId, queryByTestId } = render(
      <TurnLiveMarquee entries={historical} />,
    );

    expect(getByTestId("marquee-item").textContent).toContain("历史思考");
    expect(queryByTestId("marquee-duration")).toBeNull();
  });

  it("思考段运行到完成由客户端计时（FR-03）", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const runningEntries = deriveLiveMarqueeEntries([
        thinking("t-live", "正在思考", true),
      ]);
      const { rerender, findByTestId } = render(
        <TurnLiveMarquee entries={runningEntries} />,
      );

      // 挂载 effect 已记录 running 起点（1000ms）。
      nowSpy.mockReturnValue(2500);
      const doneEntries = deriveLiveMarqueeEntries([thinking("t-live", "思考完成")]);
      rerender(<TurnLiveMarquee entries={doneEntries} />);

      const duration = await findByTestId("marquee-duration");
      expect(duration.textContent).toContain("1.5s");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("条目固定 16rem 宽度，图标与耗时区不参与滚动（FR-04）", () => {
    const doneEntries = deriveLiveMarqueeEntries([
      tool("tool-done", { startedAt: 0, endedAt: 1500 }),
    ]);
    const { getByTestId, container } = render(
      <TurnLiveMarquee entries={doneEntries} />,
    );

    expect(getByTestId("marquee-item").className).toContain("w-[16rem]");
    expect(container.querySelector(".sh-live-marquee-ticker")).toBeNull();
    expect(getByTestId("marquee-duration")).not.toBeNull();
  });

  it("reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）", () => {
    const { queryByTestId, getByTestId } = render(
      <TurnLiveMarquee entries={entries} reducedMotion />,
    );

    expect(queryByTestId("turn-live-marquee-track")).toBeNull();
    expect(getByTestId("turn-live-marquee").textContent).toContain("report.md");
  });

  it("无条目时不渲染空壳", () => {
    const { queryByTestId } = render(<TurnLiveMarquee entries={[]} />);
    expect(queryByTestId("turn-live-marquee")).toBeNull();
  });

  it("组件不可见时暂停滚动，恢复可见后继续（FR-06）", async () => {
    let callback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: ReadonlyArray<number> = [];
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    let rafCalls = 0;
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => {
        rafCalls += 1;
        return rafCalls;
      });

    try {
      render(<TurnLiveMarquee entries={entries} />);
      await waitFor(() => expect(callback).not.toBeNull());
      expect(rafCalls).toBeGreaterThan(0);

      act(() => {
        callback!(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      const pausedCalls = rafCalls;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(rafCalls).toBe(pausedCalls);

      act(() => {
        callback!(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      await waitFor(() => expect(rafCalls).toBeGreaterThan(pausedCalls));
    } finally {
      rafSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("追平目标后 rAF 停排，entries 更新重新起排（2026-10-23-review-risk-fixes-2）", () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
    const segs1 = [
      thinking("t1", "分析登录链路"),
      tool("tool-1", { toolName: "Read", primary: "src/lib/auth.ts" }),
      fileSeg("f1", "report.md"),
    ];
    const segs2 = [...segs1, thinking("t-new", "新事件到达")];
    try {
      const { rerender } = render(
        <TurnLiveMarquee entries={deriveLiveMarqueeEntries(segs1)} />,
      );
      // 挂载即起排（至少一帧）
      expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
      // 手动驱动全部已排帧：jsdom 下 clientWidth/scrollWidth 恒 0 → distance=0
      // → 追平分支。旧实现每帧无条件续排（驱动 N 帧又排 N 帧）；新实现停排。
      act(() => {
        rafCallbacks.splice(0).forEach((cb) => cb(performance.now()));
      });
      expect(rafCallbacks.length).toBe(0);
      // 新内容到达（target 更新唯一入口 applyTarget）→ 重新起排
      rerender(<TurnLiveMarquee entries={deriveLiveMarqueeEntries(segs2)} />);
      expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
    } finally {
      rafSpy.mockRestore();
    }
  });
});

describe("TurnTimeline 接入门控（FR-01 / FR-04）", () => {
  it("对话视图 + 运行中轮次 → 渲染跑马灯", () => {
    const { queryByTestId } = renderTimeline([makeTurn()]);
    expect(queryByTestId("turn-live-marquee")).not.toBeNull();
  });

  it("对话视图 + 终态轮次 → 不渲染", () => {
    const { queryByTestId } = renderTimeline([makeTurn({ status: "completed" })]);
    expect(queryByTestId("turn-live-marquee")).toBeNull();
  });

  it("进度视图 + 运行中轮次 → 不渲染", () => {
    const { queryByTestId } = renderTimeline([makeTurn()], "all");
    expect(queryByTestId("turn-live-marquee")).toBeNull();
  });

  it("轨迹视图 → 不渲染", () => {
    const { queryByTestId } = renderTimeline([makeTurn()], "trajectory");
    expect(queryByTestId("turn-live-marquee")).toBeNull();
  });
});
