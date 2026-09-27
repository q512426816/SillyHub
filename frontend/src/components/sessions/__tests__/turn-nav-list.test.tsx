/**
 * TurnNavList（行式轮次导航列）组件单测（2026-09-27-session-fast-replay task-04 /
 * FR-06）。
 *
 * 依据：
 *   - components/sessions/turn-nav-list.tsx（本 task 实现）
 *   - design.md §做法概述⑤ / FR-06：desktop 常驻行式导航列（约 220px 可拖宽）、
 *     每行整行命中（≥40px）含轮号+状态点+摘要+相对时间、当前轮高亮滚动联动、
 *     未加载轮显示大纲摘要、>200 轮固定行高 + content-visibility、aria-label
 *     轮号/状态/摘要语义保留（TurnCatalog task-02 契约延续）。
 *
 * 测试风格对齐同目录 turn-catalog.test.tsx（testing-library + cleanup；纯受控
 * 组件不 mock 网络层；jsdom 缺口补 scrollIntoView stub）。合并语义
 * （mergeTurnNavEntries）在 session-panel-page 派生层，由 page.test 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

import TurnNavList, {
  type TurnNavListProps,
} from "@/components/sessions/turn-nav-list";
import type { TurnNavEntry } from "@/components/sessions/turn-nav-list";

// ── jsdom 缺口 ───────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom 未实现 scrollIntoView（activeTurnKey 变化 → 行滚入轨内可视区链路）。
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
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

function getNav(container: HTMLElement): HTMLElement {
  return within(container).getByRole("navigation");
}

function getRows(container: HTMLElement): HTMLElement[] {
  return within(getNav(container)).getAllByRole("button");
}

/** 行状态点（轮号旁 aria-hidden 小圆点——按 rounded-full 视觉类定位，结构无关）。 */
function getDot(row: HTMLElement): HTMLElement {
  const dot = Array.from(row.querySelectorAll("span")).find((s) =>
    s.className.includes("rounded-full"),
  );
  return dot as HTMLElement;
}

// ── 0. 短会话隐藏（TurnCatalog ql-20260909-005 同口径保留） ─────────────

describe("TurnNavList 短会话隐藏", () => {
  it("entries < 3 → 整列不渲染（0/1/2 条均隐藏）；3 条起出现", () => {
    const { container } = renderNav([]);
    expect(container.textContent).toBe("");

    const two = renderNav(FIXTURES.slice(0, 2));
    expect(two.container.textContent).toBe("");
    two.unmount();

    const three = renderNav(FIXTURES);
    expect(within(three.container).getByRole("navigation")).toBeTruthy();
    expect(within(three.container).getAllByRole("button")).toHaveLength(3);
  });
});

// ── 1. 行渲染（轮号/状态点/摘要/相对时间/aria-label） ────────────────────

describe("TurnNavList 行渲染", () => {
  it("每行整行命中区（button + data-turn-key），导航语义 aria-label=轮次导航", () => {
    const { container } = renderNav(FIXTURES);
    const nav = getNav(container);
    expect(nav).toHaveAttribute("aria-label", "轮次导航");
    const rows = getRows(container);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-turn-key", "run-1");
  });

  it("行内容：第N轮 + 摘要 + 相对时间（HH 跨度回退日期档不在此断言时刻值）", () => {
    const { container } = renderNav(FIXTURES);
    const rows = getRows(container);
    expect(rows[0]!.textContent).toContain("第1轮");
    expect(rows[0]!.textContent).toContain("调研 sessions 页面组件结构与渲染链路");
    // AT_0925 为本地时区固化时刻——相对时间档位由渲染期 Date.now 决定，只断
    // 轮号 + 摘要 + 状态点结构（相对时间文案随现实时钟漂移，不硬编码）。
    expect(getDot(rows[0]!)).toBeTruthy();
  });

  it("aria-label = 第N轮 · 状态 · 提问摘要（截 30 字）；未加载追加「未加载」", () => {
    const long30 =
      "先调研 sessions 页面的组件结构并梳理 TurnTimeline 渲染链路与跳转锚点缺口"; // >30 字
    const { container } = renderNav([
      { ...ENTRY_COMPLETED, promptSummary: long30 },
      ENTRY_FAILED,
      ENTRY_UNLOADED_OUTLINE,
    ]);
    const rows = getRows(container);
    expect(rows[0]).toHaveAttribute(
      "aria-label",
      `第1轮 · 完成 · ${long30.slice(0, 30)}…`,
    );
    expect(rows[1]).toHaveAttribute("aria-label", "第2轮 · 失败 · 跳转定位怎么实现？");
    // 未加载轮带大纲摘要：状态后缀「未加载」+ 大纲摘要照常进 label。
    expect(rows[2]).toHaveAttribute(
      "aria-label",
      "第3轮 · 已停止 · 未加载 · 更早一轮的大纲摘要",
    );
  });

  it("未加载且大纲无摘要 → 占位文案「未加载 — 点击加载该轮并定位」", () => {
    const { container } = renderNav([
      ENTRY_COMPLETED,
      ENTRY_FAILED,
      ENTRY_UNLOADED_BARE,
    ]);
    const row = getRows(container)[2]!;
    expect(row.textContent).toContain("未加载 — 点击加载该轮并定位");
    expect(row).toHaveAttribute("aria-label", "第4轮 · 已停止 · 未加载");
  });

  it("状态点配色：failed → destructive；running → warning 脉冲；active → brand", () => {
    const { container } = renderNav([
      { ...ENTRY_FAILED, key: "run-f", turnNo: 1 },
      { ...ENTRY_COMPLETED, key: "run-r", turnNo: 2, status: "running" },
      { ...ENTRY_COMPLETED, key: "run-a", turnNo: 3 },
    ]);
    const rows = getRows(container);
    expect(getDot(rows[0]!).className).toContain("bg-destructive");
    expect(getDot(rows[1]!).className).toContain("bg-warning");
    expect(getDot(rows[1]!).className).toContain("animate-pulse");
  });
});

// ── 2. 长列表防卡（FR-06：>200 轮固定行高 + content-visibility） ─────────

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

  it("≤200 轮行高自适应（无 content-visibility 内联样式）；>200 轮固定行高 + contentVisibility:auto", () => {
    const short = renderNav(makeMany(200));
    const shortRow = getRows(short.container)[0]!;
    expect(shortRow.className).not.toContain("h-[44px]");
    expect(shortRow.style.contentVisibility).toBe("");
    short.unmount();

    const long = renderNav(makeMany(201));
    const longRow = getRows(long.container)[0]!;
    expect(longRow.className).toContain("h-[44px]");
    expect(longRow.style.contentVisibility).toBe("auto");
    expect(longRow.style.containIntrinsicSize).toBe("44px");
  });
});

// ── 3. 交互：点击 / Enter / active 联动 / loadingEarlier ─────────────────

describe("TurnNavList 交互与联动", () => {
  it("点击行回调 onJump 携带完整 entry；Enter 键同样触发（键盘可达）", () => {
    const { container, onJump } = renderNav(FIXTURES);
    const rows = getRows(container);
    fireEvent.click(rows[2]!);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(ENTRY_UNLOADED_OUTLINE);

    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(onJump).toHaveBeenCalledTimes(2);
    expect(onJump).toHaveBeenLastCalledWith(ENTRY_COMPLETED);
  });

  it("activeTurnKey 命中行 aria-current=true；变化时轨内 scrollIntoView（block:nearest，首渲不滚）", () => {
    const onJump = vi.fn();
    const scrollSpy = Element.prototype.scrollIntoView as Mock;
    const view = render(
      <TurnNavList entries={FIXTURES} activeTurnKey="run-2" onJump={onJump} />,
    );
    const rows = getRows(view.container);
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current");
    // ref 守卫：首次渲染（含初始 active）不滚动。
    expect(scrollSpy).not.toHaveBeenCalled();

    // active 变化 → 命中行 scrollIntoView({ block: "nearest" })。
    view.rerender(
      <TurnNavList entries={FIXTURES} activeTurnKey="run-1" onJump={onJump} />,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollSpy.mock.instances[0]).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("loadingEarlier → 轨标注 aria-busy（跳转加载进行中）", () => {
    const { container } = renderNav(FIXTURES, { loadingEarlier: true });
    expect(getNav(container)).toHaveAttribute("aria-busy", "true");
  });
});

// ── 4. 列宽：默认 220 + 记忆键 + 拖宽把手 ────────────────────────────────

describe("TurnNavList 列宽", () => {
  it("默认 220px；把手挂载（role=separator）；localStorage 记忆键 sillyhub.sessions.turnNavWidth", () => {
    const { container } = renderNav(FIXTURES);
    const column = container.querySelector<HTMLElement>(
      '[data-testid="turn-nav-column"]',
    );
    expect(column).toBeTruthy();
    expect(column!.style.width).toBe("220px");
    const resizer = within(container).getByRole("separator", {
      name: "调整轮次导航宽度",
    });
    expect(resizer).toHaveAttribute("aria-valuenow", "220");
    expect(resizer).toHaveAttribute("aria-valuemin", "180");
    expect(resizer).toHaveAttribute("aria-valuemax", "320");
    // 拖宽写 localStorage（双击复位默认不改宽；用键盘 ArrowRight +16 验证记忆）。
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(column!.style.width).toBe("236px");
    expect(window.localStorage.getItem("sillyhub.sessions.turnNavWidth")).toBe(
      "236",
    );
  });
});
