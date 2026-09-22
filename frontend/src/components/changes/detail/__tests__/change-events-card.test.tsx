// task-07（2026-09-23-change-events-channel）：观测事件卡四组——渲染/告警高亮/
// 空态/角标计数。数据源 listChangeEvents vi.mock 部分替换（change-sessions-card
// 同范式），@tanstack/react-query 走真实 QueryClient + wrapper；时间列渲染与
// locale 相关（zh-CN toLocaleString），不断言时间文本，只断言 kind/rule/detail
// 与 testid / class 副作用。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeEventsCard } from "@/components/changes/detail/change-events-card";
import type {
  ChangeEventItem,
  ChangeEventListResponse,
} from "@/lib/changes";

const mocks = vi.hoisted(() => ({
  listChangeEvents: vi.fn(),
}));

// 部分 mock：仅替换本卡数据源 listChangeEvents，模块其余导出保持真实实现。
vi.mock("@/lib/changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/changes")>()),
  listChangeEvents: mocks.listChangeEvents,
}));

/** 造一行观测事件：seq 唯一即可（id UUID / ts ISO，仅作 key 与渲染输入）。 */
function eventOf(
  seq: string,
  kind: string,
  opts: {
    severity?: string | null;
    rule?: string | null;
    detail?: string | null;
    provisional?: boolean;
  } = {},
): ChangeEventItem {
  return {
    id: `00000000-0000-0000-0000-0000000000${seq}`,
    ts: `2026-09-23T04:00:00.${seq}Z`,
    kind,
    stage: null,
    detail: opts.detail ?? null,
    rule: opts.rule ?? null,
    severity: opts.severity ?? null,
    provisional: opts.provisional ?? true,
    created_at: "2026-09-23T04:00:00Z",
  };
}

function resp(items: ChangeEventItem[]): ChangeEventListResponse {
  return { items, total: items.length };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeEventsCard workspaceId="ws-1" changeKey="2026-09-23-demo" />
    </QueryClientProvider>,
  );
}

describe("ChangeEventsCard 观测事件卡（task-07）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("渲染：3 条事件（含 1 条 warning）→ 容器 testid 存在、3 行 kind 各一、每行 provisional 徽标", async () => {
    mocks.listChangeEvents.mockResolvedValue(
      resp([
        eventOf("01", "stage_transition", {
          severity: "warning",
          rule: "P0-stage-skipped",
          detail: "跳过验证阶段",
        }),
        eventOf("02", "test_run"),
        eventOf("03", "file_change"),
      ]),
    );
    renderCard();

    expect(await screen.findByTestId("change-events-card")).toBeInTheDocument();
    // 3 行：三个 kind 文本各出现一次（首轮含 warning → 自动展开，内容可见）。
    // findBy 等数据到达 + 自动展开（容器 testid 首帧即存在，不能作数据就绪信号）。
    expect(await screen.findByText("stage_transition")).toBeInTheDocument();
    expect(screen.getByText("test_run")).toBeInTheDocument();
    expect(screen.getByText("file_change")).toBeInTheDocument();
    // provisional 徽标每行一个（title 为 D-004 红线文案）。
    expect(
      screen.getAllByTitle("旁路观测信号，非流程真相"),
    ).toHaveLength(3);
    // warning 行的 rule（⚖ 前缀 span，title 透传）与 detail 文本可见。
    expect(screen.getByTitle("P0-stage-skipped")).toHaveTextContent(
      "⚖ P0-stage-skipped",
    );
    expect(screen.getByText("跳过验证阶段")).toBeInTheDocument();
  });

  it("告警高亮：warning 行带 change-event-row-warning + 琥珀高亮类，非 warning 行无；角标显示 warning 计数", async () => {
    mocks.listChangeEvents.mockResolvedValue(
      resp([
        eventOf("01", "test_run", { severity: "warning" }),
        eventOf("02", "file_change"),
        eventOf("03", "stage_transition"),
      ]),
    );
    renderCard();

    await screen.findByText("test_run");
    // 3 行中仅 warning 行命中 testid（getAllByTestId 是全量收集）。
    const warningRows = screen.getAllByTestId("change-event-row-warning");
    expect(warningRows).toHaveLength(1);
    expect(warningRows[0]).toHaveTextContent("test_run");
    // 琥珀高亮类（组件 warning 分支 border-amber-300 bg-amber-50）。
    expect(warningRows[0]).toHaveClass("border-amber-300");
    // 非 warning 行：kind span 的直接父级是行容器，无 data-testid 也无高亮类。
    const normalRow = screen.getByText("file_change").parentElement!;
    expect(normalRow).not.toHaveAttribute("data-testid");
    expect(normalRow).not.toHaveClass("border-amber-300");
    // 角标显示 1 条 warning 计数。
    expect(screen.getByTestId("change-events-warning-badge")).toHaveTextContent(
      "1",
    );
  });

  it("空态：items=[] → 无 warning 角标；展开后显示「暂无观测事件」", async () => {
    mocks.listChangeEvents.mockResolvedValue(resp([]));
    renderCard();

    // 无 warning → 默认收起：空态文案不可见。
    expect(screen.queryByText("暂无观测事件")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("change-events-warning-badge"),
    ).not.toBeInTheDocument();
    // 点击展开后空态文案出现。
    fireEvent.click(screen.getByRole("button", { name: "展开 ▼" }));
    expect(await screen.findByText("暂无观测事件")).toBeInTheDocument();
    expect(
      screen.queryByTestId("change-events-warning-badge"),
    ).not.toBeInTheDocument();
  });

  it("角标计数与展开：2 条 warning → 角标「2」且默认自动展开", async () => {
    mocks.listChangeEvents.mockResolvedValue(
      resp([
        eventOf("01", "test_run", { severity: "warning" }),
        eventOf("02", "lint", { severity: "warning" }),
        eventOf("03", "file_change"),
      ]),
    );
    renderCard();

    // 首轮含 warning → 自动展开：行内容可见（内容仅在 open 时渲染）。
    expect(await screen.findByText("test_run")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByText("file_change")).toBeInTheDocument();
    // 角标文本为 warning 计数 2。
    expect(screen.getByTestId("change-events-warning-badge")).toHaveTextContent(
      "2",
    );
    expect(screen.getByRole("button", { name: "收起 ▲" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("角标计数与展开：0 warning（3 条普通事件）→ 无角标默认收起，点击展开后内容可见", async () => {
    mocks.listChangeEvents.mockResolvedValue(
      resp([
        eventOf("01", "test_run"),
        eventOf("02", "lint"),
        eventOf("03", "file_change"),
      ]),
    );
    renderCard();

    // 默认收起：展开按钮 aria-expanded=false，行内容与空态文案均不可见。
    const toggle = screen.getByRole("button", { name: "展开 ▼" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("test_run")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无观测事件")).not.toBeInTheDocument();
    // 点击展开：aria-expanded 翻转，3 行内容可见（此处同时证明数据已到）。
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "true"),
    );
    expect(await screen.findByText("test_run")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByText("file_change")).toBeInTheDocument();
    // 数据已渲染但 0 warning → 仍无角标。
    expect(
      screen.queryByTestId("change-events-warning-badge"),
    ).not.toBeInTheDocument();
  });
});
