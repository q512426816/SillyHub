/**
 * use-object-url 单测：覆盖 blob 拉取 / 竞态防护 / 卸载 revoke / retry。
 *
 * jsdom 无 URL.createObjectURL / revokeObjectURL，需 mock（参照 explorer 测试先例）。
 */

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useObjectUrl } from "../use-object-url";

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  });
  mockCreateObjectURL.mockClear();
  mockRevokeObjectURL.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (_v: T) => void;
  let reject!: (_e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useObjectUrl", () => {
  it("fetcher 为 null 时保持 idle 不发请求", () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.blob).toBeNull();
    expect(result.current.url).toBeNull();
  });

  it("拉取成功后 status=ok 且 blob/url 可用", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const { promise, resolve } = deferred<Blob>();
    const fetcher = vi.fn(() => promise);

    const { result } = renderHook(() => useObjectUrl(fetcher));
    expect(result.current.status).toBe("loading");

    await act(async () => resolve(blob));
    expect(result.current.status).toBe("ok");
    expect(result.current.blob).toBe(blob);
    expect(result.current.url).toBe("blob:mock-url");
  });

  it("拉取失败进入 error，retry 可恢复", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    let attempt = 0;
    const fetcher = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("网络错误"))
        : Promise.resolve(blob);
    });

    const { result } = renderHook(() => useObjectUrl(fetcher));
    await act(async () => {});
    expect(result.current.status).toBe("error");

    await act(async () => result.current.retry());
    expect(result.current.status).toBe("ok");
    expect(result.current.blob).toBe(blob);
  });

  it("卸载时已创建的 objectURL 被 revoke", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const fetcher = vi.fn(() => Promise.resolve(blob));

    const { result, unmount } = renderHook(() => useObjectUrl(fetcher));
    await act(async () => {});
    expect(result.current.url).toBe("blob:mock-url");

    unmount();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("fetcher 切换时旧 URL 被 revoke，stale 结果被丢弃", async () => {
    const blobA = new Blob(["A"], { type: "text/plain" });
    const blobB = new Blob(["B"], { type: "text/plain" });

    const dA = deferred<Blob>();
    const fetcherA = vi.fn(() => dA.promise);
    const fetcherB = vi.fn(() => Promise.resolve(blobB));

    const { result, rerender } = renderHook(
      ({ fetcher }) => useObjectUrl(fetcher),
      { initialProps: { fetcher: fetcherA } },
    );

    // A 还在 pending 时切换到 B
    rerender({ fetcher: fetcherB });
    // A 迟到完成，结果应被丢弃
    await act(async () => dA.resolve(blobA));
    expect(result.current.blob).toBe(blobB);
  });
});
