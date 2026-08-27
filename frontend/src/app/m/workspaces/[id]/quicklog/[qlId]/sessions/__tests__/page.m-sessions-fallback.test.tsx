/**
 * task-10 · quicklog/[qlId]/sessions 深链兜底 redirect 薄壳测试
 * （X-02 / FR-10 / design §9.4 / Grill C-11）。
 *
 * 覆盖验收面：
 *  - 挂载即 router.replace 到 /m/workspaces/[id]/sessions（会话列表，
 *    不落 404），且恰一次；
 *  - 零 UI 渲染（容器为空）——零数据请求由页面零 import @/lib 请求函数保证。
 *
 * mock 策略：mock next/navigation 的 useRouter（对齐 (dashboard)/layout.test.tsx
 * 等既有先例）；vitest clearMocks 自动清调用计数。
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "@/app/m/workspaces/[id]/quicklog/[qlId]/sessions/page";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe("m/workspaces/[id]/quicklog/[qlId]/sessions 深链兜底", () => {
  it("挂载即 replace 到 /m/workspaces/w1/sessions（恰一次）", async () => {
    render(<Page params={{ id: "w1", qlId: "q1" }} />);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/m/workspaces/w1/sessions");
    });
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("渲染 null（零 UI）", () => {
    const { container } = render(<Page params={{ id: "w1", qlId: "q1" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
