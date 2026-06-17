import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AdminRolePermissionPicker } from "@/components/admin-role-permission-picker";

describe("AdminRolePermissionPicker", () => {
  it("renders 6 group panels", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={onChange} />,
    );
    expect(screen.getByText("平台")).toBeInTheDocument();
    expect(screen.getByText(/管理（用户\/组织\/角色）/)).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText(/Agent \/ 代码 \/ 部署 \/ 工具/)).toBeInTheDocument();
    expect(screen.getByText("变更")).toBeInTheDocument();
    expect(screen.getByText("审计")).toBeInTheDocument();
  });

  it("toggling a permission calls onChange with the new set", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={onChange} />,
    );
    const userRead = screen.getByLabelText("user:read");
    expect(userRead).toBeDefined();
    fireEvent.click(userRead);
    expect(onChange).toHaveBeenCalledWith(["user:read"]);
  });

  it("clicking a checked permission removes it", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker
        permissions={["user:read"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("user:read"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("group-level select-all adds all group permissions", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker permissions={[]} onChange={onChange} />,
    );
    const adminGroup = screen.getByText(/管理（用户\/组织\/角色）/).closest("label")!;
    const checkbox = adminGroup.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    const call = onChange.mock.calls[0]![0] as string[];
    expect(call).toContain("user:read");
    expect(call).toContain("user:write");
    expect(call).toContain("organization:read");
    expect(call).toContain("role:write");
  });

  it("group-level select-all toggles off when fully selected", () => {
    const all = [
      "user:read",
      "user:write",
      "user:login:manage",
      "organization:read",
      "organization:write",
      "role:read",
      "role:write",
    ];
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker
        permissions={all}
        onChange={onChange}
      />,
    );
    const adminGroup = screen.getByText(/管理（用户\/组织\/角色）/).closest("label")!;
    const checkbox = adminGroup.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disabled prop disables all checkboxes", () => {
    const onChange = vi.fn();
    render(
      <AdminRolePermissionPicker
        permissions={[]}
        onChange={onChange}
        disabled
      />,
    );
    const userRead = screen.getByLabelText("user:read") as HTMLInputElement;
    expect(userRead.disabled).toBe(true);
    fireEvent.click(userRead);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("partial selection shows count (N/total)", () => {
    render(
      <AdminRolePermissionPicker
        permissions={["user:read"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/1\/7/)).toBeInTheDocument();
  });
});
