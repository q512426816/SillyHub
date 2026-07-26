/**
 * change 2026-07-25-daemon-borrow-for-business task-12 / FR-02
 *
 * WorkspaceMemberRow 角色下拉测试：业务成员（business_member）选项可见且可授。
 * 复用现有 PATCH /members/{uid} 端点（updateMemberRole），无新授角色端点。
 */
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceMemberRow } from "@/components/workspace-member-row";
import type { WorkspaceMemberView } from "@/lib/workspace-members";

function makeMember(
  overrides: Partial<WorkspaceMemberView> = {},
): WorkspaceMemberView {
  return {
    user_id: "u-1",
    email: "biz@test.com",
    display_name: "李业务",
    role_key: "viewer",
    role_name: "只读成员",
    granted_at: "2026-07-01T00:00:00Z",
    is_current_user: false,
    ...overrides,
  } as unknown as WorkspaceMemberView;
}

describe("WorkspaceMemberRow business_member 选项（task-12 / FR-02）", () => {
  afterEach(() => cleanup());

  it("角色下拉包含「业务成员（借用守护进程）」选项", () => {
    render(
      <WorkspaceMemberRow
        member={makeMember()}
        actionLoading={false}
        onRoleChange={vi.fn()}
        onSetOwner={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("business_member");
    expect(
      Array.from(select.options).some((o) =>
        o.textContent?.includes("业务成员"),
      ),
    ).toBe(true);
  });

  it("选「业务成员」→ onRoleChange(business_member)（复用现有 PATCH 端点）", () => {
    const onRoleChange = vi.fn();
    render(
      <WorkspaceMemberRow
        member={makeMember()}
        actionLoading={false}
        onRoleChange={onRoleChange}
        onSetOwner={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "business_member" },
    });
    expect(onRoleChange).toHaveBeenCalledWith("business_member");
  });

  it("回显 business_member 时不进「不可修改」兜底（在白名单内）", () => {
    render(
      <WorkspaceMemberRow
        member={makeMember({
          role_key: "business_member",
          role_name: "业务成员",
        })}
        actionLoading={false}
        onRoleChange={vi.fn()}
        onSetOwner={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // 业务成员在白名单，不应出现「不可修改」兜底 option
    expect(screen.queryByText(/不可修改/)).not.toBeInTheDocument();
  });
});
