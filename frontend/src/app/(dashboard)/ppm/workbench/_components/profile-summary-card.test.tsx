/** ProfileSummaryCard 切换用户下拉单测 (task-12 / FR-02 / D-005)。 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, render } from "@testing-library/react";

import { ProfileSummaryCard } from "@/app/(dashboard)/ppm/workbench/_components/profile-summary-card";
import type { WorkbenchProfile } from "@/lib/ppm/types";

const profile: WorkbenchProfile = {
  display_name: "张三",
  employee_no: "E001",
  department_name: "研发部",
  role_name: "项目经理",
  avatar_text: "张",
  can_view_others: true,
};

describe("ProfileSummaryCard — 切换用户下拉", () => {
  it("canViewOthers=false → 不渲染切换下拉", () => {
    render(
      <ProfileSummaryCard
        profile={{ ...profile, can_view_others: false }}
        canViewOthers={false}
        switchableUsers={[]}
      />,
    );
    expect(screen.queryByText("切换查看其他成员工作台")).toBeNull();
  });

  it("canViewOthers=true + 有可切换用户 → 渲染下拉含选项 + 我自己", () => {
    render(
      <ProfileSummaryCard
        profile={profile}
        canViewOthers
        switchableUsers={[
          {
            user_id: "u2",
            display_name: "李四",
            employee_no: "E002",
            department_name: "前端组",
          },
        ]}
        targetUserId={null}
      />,
    );
    expect(screen.getByText("切换查看其他成员工作台")).toBeTruthy();
    // select 含「我自己」与「李四」
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("我自己");
    expect(options.some((t) => t?.includes("李四"))).toBe(true);
  });

  it("选中他人 → onSwitchUser(userId);选我自己 → onSwitchUser(null)", () => {
    const onSwitch = vi.fn();
    render(
      <ProfileSummaryCard
        profile={profile}
        canViewOthers
        switchableUsers={[
          {
            user_id: "u2",
            display_name: "李四",
            employee_no: "E002",
            department_name: "前端组",
          },
        ]}
        targetUserId={null}
        onSwitchUser={onSwitch}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "u2" } });
    expect(onSwitch).toHaveBeenLastCalledWith("u2");
    fireEvent.change(select, { target: { value: "__me__" } });
    expect(onSwitch).toHaveBeenLastCalledWith(null);
  });
});
