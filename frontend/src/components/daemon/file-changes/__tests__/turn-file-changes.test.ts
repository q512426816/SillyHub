// task-11（2026-10-20-session-page-dsh-alignment 线 C「1b 第三段」）映射纯函数单测。
//
// 锁定契约（design.md「文件变更卡 DTO」+ E6/E8）：
//   1. 归因映射：edit_patch → source=tool（edits 取 editToolNames 条数、工具名保留）；
//      command → source=shell（edits=0，无「编辑次数」概念）；
//   2. status=partial（或 truncated）→ truncated=true，卡片照出（不是错误态）；
//   3. binary 透传到 ChangedFile（行级破折号由卡片承担）；
//   4. capability=tool_only → **降级态**（不是 null）：files 恒空、不伪造行级数据；
//   5. 两字段全缺（未接线）→ null（不出卡、不出占位）；snapshot=null 但 capability
//      已给 → 降级态（E8：不许静默成「本轮无改动」）；
//   6. status=failed/unavailable → 降级态；
//   7. sharedWorkspace = snapshot.concurrentSessionsHint（共享工作区恒提示）；
//   8. ok 且 files 为空 → null（快照确认零改动 → 空态零渲染，不写「无改动」文案）；
//   9. attachRunFileChanges：snake_case 读模型 → camelCase 轮字段，capability 缺省
//      tool_only，未变化轮保持对象引用（TurnRow memo 不击穿）。

import { describe, expect, it } from "vitest";

import {
  attachRunFileChanges,
  toChangedFile,
  toFileChangesCardProps,
  type FileChangesTurnFields,
  type TurnFileChange,
  type TurnFileChangesSnapshot,
} from "@/components/daemon/file-changes/turn-file-changes";

/** 测试用轮对象（投影只认 runId / realRunId / 两个快照字段，其余字段原样保留）。 */
type TestTurn = FileChangesTurnFields & { prompt?: string };

function makeFile(overrides: Partial<TurnFileChange> = {}): TurnFileChange {
  return {
    path: "frontend/src/a.tsx",
    status: "modified",
    added: 12,
    deleted: 3,
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
    collectMs: 42,
    status: "ok",
    files: [],
    concurrentSessionsHint: true,
    ...overrides,
  };
}

describe("toFileChangesCardProps：归因映射", () => {
  it("edit_patch → source=tool，edits 取 editToolNames 条数并保留工具名", () => {
    const snapshot = makeSnapshot({
      files: [
        makeFile({ path: "a.tsx", attribution: "edit_patch", editToolNames: ["Edit", "Write"] }),
        makeFile({
          path: "b.tsx",
          attribution: "edit_patch",
          editToolNames: null,
          added: 1,
          deleted: 0,
        }),
      ],
    });

    const props = toFileChangesCardProps(snapshot, "full", { turnNo: 7 });
    expect(props).not.toBeNull();
    expect(props!.files).toHaveLength(2);
    expect(props!.turnNo).toBe(7);
    expect(props!.truncated).toBe(false);
    expect(props!.sharedWorkspace).toBe(true);
    expect(props!.degraded).toBeUndefined();

    const [multi, single] = props!.files;
    expect(multi).toMatchObject({ path: "a.tsx", source: "tool", edits: 2 });
    expect(multi!.editToolNames).toEqual(["Edit", "Write"]);
    // 无工具名（老 daemon / 未记录）按 1 条计，不编造多个。
    expect(single).toMatchObject({ path: "b.tsx", source: "tool", edits: 1 });
    expect(single!.editToolNames).toBeUndefined();
  });

  it("command → source=shell、edits=0 且不带工具名（命令行/脚本改动）", () => {
    const snapshot = makeSnapshot({
      files: [
        makeFile({
          path: "package.json",
          attribution: "command",
          editToolNames: ["Edit"],
          added: 0,
          deleted: 1,
        }),
      ],
    });

    const props = toFileChangesCardProps(snapshot, "full");
    const file = props!.files[0]!;
    expect(file.source).toBe("shell");
    expect(file.edits).toBe(0);
    expect(file.editToolNames).toBeUndefined();
  });

  it("toChangedFile 直调同口径（binary 透传）", () => {
    expect(toChangedFile(makeFile({ binary: true, added: 0, deleted: 0 }))).toMatchObject({
      binary: true,
      adds: 0,
      dels: 0,
      source: "tool",
    });
    // binary 缺省/false 不进对象（不制造 undefined 键，保持既有形状）。
    expect("binary" in toChangedFile(makeFile())).toBe(false);
  });
});

describe("toFileChangesCardProps：partial / truncated 采样降级", () => {
  it("status=partial → 卡片照出 + truncated=true（不是错误态）", () => {
    const snapshot = makeSnapshot({ status: "partial", reason: "timeout", files: [makeFile()] });

    const props = toFileChangesCardProps(snapshot, "full");
    expect(props).not.toBeNull();
    expect(props!.truncated).toBe(true);
    expect(props!.files).toHaveLength(1);
    // 行级统计不可信，但文件清单仍可展示（破折号由卡片承担）。
    expect(props!.files[0]!.adds).toBe(12);
  });

  it("truncated=true（改动数超上限）即便 status=ok 也走 truncated", () => {
    const props = toFileChangesCardProps(
      makeSnapshot({ status: "ok", truncated: true, files: [makeFile()] }),
      "full",
    );
    expect(props!.truncated).toBe(true);
  });

  it("ok 且 files 为空 → null（快照确认零改动：空态零渲染）", () => {
    expect(toFileChangesCardProps(makeSnapshot({ files: [] }), "full")).toBeNull();
  });
});

describe("toFileChangesCardProps：三态降级（E6/E8）", () => {
  it('capability="tool_only" → 降级态（不是 null）：files 恒空，快照里的 files 也不采信', () => {
    const props = toFileChangesCardProps(
      makeSnapshot({ files: [makeFile()] }),
      "tool_only",
    );
    expect(props).not.toBeNull();
    expect(props!.degraded).toBe(true);
    expect(props!.capability).toBe("tool_only");
    expect(props!.files).toEqual([]);
    // 降级态不出「（部分）」——它压根没有行级数据，不是截断。
    expect(props!.truncated).toBeUndefined();
  });

  it('snapshot=null + capability="full" → 降级态（backend 声称有快照却没数据：显式降级）', () => {
    const props = toFileChangesCardProps(null, "full");
    expect(props).not.toBeNull();
    expect(props!.degraded).toBe(true);
    expect(props!.files).toEqual([]);
  });

  it("snapshot=null + capability=tool_only → 降级态", () => {
    expect(toFileChangesCardProps(null, "tool_only")).toMatchObject({
      degraded: true,
      capability: "tool_only",
      files: [],
    });
  });

  it("两字段全缺（挂载方未接线）→ null：不出卡、不出占位", () => {
    expect(toFileChangesCardProps(undefined, undefined)).toBeNull();
    expect(toFileChangesCardProps(null, null)).toBeNull();
  });

  it("status=failed / unavailable → 降级态，且不把不可信 files 渲染出来", () => {
    for (const status of ["failed", "unavailable"] as const) {
      const props = toFileChangesCardProps(
        makeSnapshot({ status, files: [makeFile()] }),
        "full",
      );
      expect(props).not.toBeNull();
      expect(props!.degraded).toBe(true);
      expect(props!.files).toEqual([]);
    }
  });

  it("sharedWorkspace 跟随 concurrentSessionsHint（false 时不提示）", () => {
    const props = toFileChangesCardProps(
      makeSnapshot({
        files: [makeFile()],
        // 后端恒 true；这里显式造 false 验证「只读字段、不硬编码」。
        concurrentSessionsHint: false as unknown as true,
      }),
      "full",
    );
    expect(props!.sharedWorkspace).toBe(false);
  });
});

describe("attachRunFileChanges：读模型 → 轮视图（纯透传）", () => {
  it("snake_case 读模型映射成 camelCase 轮字段，capability 原样透传", () => {
    const snapshot = makeSnapshot({ files: [makeFile()] });
    const turns: TestTurn[] = [{ runId: "run-1", prompt: "hi" }];
    const runsMeta = new Map([
      ["run-1", { file_changes: snapshot, file_changes_capability: "full" as const }],
    ]);

    const out = attachRunFileChanges(turns, runsMeta);
    expect(out[0]).not.toBe(turns[0]);
    expect(out[0]!.fileChanges).toBe(snapshot);
    expect(out[0]!.fileChangesCapability).toBe("full");
    // 其余字段原样保留。
    expect(out[0]!.prompt).toBe("hi");
  });

  it("capability 字段缺失按 tool_only（E8：字段缺失＝老 daemon，显式降级）", () => {
    const turns: TestTurn[] = [{ runId: "run-1" }];
    const runsMeta = new Map([["run-1", { file_changes: null }]]);
    const out = attachRunFileChanges(turns, runsMeta);
    expect(out[0]!.fileChangesCapability).toBe("tool_only");
    expect(out[0]!.fileChanges).toBeNull();
  });

  it("realRunId 优先做 run 键（attach 历史轮伪 runId 也能命中）", () => {
    const snapshot = makeSnapshot();
    const turns: TestTurn[] = [{ runId: "__attach_history_1__", realRunId: "run-real" }];
    const runsMeta = new Map([["run-real", { file_changes: snapshot, file_changes_capability: "full" as const }]]);
    const out = attachRunFileChanges(turns, runsMeta);
    expect(out[0]!.fileChanges).toBe(snapshot);
  });

  it("未命中的轮原样透传（无 run 快照来源 → 不出卡）", () => {
    const turns: TestTurn[] = [{ runId: "run-x" }];
    const runsMeta = new Map([["run-1", { file_changes: null }]]);
    const out = attachRunFileChanges(turns, runsMeta);
    expect(out[0]).toBe(turns[0]);
    expect(out[0]!.fileChangesCapability).toBeUndefined();
  });

  it("同输入重复调用复用同一投影对象（TurnRow memo 不击穿），runsMeta 空时原数组返回", () => {
    const snapshot = makeSnapshot();
    const turns: TestTurn[] = [{ runId: "run-1" }];
    const runsMeta = new Map([
      ["run-1", { file_changes: snapshot, file_changes_capability: "full" as const }],
    ]);

    const first = attachRunFileChanges(turns, runsMeta);
    const second = attachRunFileChanges(turns, runsMeta);
    expect(second[0]).toBe(first[0]);

    const untouched = attachRunFileChanges(turns, new Map());
    expect(untouched).toBe(turns);
  });
});
