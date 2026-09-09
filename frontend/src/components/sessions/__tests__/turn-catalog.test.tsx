/**
 * TurnCatalog（TickRail 刻度轨）组件单测（2026-09-08-session-turn-nav task-02 /
 * FR-01 FR-02 FR-08 / D-003@v2 D-007@v1）。
 *
 * 依据：
 *   - components/sessions/turn-catalog.tsx（本 task 实现）
 *   - design §5（组件契约）/ §9（UI 规格）/ §11（测试策略）
 *   - prototype-session-turn-nav.html v3（.tick-rail / .tick / .tick-flyout 交互基准）
 *   - tasks/task-02.md acceptance：刻度数量/状态类、hover 与 focus 飞出卡（内容与
 *     垂直钳制）、aria-label/aria-current、未加载空心与 meta 尾注、click 携带 entry、
 *     hover:none（触屏）不挂飞出卡。
 *
 * 测试风格对齐同目录 session-config-bar.test.tsx（testing-library + cleanup）。
 * 纯受控组件：不 mock 任何模块；jsdom 缺口按惯例补——scrollIntoView 未实现
 * （beforeEach 挂 stub）、matchMedia 由 src/test/setup.ts polyfill（matches:false
 * = 有 hover），触屏用例用 vi.stubGlobal 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

import TurnCatalog, {
  computeFlyoutTop,
  type TurnCatalogEntry,
  type TurnCatalogProps,
} from "@/components/sessions/turn-catalog";

// ── jsdom 缺口 ───────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom 未实现 scrollIntoView（activeTurnKey 变化 → 刻度滚入轨内可视区链路）。
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── 固件构造 ─────────────────────────────────────────────────────────────

/** 本地时区固化的 startedAt（toString 可往返解析，避免 toISOString 时区偏移）。 */
const AT_0925 = new Date(2026, 8, 8, 9, 25).toString();
const AT_1042 = new Date(2026, 8, 8, 10, 42).toString();

const LONG_PROMPT =
  "先调研 sessions 页面的组件结构并梳理 TurnTimeline 渲染链路与跳转锚点缺口"; // >30 字

const ENTRY_COMPLETED: TurnCatalogEntry = {
  key: "run-1",
  turnNo: 1,
  startedAt: AT_0925,
  status: "completed",
  senderName: null,
  promptSummary: LONG_PROMPT,
  answerSummary: "SessionsPortal → grid[320px|1fr]，右侧 SessionPanel 分发 page/dialog 两种模式",
  loaded: true,
};

const ENTRY_FAILED: TurnCatalogEntry = {
  key: "run-2",
  turnNo: 2,
  startedAt: AT_1042,
  status: "failed",
  senderName: null,
  promptSummary: "跳转定位怎么实现？",
  answerSummary: "TurnRow 根节点新增 data-turn-key，跳转时 querySelector 精确匹配",
  loaded: true,
};

const ENTRY_UNLOADED: TurnCatalogEntry = {
  key: "run-3",
  turnNo: 3,
  startedAt: AT_0925,
  status: "pending",
  senderName: "W",
  promptSummary: undefined,
  answerSummary: undefined,
  loaded: false,
};

const FIXTURES = [ENTRY_COMPLETED, ENTRY_FAILED, ENTRY_UNLOADED];

function renderCatalog(
  entries: TurnCatalogEntry[],
  overrides: Partial<TurnCatalogProps> = {},
) {
  const onJump = overrides.onJump ?? vi.fn();
  const utils = render(
    <TurnCatalog entries={entries} activeTurnKey={null} onJump={onJump} {...overrides} />,
  );
  return { ...utils, onJump };
}

function getNav(container: HTMLElement): HTMLElement {
  return within(container).getByRole("navigation");
}

function getTicks(container: HTMLElement): HTMLElement[] {
  return within(getNav(container)).getAllByRole("button");
}

// ── 0. 短会话隐藏（ql-20260909-005） ──────────────────────────────────────

describe("TurnCatalog 短会话隐藏（ql-20260909-005）", () => {
  it("entries < 3 → 整条轨道不渲染（0/1/2 条均隐藏）；3 条起出现", () => {
    const { container } = renderCatalog([]);
    expect(container.textContent).toBe("");

    const two = renderCatalog(FIXTURES.slice(0, 2));
    expect(two.container.textContent).toBe("");
    two.unmount();

    const three = renderCatalog(FIXTURES);
    expect(within(three.container).getByRole("navigation")).toBeTruthy();
  });

  it("隐藏→增长跨阈值自动出现（entries 1 → 3）", () => {
    const { container, rerender } = renderCatalog(FIXTURES.slice(0, 1));
    expect(within(container).queryByRole("navigation")).toBeNull();
    rerender(
      <TurnCatalog entries={FIXTURES} activeTurnKey={null} onJump={vi.fn()} />,
    );
    expect(within(container).getByRole("navigation")).toBeTruthy();
    expect(within(container).getAllByRole("button")).toHaveLength(3);
  });
});

// ── 1. 刻度渲染（数量/状态类） ────────────────────────────────────────────

describe("TurnCatalog 刻度渲染", () => {
  it("entries 每项渲染一条刻度 button（3 条目 → 3 刻度），轨带导航语义", () => {
    const { container } = renderCatalog(FIXTURES);
    const nav = getNav(container);
    expect(nav).toHaveAttribute("aria-label", "轮次刻度导航");
    expect(within(nav).getAllByRole("button")).toHaveLength(FIXTURES.length);
  });

  it("completed 默认态：muted 低透明度细杠，无 failed/running/空心类", () => {
    const { container } = renderCatalog(FIXTURES);
    const cls = getTicks(container)[0]!.className;
    expect(cls).toContain("w-[14px]");
    expect(cls).toContain("bg-muted-foreground");
    expect(cls).toContain("opacity-45");
    expect(cls).not.toContain("bg-destructive");
    expect(cls).not.toContain("animate-pulse");
    expect(cls).not.toContain("bg-transparent");
  });

  it("failed → bg-destructive/75；running → bg-warning 脉冲", () => {
    // ql-20260909-005：<3 条轨道隐藏——本用例补第三条凑齐显隐阈值（状态色断言
    // 与前两条刻度相关，第三条目纯占位）。
    const { container } = renderCatalog([
      { ...ENTRY_FAILED, key: "run-f", turnNo: 1 },
      { ...ENTRY_COMPLETED, key: "run-r", turnNo: 2, status: "running" },
      { ...ENTRY_COMPLETED, key: "run-c", turnNo: 3 },
    ]);
    const [failedCls, runningCls] = getTicks(container).map((t) => t.className);
    expect(failedCls).toContain("bg-destructive");
    expect(failedCls).toContain("opacity-75");
    expect(failedCls).not.toContain("animate-pulse");
    expect(runningCls).toContain("bg-warning");
    expect(runningCls).toContain("animate-pulse");
  });

  it("aria-label = 第N轮 · 状态 · 提问摘要（截 30 字加省略号）", () => {
    const { container } = renderCatalog(FIXTURES);
    const ticks = getTicks(container);
    expect(ticks[0]).toHaveAttribute(
      "aria-label",
      expect.stringContaining(`${LONG_PROMPT.slice(0, 30)}…`),
    );
    expect(ticks[0]).toHaveAttribute("aria-label", "第1轮 · 完成 · 先调研 sessions 页面的组件结构并梳理 TurnTi…");
    expect(ticks[1]).toHaveAttribute("aria-label", "第2轮 · 失败 · 跳转定位怎么实现？");
  });
});

// ── 2. 未加载空心态 ──────────────────────────────────────────────────────

describe("TurnCatalog 未加载刻度", () => {
  it("!loaded → 空心描边（bg-transparent + inset shadow），aria-label 含「未加载」", () => {
    const { container } = renderCatalog(FIXTURES);
    const unloaded = getTicks(container)[2]!;
    const cls = unloaded.className;
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground)/0.6)]");
    expect(cls).not.toContain("bg-muted-foreground");
    // 状态文案后缀「未加载」；未加载无提问摘要 → aria-label 到此为止
    expect(unloaded).toHaveAttribute("aria-label", "第3轮 · 已停止 · 未加载");
  });
});

// ── 3. 飞出卡（hover / focus / 定位钳制 / 触屏） ──────────────────────────

describe("TurnCatalog 飞出卡", () => {
  it("hover 刻度显示飞出卡：轮号+提问+正文摘要+meta，离开隐藏", () => {
    const { container } = renderCatalog(FIXTURES);
    const ticks = getTicks(container);
    fireEvent.mouseOver(ticks[1]!);

    const flyout = screen.getByTestId("tick-flyout");
    expect(flyout.className).toContain("show");
    expect(flyout.textContent).toContain("2 轮 · 跳转定位怎么实现？");
    expect(flyout.textContent).toContain("TurnRow 根节点新增 data-turn-key");
    // meta = HH:mm · 状态 · 发送者（senderName 空 → 「我」）
    expect(flyout.textContent).toContain("10:42 · 失败 · 我");

    fireEvent.mouseOut(ticks[1]!);
    expect(flyout.className).not.toContain("show");
  });

  it("键盘 focus 触发飞出卡；未加载条目 meta 追加「未加载 — 点击加载该轮并定位」", () => {
    const { container } = renderCatalog(FIXTURES);
    const ticks = getTicks(container);
    fireEvent.focus(ticks[2]!);

    const flyout = screen.getByTestId("tick-flyout");
    expect(flyout.className).toContain("show");
    expect(flyout.textContent).toContain("3 轮");
    expect(flyout.textContent).toContain("09:25 · 已停止 · W");
    expect(flyout.textContent).toContain("未加载 — 点击加载该轮并定位");
  });

  it("飞出卡垂直定位随刻度居中并钳制在轨内上下 8px（R-09）", () => {
    const { container } = renderCatalog(FIXTURES);
    const nav = getNav(container);
    const ticks = getTicks(container);
    const flyout = screen.getByTestId("tick-flyout");
    // 量测前提 mock：轨高 300、卡高 200（半高 100）
    Object.defineProperty(nav, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(flyout, "offsetHeight", { value: 200, configurable: true });

    // 底部刻度（offsetTop 1000）：未钳制 top=900 → 钳到轨高-卡高-8=92
    Object.defineProperty(ticks[2]!, "offsetTop", { value: 1000, configurable: true });
    fireEvent.mouseOver(ticks[2]!);
    expect(flyout.style.top).toBe("92px");

    // 顶部刻度（offsetTop 0）：居中 top=-100 → 钳到下限 8
    Object.defineProperty(ticks[0]!, "offsetTop", { value: 0, configurable: true });
    fireEvent.mouseOver(ticks[0]!);
    expect(flyout.style.top).toBe("8px");

    // 定位纯函数边界直测（居中不触界 / 上限 / 下限）
    expect(computeFlyoutTop(150, 300, 200)).toBe(50);
    expect(computeFlyoutTop(1000, 300, 200)).toBe(92);
    expect(computeFlyoutTop(0, 300, 200)).toBe(8);
  });

  it("hover:none（触屏）不挂飞出卡，点击刻度直接 onJump", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(hover: none)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    const { container, onJump } = renderCatalog(FIXTURES);
    const ticks = getTicks(container);
    expect(screen.queryByTestId("tick-flyout")).not.toBeInTheDocument();
    fireEvent.mouseOver(ticks[1]!);
    expect(screen.queryByTestId("tick-flyout")).not.toBeInTheDocument();
    fireEvent.click(ticks[1]!);
    expect(onJump).toHaveBeenCalledWith(ENTRY_FAILED);
  });
});

// ── 4. 点击回调 / active 联动 / 空态 ─────────────────────────────────────

describe("TurnCatalog 交互与联动", () => {
  it("点击刻度回调 onJump 携带完整 entry 对象", () => {
    const { container, onJump } = renderCatalog(FIXTURES);
    fireEvent.click(getTicks(container)[2]!);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(ENTRY_UNLOADED);
  });

  it("activeTurnKey 命中刻度 aria-current=true；变化时轨内 scrollIntoView（首次渲染不滚）", () => {
    const onJump = vi.fn();
    const scrollSpy = Element.prototype.scrollIntoView as Mock;
    const view = render(
      <TurnCatalog entries={FIXTURES} activeTurnKey="run-2" onJump={onJump} />,
    );
    const ticks = getTicks(view.container);
    expect(ticks[1]).toHaveAttribute("aria-current", "true");
    expect(ticks[0]).not.toHaveAttribute("aria-current");
    expect(ticks[2]).not.toHaveAttribute("aria-current");
    // ref 守卫：首次渲染（含初始 active）不滚动
    expect(scrollSpy).not.toHaveBeenCalled();

    // active 变化 → 命中刻度 scrollIntoView({ block: "nearest" })
    view.rerender(<TurnCatalog entries={FIXTURES} activeTurnKey="run-1" onJump={onJump} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollSpy.mock.instances[0]).toBe(ticks[0]);
    expect(ticks[0]).toHaveAttribute("aria-current", "true");
    expect(ticks[1]).not.toHaveAttribute("aria-current");
  });

  it("空 entries 渲染不崩：整条轨道不渲染（ql-20260909-005 短会话隐藏同口径）", () => {
    const { container } = renderCatalog([]);
    expect(container.textContent).toBe("");
    expect(within(container).queryByRole("navigation")).toBeNull();
  });

  it("loadingEarlier → 轨标注 aria-busy（跳转加载进行中）", () => {
    const { container } = renderCatalog(FIXTURES, { loadingEarlier: true });
    expect(getNav(container)).toHaveAttribute("aria-busy", "true");
  });
});
