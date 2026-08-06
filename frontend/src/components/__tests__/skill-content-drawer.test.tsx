/**
 * 2026-08-05-skill-content-viewer task-08：SkillContentDrawer 单测。
 *
 * 覆盖：
 *  1. platform kind 调 usePlatformSkillContent，content 用 MarkdownText size=reading 渲染。
 *  2. custom kind 调 getCustomSkill(skillId)（与 platform 缓存对称）。
 *
 * MarkdownText 用 dynamic import（ssr:false），jsdom 下不渲染真实预览，这里 mock 成
 * 纯 div 以验证 size prop 传递 + content 透传。
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  usePlatformSkillContent: vi.fn(),
  getCustomSkill: vi.fn(),
}));

vi.mock("@/lib/custom-skills", async () => {
  const actual = await vi.importActual<typeof import("@/lib/custom-skills")>("@/lib/custom-skills");
  return {
    ...actual,
    usePlatformSkillContent: mocks.usePlatformSkillContent,
    getCustomSkill: mocks.getCustomSkill,
  };
});

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content, size }: { content: string; size?: string }) => (
    <div data-testid="md" data-size={size ?? "compact"}>
      {content}
    </div>
  ),
}));

import { SkillContentDrawer } from "@/components/skill-content-drawer";

function renderDrawer(props: React.ComponentProps<typeof SkillContentDrawer>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SkillContentDrawer {...props} />
    </QueryClientProvider>,
  );
}

describe("SkillContentDrawer", () => {
  it("platform kind 渲染 content (MarkdownText size=reading)", () => {
    mocks.usePlatformSkillContent.mockReturnValue({
      content: { skill_name: "sillyspec-test", content: "# hi" },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { getByTestId, getByText } = renderDrawer({
      open: true,
      onClose: () => {},
      kind: "platform",
      skillName: "sillyspec-test",
    });
    expect(mocks.usePlatformSkillContent).toHaveBeenCalledWith("sillyspec-test");
    const md = getByTestId("md");
    expect(md).toHaveAttribute("data-size", "reading");
    expect(getByText("# hi")).toBeTruthy();
  });

  it("custom kind 调 getCustomSkill(skillId)", async () => {
    mocks.usePlatformSkillContent.mockReturnValue({
      content: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    mocks.getCustomSkill.mockResolvedValue({
      id: "s1",
      name: "my-skill",
      content: "# custom body",
    } as never);
    renderDrawer({
      open: true,
      onClose: () => {},
      kind: "custom",
      skillId: "s1",
    });
    await waitFor(() => expect(mocks.getCustomSkill).toHaveBeenCalledWith("s1"));
  });
});
