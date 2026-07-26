/**
 * task-13 / FR-04：canBorrowSharedDaemon 纯函数测试。
 *
 * 契约（design §5 Phase 2 / D-002@v1 / D-006@v2）：
 *  - is_platform_admin 短路 true（平台管理员继承借用能力）
 *  - permissions 含 "daemon:borrow" → true（business_member 角色授此权限）
 *  - 其余（无 daemon:borrow 且非 admin）→ false
 *  - permissions 缺省/null → false（防御 undefined）
 */
import { describe, expect, it } from "vitest";

import { canBorrowSharedDaemon } from "@/lib/workspace-binding";

describe("canBorrowSharedDaemon（task-13 / FR-04 门禁放宽）", () => {
  it("permissions 含 daemon:borrow → true（business_member）", () => {
    expect(
      canBorrowSharedDaemon(
        ["workspace:read", "task:run_agent", "daemon:borrow"],
        false,
      ),
    ).toBe(true);
  });

  it("is_platform_admin=true 短路 → true（即便 permissions 缺 daemon:borrow）", () => {
    expect(canBorrowSharedDaemon(["workspace:read"], true)).toBe(true);
  });

  it("is_platform_admin=true 且 permissions 为空 → 仍 true", () => {
    expect(canBorrowSharedDaemon([], true)).toBe(true);
  });

  it("permissions 不含 daemon:borrow 且非 admin → false（普通 viewer/developer）", () => {
    expect(
      canBorrowSharedDaemon(["workspace:read", "task:run_agent"], false),
    ).toBe(false);
  });

  it("permissions 缺省（undefined）且非 admin → false", () => {
    expect(canBorrowSharedDaemon(undefined, false)).toBe(false);
  });

  it("permissions 为 null 且非 admin → false", () => {
    expect(canBorrowSharedDaemon(null, false)).toBe(false);
  });

  it("is_platform_admin 缺省（undefined）+ 含 daemon:borrow → true", () => {
    expect(canBorrowSharedDaemon(["daemon:borrow"], undefined)).toBe(true);
  });

  it("is_platform_admin 缺省 + 无 daemon:borrow → false", () => {
    expect(canBorrowSharedDaemon(["workspace:read"], undefined)).toBe(false);
  });
});
