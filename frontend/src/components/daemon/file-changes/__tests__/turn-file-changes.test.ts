// task-11（2026-10-20-session-page-dsh-alignment 线 C「1b 第三段」）映射纯函数单测。
//
// 锁定契约（design.md「文件变更卡 DTO」+ E6/E8）：
//   1. 归因映射：edit_patch → source=tool（edits 取 editToolNames 条数、工具名保留）；
//      command → source=shell（edits=0，无「编辑次数」概念）；
//   2. status=partial（或 truncated）→ truncated=true，卡片照出（不是错误态）；
//   3. binary 透传到 ChangedFile（行级破折号由卡片承担）；
//   4. capability=tool_only → **null**（2026-10-22-file-card-hide-empty：没有信息就
//      不出卡，历史轮不再挂「仅工具编辑」占位）；
//   5. 两字段全缺（未接线）→ null；snapshot=null 但 capability 已给 → 同样 null；
//   6. status=failed/unavailable → null（采集失败也不占位）；
//   7. sharedWorkspace = snapshot.concurrentSessionsHint（共享工作区恒提示）；
//   8. ok 且 files 为空 → null（快照确认零改动 → 空态零渲染，不写「无改动」文案）；
//   9. attachRunFileChanges：snake_case 读模型 → camelCase 轮字段，capability 缺省
//      tool_only，未变化轮保持对象引用（TurnRow memo 不击穿）。

import { describe, expect, it } from "vitest";

import {
  attachRunFileChanges,
  NOTICE_PARTIAL_NO_FILES,
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

  it("status/hasLineStats 透传：untracked 与 mtime 行行级不可信", () => {
    expect(
      toChangedFile(makeFile({ status: "untracked", added: 0, deleted: 0 })),
    ).toMatchObject({ status: "untracked", hasLineStats: false });
    expect(toChangedFile(makeFile({ status: "deleted" }))).toMatchObject({
      status: "deleted",
      hasLineStats: true,
    });
    expect(
      toChangedFile(makeFile({ source: "mtime", attribution: "command" })),
    ).toMatchObject({ hasLineStats: false });
    expect(toChangedFile(makeFile({ status: "added" }))).toMatchObject({
      status: "added",
      hasLineStats: true,
    });
  });

  it("edits 取编辑调用次数（editToolNames 保留重复项）", () => {
    const file = toChangedFile(
      makeFile({ editToolNames: ["Edit", "Edit", "Write"] }),
    );
    expect(file.edits).toBe(3);
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

  it("partial 且 files 为空（超时/队列溢出）→ 提示卡而不是 null（D-034：不静默）", () => {
    const props = toFileChangesCardProps(
      makeSnapshot({ status: "partial", reason: "timeout", files: [] }),
      "full",
    );
    expect(props).not.toBeNull();
    expect(props!.files).toEqual([]);
    expect(props!.notice).toContain("超时");
    expect(props!.notice).toContain("本轮改动未知");
    expect(props!.truncated).toBe(true);
    // 文案说的是「没拿到清单」，不是「没改文件」。
    expect(props!.notice).not.toContain("无改动");
    expect(NOTICE_PARTIAL_NO_FILES).toContain("未知");
    expect(NOTICE_PARTIAL_NO_FILES).not.toContain("无改动");
  });

  it("partial 且 files 为空 + concurrentSessionsHint → 提示卡仍带共享工作区标注", () => {
    const props = toFileChangesCardProps(
      makeSnapshot({ status: "partial", reason: "queue_overflow", files: [] }),
      "full",
    );
    expect(props!.sharedWorkspace).toBe(true);
  });

  it("notice 按 reason 生成：timeout 带耗时、queue_overflow 明确排队溢出、无 reason 用通用文案", () => {
    const timeout = toFileChangesCardProps(
      makeSnapshot({ status: "partial", reason: "timeout", collectMs: 1500, files: [] }),
      "full",
    );
    expect(timeout!.notice).toContain("1.5s");
    expect(timeout!.notice).not.toContain("排队溢出");

    const queue = toFileChangesCardProps(
      makeSnapshot({ status: "partial", reason: "queue_overflow", files: [] }),
      "full",
    );
    expect(queue!.notice).toContain("排队溢出");
    expect(queue!.notice).not.toContain("超时");

    const generic = toFileChangesCardProps(
      makeSnapshot({ status: "partial", files: [] }),
      "full",
    );
    expect(generic!.notice).toBe(NOTICE_PARTIAL_NO_FILES);
  });
});

describe("toFileChangesCardProps：无信息一律不出卡（2026-10-22-file-card-hide-empty）", () => {
  it('capability="tool_only" → null：不出「仅工具编辑」卡，也不采信快照里的 files', () => {
    // 历史轮（daemon 0.2.0 / 部署之前）就是这一态；用户裁决「没有信息就隐藏卡片」。
    expect(toFileChangesCardProps(makeSnapshot({ files: [makeFile()] }), "tool_only")).toBeNull();
  });

  it('snapshot=null + capability="full" → null（backend 声称有快照却没数据：同样零信息）', () => {
    expect(toFileChangesCardProps(null, "full")).toBeNull();
  });

  it("snapshot=null + capability=tool_only → null", () => {
    expect(toFileChangesCardProps(null, "tool_only")).toBeNull();
  });

  it("两字段全缺（挂载方未接线）→ null：不出卡、不出占位", () => {
    expect(toFileChangesCardProps(undefined, undefined)).toBeNull();
    expect(toFileChangesCardProps(null, null)).toBeNull();
  });

  it("status=failed / unavailable → null（采集失败也不占位，不把不可信 files 渲染出来）", () => {
    for (const status of ["failed", "unavailable"] as const) {
      expect(toFileChangesCardProps(makeSnapshot({ status, files: [makeFile()] }), "full")).toBeNull();
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
