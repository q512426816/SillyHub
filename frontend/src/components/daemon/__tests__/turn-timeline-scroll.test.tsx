/**
 * ql-20260822-010：TurnTimeline 贴底跟随滚动单测。
 *
 * 背景：原实现每次 turns 更新无条件 scrollTo 底部，用户上滚读历史时被流式
 * 更新反复拉回底部。新契约：
 *   1. 贴底（距底 < 80px）→ turns 更新跟随滚底；
 *   2. 用户上滚（距底 ≥ 80px）→ 不再自动滚底；
 *   3. 新增 pending 轮（用户刚发送消息的占位 turn）→ 无条件强制回底；
 *   4. 用户滚回贴底 → 恢复跟随。
 *
 * jsdom 无布局：scrollHeight/clientHeight 经 defineProperty 固定（1000/500），
 * scrollTop 直接赋值驱动「用户滚动」，scrollTo 以 mock 替换记录调用。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TurnTimeline } from "../turn-timeline";
import type { SessionTurnView } from "../turn-timeline";

// ql-20260903-026：行级 memo 断言面——计历史 markdown 块渲染次数（jsdom 下
// 真实 MarkdownText 是 next/dynamic null，mock 替身带计数器）。既有用例的
// turn 均 output 空串（不渲染 markdown），mock 对其惰性。
const mdRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => {
    mdRenders.count += 1;
    return <div data-testid="md">{content}</div>;
  },
}));

/** 稳定引用（行级 memo 生效前提——内联箭头/字面量数组每次 renderProps 新建会击穿）。 */
const noop = () => {};
const STABLE_DIALOG_HISTORY: never[] = [];

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-1",
    turn: 1,
    prompt: "你好",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  };
}

function renderProps(turns: SessionTurnView[]) {
  return {
    turns,
    viewMode: "conversation" as const,
    errorMsg: null,
    sessionStatus: "active" as const,
    pendingRequests: [],
    dialogHistory: STABLE_DIALOG_HISTORY,
    onDialogResolved: noop,
    onResend: noop,
    onSwitchProvider: noop,
    hasOnlineProvider: true,
    emptyProviderLabel: "Claude Code",
  };
}

/** 挂载 + 布局 mock：scrollHeight=1000 / clientHeight=500 / scrollTo=mock。 */
function setup(turns: SessionTurnView[]) {
  const utils = render(<TurnTimeline {...renderProps(turns)} />);
  const el = screen.getByTestId("turn-timeline-scroll") as HTMLDivElement;
  Object.defineProperty(el, "scrollHeight", {
    get: () => 1000,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", { get: () => 500, configurable: true });
  const scrollToMock = vi.fn();
  Object.defineProperty(el, "scrollTo", { value: scrollToMock, configurable: true });
  const rerenderTurns = (t: SessionTurnView[]) => {
    const props = renderProps(t);
    utils.rerender(<TurnTimeline {...props} />);
  };
  return { el, scrollToMock, rerenderTurns, ...utils };
}

/** 模拟用户滚动到指定 scrollTop 并派发 scroll 事件。 */
function userScrollTo(el: HTMLElement, scrollTop: number) {
  el.scrollTop = scrollTop;
  fireEvent.scroll(el);
}

// jsdom Element.scrollTo 未实现（生产代码有 typeof 守卫），无需全局 stub。
afterEach(() => {
  cleanup();
});
describe("TurnTimeline 贴底跟随滚动（ql-20260822-010）", () => {
  it("贴底时 turns 更新跟随滚底", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    // 贴底态（scrollTop=500 → 距底 0）
    userScrollTo(el, 500);
    rerenderTurns([
      makeTurn(),
      makeTurn({ runId: "run-2", turn: 2, output: "新的一轮" }),
    ]);
    expect(scrollToMock).toHaveBeenCalledWith(0, 1000);
  });

  it("用户上滚读历史后，流式更新不再强制拉回底部", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    // 上滚（scrollTop=100 → 距底 400 ≥ 80）
    userScrollTo(el, 100);
    rerenderTurns([
      makeTurn(),
      makeTurn({
        runId: "run-2",
        turn: 2,
        output: "流式输出中…",
        status: "running",
      }),
    ]);
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("上滚后用户发送新消息（新增 pending 轮）→ 强制回底", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    userScrollTo(el, 100); // 上滚读历史
    rerenderTurns([
      makeTurn(),
      makeTurn({
        runId: "__pending_1__",
        turn: null,
        prompt: "新消息",
        status: "pending",
      }),
    ]);
    expect(scrollToMock).toHaveBeenCalledWith(0, 1000);
  });

  it("pending 轮状态更新（running/completed）不重复强制回底，但仍受贴底跟随", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    userScrollTo(el, 100); // 上滚
    const pendingTurn = makeTurn({
      runId: "__pending_1__",
      turn: null,
      status: "pending",
    });
    rerenderTurns([makeTurn(), pendingTurn]);
    expect(scrollToMock).toHaveBeenCalledTimes(1); // pending 首现强制回底
    // 同一 runId 状态推进 running → 不再强制（且用户仍在上方）
    rerenderTurns([
      makeTurn(),
      { ...pendingTurn, status: "running" },
    ]);
    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it("用户滚回贴底后恢复跟随", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    userScrollTo(el, 100); // 上滚打断跟随
    rerenderTurns([
      makeTurn(),
      makeTurn({ runId: "run-2", turn: 2, status: "running" }),
    ]);
    expect(scrollToMock).not.toHaveBeenCalled();
    // 滚回贴底（scrollTop=460 → 距底 40 < 80）
    userScrollTo(el, 460);
    rerenderTurns([
      makeTurn(),
      makeTurn({ runId: "run-2", turn: 2, output: "继续输出", status: "running" }),
    ]);
    expect(scrollToMock).toHaveBeenCalledWith(0, 1000);
  });
});

// ── ql-20260903-023：回到底部悬浮按钮 + 新消息计数（照群聊同款） ────────────

describe("TurnTimeline 回到底部悬浮按钮（ql-20260903-023）", () => {
  it("离开底部出现；离开期间新增轮显示「N 条新消息」；点击回底按钮消失", () => {
    const { el, scrollToMock, rerenderTurns } = setup([makeTurn()]);
    // 初始贴底：无按钮。
    userScrollTo(el, 500);
    expect(screen.queryByTestId("turn-jump-bottom")).toBeNull();

    // 上滚离开底部 → 按钮出现（尚无新消息 → 只显示「回到底部」）。
    userScrollTo(el, 100);
    const btn = screen.getByTestId("turn-jump-bottom");
    expect(btn.textContent).toContain("回到底部");
    expect(btn.textContent).not.toContain("新消息");

    // 离开期间追加新轮 → 「1 条新消息」（渲染期计算，无滞后）。
    rerenderTurns([
      makeTurn(),
      makeTurn({ runId: "run-2", turn: 2, output: "新答复" }),
    ]);
    expect(screen.getByTestId("turn-jump-bottom").textContent).toContain(
      "1 条新消息",
    );

    // 点击 → 平滑滚底 + 按钮消失（状态重置）。
    fireEvent.click(screen.getByTestId("turn-jump-bottom"));
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 1000,
      behavior: "smooth",
    });
    expect(screen.queryByTestId("turn-jump-bottom")).toBeNull();
  });

  it("触顶翻页 prepend 历史页（末轮未变）不计入「新消息」", () => {
    const newer = makeTurn({ runId: "run-2", turn: 2, output: "最新" });
    const { el, rerenderTurns } = setup([makeTurn(), newer]);
    userScrollTo(el, 100); // 离开底部读历史
    // prepend 更早一页：末轮身份不变 → 仍只显示「回到底部」。
    rerenderTurns([
      makeTurn({ runId: "run-0", turn: 0, output: "更早一页" }),
      makeTurn(),
      newer,
    ]);
    const btn = screen.getByTestId("turn-jump-bottom");
    expect(btn.textContent).toContain("回到底部");
    expect(btn.textContent).not.toContain("新消息");
  });
});

// ── ql-20260903-026：行级 memo——流式 delta 只重渲染变化行 ───────────────────

describe("TurnTimeline 行级 memo（ql-20260903-026）", () => {
  it("delta 只重渲染变化行：未变行（引用稳定）的 markdown 不重渲染", () => {
    mdRenders.count = 0;
    const t1 = makeTurn({ runId: "r1", output: "第一轮答复" });
    const t2 = makeTurn({ runId: "r2", output: "第二轮答复" });
    const { rerenderTurns } = setup([t1, t2]);
    expect(mdRenders.count).toBe(2);

    // 流式 delta 语义（对齐 session-panel displayTurns 引用稳定守卫）：
    // 仅 r2 path-copy 新对象，r1 引用不变 → 只有 r2 行重渲染。
    rerenderTurns([t1, makeTurn({ runId: "r2", output: "第二轮答复（增量）" })]);
    expect(mdRenders.count).toBe(3);

    // 再来一轮 delta（仍只动 r2）。
    rerenderTurns([t1, makeTurn({ runId: "r2", output: "第二轮答复（再增量）" })]);
    expect(mdRenders.count).toBe(4);
  });
});
