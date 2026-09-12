import { afterEach, describe, expect, it, vi } from "vitest";

import { updateMyAvatar } from "@/lib/auth";

// fetchMe 会写 zustand store——mock 掉 session store，只断言调用语义。
const setUserMock = vi.fn();
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => ({ setUser: setUserMock }),
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

function meResponse(): Response {
  return new Response(
    JSON.stringify({
      user: { id: "u1", email: "a@b.c", username: "a", is_platform_admin: false },
      permissions: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  fetchMock.mockReset();
  setUserMock.mockReset();
  warnSpy.mockClear();
});

describe("updateMyAvatar（H-3：PATCH 成功即成功，fetchMe 刷新失败不上抛）", () => {
  it("PATCH 成功 + fetchMe 成功 → 正常返回且 store 刷新一次", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("null", { status: 200 })) // PATCH
      .mockResolvedValueOnce(meResponse()); // GET /api/auth/me

    await expect(updateMyAvatar("/api/file/abc")).resolves.toBeUndefined();

    const [patchUrl, patchInit] = fetchMock.mock.calls[0] ?? [];
    // apiFetch 会把相对路径补全为绝对 URL（api.test.ts 同款地址断言口径）。
    expect(String(patchUrl)).toContain("/api/auth/me/avatar");
    expect(patchInit?.method).toBe("PATCH");
    expect(patchInit?.body).toBe(JSON.stringify({ avatar: "/api/file/abc" }));
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("PATCH 成功但 fetchMe 网络失败 → 不抛错（调用方不得误判保存失败而回收新文件）", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("null", { status: 200 })) // PATCH 成功
      .mockRejectedValueOnce(new TypeError("网络抖动")); // fetchMe 失败

    await expect(updateMyAvatar("/api/file/abc")).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1); // 只留 warn，不上抛
  });

  it("PATCH 失败 → 原样上抛（调用方孤儿回收路径仍生效）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "x", message: "bad" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(updateMyAvatar("/api/file/abc")).rejects.toMatchObject({ status: 500 });
    expect(setUserMock).not.toHaveBeenCalled();
  });

  it("清除头像：null 映射为空串下发（三态契约回归）", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("null", { status: 200 }))
      .mockResolvedValueOnce(meResponse());

    await updateMyAvatar(null);

    const [, clearInit] = fetchMock.mock.calls[0] ?? [];
    expect(clearInit?.body).toBe(JSON.stringify({ avatar: "" }));
  });
});
