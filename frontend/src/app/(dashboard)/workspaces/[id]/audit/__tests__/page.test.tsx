/**
 * 2026-10-12-workspace-dead-link-fix：审计日志页返回链接钉住。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/workspaces/[id]/audit/page.tsx（页头返回链接）
 *   - 8a928588f 下线「项目组组件」页删除 workspaces/[id]/components 路由后，
 *     本页返回链接文案「← 组件列表」指向已删路由、点击即 404；改为「← 工作区」
 *     并钉住指向工作区详情首页。
 *
 * mock 风格对齐 workspaces/[id]/mcp-tokens/__tests__/page.test.tsx（next/link 渲染
 * 真实 <a> 以断言 href）；数据面取空列表。
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkspaceAuditPage from "@/app/(dashboard)/workspaces/[id]/audit/page";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    listAuditLogs: vi.fn().mockResolvedValue([]),
  };
});

describe("审计日志页返回链接（2026-10-12-workspace-dead-link-fix）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("页头「← 工作区」链接指向工作区详情首页（原「← 组件列表」指向已删路由）", async () => {
    render(<WorkspaceAuditPage params={{ id: "ws-1" }} />);
    const link = await screen.findByText("← 工作区");
    expect(link.closest("a")).toHaveAttribute("href", "/workspaces/ws-1");
  });
});
