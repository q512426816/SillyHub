// task-03（2026-07-31-admin-roles-permission-modal）：AdminRolePermissionPicker 左树右权测试。
// 覆盖 FR-02/03/04：左树 section/menu + 选中数、点节点切换右面板、全选/indeterminate、
// 默认选第一个 menu、disabled。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AdminRolePermissionPicker } from "../admin-role-permission-picker";
import { MENU_PERMISSION_GROUPS, MENU_SECTION_ORDER } from "@/lib/menu-permissions";

// 取第一个非 pickerHidden menu + 它的一个权限 key,作为测试夹具。
const firstMenu = MENU_PERMISSION_GROUPS.find((g) => !g.pickerHidden)!;
const firstPermKey = firstMenu.permissions[0]!.key;
const firstPermName = firstMenu.permissions[0]!.name;
const firstSectionMenus = MENU_PERMISSION_GROUPS.filter(
  (g) => g.section === firstMenu.section && !g.pickerHidden,
);
// 第二个非 pickerHidden menu(测切换)。
const secondMenu =
  MENU_PERMISSION_GROUPS.filter((g) => !g.pickerHidden).find(
    (g) => g.menuKey !== firstMenu.menuKey,
  ) ?? firstMenu;

describe("AdminRolePermissionPicker 左树右权 (task-03 / FR-02/03/04)", () => {
  it("左树渲染所有 section 的 menu + 选中数 n/m", () => {
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />,
    );
    // 第一个 menu 标签 + 0/n 选中数可见(左树)。
    const labels = screen.getAllByText(firstMenu.menuLabel);
    expect(labels.length).toBeGreaterThan(0);
    const cntRegex = new RegExp(`^0/${firstMenu.permissions.length}$`);
    expect(screen.getByText(cntRegex)).toBeInTheDocument();
  });

  it("默认选第一个 menu → 右面板显其权限(非空)", () => {
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />,
    );
    // 右面板显第一个 menu 的权限名。
    expect(screen.getByText(firstPermName)).toBeInTheDocument();
  });

  it("点左树第二个 menu → 右面板切换到该 menu 权限", () => {
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(secondMenu.menuLabel));
    // 右面板应显第二个 menu 的第一个权限名。
    expect(
      screen.getByText(secondMenu.permissions[0]!.name),
    ).toBeInTheDocument();
  });

  it("勾选右面板单个权限 → onChange 收到该 key", () => {
    const onChange = vi.fn();
    render(<AdminRolePermissionPicker permissions={[]} onChange={onChange} />);
    const ck = screen.getByLabelText(firstPermKey) as HTMLInputElement;
    fireEvent.click(ck);
    expect(onChange).toHaveBeenCalledWith([firstPermKey]);
  });

  it("全选 → onChange 含该 menu 全部 key", () => {
    const onChange = vi.fn();
    render(<AdminRolePermissionPicker permissions={[]} onChange={onChange} />);
    const allBtn = screen.getByLabelText(`${firstMenu.menuLabel} 全选`);
    fireEvent.click(allBtn);
    expect(onChange).toHaveBeenCalledWith(firstMenu.permissions.map((p) => p.key));
  });

  it("部分选中 → 全选 checkbox indeterminate", () => {
    render(
      <AdminRolePermissionPicker
        permissions={[firstPermKey]}
        onChange={vi.fn()}
      />,
    );
    const allInput = screen.getByLabelText(
      `${firstMenu.menuLabel} 全选`,
    ) as HTMLInputElement;
    expect(allInput.indeterminate).toBe(true);
  });

  it("disabled → 单个权限 checkbox 不可点(onChange 不触发)", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={onChange} disabled />,
    );
    const ck = screen.getByLabelText(firstPermKey) as HTMLInputElement;
    expect(ck.disabled).toBe(true);
    fireEvent.click(ck);
    expect(onChange).not.toHaveBeenCalled();
  });
});
