/**
 * 2026-10-12-workspace-dead-link-fix：审批中心页返回链接钉住。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx（页头返回链接）
 *   - 8a928588f 下线「项目组组件」页删除 workspaces/[id]/components 路由后，
 *     本页返回链接曾指向已删路由、点击即 404；钉住其指向工作区详情首页。
 *
 * mock 风格对齐 workspaces/[id]/mcp-tokens/__tests__/page.test.tsx（next/link 渲染
 * 真实 <a> 以断言 href）；数据面取空列表，SessionPermissionPanel 桩化（非本测对象）。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkspaceApprovalsPage from "@/app/(dashboard)/workspaces/[id]/approvals/page";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/approvals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/approvals")>();
  return {
    ...actual,
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    listApprovalHistory: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorkspaceAgentSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorkspaceDialogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/permissions/session-permission-panel", () => ({
  SessionPermissionPanel: () => <div data-testid="session-permission-panel-stub" />,
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceApprovalsPage params={{ id: "ws-1" }} />
    </QueryClientProvider>,
  );
}

describe("审批中心页返回链接（2026-10-12-workspace-dead-link-fix）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("页头「← 工作区」链接指向工作区详情首页（components 页下线后不得 404）", async () => {
    renderPage();
    const link = await screen.findByText("← 工作区");
    expect(link.closest("a")).toHaveAttribute("href", "/workspaces/ws-1");
  });
});
