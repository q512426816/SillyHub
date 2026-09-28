/**
 * TurnNavList（轮次导航——2026-09-28-turn-nav-hover-flyout 形态）组件单测。
 *
 * 形态（2026-09-28 用户反馈「220px 常驻太占地方」后的折中）：
 *   - 平时 44px 窄轨：把手（当前轮号 + 展开指示，点击 pin）+ 垂直刻度（每轮
 *     一段，当前轮高亮；刻度本身是 button，aria-label 与行式版同构——可达性
 *     不降级，点击直跳该轮）；
 *   - 悬停 300ms 防抖滑出行式浮层（absolute 不挤压聊天区）；整体移开 250ms
 *     收起；pin 锁定常开；浮层内点行跳转（非 pin 态选完即收）。
 *
 * 依据：components/sessions/turn-nav-list.tsx（本变更实现）/ 成功标准。
 * 测试风格对齐 turn-catalog.test.tsx（testing-library + cleanup；纯受控组件
 * 不 mock 网络层；jsdom 缺口补 scrollIntoView stub）。合并语义
 * （mergeTurnNavEntries）在派生层，由 page.test 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { cleanup, render, fireEvent, within, act } from "@testing-library/react";

import TurnNavList, {
  type TurnNavListProps,
} from "@/components/sessions/turn-nav-list";
import type { TurnNavEntry } from "@/components/sessions/turn-nav-list";

// ── jsdom 缺口 ───────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom 未实现 scrollIntoView（activeTurnKey 变化 → 行滚入轨内可视区链路）。
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ── 固件构造 ─────────────────────────────────────────────────────────────

/** 本地时区固化的 startedAt（toString 可往返解析，避免 toISOString 时区偏移）。 */
const AT_0925 = new Date(2026, 8, 27, 9, 25).toString();

const ENTRY_COMPLETED: TurnNavEntry = {
  key: "run-1",
  turnNo: 1,
  startedAt: AT_0925,
  status: "completed",
  senderName: null,
  promptSummary: "调研 sessions 页面组件结构与渲染链路",
  answerSummary: "SessionsPortal → grid 布局",
  loaded: true,
};

const ENTRY_FAILED: TurnNavEntry = {
  key: "run-2",
  turnNo: 2,
  startedAt: AT_0925,
  status: "failed",
  senderName: null,
  promptSummary: "跳转定位怎么实现？",
  answerSummary: "data-turn-key 精确匹配",
  loaded: true,
};

/** 未加载轮 + 大纲摘要（FR-06 空态升级：大纲给到摘要照常显示）。 */
const ENTRY_UNLOADED_OUTLINE: TurnNavEntry = {
  key: "run-3",
  turnNo: 3,
  startedAt: AT_0925,
  status: "pending",
  senderName: "W",
  promptSummary: "更早一轮的大纲摘要",
  answerSummary: undefined,
  loaded: false,
};

/** 未加载轮且大纲无摘要（最空态：占位文案）。 */
const ENTRY_UNLOADED_BARE: TurnNavEntry = {
  key: "run-4",
  turnNo: 4,
  startedAt: null,
  status: "pending",
  senderName: null,
  promptSummary: undefined,
  answerSummary: undefined,
  loaded: false,
};

const FIXTURES = [ENTRY_COMPLETED, ENTRY_FAILED, ENTRY_UNLOADED_OUTLINE];

function renderNav(
  entries: TurnNavEntry[],
  overrides: Partial<TurnNavListProps> = {},
) {
  const onJump = overrides.onJump ?? vi.fn();
  const utils = render(
    <TurnNavList
      entries={entries}
      activeTurnKey={null}
      onJump={onJump}
      {...overrides}
    />,
  );
  return { ...utils, onJump };
}

/** 窄轨刻度（默认渲染；aria-label/点击契约与行式版同构）。 */
function getTicks(container: HTMLElement): HTMLElement[] {
  return within(container).getAllByTestId("turn-nav-tick");
}

/** 把手（pin 切换入口）。 */
function getToggle(container: HTMLElement): HTMLElement {
  return within(container).getByTestId("turn-nav-toggle");
}

/** pin 展开后返回浮层行列表；未展开抛错（调用方先确保展开）。 */
function getFlyoutRows(container: HTMLElement): HTMLElement[] {
  return within(within(container).getByTestId("turn-nav-flyout")).getAllByTestId(
    "turn-nav-row",
  );
}

/** 通过把手 pin 展开（触屏主通道，同步无 timer 依赖）。 */
function pinOpen(container: HTMLElement) {
  fireEvent.click(getToggle(container));
}

/** 行/刻度状态点（aria-hidden 小圆点——按 rounded-full 视觉类定位，结构无关）。 */
function getDot(row: HTMLElement): HTMLElement {
  const dot = Array.from(row.querySelectorAll("span")).find((s) =>
    s.className.includes("rounded-full"),
  );
  return dot as HTMLElement;
}

// ── 0. 短会话隐藏（TurnCatalog ql-20260909-005 同口径保留） ─────────────

describe("TurnNavList 短会话隐藏", () => {
  it("entries < 3 → 整列不渲染（0/1/2 条均隐藏）；3 条起出现窄轨", () => {
    const { container } = renderNav([]);
    expect(container.textContent).toBe("");

    const two = renderNav(FIXTURES.slice(0, 2));
    expect(two.container.textContent).toBe("");
    two.unmount();

    const three = renderNav(FIXTURES);
    expect(within(three.container).getByTestId("turn-nav-rail")).toBeTruthy();
    expect(getTicks(three.container)).toHaveLength(3);
  });
});

// ── 1. 窄轨渲染（刻度契约延续：aria-label / data-turn-key / aria-current） ─

describe("TurnNavList 窄轨刻度", () => {
  it("刻度 aria-label = 第N轮 · 状态 · 提问摘要（截 30 字）；未加载追加「未加载」", () => {
    const long30 =
      "先调研 sessions 页面的组件结构并梳理 TurnTimeline 渲染链路与跳转锚点缺口"; // >30 字
    const { container } = renderNav([
      { ...ENTRY_COMPLETED, promptSummary: long30 },
      ENTRY_FAILED,
      ENTRY_UNLOADED_OUTLINE,
    ]);
    const ticks = getTicks(container);
    expect(ticks[0]).toHaveAttribute(
      "aria-label",
      `第1轮 · 完成 · ${long30.slice(0, 30)}…`,
    );
    expect(ticks[1]).toHaveAttribute("aria-label", "第2轮 · 失败 · 跳转定位怎么实现？");
    // 未加载轮带大纲摘要：状态后缀「未加载」+ 大纲摘要照常进 label。
    expect(ticks[2]).toHaveAttribute(
      "aria-label",
      "第3轮 · 已停止 · 未加载 · 更早一轮的大纲摘要",
    );
  });

  it("把手显示当前轮号（#N）；无 active 显 —；aria-expanded 随展开态", () => {
    const { container } = renderNav(FIXTURES, { activeTurnKey: "run-2" });
    const toggle = getToggle(container);
    expect(toggle.textContent).toContain("#2");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    pinOpen(container);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

// ── 2. 展开/收起（悬停防抖 / pin / 浮层不挤压） ──────────────────────────

describe("TurnNavList 展开收起", () => {
  it("悬停 300ms 防抖滑出浮层；不足 300ms 离开不展开；展开后移开 250ms 收起", () => {
    const { container } = renderNav(FIXTURES);
    const column = within(container).getByTestId("turn-nav-column");
    fireEvent.mouseEnter(column);
    act(() => vi.advanceTimersByTime(200));
    expect(within(container).queryByTestId("turn-nav-flyout")).toBeNull();
    act(() => vi.advanceTimersByTime(100)); // 满 300ms
    expect(within(container).getByTestId("turn-nav-flyout")).toBeTruthy();

    fireEvent.mouseLeave(column);
    act(() => vi.advanceTimersByTime(150));
    expect(within(container).getByTestId("turn-nav-flyout")).toBeTruthy(); // 防抖间隙
    act(() => vi.advanceTimersByTime(100)); // 满 250ms
    expect(within(container).queryByTestId("turn-nav-flyout")).toBeNull();
  });

  it("pin 锁定常开（把手切换）；移开不收；浮层头显示总轮数与收起钮", () => {
    const { container } = renderNav(FIXTURES);
    pinOpen(container);
    const column = within(container).getByTestId("turn-nav-column");
    fireEvent.mouseLeave(column);
    act(() => vi.advanceTimersByTime(1000));
    const flyout = within(container).getByTestId("turn-nav-flyout");
    expect(flyout.textContent).toContain("共 3 轮");
    fireEvent.click(within(flyout).getByRole("button", { name: "收起轮次导航" }));
    expect(within(container).queryByTestId("turn-nav-flyout")).toBeNull();
  });

  it("浮层行内容：第N轮 + 摘要 + 相对时间；未加载无摘要占位文案", () => {
    const { container } = renderNav([
      ENTRY_COMPLETED,
      ENTRY_FAILED,
      ENTRY_UNLOADED_BARE,
    ]);
    pinOpen(container);
    const rows = getFlyoutRows(container);
    expect(rows[0]!.textContent).toContain("第1轮");
    expect(rows[0]!.textContent).toContain("调研 sessions 页面组件结构与渲染链路");
    expect(rows[2]!.textContent).toContain("未加载 — 点击加载该轮并定位");
    expect(getDot(rows[0]!)).toBeTruthy();
  });

  it("浮层 absolute 不挤压布局：列容器宽度恒为窄轨 44px（展开前后不变）", () => {
    const { container } = renderNav(FIXTURES);
    const rail = within(container).getByTestId("turn-nav-rail");
    expect(rail.style.width).toBe("44px");
    pinOpen(container);
    expect(within(container).getByTestId("turn-nav-rail").style.width).toBe("44px");
  });
});

// ── 3. 交互：点击 / Enter / active 联动 / loadingEarlier ─────────────────

describe("TurnNavList 交互与联动", () => {
  it("刻度点击直跳回调 onJump 携带完整 entry；Enter 键同样触发（键盘可达）", () => {
    const { container, onJump } = renderNav(FIXTURES);
    const ticks = getTicks(container);
    fireEvent.click(ticks[2]!);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(ENTRY_UNLOADED_OUTLINE);

    fireEvent.keyDown(ticks[0]!, { key: "Enter" });
    expect(onJump).toHaveBeenCalledTimes(2);
    expect(onJump).toHaveBeenLastCalledWith(ENTRY_COMPLETED);
  });

  it("浮层行点击跳转：非 pin 态选完即收（悬停态同收）；pin 态保持展开", () => {
    // 悬停展开态
    const a = renderNav(FIXTURES);
    const colA = within(a.container).getByTestId("turn-nav-column");
    fireEvent.mouseEnter(colA);
    act(() => vi.advanceTimersByTime(350));
    fireEvent.click(getFlyoutRows(a.container)[1]!);
    expect(a.onJump).toHaveBeenCalledWith(ENTRY_FAILED);
    expect(within(a.container).queryByTestId("turn-nav-flyout")).toBeNull();
    a.unmount();

    // pin 态：跳转后保持展开
    const b = renderNav(FIXTURES);
    pinOpen(b.container);
    const bRows = getFlyoutRows(b.container);
    fireEvent.click(bRows[1]!);
    expect(b.onJump).toHaveBeenCalledWith(ENTRY_FAILED);
    expect(within(b.container).getByTestId("turn-nav-flyout")).toBeTruthy();
  });

  it("activeTurnKey 命中刻度/行 aria-current=true；变化时轨内 scrollIntoView（block:nearest，首渲不滚）", () => {
    const onJump = vi.fn();
    const scrollSpy = Element.prototype.scrollIntoView as Mock;
    const view = render(
      <TurnNavList entries={FIXTURES} activeTurnKey="run-2" onJump={onJump} />,
    );
    const ticks = getTicks(view.container);
    expect(ticks[1]).toHaveAttribute("aria-current", "true");
    expect(ticks[0]).not.toHaveAttribute("aria-current");
    // ref 守卫：首次渲染（含初始 active）不滚动。
    expect(scrollSpy).not.toHaveBeenCalled();

    // active 变化 → 命中刻度 scrollIntoView({ block: "nearest" })。
    view.rerender(
      <TurnNavList entries={FIXTURES} activeTurnKey="run-1" onJump={onJump} />,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollSpy.mock.instances[0]).toBe(ticks[0]);
  });

  it("loadingEarlier → 轨标注 aria-busy（跳转加载进行中）", () => {
    const { container } = renderNav(FIXTURES, { loadingEarlier: true });
    expect(
      within(container).getByTestId("turn-nav-rail-ticks"),
    ).toHaveAttribute("aria-busy", "true");
  });
});

// ── 4. 长列表防卡（FR-06：>200 轮固定行高 + content-visibility） ─────────

describe("TurnNavList 长列表防卡", () => {
  function makeMany(n: number): TurnNavEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      key: `run-${i}`,
      turnNo: i + 1,
      startedAt: AT_0925,
      status: "completed" as const,
      senderName: null,
      promptSummary: `第 ${i + 1} 轮摘要`,
      answerSummary: undefined,
      loaded: true,
    }));
  }

  it("≤200 轮浮层行高自适应（无 content-visibility 内联样式）；>200 轮固定行高 + contentVisibility:auto", () => {
    const short = renderNav(makeMany(200));
    pinOpen(short.container);
    const shortRow = getFlyoutRows(short.container)[0]!;
    expect(shortRow.className).not.toContain("h-[44px]");
    expect(shortRow.style.contentVisibility).toBe("");
    short.unmount();

    const long = renderNav(makeMany(201));
    pinOpen(long.container);
    const longRow = getFlyoutRows(long.container)[0]!;
    expect(longRow.className).toContain("h-[44px]");
    expect(longRow.style.contentVisibility).toBe("auto");
    expect(longRow.style.containIntrinsicSize).toBe("44px");
  });
});
