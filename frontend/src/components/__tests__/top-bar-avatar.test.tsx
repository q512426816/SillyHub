/**
 * TopBar avatar prop 接线测试（2026-09-10-account-avatar-upload task-09 / FR-05）。
 *
 * mock 惯例沿 top-bar.test.tsx（workspace-switcher / notification-bell /
 * next/navigation）+ @/lib/file/api 的 fetchFileBlob（chat-message-avatar.test.tsx
 * 同款）。用例三态：文件中心 URL（blob objectURL 渲染 img）、http 外链直用、
 * 缺省/null 首字回退；另补 blob 拉取失败静默回退守护。
 *
 * jsdom 两处补丁说明：
 *   - URL.createObjectURL——src/test/setup.ts 已全局 polyfill（返回 blob:mock-*）；
 *   - window.Image——Radix AvatarImage 的 useImageLoadingStatus 以 new Image() 探测
 *     加载态，jsdom 不加载资源、load 永不触发 → status 停在 loading、img 永不
 *     渲染。此处用「src 赋值即加载成功」替身复刻真实浏览器路径。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 与 top-bar.test.tsx 同款：mock 子组件，避免拖入 react-query / SSE / context 依赖。
vi.mock("@/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => (
    <div data-testid="workspace-switcher-mock">switcher</div>
  ),
}));

vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell-mock">bell</div>,
}));

// next/navigation 在 jsdom 下需 mock，避免引入真实路由依赖。
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspaces",
  useRouter: () => ({ push: () => {} }),
}));

// useAvatarSrc 的 blob 拉取依赖——mock 掉网络层，只测 TopBar 接线行为。
const { fetchFileBlobMock } = vi.hoisted(() => ({
  fetchFileBlobMock: vi.fn(),
}));
vi.mock("@/lib/file/api", () => ({
  fetchFileBlob: fetchFileBlobMock,
}));

/**
 * Radix AvatarImage 加载探测替身：src 赋值即同步置 complete/naturalWidth 并派发
 * load 事件（真实浏览器中图片加载成功的路径），使 AvatarImage 渲染 <img>、
 * Radix 撤下 AvatarFallback。
 */
class LoadedFakeImage {
  naturalWidth = 64;
  complete = false;
  crossOrigin: string | null = null;
  referrerPolicy = "";
  private _src = "";
  private listeners = new Map<
    string,
    Array<(event: { currentTarget: LoadedFakeImage }) => void>
  >();

  addEventListener(
    type: string,
    listener: (event: { currentTarget: LoadedFakeImage }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(
    type: string,
    listener: (event: { currentTarget: LoadedFakeImage }) => void,
  ) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }

  set src(value: string) {
    this._src = value;
    this.complete = true;
    for (const listener of this.listeners.get("load") ?? []) {
      listener({ currentTarget: this });
    }
  }

  get src(): string {
    return this._src;
  }
}

vi.stubGlobal("Image", LoadedFakeImage);

import { TopBar } from "@/components/top-bar";

const DISPLAY_NAME = "管理员";

beforeEach(() => {
  fetchFileBlobMock.mockReset();
});

describe("TopBar avatar 接线（task-09 / FR-05）", () => {
  it("avatar 为文件中心 URL → fetchFileBlob 取 blob 后渲染 img（alt=displayName）", async () => {
    fetchFileBlobMock.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    render(
      <TopBar displayName={DISPLAY_NAME} onLogout={() => {}} avatar="/api/file/abc-123" />,
    );

    const img = await screen.findByAltText(DISPLAY_NAME);
    expect(fetchFileBlobMock).toHaveBeenCalledWith("abc-123");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    // 图加载成功后 Radix 撤下 Fallback——首字「管」不再渲染。
    await waitFor(() => expect(screen.queryByText("管")).toBeNull());
  });

  it("avatar 为 http 外链 → 原值直用作 img src（fetchFileBlob 未调）", async () => {
    render(
      <TopBar
        displayName={DISPLAY_NAME}
        onLogout={() => {}}
        avatar="https://cdn.example.com/a.png"
      />,
    );

    const img = await screen.findByAltText(DISPLAY_NAME);
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(fetchFileBlobMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("管")).toBeNull());
  });

  it("avatar 缺省 / 为 null → 仅 AvatarFallback 首字回退（不渲染 img）", () => {
    // 不传 avatar（既有调用方零改动形态）
    const { rerender } = render(
      <TopBar displayName={DISPLAY_NAME} onLogout={() => {}} />,
    );
    expect(screen.getByText("管")).toBeTruthy();
    expect(screen.queryByAltText(DISPLAY_NAME)).toBeNull();

    // 显式 null（useSession user.avatar 缺省时 app-shell 传入的形态）
    rerender(
      <TopBar displayName={DISPLAY_NAME} onLogout={() => {}} avatar={null} />,
    );
    expect(screen.getByText("管")).toBeTruthy();
    expect(screen.queryByAltText(DISPLAY_NAME)).toBeNull();
    expect(fetchFileBlobMock).not.toHaveBeenCalled();
  });

  it("blob 拉取失败 → 静默回退首字（零回归守护）", async () => {
    fetchFileBlobMock.mockRejectedValue(new Error("401"));
    render(
      <TopBar displayName={DISPLAY_NAME} onLogout={() => {}} avatar="/api/file/xyz" />,
    );

    await waitFor(() => expect(fetchFileBlobMock).toHaveBeenCalledWith("xyz"));
    // 回退不渲染 img，首字 Fallback 照常。
    expect(screen.queryByAltText(DISPLAY_NAME)).toBeNull();
    expect(screen.getByText("管")).toBeTruthy();
  });
});
