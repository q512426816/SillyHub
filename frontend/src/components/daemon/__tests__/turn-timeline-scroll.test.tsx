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
    dialogHistory: [],
    onDialogResolved: () => {},
    onResend: () => {},
    onSwitchProvider: () => {},
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
