// 2026-10-16-change-center-back-keeps-list-state：详情页返回列表入口行为回归。
//
// 用户实证：变更中心列表切「已归档」/翻页后进详情，点 breadcrumb「变更列表」回列表
// 被重置为进行中第 1 页（原实现是客户端导航到无参 /changes，列表组件重挂载）。修复后
// 返回入口 = BackToListLink：历史可后退（length>1）→ router.back() 回带 query 的列表
// URL（列表从 URL 恢复状态）；新标签深链（length<=1）→ Link 默认导航兜底。
//
// mock 范式对齐同目录 page-team-toggle.test.tsx；next/link mock 必须透传 onClick
// （BackToListLink 的 back 行为挂在 onClick 上，吞掉即断言失效）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import type { ChangeRead } from "@/lib/changes";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace, back: navMocks.back }),
  useSearchParams: () => navMocks.searchParams,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    onClick?: (e: { preventDefault: () => void }) => void;
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  listChangeSessions: vi.fn(),
  listQuicklogEntries: vi.fn(),
  deleteChange: vi.fn(),
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  getAgentStatus: vi.fn().mockRejectedValue(new Error("no-agent-in-back-tests")),
  submitStageReview: vi.fn(),
  deleteChange: mocks.deleteChange,
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-back-tests")),
  getChangeAssets: vi.fn().mockRejectedValue(new Error("no-assets-in-back-tests")),
  getChangeUsage: vi.fn().mockRejectedValue(new Error("no-usage-in-back-tests")),
  getScopeAudit: vi.fn().mockRejectedValue(new Error("no-audit-in-back-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 删除 onSuccess 走 notify.success（antd App 上下文）——测试树无 <App> 包裹时
// App.useApp() 的 message 为 undefined 会抛错使 mutation 误入 onError；本文件
// 断言面是 back/push 跳转，toast 静音即可
vi.mock("@/lib/errors", () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

// 删除入口权限可切换 holder（真实 hook 走 session/fetchMe）：默认无权限（不渲染
// 删除按钮），删除用例置平台管理员开启入口；真实 canDeleteChange 保持导出
const accessMock = vi.hoisted(() => ({
  value: { userId: null, isPlatformAdmin: false, workspaceRole: null },
}));
vi.mock("@/components/delete-change-confirm", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/delete-change-confirm")
  >();
  return {
    ...actual,
    useChangeDeleteAccess: () => accessMock.value,
  };
});

function makeChange(): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-10-16-back-to-list",
    title: "返回保状态回归",
    current_stage: "execute",
    pending_review: null,
    status: "in_progress",
    location: "active",
    change_type: null,
    is_thin: false,
    affected_components: [],
    updated_at: "2026-10-16T10:00:00Z",
    stages: {},
  } as unknown as ChangeRead;
}

/** 指定 history.length（BackToListLink 渲染期读它判可否 back）。 */
function stubHistoryLength(len: number) {
  Object.defineProperty(window.history, "length", {
    value: len,
    writable: true,
    configurable: true,
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />
    </QueryClientProvider>,
  );
}

describe("详情页返回列表入口（2026-10-16-change-center-back-keeps-list-state）", () => {
  beforeEach(() => {
    navMocks.searchParams = new URLSearchParams();
    mocks.getChange.mockResolvedValue(makeChange());
    mocks.listChangeSessions.mockResolvedValue([]);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
    // 还原 jsdom 默认（History.prototype 的 getter 被实例 own property 覆盖后要摘掉）
    delete (window.history as unknown as { length?: number }).length;
  });

  it("历史可后退（length=2）：点 breadcrumb「变更列表」调 router.back()", async () => {
    stubHistoryLength(2);
    renderPage();
    const backLink = await screen.findByRole("link", { name: "变更列表" });
    expect(backLink.getAttribute("href")).toBe("/workspaces/ws-1/changes");
    fireEvent.click(backLink);
    expect(navMocks.back).toHaveBeenCalledTimes(1);
  });

  it("无历史可退（length=1，新标签深链）：点击不调 router.back()，href 兜底", async () => {
    stubHistoryLength(1);
    renderPage();
    const backLink = await screen.findByRole("link", { name: "变更列表" });
    fireEvent.click(backLink);
    expect(navMocks.back).not.toHaveBeenCalled();
  });
});

// ── 删除成功后的返回（2026-10-16-change-center-delete-back-keeps-state）────────
// 删除后 router.push 无参列表会丢来路 tab/页码——改为与 BackToListLink 同款判定：
// 可后退 back 回带 query 的列表 URL（列表从 URL 快照恢复），深链兜底 push 默认列表。
describe("详情页删除成功后返回列表（2026-10-16-change-center-delete-back-keeps-state）", () => {
  beforeEach(() => {
    navMocks.searchParams = new URLSearchParams();
    mocks.getChange.mockResolvedValue(makeChange());
    mocks.listChangeSessions.mockResolvedValue([]);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    mocks.deleteChange.mockResolvedValue({});
    accessMock.value = { userId: null, isPlatformAdmin: true, workspaceRole: null };
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
    accessMock.value = { userId: null, isPlatformAdmin: false, workspaceRole: null };
    delete (window.history as unknown as { length?: number }).length;
  });

  /** 打开删除确认弹层并输入末段启用「确认删除」后点击（changeKeyTail 去日期前缀）。 */
  async function confirmDelete() {
    fireEvent.click(await screen.findByTestId("change-delete-entry"));
    const input = await screen.findByTestId("delete-change-confirm-input");
    fireEvent.change(input, { target: { value: "back-to-list" } });
    fireEvent.click(screen.getByText("确认删除"));
  }

  it("历史可后退（length=2）：删除成功后 router.back() 回来路列表（不 push）", async () => {
    stubHistoryLength(2);
    renderPage();
    await confirmDelete();
    await waitFor(() => expect(navMocks.back).toHaveBeenCalledTimes(1));
    expect(navMocks.push).not.toHaveBeenCalled();
  });

  it("无历史可退（length=1）：删除成功后兜底 push 默认列表", async () => {
    stubHistoryLength(1);
    renderPage();
    await confirmDelete();
    await waitFor(() =>
      expect(navMocks.push).toHaveBeenCalledWith("/workspaces/ws-1/changes"),
    );
    expect(navMocks.back).not.toHaveBeenCalled();
  });
});
