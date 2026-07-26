/**
 * change 2026-07-25-daemon-borrow-for-business task-12 / FR-01 / D-003@v1
 *
 * SharedDaemonToggle 组件测试。
 *
 * 契约：
 *  - shared=false 渲染「未共享」徽标，勾选 → 调 setMyBindingShared(ws, true) → onChanged
 *  - shared=true 渲染「已共享」徽标，取消勾选 → 调 setMyBindingShared(ws, false) → onChanged
 *  - pending 期间 input disabled，防重复点击
 *  - 失败显示行内错误，onChanged 不被调用
 *
 * 参考 workspace-binding-dialog.test.tsx 的 vi.mock("@/lib/workspace-binding") 模式。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedDaemonToggle } from "@/components/workspace/shared-daemon-toggle";
import { ApiError } from "@/lib/api";

const bindingApi = vi.hoisted(() => ({
  setMyBindingShared: vi.fn(),
}));
vi.mock("@/lib/workspace-binding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-binding")>(
    "@/lib/workspace-binding",
  );
  return { ...actual, setMyBindingShared: bindingApi.setMyBindingShared };
});

describe("SharedDaemonToggle（task-12 / FR-01）", () => {
  afterEach(() => {
    cleanup();
    bindingApi.setMyBindingShared.mockReset();
  });

  it("shared=false：渲染「未共享」徽标，勾选 → setMyBindingShared(ws,true) → onChanged", async () => {
    bindingApi.setMyBindingShared.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "u-1",
      shared: true,
    });
    const onChanged = vi.fn();

    render(
      <SharedDaemonToggle
        workspaceId="ws-1"
        shared={false}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText("未共享")).toBeInTheDocument();
    const toggle = screen.getByTestId("shared-daemon-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(bindingApi.setMyBindingShared).toHaveBeenCalledWith("ws-1", true);
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("shared=true：渲染「已共享」徽标，取消勾选 → setMyBindingShared(ws,false) → onChanged", async () => {
    bindingApi.setMyBindingShared.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "u-1",
      shared: false,
    });
    const onChanged = vi.fn();

    render(
      <SharedDaemonToggle
        workspaceId="ws-1"
        shared={true}
        daemonLabel="我的本机守护进程"
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText("已共享")).toBeInTheDocument();
    expect(screen.getByText(/共享「我的本机守护进程」/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("shared-daemon-toggle"));

    await waitFor(() => {
      expect(bindingApi.setMyBindingShared).toHaveBeenCalledWith("ws-1", false);
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("失败：显示行内错误，onChanged 不被调用", async () => {
    const err = new ApiError(409, {
      code: "binding_not_found",
      message: "尚未配置绑定",
      request_id: null,
      details: null,
    });
    bindingApi.setMyBindingShared.mockRejectedValue(err);
    const onChanged = vi.fn();

    render(
      <SharedDaemonToggle
        workspaceId="ws-1"
        shared={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByTestId("shared-daemon-toggle"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("尚未配置绑定");
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("pending 期间 input disabled，防重复点击", async () => {
    // 用一个不 resolve 的 promise 钉住 pending 态
    bindingApi.setMyBindingShared.mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <SharedDaemonToggle
        workspaceId="ws-1"
        shared={false}
        onChanged={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("shared-daemon-toggle") as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeDisabled();
    });

    // 再次点击不应新增调用（handleChange 在 pending 时直接 return）
    fireEvent.click(toggle);
    expect(bindingApi.setMyBindingShared).toHaveBeenCalledTimes(1);
  });
});
