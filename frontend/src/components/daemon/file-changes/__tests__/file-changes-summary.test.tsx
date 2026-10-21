// task-11（2026-10-20-session-page-dsh-alignment 线 C）会话级汇总卡单测。
//
// 锁定契约（design E7 + R-08）：
//   1. 多轮去重：同一 path 出现在 3 轮 → 汇总计 1 个文件、+/− 为三轮之和；
//   2. Σadded / Σdeleted 与文件总数口径；
//   3. status 取最差值（unavailable > failed > partial > ok）；
//   4. 横幅「可能含并行会话改动」恒在场（共享工作区归属不可分，D-023 接受）；
//   5. 降级轮（capability=tool_only / 无快照）计入「N 轮无工作区快照」，汇总至少
//      partial——「统计不完整」不许被读成「没有改动」；
//   6. 无数据不渲染；**零 fetch**（props only 的硬约束）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  FileChangesSummary,
  aggregateTurnFileChanges,
  worstFileChangesStatus,
  type FileChangesSummaryEntry,
} from "@/components/daemon/file-changes/file-changes-summary";
import type {
  TurnFileChange,
  TurnFileChangesSnapshot,
} from "@/components/daemon/file-changes/turn-file-changes";

function makeFile(overrides: Partial<TurnFileChange> = {}): TurnFileChange {
  return {
    path: "frontend/src/a.tsx",
    status: "modified",
    added: 10,
    deleted: 2,
    attribution: "edit_patch",
    editToolNames: ["Edit"],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<TurnFileChangesSnapshot> = {},
): TurnFileChangesSnapshot {
  return {
    runId: "run-1",
    baselineHead: "abc1234",
    collectedAt: "2026-10-21T08:00:00Z",
    collectMs: 30,
    status: "ok",
    files: [],
    concurrentSessionsHint: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("worstFileChangesStatus / aggregateTurnFileChanges（纯函数）", () => {
  it("status 取最差值：unavailable > failed > partial > ok", () => {
    expect(worstFileChangesStatus(["ok", "partial", "failed"])).toBe("failed");
    expect(worstFileChangesStatus(["failed", "unavailable", "ok"])).toBe("unavailable");
    expect(worstFileChangesStatus(["ok", "partial"])).toBe("partial");
    expect(worstFileChangesStatus([])).toBeNull();
    expect(worstFileChangesStatus(["ok", "ok"])).toBe("ok");
  });

  it("同一 path 出现在 3 轮 → 1 个文件、+/− 与编辑次数求和", () => {
    const entries: FileChangesSummaryEntry[] = [
      {
        snapshot: makeSnapshot({
          files: [makeFile({ path: "src/shared.ts", added: 10, deleted: 1 })],
        }),
        capability: "full",
      },
      {
        snapshot: makeSnapshot({
          files: [makeFile({ path: "src/shared.ts", added: 5, deleted: 2 })],
        }),
        capability: "full",
      },
      {
        snapshot: makeSnapshot({
          files: [
            makeFile({
              path: "src/shared.ts",
              added: 1,
              deleted: 0,
              attribution: "command",
              editToolNames: null,
            }),
          ],
        }),
        capability: "full",
      },
    ];

    const agg = aggregateTurnFileChanges(entries);
    expect(agg.totalFiles).toBe(1);
    expect(agg.files[0]).toMatchObject({
      path: "src/shared.ts",
      adds: 16,
      dels: 3,
      // 前两轮各 1 次 Edit 编辑，第三轮是命令行改动（无「编辑次数」概念）→ 合计 2。
      edits: 2,
      // 任一轮是 command 归因 → 保守按 shell（不把 git 侧改动说成工具编辑）。
      source: "shell",
    });
    expect(agg.totalAdds).toBe(16);
    expect(agg.totalDels).toBe(3);
    expect(agg.status).toBe("ok");
  });

  it("降级轮（tool_only / 无快照）不伪造文件，但把汇总压到至少 partial 并计数", () => {
    const agg = aggregateTurnFileChanges([
      { snapshot: makeSnapshot({ files: [makeFile()] }), capability: "full" },
      { snapshot: null, capability: "tool_only" },
      { snapshot: null, capability: null },
      { snapshot: null, capability: "tool_only" },
    ]);

    expect(agg.totalFiles).toBe(1);
    expect(agg.degradedTurns).toBe(2);
    // 两字段全缺的轮不参与（未接线，不算降级）。
    expect(agg.consideredTurns).toBe(3);
    expect(agg.status).toBe("partial");
  });

  it("truncated / partial 快照计入 truncated（行级统计为下限）", () => {
    const agg = aggregateTurnFileChanges([
      { snapshot: makeSnapshot({ status: "partial", files: [makeFile()] }), capability: "full" },
    ]);
    expect(agg.truncated).toBe(true);
    expect(agg.status).toBe("partial");
    expect(agg.totalFiles).toBe(1);
  });

  it("failed / unavailable 轮不贡献文件行（数据不可信）", () => {
    const agg = aggregateTurnFileChanges([
      {
        snapshot: makeSnapshot({ status: "unavailable", files: [makeFile()] }),
        capability: "full",
      },
      { snapshot: makeSnapshot({ status: "ok", files: [makeFile({ path: "b.ts" })] }), capability: "full" },
    ]);
    expect(agg.status).toBe("unavailable");
    expect(agg.totalFiles).toBe(1);
    expect(agg.files[0]!.path).toBe("b.ts");
  });
});

describe("FileChangesSummary（渲染）", () => {
  it("多轮汇总卡：文件总数 + Σ+/− + 状态 + 横幅 + 降级计数", () => {
    render(
      <FileChangesSummary
        turns={[
          {
            snapshot: makeSnapshot({
              files: [
                makeFile({ path: "src/a.ts", added: 8, deleted: 1 }),
                makeFile({ path: "src/b.ts", added: 2, deleted: 0 }),
              ],
            }),
            capability: "full",
          },
          {
            snapshot: makeSnapshot({
              files: [makeFile({ path: "src/a.ts", added: 4, deleted: 3 })],
            }),
            capability: "full",
          },
          { snapshot: null, capability: "tool_only" },
        ]}
      />,
    );

    const card = screen.getByTestId("file-changes-summary");
    // 3 个不同 path？不：a.ts 出现两轮（去重），b.ts 一次 → 共 2 个文件。
    expect(card).toHaveAttribute("data-total-files", "2");
    expect(card).toHaveAttribute("data-degraded-turns", "1");
    expect(card).toHaveAttribute("data-status", "partial");
    expect(screen.getByText("会话文件改动")).toBeInTheDocument();
    expect(screen.getByText("共 2 个文件")).toBeInTheDocument();
    expect(screen.getByText("+14")).toBeInTheDocument();
    expect(screen.getByText("−4")).toBeInTheDocument();
    expect(screen.getByTestId("file-changes-summary-status")).toHaveTextContent("统计不完整");
    // R-08 横幅恒在场（含并行会话改动）。
    expect(screen.getByTestId("file-changes-summary-banner")).toHaveTextContent(
      /可能含并行会话改动/,
    );
    expect(screen.getByTestId("file-changes-summary-degraded")).toHaveTextContent(
      "其中 1 轮无工作区快照（仅工具编辑），汇总不完整",
    );
    // 硬约束：全树不出现「无改动」——没有快照 ≠ 没有改动。
    expect(screen.queryByText(/无改动/)).toBeNull();
  });

  it("status=ok 时给完整口径，且仍带并行会话横幅", () => {
    render(
      <FileChangesSummary
        turns={[
          {
            snapshot: makeSnapshot({ files: [makeFile({ added: 3, deleted: 0 })] }),
            capability: "full",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("file-changes-summary")).toHaveAttribute("data-status", "ok");
    expect(screen.getByTestId("file-changes-summary-status")).toHaveTextContent("完整");
    expect(screen.getByTestId("file-changes-summary-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("file-changes-summary-degraded")).toBeNull();
  });

  it("无数据不渲染（零文件且无降级轮 → 不出空壳）", () => {
    const { container } = render(
      <FileChangesSummary turns={[{ snapshot: makeSnapshot({ files: [] }), capability: "full" }]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("file-changes-summary")).toBeNull();
  });

  it("零 fetch：props only，渲染不触发任何网络请求", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <FileChangesSummary
        turns={[
          { snapshot: makeSnapshot({ files: [makeFile()] }), capability: "full" },
          { snapshot: null, capability: "tool_only" },
        ]}
      />,
    );

    expect(screen.getByTestId("file-changes-summary")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
