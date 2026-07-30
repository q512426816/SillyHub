/**
 * 2026-07-29-sidebar-menu-restructure task-03：/settings/providers 页渲染测试。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-29-sidebar-menu-restructure/design.md（§5.2 Phase 2、D-002）
 *   - tasks/task-03.md（验收：标题 + 供应商区块挂载）
 *
 * 覆盖:
 *   1. 页面渲染标题「我的供应商」
 *   2. LlmProviderSection 区块被挂载（mock 成占位 div，区块本身有独立测试）
 *
 * 测试模式：照搬 skills/__tests__/page.test.tsx 的 QueryClientProvider 脚手架。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import LlmProvidersPage from "@/app/(dashboard)/settings/providers/page";

// 每 test 独立 QueryClient（retry:false + gcTime:0），与 skills 页测试一致。
function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// LlmProviderSection 内部走接口/通知等副作用，此处只验证「被挂载」，
// mock 为占位 div（区块行为由其组件自身的测试覆盖）。
vi.mock("@/components/llm-providers/llm-provider-list", () => ({
  LlmProviderSection: () => <div data-testid="llm-provider-section" />,
}));

// next/link mock（jsdom 下不导航），与 mcp 页测试一致。
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("/settings/providers 页 task-03", () => {
  it("渲染标题「我的供应商」", () => {
    renderPage(<LlmProvidersPage />);

    expect(screen.getByText("我的供应商")).toBeInTheDocument();
  });

  it("挂载 LlmProviderSection 区块", () => {
    renderPage(<LlmProvidersPage />);

    expect(screen.getByTestId("llm-provider-section")).toBeInTheDocument();
  });
});
