import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AdminUserDrawer } from "@/components/admin-user-drawer";
import type {
  OrganizationRead,
  RoleRead,
  UserRead,
} from "@/lib/admin";

function makeOrg(id: string, name: string, code: string): OrganizationRead {
  return {
    id,
    name,
    code,
    description: null,
    parent_id: null,
    status: "active",
    sort_order: 0,
    member_count: 0,
    children_count: 0,
    created_at: "",
    updated_at: "",
  };
}

function makeRole(id: string, key: string, name: string): RoleRead {
  return {
    id,
    key,
    name,
    description: null,
    is_system: false,
    is_active: true,
    permissions: [],
    user_count: 0,
    created_at: "",
    updated_at: "",
  };
}

function makeUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: "u1",
    email: "alice@example.com",
    display_name: "Alice",
    status: "active",
    is_platform_admin: false,
    login_enabled: true,
    last_login_at: null,
    created_at: "",
    organizations: [],
    roles: [],
    ...overrides,
  };
}

const baseProps = {
  onClose: () => {},
  onSubmit: vi.fn().mockResolvedValue(undefined),
  organizations: [makeOrg("o1", "Acme", "acme")],
  roles: [makeRole("r1", "editor", "Editor")],
  canWrite: true,
  canLoginManage: true,
  currentUserId: "self",
};

describe("AdminUserDrawer", () => {
  it("create mode renders email + password + display_name fields", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    expect(screen.getByText("邮箱")).toBeInTheDocument();
    expect(screen.getByText(/密码（至少 8 位）/)).toBeInTheDocument();
    expect(screen.getByText(/显示名（可选）/)).toBeInTheDocument();
  });

  it("edit mode hides password field", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="edit"
        user={makeUser()}
      />,
    );
    expect(screen.queryByText(/密码（至少 8 位）/)).not.toBeInTheDocument();
  });

  it("edit mode pre-fills fields from user", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="edit"
        user={makeUser({
          display_name: "Alice",
          is_platform_admin: true,
          organizations: [{ id: "o1", name: "Acme", code: "acme" }],
          roles: [{ id: "r1", key: "editor", name: "Editor" }],
        })}
      />,
    );
    expect(
      (screen.getByDisplayValue("Alice") as HTMLInputElement).value,
    ).toBe("Alice");
    const orgCheckbox = screen.getByLabelText("acme") as HTMLInputElement;
    expect(orgCheckbox.checked).toBe(true);
  });

  it("create submit is disabled when email invalid or password too short", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    const submitBtn = screen.getByText("保存");
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("create submit calls onSubmit with form body", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminUserDrawer
        {...baseProps}
        onSubmit={onSubmit}
        open
        mode="create"
      />,
    );
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "bob@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0];
    expect(body.email).toBe("bob@example.com");
    expect(body.password).toBe("Password1!");
  });

  it("self-edit shows banner and disables self-demotion", () => {
    const user = makeUser({ id: "self", is_platform_admin: true });
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="edit"
        user={user}
        currentUserId="self"
      />,
    );
    expect(
      screen.getByText(/不能取消自己的超管权限或禁用自己的登录/),
    ).toBeInTheDocument();
    // is_platform_admin checkbox is disabled (can't demote self)
    const adminCheckbox = screen.getByLabelText("平台超级管理员") as HTMLInputElement;
    expect(adminCheckbox.disabled).toBe(true);
  });

  it("disabled canWrite disables submit", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
        canWrite={false}
      />,
    );
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("organizations checkbox toggles selection", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    const cb = screen.getByLabelText("acme") as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
  });
});
