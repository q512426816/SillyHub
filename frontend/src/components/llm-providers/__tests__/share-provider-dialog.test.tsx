/**
 * 2026-10-30-provider-user-share：属主侧共享弹窗单测。
 *
 * 覆盖：打开即拉共享列表；按用户名共享后追加行；撤销后移除行。
 * API/通知局部 mock，Dialog（Radix）走真实实现。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ShareProviderDialog } from "@/components/llm-providers/share-provider-dialog";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  share: vi.fn(),
  unshare: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/api/llm-providers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/llm-providers")>();
  return {
    ...actual,
    listProviderShares: (...args: unknown[]) => mocks.list(...args),
    shareProvider: (...args: unknown[]) => mocks.share(...args),
    unshareProvider: (...args: unknown[]) => mocks.unshare(...args),
  };
});

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return {
    ...actual,
    useNotify: () => ({ success: mocks.success, error: mocks.error }),
  };
});

const PROVIDER = {
  id: "prov-1",
  name: "我的 GLM",
  is_default: false,
} as unknown as LlmProviderRead;

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([
    {
      user_id: "u-bob",
      username: "bob",
      display_name: "Bob",
      created_at: "2026-10-30T08:00:00Z",
    },
  ]);
  mocks.share.mockReset().mockResolvedValue({
    user_id: "u-alice",
    username: "alice",
    display_name: "Alice",
    created_at: "2026-10-30T08:01:00Z",
  });
  mocks.unshare.mockReset().mockResolvedValue(undefined);
  mocks.success.mockReset();
  mocks.error.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ShareProviderDialog（2026-10-30-provider-user-share）", () => {
  it("打开拉取共享列表；按用户名共享追加行；撤销移除行", async () => {
    render(<ShareProviderDialog provider={PROVIDER} onOpenChange={() => {}} />);

    // 打开即拉列表。
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith("prov-1");

    // 添加 alice。
    fireEvent.change(screen.getByLabelText("共享目标用户名或邮箱"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "共享" }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledWith("prov-1", "alice"));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("已共享");

    // 撤销 bob。
    const bobRow = screen.getByText("Bob").closest("div");
    expect(bobRow).not.toBeNull();
    fireEvent.click(
      bobRow!.querySelector("button") as HTMLButtonElement,
    );
    await waitFor(() => expect(mocks.unshare).toHaveBeenCalledWith("prov-1", "u-bob"));
    await waitFor(() => expect(screen.queryByText("Bob")).toBeNull());
    expect(mocks.success).toHaveBeenCalledWith("已撤销共享");
  });
});
