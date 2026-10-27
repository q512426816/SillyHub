// 2026-10-16-change-title-condense-backfill FR-06：详情页改名入口行为测试。
//
// 覆盖三面（用户口径 2026-10-16：管理员/平台责任人/变更责任人可重命名 title，
// 10-30 字必须）：
// 1. 权限三元组可见（owner 本人）+ 保存链路——弹层预填当前 title、strip 后
//    调 renameChangeTitle、成功后失效缓存（getChange 重取）；
// 2. 越带禁用——<10 字保存禁用 + 实时字数提示；
// 3. 无权限不渲染入口——三判全空无「改名」按钮。
//
// mock 范式对齐同目录 page-back-to-list.test.tsx（useChangeDeleteAccess mock 控权限）。
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
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  renameChangeTitle: vi.fn(),
  listChangeSessions: vi.fn(),
  listQuicklogEntries: vi.fn(),
  /** 权限三元组（useChangeDeleteAccess mock 返回值；用例内改写控制可见性）。 */
  access: { userId: null as string | null, isPlatformAdmin: false, workspaceRole: null as string | null },
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  renameChangeTitle: mocks.renameChangeTitle,
  getAgentStatus: vi.fn().mockRejectedValue(new Error("no-agent-in-rename-tests")),
  submitStageReview: vi.fn(),
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-rename-tests")),
  getChangeAssets: vi.fn().mockRejectedValue(new Error("no-assets-in-rename-tests")),
  getChangeUsage: vi.fn().mockRejectedValue(new Error("no-usage-in-rename-tests")),
  getScopeAudit: vi.fn().mockRejectedValue(new Error("no-audit-in-rename-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// useNotify 走 antd App 上下文（jsdom 未挂载 App 时 message.error 非函数）——
// 照 agent-profiles 页测试惯例 mock 成 vi.fn 三件套
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

vi.mock("@/components/delete-change-confirm", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/delete-change-confirm")
  >();
  return {
    ...actual,
    useChangeDeleteAccess: () => mocks.access,
  };
});

function makeChange(): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-10-16-rename-title",
    title: "旧标题占位",
    owner_id: "u-owner",
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

describe("详情页改名入口（2026-10-16-change-title-condense-backfill FR-06）", () => {
  beforeEach(() => {
    navMocks.searchParams = new URLSearchParams();
    mocks.getChange.mockResolvedValue(makeChange());
    mocks.listChangeSessions.mockResolvedValue([]);
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    mocks.access = { userId: null, isPlatformAdmin: false, workspaceRole: null };
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("owner 可见入口，保存走 strip 后的新标题并失效缓存", async () => {
    mocks.access = { userId: "u-owner", isPlatformAdmin: false, workspaceRole: null };
    mocks.renameChangeTitle.mockResolvedValue({
      id: "ch-1",
      change_key: "2026-10-16-rename-title",
      title: "变更中心标题提炼与存量回填方案",
    });
    renderPage();
    const entry = await screen.findByTestId("change-rename-entry");
    fireEvent.click(entry);

    const input = screen.getByTestId("change-rename-input") as HTMLInputElement;
    expect(input.value).toBe("旧标题占位");
    fireEvent.change(input, { target: { value: "  变更中心标题提炼与存量回填方案  " } });

    const save = screen.getByTestId("change-rename-save") as HTMLButtonElement;
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => {
      expect(mocks.renameChangeTitle).toHaveBeenCalledWith(
        "ws-1",
        "ch-1",
        "变更中心标题提炼与存量回填方案",
      );
    });
    // 成功后关弹层 + 缓存失效触发 getChange 重取
    await waitFor(() => {
      expect(screen.queryByTestId("change-rename-dialog")).toBeNull();
      expect(mocks.getChange.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("越带（<10 字）保存禁用并提示字数", async () => {
    mocks.access = { userId: "u-owner", isPlatformAdmin: false, workspaceRole: null };
    renderPage();
    fireEvent.click(await screen.findByTestId("change-rename-entry"));

    const input = screen.getByTestId("change-rename-input");
    fireEvent.change(input, { target: { value: "太短" } });

    expect(screen.getByTestId("change-rename-save")).toBeDisabled();
    expect(screen.getByTestId("change-rename-hint").textContent).toContain("2");
  });

  it("无权限三元组不渲染改名入口", async () => {
    renderPage();
    await screen.findByText("旧标题占位");
    expect(screen.queryByTestId("change-rename-entry")).toBeNull();
  });
});
