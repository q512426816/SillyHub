import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api";
import {
  PERMISSION_GROUPS,
  createUser,
  createOrganization,
  createRole,
  deleteOrganization,
  deleteRole,
  deleteUser,
  disableOrganization,
  disableRole,
  disableUserLogin,
  enableOrganization,
  enableRole,
  enableUserLogin,
  getOrganization,
  getRole,
  getUser,
  listOrganizations,
  listPermissions,
  listRoles,
  listUserAudit,
  listUserSessions,
  listUserWorkspaces,
  listUsers,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  updateOrganization,
  updateRole,
  updateUser,
} from "@/lib/admin";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { useSession } from "@/stores/session";

afterEach(() => {
  fetchMock.mockReset();
  useSession.getState().clear();
});

function jsonOnce(body: unknown, status = 200, headers: Record<string, string> = {}): void {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

function emptyOnce(status = 204): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status }));
}

function errOnce(status: number, body: unknown): void {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function lastCallUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

function lastCallInit(): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

describe("admin API client", () => {
  it("ApiError is re-exported and thrown on 4xx", async () => {
    errOnce(403, {
      code: "PERMISSION_DENIED",
      message: "forbidden",
      request_id: "r1",
      details: { required: "user:write" },
    });
    await expect(listUsers()).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "PERMISSION_DENIED",
      requestId: "r1",
    });
  });

  it("network failures throw ApiError(0, network_error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(listUsers()).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      code: "network_error",
    });
  });

  it("listUsers builds query string correctly", async () => {
    jsonOnce({ items: [], total: 0 });
    await listUsers({ q: "alice", status: "active", limit: 20, offset: 0 });
    const url = lastCallUrl();
    expect(url).toContain("/api/admin/users");
    expect(url).toContain("q=alice");
    expect(url).toContain("status=active");
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=0");
  });

  it("getUser returns UserRead", async () => {
    jsonOnce({
      id: "u1",
      email: "a@b.c",
      display_name: null,
      status: "active",
      is_platform_admin: false,
      login_enabled: true,
      last_login_at: null,
      created_at: "2024-01-01T00:00:00Z",
      organizations: [],
      roles: [],
    });
    const result = await getUser("u1");
    expect(result.id).toBe("u1");
    expect(result.login_enabled).toBe(true);
    expect(result.organizations).toEqual([]);
  });

  it("createUser sends POST + JSON body", async () => {
    jsonOnce(
      {
        id: "u2",
        email: "x@y.z",
        display_name: null,
        status: "active",
        is_platform_admin: false,
        login_enabled: true,
        last_login_at: null,
        created_at: "2024-01-01T00:00:00Z",
        organizations: [],
        roles: [],
      },
      201,
    );
    await createUser({
      email: "x@y.z",
      password: "Password123!",
    });
    const init = lastCallInit();
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string).email).toBe("x@y.z");
  });

  it("updateUser sends PATCH + JSON body", async () => {
    jsonOnce({
      id: "u1",
      email: "a@b.c",
      display_name: null,
      status: "active",
      is_platform_admin: false,
      login_enabled: true,
      last_login_at: null,
      created_at: "",
      organizations: [],
      roles: [],
    });
    await updateUser("u1", { display_name: "Alice" });
    const init = lastCallInit();
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string).display_name).toBe("Alice");
  });

  it("deleteUser returns void on 204", async () => {
    emptyOnce(204);
    const result = await deleteUser("u1");
    expect(result).toBeUndefined();
  });

  it("listUserSessions returns array", async () => {
    jsonOnce([
      {
        id: "s1",
        user_agent: "curl",
        ip: "1.2.3.4",
        created_at: "2024-01-01T00:00:00Z",
        revoked_at: null,
        last_used_at: null,
      },
    ]);
    const sessions = await listUserSessions("u1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe("s1");
  });

  it("revokeUserSession sends DELETE", async () => {
    emptyOnce(204);
    await revokeUserSession("u1", "s1");
    expect(lastCallInit().method).toBe("DELETE");
    expect(lastCallUrl()).toContain("/api/admin/users/u1/sessions/s1");
  });

  it("revokeAllUserSessions returns revoked_count", async () => {
    jsonOnce({ revoked_count: 3 });
    const result = await revokeAllUserSessions("u1");
    expect(result.revoked_count).toBe(3);
  });

  it("listUserAudit returns array", async () => {
    jsonOnce([
      {
        id: "a1",
        actor_id: "u1",
        action: "user.update",
        entity_type: "user",
        entity_id: "u1",
        payload: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);
    const logs = await listUserAudit("u1");
    expect(logs).toHaveLength(1);
  });

  it("listUserWorkspaces returns array", async () => {
    jsonOnce([
      {
        workspace_id: "w1",
        workspace_name: "WS",
        workspace_slug: "ws",
        role: "workspace_owner",
      },
    ]);
    const list = await listUserWorkspaces("u1");
    expect(list[0]!.workspace_id).toBe("w1");
  });

  it("resetUserPassword returns new password", async () => {
    jsonOnce({ password: "Plaintext1!", message: "ok" });
    const result = await resetUserPassword("u1");
    expect(result.password).toBe("Plaintext1!");
  });

  it("disableUserLogin returns updated user", async () => {
    jsonOnce({
      id: "u1",
      email: "a@b.c",
      display_name: null,
      status: "active",
      is_platform_admin: false,
      login_enabled: false,
      last_login_at: null,
      created_at: "",
      organizations: [],
      roles: [],
    });
    const result = await disableUserLogin("u1");
    expect(result.login_enabled).toBe(false);
  });

  it("enableUserLogin returns updated user", async () => {
    jsonOnce({
      id: "u1",
      email: "a@b.c",
      display_name: null,
      status: "active",
      is_platform_admin: false,
      login_enabled: true,
      last_login_at: null,
      created_at: "",
      organizations: [],
      roles: [],
    });
    const result = await enableUserLogin("u1");
    expect(result.login_enabled).toBe(true);
  });

  it("self-disable-login 403 propagates USER_SELF_DISABLE_LOGIN_FORBIDDEN", async () => {
    errOnce(403, {
      code: "USER_SELF_DISABLE_LOGIN_FORBIDDEN",
      message: "cannot disable own login",
      request_id: "r",
      details: null,
    });
    await expect(disableUserLogin("u-self")).rejects.toMatchObject({
      status: 403,
      code: "USER_SELF_DISABLE_LOGIN_FORBIDDEN",
    });
  });

  it("listOrganizations returns array", async () => {
    jsonOnce([
      {
        id: "o1",
        name: "Acme",
        code: "acme",
        description: null,
        parent_id: null,
        status: "active",
        sort_order: 0,
        member_count: 0,
        children_count: 0,
        created_at: "",
        updated_at: "",
      },
    ]);
    const orgs = await listOrganizations({ is_active: true });
    expect(orgs).toHaveLength(1);
    expect(lastCallUrl()).toContain("is_active=true");
  });

  it("getOrganization returns detail with children", async () => {
    jsonOnce({
      id: "o1",
      name: "Acme",
      code: "acme",
      description: null,
      parent_id: null,
      status: "active",
      sort_order: 0,
      member_count: 0,
      children_count: 0,
      created_at: "",
      updated_at: "",
      children: [],
    });
    const result = await getOrganization("o1");
    expect(result.children).toEqual([]);
  });

  it("createOrganization sends POST", async () => {
    jsonOnce(
      {
        id: "o1",
        name: "Acme",
        code: "acme",
        description: null,
        parent_id: null,
        status: "active",
        sort_order: 0,
        member_count: 0,
        children_count: 0,
        created_at: "",
        updated_at: "",
      },
      201,
    );
    await createOrganization({ name: "Acme", code: "acme" });
    expect(lastCallInit().method).toBe("POST");
  });

  it("updateOrganization sends PATCH", async () => {
    jsonOnce({
      id: "o1",
      name: "Acme2",
      code: "acme",
      description: null,
      parent_id: null,
      status: "active",
      sort_order: 0,
      member_count: 0,
      children_count: 0,
      created_at: "",
      updated_at: "",
    });
    await updateOrganization("o1", { name: "Acme2" });
    expect(lastCallInit().method).toBe("PATCH");
  });

  it("disableOrganization returns updated", async () => {
    jsonOnce({
      id: "o1",
      name: "Acme",
      code: "acme",
      description: null,
      parent_id: null,
      status: "disabled",
      sort_order: 0,
      member_count: 0,
      children_count: 0,
      created_at: "",
      updated_at: "",
    });
    const result = await disableOrganization("o1");
    expect(result.status).toBe("disabled");
  });

  it("enableOrganization returns updated", async () => {
    jsonOnce({
      id: "o1",
      name: "Acme",
      code: "acme",
      description: null,
      parent_id: null,
      status: "active",
      sort_order: 0,
      member_count: 0,
      children_count: 0,
      created_at: "",
      updated_at: "",
    });
    const result = await enableOrganization("o1");
    expect(result.status).toBe("active");
  });

  it("deleteOrganization returns void on 204", async () => {
    emptyOnce(204);
    expect(await deleteOrganization("o1")).toBeUndefined();
  });

  it("deleteOrganization 409 ORGANIZATION_HAS_CHILDREN surfaces details", async () => {
    errOnce(409, {
      code: "ORGANIZATION_HAS_CHILDREN",
      message: "has children",
      request_id: "r",
      details: { children_count: 3 },
    });
    await expect(deleteOrganization("o1")).rejects.toMatchObject({
      status: 409,
      code: "ORGANIZATION_HAS_CHILDREN",
      details: { children_count: 3 },
    });
  });

  it("listRoles builds query string", async () => {
    jsonOnce({ items: [], total: 0 });
    await listRoles({ search: "admin", page: 1, size: 20 });
    expect(lastCallUrl()).toContain("search=admin");
    expect(lastCallUrl()).toContain("page=1");
  });

  it("getRole returns RoleRead", async () => {
    jsonOnce({
      id: "r1",
      key: "custom",
      name: "Custom",
      description: null,
      is_system: false,
      is_active: true,
      permissions: ["user:read"],
      user_count: 0,
      created_at: "",
      updated_at: "",
    });
    const result = await getRole("r1");
    expect(result.key).toBe("custom");
    expect(result.permissions).toEqual(["user:read"]);
  });

  it("createRole sends POST + permission_keys", async () => {
    jsonOnce(
      {
        id: "r1",
        key: "custom",
        name: "Custom",
        description: null,
        is_system: false,
        is_active: true,
        permissions: ["user:read"],
        user_count: 0,
        created_at: "",
        updated_at: "",
      },
      201,
    );
    await createRole({
      key: "custom",
      name: "Custom",
      permission_keys: ["user:read"],
    });
    expect(JSON.parse((lastCallInit().body as string)).permission_keys).toEqual([
      "user:read",
    ]);
  });

  it("updateRole sends PATCH", async () => {
    jsonOnce({
      id: "r1",
      key: "custom",
      name: "Custom2",
      description: null,
      is_system: false,
      is_active: true,
      permissions: [],
      user_count: 0,
      created_at: "",
      updated_at: "",
    });
    await updateRole("r1", { name: "Custom2" });
    expect(lastCallInit().method).toBe("PATCH");
  });

  it("disableRole returns updated", async () => {
    jsonOnce({
      id: "r1",
      key: "custom",
      name: "Custom",
      description: null,
      is_system: false,
      is_active: false,
      permissions: [],
      user_count: 0,
      created_at: "",
      updated_at: "",
    });
    expect((await disableRole("r1")).is_active).toBe(false);
  });

  it("enableRole returns updated", async () => {
    jsonOnce({
      id: "r1",
      key: "custom",
      name: "Custom",
      description: null,
      is_system: false,
      is_active: true,
      permissions: [],
      user_count: 0,
      created_at: "",
      updated_at: "",
    });
    expect((await enableRole("r1")).is_active).toBe(true);
  });

  it("deleteRole returns void on 204", async () => {
    emptyOnce(204);
    expect(await deleteRole("r1")).toBeUndefined();
  });

  it("deleteRole 409 ROLE_IN_USE surfaces details.user_count", async () => {
    errOnce(409, {
      code: "ROLE_IN_USE",
      message: "in use",
      request_id: "r",
      details: { user_count: 5 },
    });
    await expect(deleteRole("r1")).rejects.toMatchObject({
      status: 409,
      code: "ROLE_IN_USE",
      details: { user_count: 5 },
    });
  });

  it("createRole 422 invalid permission_keys surfaces details", async () => {
    errOnce(422, {
      code: "VALIDATION_ERROR",
      message: "bad perm",
      request_id: "r",
      details: { invalid: ["foo:bar"] },
    });
    await expect(
      createRole({
        key: "c",
        name: "C",
        permission_keys: ["foo:bar" as never],
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("PERMISSION_GROUPS covers all 6 groups", () => {
    const groups = PERMISSION_GROUPS.map((g) => g.group);
    expect(groups).toContain("PLATFORM");
    expect(groups).toContain("ADMIN");
    expect(groups).toContain("WORKSPACE");
    expect(groups).toContain("AGENT");
    expect(groups).toContain("CHANGE");
    expect(groups).toContain("AUDIT");
  });

  it("PERMISSION_GROUPS ADMIN group contains user/organization/role perms", () => {
    const admin = PERMISSION_GROUPS.find((g) => g.group === "ADMIN");
    expect(admin).toBeDefined();
    const keys = admin!.permissions.map((p) => p.key);
    expect(keys).toContain("user:read");
    expect(keys).toContain("user:write");
    expect(keys).toContain("user:login:manage");
    expect(keys).toContain("organization:read");
    expect(keys).toContain("organization:write");
    expect(keys).toContain("role:read");
    expect(keys).toContain("role:write");
  });

  it("listPermissions returns flat PermissionWithGroup[] derived from PERMISSION_GROUPS", async () => {
    const all = await listPermissions();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(7);
    const adminPerm = all.find((p) => p.key === "user:read");
    expect(adminPerm?.group).toBe("ADMIN");
  });

  it("apiFetch is re-exported and usable (sanity)", async () => {
    jsonOnce({ ok: 1 });
    const result = await apiFetch<{ ok: number }>("/api/admin/roles");
    expect(result.ok).toBe(1);
  });

  it("ApiError class is exported", () => {
    expect(new ApiError(400, {
      code: "x",
      message: "m",
      request_id: null,
      details: null,
    })).toBeInstanceOf(Error);
  });
});
