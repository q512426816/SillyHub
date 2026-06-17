import { describe, expect, it } from "vitest";

import { hasAdminPermission } from "@/lib/permission";
import type { SessionUser } from "@/stores/session";

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u-1",
    email: "u@example.com",
    displayName: "U",
    ...overrides,
  };
}

describe("hasAdminPermission", () => {
  it("returns false for null user", () => {
    expect(hasAdminPermission(null)).toBe(false);
  });

  it("returns true when is_platform_admin === true", () => {
    expect(hasAdminPermission(makeUser({ is_platform_admin: true }))).toBe(true);
  });

  it("returns true when user holds any user:* permission", () => {
    expect(
      hasAdminPermission(
        makeUser({ permissions: ["user:read", "workspace:read"] }),
      ),
    ).toBe(true);
  });

  it("returns true when user holds any organization:* permission", () => {
    expect(
      hasAdminPermission(makeUser({ permissions: ["organization:write"] })),
    ).toBe(true);
  });

  it("returns true when user holds any role:* permission", () => {
    expect(hasAdminPermission(makeUser({ permissions: ["role:read"] }))).toBe(
      true,
    );
  });

  it("returns false when user only holds unrelated permissions", () => {
    expect(
      hasAdminPermission(
        makeUser({ permissions: ["workspace:read", "agent:run"] }),
      ),
    ).toBe(false);
  });

  it("returns false when permissions array is empty", () => {
    expect(hasAdminPermission(makeUser({ permissions: [] }))).toBe(false);
  });

  it("returns false when both fields are missing (legacy session)", () => {
    expect(hasAdminPermission(makeUser({}))).toBe(false);
  });

  it("returns false when is_platform_admin is false and no permissions", () => {
    expect(
      hasAdminPermission(makeUser({ is_platform_admin: false, permissions: [] })),
    ).toBe(false);
  });
});
