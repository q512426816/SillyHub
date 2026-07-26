/**
 * change 2026-07-25-daemon-borrow-for-business task-12 / FR-02 / D-003@v1
 *
 * SharedDaemonManager 组件测试（owner 视角）。
 *
 * 契约：
 *  - 挂载 → fetchSharedDaemons(ws) → 渲染列表（出借人/守护进程/在线徽标）
 *  - 空列表 → 友好空态
 *  - 点「撤销共享」→ confirm → revokeSharedDaemon(ws, lenderUserId) → refresh + onRevoked
 *  - confirm 取消 → 不调用 revoke
 *  - 撤销失败 → 显示行内错误
 *  - members prop 反查出借人展示名（lender_user_id → display_name/email）
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedDaemonManager } from "@/components/workspace/shared-daemon-manager";
import { ApiError } from "@/lib/api";
import type { WorkspaceMemberView } from "@/lib/workspace-members";

const bindingApi = vi.hoisted(() => ({
  fetchSharedDaemons: vi.fn(),
  revokeSharedDaemon: vi.fn(),
}));
vi.mock("@/lib/workspace-binding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-binding")>(
    "@/lib/workspace-binding",
  );
  return {
    ...actual,
    fetchSharedDaemons: bindingApi.fetchSharedDaemons,
    revokeSharedDaemon: bindingApi.revokeSharedDaemon,
  };
});

function makeMember(overrides: Partial<WorkspaceMemberView> = {}): WorkspaceMemberView {
  return {
    user_id: "lender-uuid-0",
    email: "dev@test.com",
    display_name: "张开发",
    role_key: "developer",
    role_name: "开发者",
    granted_at: "2026-07-01T00:00:00Z",
    is_current_user: false,
    ...overrides,
  } as unknown as WorkspaceMemberView;
}

describe("SharedDaemonManager（task-12 / FR-02 owner 管理）", () => {
  afterEach(() => {
    cleanup();
    bindingApi.fetchSharedDaemons.mockReset();
    bindingApi.revokeSharedDaemon.mockReset();
  });

  it("挂载 → fetchSharedDaemons → 渲染列表（出借人/在线徽标/撤销按钮）", async () => {
    bindingApi.fetchSharedDaemons.mockResolvedValue([
      {
        lender_user_id: "lender-uuid-0",
        daemon_id: "daemon-uuid-1",
        daemon_status: "online",
        daemon_hostname: "DESKTOP-DEV1",
        revocable: true,
      },
    ]);

    render(<SharedDaemonManager workspaceId="ws-1" members={[makeMember()]} />);

    await waitFor(() => {
      expect(bindingApi.fetchSharedDaemons).toHaveBeenCalledWith("ws-1");
    });

    // members 反查展示名（张开发）
    expect(await screen.findByText("张开发")).toBeInTheDocument();
    // daemon hostname + 在线徽标
    expect(screen.getByText("DESKTOP-DEV1")).toBeInTheDocument();
    expect(screen.getByText("在线")).toBeInTheDocument();
    // 撤销按钮存在且可点（revocable=true）
    expect(screen.getByTestId("revoke-shared-daemon")).not.toBeDisabled();
  });

  it("空列表 → 友好空态文案", async () => {
    bindingApi.fetchSharedDaemons.mockResolvedValue([]);

    render(<SharedDaemonManager workspaceId="ws-1" />);

    expect(await screen.findByText(/当前工作空间暂无共享守护进程/)).toBeInTheDocument();
    expect(screen.queryByTestId("shared-daemon-row")).not.toBeInTheDocument();
  });

  it("点撤销 → confirm → revokeSharedDaemon(ws, lenderId) → onRevoked + 刷新", async () => {
    bindingApi.fetchSharedDaemons
      // 首次挂载：1 条共享
      .mockResolvedValueOnce([
        {
          lender_user_id: "lender-uuid-0",
          daemon_id: "daemon-uuid-1",
          daemon_status: "online",
          daemon_hostname: "DESKTOP-DEV1",
          revocable: true,
        },
      ])
      // 撤销后 refresh：空列表
      .mockResolvedValueOnce([]);
    bindingApi.revokeSharedDaemon.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: "lender-uuid-0",
      shared: false,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRevoked = vi.fn();

    render(<SharedDaemonManager workspaceId="ws-1" members={[makeMember()]} onRevoked={onRevoked} />);

    const revokeBtn = await screen.findByTestId("revoke-shared-daemon");
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(bindingApi.revokeSharedDaemon).toHaveBeenCalledWith("ws-1", "lender-uuid-0");
    });
    await waitFor(() => {
      expect(onRevoked).toHaveBeenCalledTimes(1);
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("张开发"));
  });

  it("confirm 取消 → 不调用 revokeSharedDaemon", async () => {
    bindingApi.fetchSharedDaemons.mockResolvedValue([
      {
        lender_user_id: "lender-uuid-0",
        daemon_id: "daemon-uuid-1",
        daemon_status: "online",
        daemon_hostname: "DESKTOP-DEV1",
        revocable: true,
      },
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SharedDaemonManager workspaceId="ws-1" members={[makeMember()]} />);

    const revokeBtn = await screen.findByTestId("revoke-shared-daemon");
    fireEvent.click(revokeBtn);

    expect(bindingApi.revokeSharedDaemon).not.toHaveBeenCalled();
  });

  it("撤销失败 → 显示行内错误", async () => {
    bindingApi.fetchSharedDaemons.mockResolvedValue([
      {
        lender_user_id: "lender-uuid-0",
        daemon_id: "daemon-uuid-1",
        daemon_status: "online",
        daemon_hostname: "DESKTOP-DEV1",
        revocable: true,
      },
    ]);
    const err = new ApiError(409, {
      code: "binding_not_found",
      message: "该成员尚未配置绑定",
      request_id: null,
      details: null,
    });
    bindingApi.revokeSharedDaemon.mockRejectedValue(err);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SharedDaemonManager workspaceId="ws-1" members={[makeMember()]} />);

    const revokeBtn = await screen.findByTestId("revoke-shared-daemon");
    fireEvent.click(revokeBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("该成员尚未配置绑定");
  });
});
