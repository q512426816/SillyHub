import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// antd Tree / @rc-component/resize-observer 需要 ResizeObserver，jsdom 缺，补 mock。
// 放 import 后、describe 前（模块顶层代码先于测试函数 render 执行）。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// task-09: RemoteFolderPicker 组件测试。聚焦可稳定断言的行为：
//   - open → listRoots 初始化（FR-3）
//   - listRoots reject → 错误降级红条不崩溃（D-004）
//   - 地址栏手输 + 跳转 → listDir 校验（D-003）
//   - 跳转失败 → 禁用确认
//   - onConfirm → onPick(path) + onClose
// 注：antd Tree 的 loadData 展开交互依赖虚拟滚动 + portal，jsdom 下不稳定，
//     故展开用例改以 listDir 被调用来间接断言（手输跳转路径同样走 listDir）。

vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    listRoots: vi.fn(),
    listDir: vi.fn(),
  };
});

import { RemoteFolderPicker } from "../remote-folder-picker";
import { listRoots, listDir } from "@/lib/daemon";

const mockListRoots = listRoots as unknown as ReturnType<typeof vi.fn>;
const mockListDir = listDir as unknown as ReturnType<typeof vi.fn>;

describe("RemoteFolderPicker（task-09）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open=true → listRoots(runtimeId) 初始化根", async () => {
    mockListRoots.mockResolvedValue({ roots: ["C:\\"] });
    render(
      <RemoteFolderPicker
        runtimeId="rt1"
        open
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockListRoots).toHaveBeenCalledWith("rt1"));
  });

  it("listRoots reject → 红条错误提示不崩溃（D-004）", async () => {
    mockListRoots.mockRejectedValue(new Error("daemon offline"));
    render(
      <RemoteFolderPicker
        runtimeId="rt1"
        open
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    // 错误降级：formatBrowseError 对非 ApiError 返 err.message，对 ApiError 返 fallback。
    await waitFor(() => {
      expect(
        screen.getByText(/daemon offline|守护进程可能离线|无法读取目录根/),
      ).toBeInTheDocument();
    });
  });

  it("地址栏手输 + 跳转 → listDir 校验路径（D-003）", async () => {
    mockListRoots.mockResolvedValue({ roots: ["C:\\"] });
    mockListDir.mockResolvedValue({ entries: [] });
    render(
      <RemoteFolderPicker
        runtimeId="rt1"
        open
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockListRoots).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/输入路径/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "D:\\" } });
    fireEvent.click(screen.getByRole("button", { name: "跳转" }));

    await waitFor(() =>
      expect(mockListDir).toHaveBeenCalledWith("rt1", "D:\\"),
    );
  });

  it("手输跳转失败 → 禁用「选择此目录」（清空 selectedPath）", async () => {
    mockListRoots.mockResolvedValue({ roots: ["C:\\"] });
    mockListDir.mockRejectedValue(new Error("not_found"));
    render(
      <RemoteFolderPicker
        runtimeId="rt1"
        open
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockListRoots).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/输入路径/), {
      target: { value: "X:\\" },
    });
    fireEvent.click(screen.getByRole("button", { name: "跳转" }));
    await waitFor(() => expect(mockListDir).toHaveBeenCalled());

    // selectedPath 被清空 → 确认按钮 disabled
    expect(screen.getByRole("button", { name: "选择此目录" })).toBeDisabled();
  });

  it("onConfirm：选中后点「选择此目录」→ onPick(path) + onClose", async () => {
    mockListRoots.mockResolvedValue({ roots: ["C:\\"] });
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <RemoteFolderPicker
        runtimeId="rt1"
        open
        onClose={onClose}
        onPick={onPick}
      />,
    );
    // 首根 "C:\" 默认选中（组件 useEffect 逻辑）→ 确认按钮 enabled
    await waitFor(() => {
      const ok = screen.getByRole("button", { name: "选择此目录" });
      expect(ok).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "选择此目录" }));
    expect(onPick).toHaveBeenCalledWith("C:\\");
    expect(onClose).toHaveBeenCalled();
  });
});
