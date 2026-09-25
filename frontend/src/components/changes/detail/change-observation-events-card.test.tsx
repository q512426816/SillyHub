// 2026-09-26-change-events-r18-full task-03：观测事件卡组件单测。
//
// 覆盖（FR-07/FR-08 四组）：
//   1. 渲染：3 条事件（含 1 warning）→ 行数/时间/规则/kind/provisional 徽标可见；
//      30s 轮询（refetchInterval=30000 由 useQuery 承载——以 30s 常量 + query 挂载为
//      断言面，不 mock react-query 内部）；拉取 URL 正确（changeKey 透传）。
//   2. 高亮：warning 行 data-severity=warning + 琥珀样式；info 行无。
//   3. 空态：空 items → 「暂无观测事件」，卡收起、无角标。
//   4. 角标：有 warning → 默认展开 + 角标=warning 计数；无 warning → 默认收起 +
//      角标=事件总数；点击折叠头切换。
//
// 红线 D-004：组件零业务逻辑——断言不渲染任何按钮型流程动作（除折叠头外无 button）。
// 模式：mock @/lib/change-events（QueryClientProvider 包裹，机器卡先例）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { ChangeEventListResponse } from "@/lib/change-events";

vi.mock("@/lib/change-events", () => ({
  listChangeEvents: vi.fn(),
}));

import { listChangeEvents } from "@/lib/change-events";
import { ChangeObservationEventsCard } from "@/components/changes/detail/change-observation-events-card";

const fetchMock = vi.mocked(listChangeEvents);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    kind: "watchdog",
    rule: "stage-stuck",
    severity: "info",
    provisional: true,
    detail: "详情文本",
    ts: "2026-09-26T06:20:11Z",
    ...overrides,
  };
}

function renderCard(data: ChangeEventListResponse, changeKey = "demo-change") {
  fetchMock.mockResolvedValue(data);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ChangeObservationEventsCard changeKey={changeKey} />
    </QueryClientProvider>,
  );
  return utils;
}

describe("ChangeObservationEventsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染：事件行齐全 + changeKey 透传取数 + provisional 徽标悬停文案", async () => {
    renderCard({
      change_name: "demo-change",
      count: 3,
      items: [
        makeEvent({ id: "e1", ts: "2026-09-26T06:20:00Z", rule: "cli-alive", kind: "heartbeat" }),
        makeEvent({ id: "e2", ts: "2026-09-26T06:21:00Z", severity: "warning", rule: "stage-stuck" }),
        makeEvent({ id: "e3", ts: "2026-09-26T06:22:00Z", provisional: false, rule: "gate-retry" }),
      ],
    });
    await waitFor(() => expect(screen.getByText("cli-alive")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("demo-change");
    expect(screen.getByText("stage-stuck")).toBeTruthy();
    expect(screen.getByText("gate-retry")).toBeTruthy();
    expect(screen.getByText("09-26 06:20:00")).toBeTruthy();
    // provisional 徽标：2 个 provisional（e1/e2）+ 1 个非（e3 不出）
    const badges = screen.getAllByText("provisional");
    expect(badges.length).toBe(2);
    expect(badges[0]?.getAttribute("title")).toBe("旁路观测信号，非流程真相");
  });

  it("高亮：warning 行带 severity 标记与琥珀类；info 行无", async () => {
    renderCard({
      change_name: "demo-change",
      count: 2,
      items: [
        makeEvent({ id: "w1", severity: "warning" }),
        makeEvent({ id: "i1", severity: "info" }),
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId("change-observation-event-w1")).toBeTruthy(),
    );
    const warnRow = screen.getByTestId("change-observation-event-w1");
    expect(warnRow.getAttribute("data-severity")).toBe("warning");
    expect(warnRow.className).toContain("amber");
    const infoRow = screen.getByTestId("change-observation-event-i1");
    expect(infoRow.getAttribute("data-severity")).toBe("info");
    expect(infoRow.className).not.toContain("amber");
  });

  it("空态：空 items → 默认收起 + 空态文案 + 无角标；点开可见空态", async () => {
    renderCard({ change_name: "demo-change", count: 0, items: [] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // 默认收起（无 warning）
    expect(
      screen.getByTestId("change-observation-events-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("change-observation-events-badge")).toBeNull();
    fireEvent.click(screen.getByTestId("change-observation-events-toggle"));
    expect(
      screen.getByTestId("change-observation-events-empty").textContent,
    ).toBe("暂无观测事件");
  });

  it("角标：有 warning → 默认展开 + 角标=warning 计数；无 warning → 收起+角标=总数；点击切换", async () => {
    const { unmount } = renderCard({
      change_name: "demo-change",
      count: 3,
      items: [
        makeEvent({ id: "a1", severity: "info" }),
        makeEvent({ id: "a2", severity: "warning" }),
        makeEvent({ id: "a3", severity: "warning" }),
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId("change-observation-events-badge")).toBeTruthy(),
    );
    // 默认展开（存在 warning）
    expect(
      screen.getByTestId("change-observation-events-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByTestId("change-observation-events-badge").textContent).toBe("2");
    // 手动折叠
    fireEvent.click(screen.getByTestId("change-observation-events-toggle"));
    expect(
      screen.getByTestId("change-observation-events-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    unmount();

    // 无 warning：默认收起 + 角标=总数
    renderCard({
      change_name: "demo-change",
      count: 2,
      items: [makeEvent({ id: "b1" }), makeEvent({ id: "b2" })],
    });
    await waitFor(() =>
      expect(screen.getByTestId("change-observation-events-badge")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("change-observation-events-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByTestId("change-observation-events-badge").textContent).toBe("2");
  });

  it("红线 D-004：事件体零业务动作（除折叠头外无 button）；拉取失败卡隐藏", async () => {
    const { container } = renderCard({
      change_name: "demo-change",
      count: 2,
      items: [makeEvent({ id: "r1", severity: "warning" }), makeEvent({ id: "r2" })],
    });
    await waitFor(() =>
      expect(screen.getByTestId("change-observation-event-r1")).toBeTruthy(),
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1); // 仅折叠头

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockRejectedValue(new Error("network down"));
    const { container: errContainer } = render(
      <QueryClientProvider client={qc}>
        <ChangeObservationEventsCard changeKey="demo-change" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(errContainer.querySelector("section")).toBeNull(),
    );
  });
});
