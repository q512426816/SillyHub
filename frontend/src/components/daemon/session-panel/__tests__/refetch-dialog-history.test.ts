// 2026-10-23-askuser-history-live-sync：refetchDialogHistory（page-helpers）
// 单元测试——SSE permission 事件触发的 dialogHistory 重拉的乱序防护。
//
// 背景：提问到达（重拉 A）与回答收口（重拉 B）秒级相邻时两次拉取并发，响应
// 乱序返回（A 晚于 B）时旧数据必须被序号守卫丢弃，最终态收敛到最新一次拉取
// 的后端权威数据。
//
// mock 口径：仅 mock @/lib/daemon 的 fetchSessionDialogHistory（helper 唯一
// 外部依赖），手动控制两个 pending promise 的 resolve 顺序制造乱序。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/daemon", () => ({
  fetchSessionDialogHistory: vi.fn(),
}));

import { fetchSessionDialogHistory } from "@/lib/daemon";
import { refetchDialogHistory } from "../page-helpers";

const mockedFetch = vi.mocked(fetchSessionDialogHistory);

describe("refetchDialogHistory 乱序防护（2026-10-23-askuser-history-live-sync）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("相邻两次拉取响应乱序 → 仅最新一次生效（旧序号响应被丢弃）", async () => {
    const setHistory = vi.fn();
    const seqRef = { current: 0 };
    let resolveA!: (v: never[]) => void;
    let resolveB!: (v: never[]) => void;
    mockedFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve as (v: never[]) => void;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve as (v: never[]) => void;
          }),
      );

    refetchDialogHistory("sess-1", setHistory, seqRef);
    refetchDialogHistory("sess-1", setHistory, seqRef);

    // 后发的先回（最新序号生效）；先发的后回（旧序号必须被丢弃）。
    resolveB(["newer"] as never[]);
    await new Promise((r) => setTimeout(r, 0));
    resolveA(["older"] as never[]);
    await new Promise((r) => setTimeout(r, 0));

    expect(setHistory).toHaveBeenCalledTimes(1);
    expect(setHistory).toHaveBeenCalledWith(["newer"]);
  });

  it("单次拉取正常路径 → 结果写入；失败静默降级不抛错", async () => {
    const setHistory = vi.fn();
    const seqRef = { current: 0 };
    mockedFetch.mockResolvedValueOnce([{ id: "d-1" }] as never[]);
    refetchDialogHistory("sess-1", setHistory, seqRef);
    await new Promise((r) => setTimeout(r, 0));
    expect(setHistory).toHaveBeenCalledWith([{ id: "d-1" }]);

    mockedFetch.mockRejectedValueOnce(new Error("network"));
    expect(() =>
      refetchDialogHistory("sess-1", setHistory, seqRef),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(setHistory).toHaveBeenCalledTimes(1);
  });
});
