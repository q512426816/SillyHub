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
  marqueeSpeedForDistance,
  marqueeTickerEnd,
  resolveMarqueeTarget,
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

  it("子代理内部工具不进入外部轨道，仅容器条目（FR-01）", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("agent-1", {
        toolName: "Agent",
        primary: "排查后端超时",
        subagentType: "Explore",
        children: [tool("inner-1", { toolName: "Grep", primary: "keepalive" })],
      }),
    ]);

    // 2026-10-25-marquee-subagent-outer-only：外部只保留容器条目，
    // 内部消息由对话流子代理卡片（SubagentBlockView）展示。
    expect(entries.map((e) => e.id)).toEqual(["agent-1"]);
    expect(entries[0]!.icon).toBe("subagent");
    expect(entries[0]!.text).toContain("排查后端超时");
  });

  it("长思考文本不截断，保留完整内容（FR-01）", () => {
    const longThinking = "这是一段很长的思考内容。".repeat(30);
    const entries = deriveLiveMarqueeEntries([
      thinking("t-long", longThinking, true),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe(longThinking);
    expect(entries[0]!.text.length).toBeGreaterThan(64);
  });

  it("条目超过上限时只保留最近 12 条", () => {
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

  it("轨道速度随距离缓出，接近目标时减速（FR-01）", () => {
    expect(marqueeSpeedForDistance(0)).toBe(40);
    expect(marqueeSpeedForDistance(20)).toBe(40);
    expect(marqueeSpeedForDistance(100)).toBeCloseTo(90, 5);
    expect(marqueeSpeedForDistance(228)).toBeCloseTo(205.2, 5);
    expect(marqueeSpeedForDistance(10_000)).toBe(1600);
  });

  it("窗口滑动目标回到 base，连续滑动不累积越界（FR-01）", () => {
    const base = -40_800;
    // 滑动：无论旧目标多负，都回到 base（修复前会在旧目标上继续减，直至轨道越界空白）。
    expect(resolveMarqueeTarget(base, -41_008, 208)).toBe(base);
    expect(resolveMarqueeTarget(base, base, 208)).toBe(base);
    // 普通内容增长：只向更负推进，不回滚。
    expect(resolveMarqueeTarget(base, -40_000, null)).toBe(base);
    expect(resolveMarqueeTarget(base, -42_000, null)).toBe(-42_000);
  });
});

describe("TurnLiveMarquee 连续轨道（FR-01 / FR-02 / FR-05）", () => {
  const entries = deriveLiveMarqueeEntries([
    thinking("t1", "分析登录链路"),
    tool("tool-1", { toolName: "Read", primary: "src/lib/auth.ts" }),
    fileSeg("f1", "report.md"),
  ]);

  it("轨道按顺序完整渲染全部条目，不复制内容循环", () => {
    const { getByTestId, getAllByTestId } = render(<TurnLiveMarquee entries={entries} />);
    const track = getByTestId("turn-live-marquee-track");

    // entries 全为完成态 → 末尾追加 1 条「等待模型响应」合成条目（LLM 间隙）。
    expect(getAllByTestId("marquee-item")).toHaveLength(entries.length);
    expect(getByTestId("marquee-awaiting")).not.toBeNull();
    expect(track.children).toHaveLength(entries.length + 1);
    const texts = Array.from(track.children).map((el) => el.textContent ?? "");
    expect(texts[0]).toContain("分析登录链路");
    expect(texts[1]).toContain("读写文件");
    expect(texts[2]).toContain("report.md");
    expect(texts[3]).toContain("等待模型响应");
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
    // 运行中滚动窗口带左右渐隐（FR-02）。
    expect(container.querySelector(".sh-live-marquee-window")).not.toBeNull();
    expect(item.textContent).toContain("先分析登录链路");
  });

  it("ticker 一次滚到末尾即停、不复制循环，跟随流式增长（FR-02）", () => {
    // 终点：文本末尾贴右缘；不溢出为 0。
    expect(marqueeTickerEnd(1000, 200)).toBe(-800);
    expect(marqueeTickerEnd(100, 200)).toBe(0);

    const longText = "长".repeat(210);
    const { container, getAllByText } = render(
      <TurnLiveMarquee entries={deriveLiveMarqueeEntries([thinking("t-long", longText, true)])} />,
    );

    // 单份文本（不是双份无限循环）；不再依赖 CSS 动画。
    expect(container.querySelectorAll('[data-testid="marquee-ticker"]')).toHaveLength(1);
    expect(getAllByText(longText)).toHaveLength(1);
    const ticker = container.querySelector('[data-testid="marquee-ticker"]') as HTMLElement;
    expect(ticker.style.animationDuration).toBe("");
  });

  it("完成条目显示 Timer 图标与耗时（FR-02）", () => {
    const doneEntries = deriveLiveMarqueeEntries([
      tool("tool-done", { startedAt: 1000, endedAt: 2500 }),
    ]);
    const { getByTestId } = render(<TurnLiveMarquee entries={doneEntries} />);

    // 真实条目（marquee-item）本身完成态：耗时 + 无转圈 + 无滚动窗口
    //（末尾等待条目上的转圈/滚动窗口属预期，不在此断言范围）。
    const item = getByTestId("marquee-item");
    const duration = getByTestId("marquee-duration");
    expect(duration.textContent).toContain("1.5s");
    expect(duration.querySelector("svg")).not.toBeNull();
    expect(item.querySelector('[data-testid="marquee-spinner"]')).toBeNull();
    expect(item.querySelector(".sh-live-marquee-window")).toBeNull();
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
    const { getByTestId } = render(<TurnLiveMarquee entries={doneEntries} />);

    const item = getByTestId("marquee-item");
    expect(item.className).toContain("w-[16rem]");
    expect(item.querySelector(".sh-live-marquee-ticker")).toBeNull();
    expect(getByTestId("marquee-duration")).not.toBeNull();
  });

  it("reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）", () => {
    const { queryByTestId, getByTestId } = render(
      <TurnLiveMarquee entries={entries} reducedMotion />,
    );

    expect(queryByTestId("turn-live-marquee-track")).toBeNull();
    // 等待态优先静态显示「等待模型响应」条目（FR-03，2026-10-23 修订）。
    expect(getByTestId("marquee-awaiting").textContent).toContain("等待模型响应");
  });

  it("最新条目非运行中时出现等待模型响应条目（FR-01）", () => {
    const { getByTestId } = render(
      <TurnLiveMarquee entries={deriveLiveMarqueeEntries([thinking("t-done", "思考完成")])} />,
    );

    const awaiting = getByTestId("marquee-awaiting");
    expect(awaiting.textContent).toContain("等待模型响应");
    // 等待条目为 running：带转圈。
    expect(awaiting.querySelector('[data-testid="marquee-spinner"]')).not.toBeNull();
  });

  it("最新条目运行中时无等待条目（FR-03）", () => {
    const { queryByTestId } = render(
      <TurnLiveMarquee entries={deriveLiveMarqueeEntries([thinking("t-run", "思考中", true)])} />,
    );

    expect(queryByTestId("marquee-awaiting")).toBeNull();
  });

  it("新事件到达后等待条目消失（FR-02）", () => {
    const { rerender, getByTestId, queryByTestId } = render(
      <TurnLiveMarquee entries={deriveLiveMarqueeEntries([thinking("t-done", "思考完成")])} />,
    );
    expect(getByTestId("marquee-awaiting")).not.toBeNull();

    rerender(
      <TurnLiveMarquee
        entries={deriveLiveMarqueeEntries([
          thinking("t-done", "思考完成"),
          tool("tool-run", { status: "running", endedAt: null }),
        ])}
      />,
    );
    expect(queryByTestId("marquee-awaiting")).toBeNull();
  });

  it("运行中条目显示走秒计时（FR-02）", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      const { getByTestId } = render(
        <TurnLiveMarquee
          entries={deriveLiveMarqueeEntries([
            tool("tool-run", { status: "running", endedAt: null, startedAt: 6000 }),
          ])}
        />,
      );

      const item = getByTestId("marquee-item");
      // elapsed 在挂载后渲染（SSR/水合一致门控），waitFor 等待出现。
      const elapsed = await waitFor(() => {
        const el = item.querySelector('[data-testid="marquee-running-elapsed"]');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(elapsed.textContent).toContain("4s");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("无段起点的运行中条目用客户端起点计时（FR-02）", async () => {
    const { getByTestId } = render(
      <TurnLiveMarquee
        entries={deriveLiveMarqueeEntries([
          { kind: "thinking", id: "t-none", text: "正在思考", streaming: true, ts: null },
        ])}
      />,
    );

    const item = getByTestId("marquee-item");
    expect(item.querySelector('[data-testid="marquee-spinner"]')).not.toBeNull();
    // 段无 startedAt → 组件以首次观察到 running 的客户端时刻为起点，
    // 1s tick 后显示走秒计时（防御路径：两者皆无才只转圈）。
    const elapsed = await waitFor(() => {
      const el = item.querySelector('[data-testid="marquee-running-elapsed"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(elapsed.textContent).toMatch(/\d+(ms|s)/);
  });

  it("active=false 时不显示等待条目（FR-01）", () => {
    const { queryByTestId } = render(
      <TurnLiveMarquee
        active={false}
        entries={deriveLiveMarqueeEntries([thinking("t-done", "思考完成")])}
      />,
    );

    expect(queryByTestId("marquee-awaiting")).toBeNull();
  });

  it("lastEventAt 服务端起点：挂载即累计、不重置（FR-01）", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(50_000);
    try {
      const { getByTestId } = render(
        <TurnLiveMarquee
          // 最后事件发生在 40s 前（服务端时间戳 10_000）。
          lastEventAt={10_000}
          entries={deriveLiveMarqueeEntries([
            tool("tool-done", { startedAt: 5_000, endedAt: 10_000 }),
          ])}
        />,
      );

      const awaiting = getByTestId("marquee-awaiting");
      // 挂载后数值段渲染：等待 ≈ 40s（服务端起点，不从 0 重置）。
      await waitFor(() => {
        expect(awaiting.textContent).toContain("40s");
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("等待条目回显本轮 token；无数据不显示（FR-02）", async () => {
    const { getByTestId, rerender } = render(
      <TurnLiveMarquee
        turnTokens={{ input: 8400, output: 1250 }}
        entries={deriveLiveMarqueeEntries([thinking("t-done", "思考完成")])}
      />,
    );
    const awaiting = getByTestId("marquee-awaiting");
    await waitFor(() => {
      expect(awaiting.textContent).toContain("↑8,400 ↓1,250");
    });

    // 两值皆 null → 不显示 token 段。
    rerender(
      <TurnLiveMarquee
        turnTokens={{ input: null, output: null }}
        entries={deriveLiveMarqueeEntries([thinking("t-done", "思考完成")])}
      />,
    );
    await waitFor(() => {
      expect(getByTestId("marquee-awaiting").textContent).not.toContain("↑");
    });
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

describe("TurnLiveMarquee 手机端窄视口分支（2026-10-26-mobile-four-page-layout-fix / FR-01）", () => {
  const entries = deriveLiveMarqueeEntries([thinking("t1", "分析登录链路")]);

  it("mobile=true 隐藏右缘 LIVE 徽标——480px 视口省宽给轨道", () => {
    const { queryByText } = render(<TurnLiveMarquee entries={entries} mobile />);
    expect(queryByText("LIVE")).toBeNull();
  });

  it("desktop 锚：缺省（不传 mobile）LIVE 徽标照旧渲染", () => {
    const { getByText } = render(<TurnLiveMarquee entries={entries} />);
    expect(getByText("LIVE")).not.toBeNull();
  });

  it("宽度基准扣自身 ml-9——修复胶囊右缘恒溢出 36px（结构性修复，desktop/mobile 通用）", () => {
    const { getByTestId } = render(<TurnLiveMarquee entries={entries} />);
    const root = getByTestId("turn-live-marquee");
    expect(root.className).toContain("ml-9");
    expect(root.className).toContain("w-[min(calc(100%-2.25rem),52rem)]");
    expect(root.className).not.toContain("w-[min(100%,52rem)]");
  });
});

describe("2026-10-29-edit-diff-stat-badge: Edit/Write 完成态条目 diff 统计徽标", () => {
  /** structuredPatch JSON 构造器（- 行 + + 行，hunk 形状与 SDK 透传一致）。 */
  function pj(del: string[], add: string[]): string {
    return JSON.stringify([
      { oldStart: 1, newStart: 1, lines: [...del.map((s) => `-${s}`), ...add.map((s) => `+${s}`)] },
    ]);
  }

  it("派生：ok + editPatch → entry.diffStat 按行前缀计数", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("e1", { toolName: "Edit", status: "ok", editPatch: pj(["旧1", "旧2"], ["新1"]) }),
    ]);
    expect(entries[0]!.diffStat).toEqual({ added: 1, removed: 2 });
  });

  it("派生：运行中（result 未配对）与 deny（失败）即使携带 editPatch 也不派生", () => {
    const patch = pj(["旧"], ["新"]);
    const entries = deriveLiveMarqueeEntries([
      tool("e-run", { toolName: "Edit", status: "running", editPatch: patch }),
      tool("e-deny", { toolName: "Edit", status: "deny", editPatch: patch }),
    ]);
    expect(entries[0]!.diffStat).toBeNull();
    expect(entries[1]!.diffStat).toBeNull();
  });

  it("派生：无 editPatch（非 Edit/Write 工具）与非法 JSON → 不显示（不伪造）", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("e-none", { toolName: "Bash", status: "ok" }),
      tool("e-bad", { toolName: "Edit", status: "ok", editPatch: "{not-json" }),
      tool("e-zero", { toolName: "Edit", status: "ok", editPatch: JSON.stringify([{ oldStart: 1, newStart: 1, lines: [" 不变"] }]) }),
    ]);
    expect(entries[0]!.diffStat).toBeNull();
    expect(entries[1]!.diffStat).toBeNull();
    expect(entries[2]!.diffStat).toBeNull();
  });

  it("渲染：完成态 Edit 条目显示 +N -M（绿/红 class），完成态工具名与统计同格", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("e1", { toolName: "Edit", status: "ok", startedAt: 0, endedAt: 900, editPatch: pj(["旧1", "旧2", "旧3", "旧4", "旧5", "旧6", "旧7"], ["新1", "新2", "新3", "新4", "新5", "新6", "新7", "新8", "新9", "新10", "新11"]) }),
    ]);
    const { getByTestId } = render(<TurnLiveMarquee entries={entries} />);
    const badge = getByTestId("diff-stat-badge");
    expect(badge.textContent).toContain("+11");
    expect(badge.textContent).toContain("-7");
    // 绿/红语义色（与状态点 dotClass 同族）
    expect(badge.querySelector(".text-emerald-600")?.textContent).toBe("+11");
    expect(badge.querySelector(".text-destructive")?.textContent).toBe("-7");
  });

  it("渲染：Write 纯新增只显示 +N，不出现 -0", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("w1", { toolName: "Write", status: "ok", editPatch: pj([], ["行1", "行2", "行3"]) }),
    ]);
    const { getByTestId } = render(<TurnLiveMarquee entries={entries} />);
    const badge = getByTestId("diff-stat-badge");
    expect(badge.textContent).toContain("+3");
    expect(badge.textContent).not.toContain("-0");
    expect(badge.querySelector(".text-destructive")).toBeNull();
  });

  it("渲染：运行中条目不渲染徽标（结果未定）", () => {
    const entries = deriveLiveMarqueeEntries([
      tool("e-run", { toolName: "Edit", status: "running", editPatch: pj(["旧"], ["新"]) }),
    ]);
    const { queryByTestId } = render(<TurnLiveMarquee entries={entries} />);
    expect(queryByTestId("diff-stat-badge")).toBeNull();
  });
});

describe("2026-10-29-engine-live-perception: 等待三态与估算补显（FR-03）", () => {
  /** 心跳状态构造（与 MarqueeHeartbeatState 同构）。 */
  function hb(over: Partial<{
    kind: "awaiting_first_token" | "generating";
    est_chars: number | null;
    est_tokens: number | null;
    precision: "estimated" | "authoritative";
    source: string;
    at: number;
  }> = {}) {
    return {
      kind: "generating" as const,
      est_chars: 42000,
      est_tokens: 12000,
      precision: "estimated" as const,
      source: "claude_input_json_delta",
      at: Date.now(),
      ...over,
    };
  }

  function awaitText(props: {
    heartbeat?: ReturnType<typeof hb> | null;
    lastEventAt?: number;
    turnTokens?: { input: number | null; output: number | null } | null;
  }) {
    const { getByTestId } = render(
      <TurnLiveMarquee
        entries={deriveLiveMarqueeEntries([tool("t1", { status: "ok" })])}
        {...props}
      />,
    );
    return getByTestId("marquee-awaiting").textContent ?? "";
  }

  it("无心跳 → 现状纯计时文案（零回归）", () => {
    const text = awaitText({ lastEventAt: Date.now() - 2_000 });
    expect(text).toContain("等待模型响应");
    expect(text).not.toContain("正在生成大段内容");
    expect(text).not.toContain("约");
  });

  it("generating 心跳（estimated）→ 正在生成大段内容 + 已产出约 N token", () => {
    const text = awaitText({ heartbeat: hb(), lastEventAt: Date.now() - 2_000 });
    expect(text).toContain("正在生成大段内容");
    expect(text).toContain("已产出约 12,000 token");
  });

  it("awaiting_first_token 心跳 → 正在等待模型响应 · 已发送上下文", () => {
    const text = awaitText({
      heartbeat: hb({ kind: "awaiting_first_token", est_chars: null, est_tokens: null }),
      lastEventAt: Date.now() - 2_000,
    });
    expect(text).toContain("正在等待模型响应");
    expect(text).toContain("已发送上下文");
  });

  it("authoritative 心跳（codex）→ 权威值不带「约」", () => {
    const text = awaitText({
      heartbeat: hb({ precision: "authoritative", source: "codex_token_usage", est_tokens: 120 }),
      lastEventAt: Date.now() - 2_000,
    });
    expect(text).toContain("已输出 120 token");
    expect(text).not.toContain("约 120");
  });

  it("心跳过期（>5s 无新心跳）→ 回落现状纯计时（瞬态自清）", () => {
    const text = awaitText({
      heartbeat: hb({ at: Date.now() - 8_000 }),
      lastEventAt: Date.now() - 2_000,
    });
    expect(text).toContain("等待模型响应");
    expect(text).not.toContain("正在生成大段内容");
  });

  it("等待 >30s → 追加大内容慢提示（三态通用）", () => {
    const text = awaitText({ heartbeat: hb(), lastEventAt: Date.now() - 40_000 });
    expect(text).toContain("大内容可能需要几分钟");
  });

  it("估算补显与轮级权威 token 并存（约值 + ↑↓ 同屏）", () => {
    const text = awaitText({
      heartbeat: hb(),
      lastEventAt: Date.now() - 2_000,
      turnTokens: { input: 19415, output: 54160 },
    });
    expect(text).toContain("已产出约 12,000 token");
    expect(text).toContain("↑19,415");
    expect(text).toContain("↓54,160");
  });
});
