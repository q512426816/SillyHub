/**
 * ChatMessageAvatar 单测（2026-09-09-sessions-visual-refresh task-03）。
 * 覆盖：agent 渐变光环形态 / user 首字回退 / avatar 图片三态（文件中心 blob、
 * 外链直用、空回退）+ size 两档。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ChatMessageAvatar } from "../chat-message-avatar";

const fetchFileBlobMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/file/api", () => ({
  fetchFileBlob: fetchFileBlobMock,
}));

function fakeBlob(): Blob {
  return new Blob(["x"], { type: "image/png" });
}

beforeEach(() => {
  fetchFileBlobMock.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:avatar-1");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("ChatMessageAvatar agent 形态", () => {
  it("渲染渐变底 + Bot 图标 + 外圈光环类", () => {
    render(<ChatMessageAvatar kind="agent" />);
    const el = screen.getByTestId("chat-message-avatar-agent");
    expect(el.className).toContain("from-brand-600");
    expect(el.className).toContain("to-info");
    expect(el.className).toContain("shadow-primary");
    // 光环环
    const ring = el.querySelector(".border-brand-400\\/40");
    expect(ring).not.toBeNull();
  });

  it("size=28 应用紧凑尺寸类", () => {
    render(<ChatMessageAvatar kind="agent" size={28} />);
    expect(screen.getByTestId("chat-message-avatar-agent").className).toContain("h-7");
  });
});

describe("ChatMessageAvatar user 形态", () => {
  it("无 avatar 回退 name 首字大写", () => {
    render(<ChatMessageAvatar kind="user" name="林一" />);
    const el = screen.getByTestId("chat-message-avatar-user");
    expect(el.textContent).toBe("林");
    expect(el.className).toContain("bg-muted");
  });

  it("avatar 为文件中心 URL → fetchFileBlob 取 blob 后渲染 img", async () => {
    fetchFileBlobMock.mockResolvedValue(fakeBlob());
    render(
      <ChatMessageAvatar kind="user" name="林一" avatar="/api/file/abc-123" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-message-avatar-img")).not.toBeNull();
    });
    expect(fetchFileBlobMock).toHaveBeenCalledWith("abc-123");
    const img = screen.getByTestId("chat-message-avatar-img").querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:avatar-1");
  });

  it("avatar 为 http 外链 → 直用作 src（不经 blob）", async () => {
    render(
      <ChatMessageAvatar
        kind="user"
        name="林一"
        avatar="https://cdn.example.com/a.png"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-message-avatar-img")).not.toBeNull();
    });
    expect(fetchFileBlobMock).not.toHaveBeenCalled();
  });

  it("blob 拉取失败 → 静默回退首字", async () => {
    fetchFileBlobMock.mockRejectedValue(new Error("401"));
    render(
      <ChatMessageAvatar kind="user" name="林一" avatar="/api/file/xyz" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-message-avatar-user")).not.toBeNull();
    });
  });
});
