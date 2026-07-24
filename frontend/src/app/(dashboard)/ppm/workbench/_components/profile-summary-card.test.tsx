/** ProfileSummaryCard 切换用户(可搜索)单测 (task-12 / FR-02 / D-005)。
 *
 * antd Select 在 jsdom 交互 finicky,这里 mock 成原生 select 桩,
 * 验证组件契约:options 透传(我自己 + 可切换用户) + onChange→onSwitchUser 转译。
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, render } from "@testing-library/react";
import type { JSX } from "react";

import { ProfileSummaryCard } from "@/app/(dashboard)/ppm/workbench/_components/profile-summary-card";
import type { WorkbenchProfile } from "@/lib/ppm/types";

vi.mock("antd", () => ({
  // 把 antd Select 桩成原生 select(value/onChange/options),便于断言与交互
  Select: ({
    value,
    onChange,
    options,
  }: {
    value?: string;
    onChange?: (v: string) => void;
    options?: { value: string; label: string }[];
  }): JSX.Element => (
    <select
      data-testid="mock-select"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const profile: WorkbenchProfile = {
  display_name: "张三",
  employee_no: "E001",
  department_name: "研发部",
  role_name: "项目经理",
  avatar_text: "张",
  can_view_others: true,
};

describe("ProfileSummaryCard — 切换用户(可搜索)", () => {
  it("canViewOthers=false → 不渲染切换下拉", () => {
    render(
      <ProfileSummaryCard
        profile={{ ...profile, can_view_others: false }}
        canViewOthers={false}
        switchableUsers={[]}
      />,
    );
    expect(screen.queryByText(/切换查看其他成员/)).toBeNull();
  });

  it("canViewOthers=true + 有可切换用户 → 渲染下拉含「我自己」与成员", () => {
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
    expect(screen.getByText(/切换查看其他成员/)).toBeTruthy();
    const select = screen.getByTestId("mock-select") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(opts.some((t) => t.includes("我自己"))).toBe(true);
    expect(opts.some((t) => t.includes("李四"))).toBe(true);
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
    const select = screen.getByTestId("mock-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "u2" } });
    expect(onSwitch).toHaveBeenLastCalledWith("u2");
    fireEvent.change(select, { target: { value: "__me__" } });
    expect(onSwitch).toHaveBeenLastCalledWith(null);
  });
});
