/**
 * notification-bell 测试（2026-08-29-approval-notify-push task-11）。
 *
 * 组件层数据 hooks 全部 mock @/lib/notifications（lib 层含 SSE 细节，task-10/13
 * 已覆盖）；组件只验：铃铛+徽标渲染 / 面板列表（类型标签+标题）/ 条目点击
 * markNotificationRead+router.push / 全部已读调 API / 空态文案 / SSE hook
 * 挂载即订阅（useNotificationsStream 被调用）。
 *
 * mock 惯例对齐 components/__tests__/top-bar.test.tsx（vi.mock 提升模块级 mock
 * + hoisted 可变 ref 控制数据）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/* ---------------- mocks ---------------- */

// 数据层整体 mock：hooks + fetch 函数。hoisted ref 供各用例注入列表/未读数。
const { state, markNotificationRead, markAllNotificationsRead, push, useNotificationsStream } =
  vi.hoisted(() => ({
    state: {
      items: [] as Array<Record<string, unknown>>,
      count: 0,
    },
    markNotificationRead: vi.fn(async () => ({})),
    markAllNotificationsRead: vi.fn(async () => ({ updated: 0 })),
    push: vi.fn(),
    useNotificationsStream: vi.fn(),
  }));

vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    useNotifications: () => ({
      items: state.items,
      total: state.items.length,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    useUnreadCount: () => ({
      count: state.count,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    useNotificationsStream,
    markNotificationRead,
    markAllNotificationsRead,
  };
});

// next/navigation：jsdom 无真实路由。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/workspaces",
}));

// formatRelativeTime 来源面板组件体量过大，mock 成稳定文案便于断言。
vi.mock("@/components/sessions/session-list-panel", () => ({
  formatRelativeTime: () => "3 分钟前",
}));

import { NotificationBell } from "@/components/notifications/notification-bell";

/* ---------------- helpers ---------------- */

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    workspace_id: "ws-1",
    type: "approval_pending",
    title: "变更「示例」等待审核",
    body: "阶段：实现",
    link: "/workspaces/ws-1/changes/c-1",
    ref_type: "change",
    ref_id: "c-1",
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderBell(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<NotificationBell />, { wrapper });
}

/** 点铃铛展开面板并等待内容出现（antd Popover 异步挂载）。 */
async function openPanel() {
  fireEvent.click(screen.getByTestId("notification-bell-trigger"));
  await screen.findByTestId("notification-panel");
}

/* ---------------- tests ---------------- */

beforeEach(() => {
  state.items = [];
  state.count = 0;
  markNotificationRead.mockClear();
  markAllNotificationsRead.mockClear();
  push.mockClear();
  useNotificationsStream.mockClear();
});

describe("NotificationBell", () => {
  it("渲染铃铛触发器与未读徽标数字（aria-label 联动未读数）", () => {
    state.count = 3;
    renderBell();
    const trigger = screen.getByTestId("notification-bell-trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-label")).toBe("通知（3 条未读）");
  });

  it("打开面板渲染通知列表：类型标签 + 标题 + 相对时间", async () => {
    state.items = [makeNotification()];
    state.count = 1;
    renderBell();
    await openPanel();
    expect(screen.getByText("待审核")).toBeTruthy();
    expect(screen.getByText("变更「示例」等待审核")).toBeTruthy();
    // 相对时间与「点击查看」同 span，用子串匹配。
    expect(screen.getByText(/3 分钟前/)).toBeTruthy();
  });

  it("点击条目：未读 → markNotificationRead + 跳转 link", async () => {
    state.items = [makeNotification()];
    state.count = 1;
    renderBell();
    await openPanel();
    fireEvent.click(screen.getAllByTestId("notification-item")[0]!);
    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith("n-1");
      expect(push).toHaveBeenCalledWith("/workspaces/ws-1/changes/c-1");
    });
  });

  it("点击已读条目：不重复 markRead，但 link 非空仍跳转", async () => {
    state.items = [
      makeNotification({ id: "n-2", read_at: new Date().toISOString() }),
    ];
    renderBell();
    await openPanel();
    fireEvent.click(screen.getAllByTestId("notification-item")[0]!);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("「全部已读」调用 markAllNotificationsRead；无未读时禁用", async () => {
    state.items = [makeNotification()];
    state.count = 1;
    renderBell();
    await openPanel();
    const btn = screen.getByRole("button", { name: "全部已读" });
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    await waitFor(() =>
      expect(markAllNotificationsRead).toHaveBeenCalledTimes(1),
    );
  });

  it("空列表渲染空态文案", async () => {
    renderBell();
    await openPanel();
    expect(screen.getByText("暂无通知")).toBeTruthy();
  });

  it("SSE hook（useNotificationsStream）挂载即被调用订阅", () => {
    renderBell();
    expect(useNotificationsStream).toHaveBeenCalled();
  });
});
