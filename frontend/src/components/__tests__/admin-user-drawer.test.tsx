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
    subtree_member_count: 0,
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
    username: "alice",
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
  it("create mode renders username + email + password + display_name fields", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
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
          username: "alice",
          display_name: "Alice",
          is_platform_admin: true,
          organizations: [{ id: "o1", name: "Acme", code: "acme" }],
          roles: [{ id: "r1", key: "editor", name: "Editor" }],
        })}
      />,
    );
    expect(
      (screen.getByLabelText("登录名") as HTMLInputElement).value,
    ).toBe("alice");
    expect(
      (screen.getByDisplayValue("Alice") as HTMLInputElement).value,
    ).toBe("Alice");
    const orgCheckbox = screen.getByLabelText("acme") as HTMLInputElement;
    expect(orgCheckbox.checked).toBe(true);
  });

  it("create submit is disabled when username missing or password too short", () => {
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
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0];
    expect(body.username).toBe("bob");
    expect(body.password).toBe("Password1!");
  });

  it("test_username_required_create: create mode disables submit when username empty or too short", async () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    // 仅填合法 password，username 空 → 保存禁用
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    expect(submitBtn.disabled).toBe(true);
    // username < 3 位 → 保存禁用
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "ab" },
    });
    expect(submitBtn.disabled).toBe(true);
    // username >= 3 位 → 保存启用
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "alice" },
    });
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
  });

  it("test_username_editable: edit mode allows editing username field", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="edit"
        user={makeUser({ username: "alice" })}
      />,
    );
    const usernameInput = screen.getByLabelText("登录名") as HTMLInputElement;
    // 初始回填 user.username
    expect(usernameInput.value).toBe("alice");
    // 可编辑（非 isSelf）
    expect(usernameInput.disabled).toBe(false);
    // 修改为新值
    fireEvent.change(usernameInput, { target: { value: "alice2" } });
    expect(usernameInput.value).toBe("alice2");
  });

  it("test_email_optional: create mode allows empty email and submits without email", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminUserDrawer
        {...baseProps}
        onSubmit={onSubmit}
        open
        mode="create"
      />,
    );
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    // email 留空
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = onSubmit.mock.calls[0]![0];
    expect(body.username).toBe("bob");
    // 空传 null
    expect(body.email).toBeFalsy();
  });

  it("test_email_format_when_present: create mode validates email format only when email is non-empty", async () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    // ① email 留空 → 保存启用
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    // ② email 非法 → 保存禁用 + 红字
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "bad-email" },
    });
    await waitFor(() => expect(submitBtn.disabled).toBe(true));
    expect(screen.getByText("邮箱格式不合法")).toBeInTheDocument();
    // ③ email 合法 → 保存启用 + 红字消失
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "bob@example.com" },
    });
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    expect(screen.queryByText("邮箱格式不合法")).not.toBeInTheDocument();
  });

  it("test_username_conflict_error_display: create mode displays error and keeps input when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("登录名已被占用"));
    render(
      <AdminUserDrawer
        {...baseProps}
        onSubmit={onSubmit}
        open
        mode="create"
      />,
    );
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Password1!" },
    });
    const submitBtn = screen.getByText("保存") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() =>
      expect(screen.getByText("登录名已被占用")).toBeInTheDocument(),
    );
    // 输入保留，便于改后重试
    const usernameInput = screen.getByLabelText("登录名") as HTMLInputElement;
    expect(usernameInput.value).toBe("alice");
    // onSubmit 被调用一次、body.username === "alice"
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].username).toBe("alice");
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

  it("T-09: create 模式按 defaultOrganizationIds 预填勾选", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
        defaultOrganizationIds={["o1"]}
      />,
    );
    // o1 对应 organization(baseProps.organizations=[makeOrg("o1","Acme","acme")])
    // checkbox aria-label=o.code="acme",默认勾选
    const cb = screen.getByLabelText("acme") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("T-10: create 模式不传 defaultOrganizationIds → 默认不勾(空回归)", () => {
    render(
      <AdminUserDrawer
        {...baseProps}
        open
        mode="create"
      />,
    );
    const cb = screen.getByLabelText("acme") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("T-11: edit 模式忽略 defaultOrganizationIds,用 user.organizations", () => {
    // 给两个 organization:o1(Acme) + o2(Beta),user.organizations=[o2]
    render(
      <AdminUserDrawer
        {...baseProps}
        organizations={[
          makeOrg("o1", "Acme", "acme"),
          makeOrg("o2", "Beta", "beta"),
        ]}
        open
        mode="edit"
        user={makeUser({
          organizations: [{ id: "o2", name: "Beta", code: "beta" }],
        })}
        defaultOrganizationIds={["o1"]}
      />,
    );
    // edit 模式:user.organizations=o2 → beta 勾选;defaultOrganizationIds=o1 被忽略
    const betaCb = screen.getByLabelText("beta") as HTMLInputElement;
    const acmeCb = screen.getByLabelText("acme") as HTMLInputElement;
    expect(betaCb.checked).toBe(true);
    expect(acmeCb.checked).toBe(false);
  });
});
