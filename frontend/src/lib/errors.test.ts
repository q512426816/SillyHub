/**
 * task-03: errMessage 单测 —— AC-01 的唯一编码验收证据。
 *
 * 覆盖 errMessage 全部分支 + D-006@v1 铁律（返回值绝不含 err.code / HTTP_ / 英文 fetch msg）。
 * 不测 useNotify（task-02 范围，需 renderHook + AntApp provider，收益低）。
 *
 * import 风格对齐 lib/daemon.test.ts / lib/__tests__/api.test.ts（显式 import vitest，
 * 虽然 vitest globals=true 已开启，但项目既有惯例如此，保持一致）。
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { errMessage } from "@/lib/errors";

describe("errMessage", () => {
  // 用例 1：业务 ApiError（409 等）→ 返回后端中文 message 原值
  it("returns backend Chinese message for business ApiError", () => {
    const err = new ApiError(409, {
      code: "HTTP_409_DAEMON_RUNTIME_IN_USE",
      message: "该 daemon 仍被 1 个 workspace 绑定，请先解绑后再移除",
      request_id: "req-abc",
      details: { bound_workspaces: ["ws-1"] },
    });
    expect(errMessage(err)).toBe(
      "该 daemon 仍被 1 个 workspace 绑定，请先解绑后再移除",
    );
  });

  // 用例 2：network_error ApiError → 中文兜底（err.message 此时是英文 "Failed to fetch"，不可暴露）
  it("returns Chinese fallback for network_error ApiError (not the English fetch message)", () => {
    const err = new ApiError(0, {
      code: "network_error",
      message: "Failed to fetch",
      request_id: null,
      details: null,
    });
    expect(errMessage(err)).toBe("网络连接失败，请检查网络后重试");
  });

  // 用例 3：普通 Error（非 ApiError）→ err.message
  it("returns err.message for generic Error", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });

  // 用例 4：无 message 的值 → 默认 fallback「操作失败」
  it("returns default fallback when err has no message", () => {
    expect(errMessage(null)).toBe("操作失败");
    expect(errMessage(undefined)).toBe("操作失败");
    expect(errMessage({})).toBe("操作失败");
    expect(errMessage(new Error(""))).toBe("操作失败"); // 空串 message 视为无
  });

  // 用例 5：传 fallback 参数 → 用传入值
  it("uses provided fallback when err has no message", () => {
    expect(errMessage(null, "加载失败")).toBe("加载失败");
    expect(errMessage(new Error(""), "删除失败")).toBe("删除失败");
  });

  // 用例 6：铁律 —— 所有分支返回值绝不包含 err.code / "HTTP_" 字样（D-006@v1）
  it("never exposes English err.code in any branch (D-006@v1)", () => {
    const businessErr = new ApiError(409, {
      code: "HTTP_409_DAEMON_RUNTIME_IN_USE",
      message: "该 daemon 仍被 1 个 workspace 绑定",
      request_id: null,
      details: null,
    });
    expect(errMessage(businessErr)).not.toContain("HTTP_");
    expect(errMessage(businessErr)).not.toContain(
      "HTTP_409_DAEMON_RUNTIME_IN_USE",
    );
    expect(errMessage(businessErr)).not.toContain("DAEMON_RUNTIME_IN_USE");

    const netErr = new ApiError(0, {
      code: "network_error",
      message: "Failed to fetch",
      request_id: null,
      details: null,
    });
    // network 兜底尤其要防 regression：一旦有人改回返 err.message 会暴露英文 + code
    expect(errMessage(netErr)).not.toContain("network_error");
    expect(errMessage(netErr)).not.toContain("Failed to fetch");
    expect(errMessage(netErr)).not.toContain("HTTP_");
  });
});
