/**
 * ql-20260821-011-9ddd：添加成员弹窗角色下拉测试。
 *
 * 2026-07-25-daemon-borrow-for-business task-12 只给行内下拉
 * （workspace-member-row.tsx）补了 business_member，漏了本弹窗——补齐并守护。
 * 断言口径与 workspace-member-row.test.tsx 同源：选项可见 + 提交值正确。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceMemberAddDialog } from "@/components/workspace-member-add-dialog";
import * as membersApi from "@/lib/workspace-members";

vi.mock("@/lib/workspace-members", () => ({
  addMember: vi.fn().mockResolvedValue({}),
  searchUsersForInvite: vi.fn().mockResolvedValue([
    {
      user_id: "u-biz",
      email: "biz@test.com",
      display_name: "李业务",
    },
  ]),
}));

describe("WorkspaceMemberAddDialog business_member 选项（ql-20260821-011-9ddd）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("角色下拉包含「业务成员（借用守护进程）」选项", () => {
    render(
      <WorkspaceMemberAddDialog
        workspaceId="ws-1"
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("business_member");
    expect(
      Array.from(select.options).some((o) => o.textContent?.includes("业务成员")),
    ).toBe(true);
  });

  it("选「业务成员」添加 → addMember 提交 role_key=business_member", async () => {
    render(
      <WorkspaceMemberAddDialog
        workspaceId="ws-1"
        onAdded={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // 搜索（≥2 字符触发防抖查询）→ 选中候选
    fireEvent.change(screen.getByPlaceholderText(/至少 2 个字符/), {
      target: { value: "李业务" },
    });
    const candidate = await screen.findByRole("button", { name: /已选|李业务/ });
    fireEvent.click(candidate);

    // 角色切业务成员后提交
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "business_member" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => {
      expect(membersApi.addMember).toHaveBeenCalledWith("ws-1", {
        user_id: "u-biz",
        role_key: "business_member",
      });
    });
  });
});
