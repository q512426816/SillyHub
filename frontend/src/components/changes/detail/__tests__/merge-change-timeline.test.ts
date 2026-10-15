import { describe, expect, it } from "vitest";

import {
  inferTaskTimeStatus,
  isTaskTimeChainBroken,
  mergeChangeTimeline,
  type MergeInput,
  type StepTimelineEntry,
  type TimelineEvent,
  type TimelineTask,
} from "@/components/changes/detail/merge-change-timeline";

function step(over: Partial<StepTimelineEntry> = {}): StepTimelineEntry {
  return {
    name: "步骤名",
    stage: "execute",
    status: "completed",
    output: null,
    completed_at: "2026-10-16T01:00:00Z",
    ordering: 1,
    wait_reason: null,
    kind: "step",
    event_type: null,
    ...over,
  };
}

function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    ts: "2026-10-16T01:00:00Z",
    kind: "file-update",
    label: "文件变更 a.tsx",
    rule: "",
    severity: "info",
    provisional: true,
    commit_title: null,
    ...over,
  };
}

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return { id: "task-01", checked: true, desc: "描述", commit_sha: null, time: null, ...over };
}

function merge(over: Partial<MergeInput> = {}) {
  return mergeChangeTimeline({ steps: [], events: [], bornAt: null, ...over });
}

describe("mergeChangeTimeline — 源内严格去重", () => {
  it("同 stage + 同 ordering 的重复步骤只保留一条", () => {
    const rows = merge({
      steps: [step({ ordering: 3 }), step({ ordering: 3, name: "重复条目" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("步骤名");
  });

  it("同 ts + 同 kind + 同 label 的重复事件只保留一条（同观测重复上报）", () => {
    const rows = merge({ events: [event(), event()] });
    expect(rows).toHaveLength(1);
  });

  it("同 ts + 同 kind 但 label 不同的事件各自保留", () => {
    const rows = merge({
      events: [event({ label: "a" }), event({ label: "b" })],
    });
    expect(rows).toHaveLength(2);
  });
});

describe("mergeChangeTimeline — task-done 折叠", () => {
  it("tasks 域 task-done（带 tasks 前缀）不产出时间线行", () => {
    const rows = merge({
      events: [event({ kind: "task-done", label: "tasks · checked 0→2" })],
    });
    expect(rows).toHaveLength(0);
  });

  it("tasks 域 task-done（无前缀裸形态）同样折叠", () => {
    const rows = merge({ events: [event({ kind: "task-done", label: "checked 2→3" })] });
    expect(rows).toHaveLength(0);
  });

  it("非 tasks 域的 checked 事件保留为普通事件行", () => {
    const rows = merge({
      events: [event({ kind: "task-done", label: "design · checked 0→6" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta).toBe("任务勾选");
  });
});

describe("mergeChangeTimeline — 排序与三输入类取舍", () => {
  it("有时间的行按时间升序，无时间的 pending 步骤置末尾", () => {
    const rows = merge({
      steps: [
        step({ ordering: 9, status: "pending", completed_at: null, name: "等待执行" }),
        step({ ordering: 1, completed_at: "2026-10-16T01:00:00Z", name: "早" }),
        step({ ordering: 2, completed_at: "2026-10-16T03:00:00Z", name: "晚" }),
      ],
    });
    expect(rows.map((r) => r.title)).toEqual(["早", "晚", "等待执行"]);
  });

  it("非 ISO 的 completed_at 残留原串与无时间者同置末尾，且不破坏其余行升序", () => {
    const rows = merge({
      steps: [
        step({ ordering: 1, completed_at: "not-a-date", name: "坏时间" }),
        step({ ordering: 2, completed_at: "2026-10-16T02:00:00Z", name: "晚" }),
        step({ ordering: 3, completed_at: "2026-10-16T01:00:00Z", name: "早" }),
      ],
    });
    expect(rows.map((r) => r.title)).toEqual(["早", "晚", "坏时间"]);
    expect(rows[2]?.at).toBe("not-a-date"); // 原串保留（MUST NOT 丢信息）
  });

  it("无时间行之间按阶段序稳定排序（brainstorm 在 execute 之前）", () => {
    const rows = merge({
      steps: [
        step({ ordering: 1, stage: "execute", completed_at: null, name: "执行待办" }),
        step({ ordering: 1, stage: "brainstorm", completed_at: null, name: "需求待办" }),
      ],
    });
    expect(rows.map((r) => r.title)).toEqual(["需求待办", "执行待办"]);
  });

  it("全空输入返回空数组；仅有 bornAt 时产出诞生锚行", () => {
    expect(merge()).toEqual([]);
    const rows = merge({ bornAt: "2026-10-15T12:00:00Z" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("born");
    expect(rows[0]?.title).toBe("变更诞生");
  });
});

describe("mergeChangeTimeline — 两源独有字段不丢", () => {
  it("步骤行保留 stage / waitReason / detail（output 全文）", () => {
    const rows = merge({
      steps: [
        step({
          stage: "verify",
          status: "waiting",
          wait_reason: "等待用户确认",
          output: "多行输出\n第二行",
          ordering: 7,
        }),
      ],
    });
    expect(rows[0]?.stage).toBe("verify");
    expect(rows[0]?.waitReason).toBe("等待用户确认");
    expect(rows[0]?.detail).toBe("多行输出\n第二行");
    expect(rows[0]?.tone).toBe("warning");
  });

  it("commit 事件行保留短哈希与标题，且阶段映射为归档（archived 事件）", () => {
    const rows = merge({
      events: [
        event({ kind: "commit", label: "a1b2c3d", commit_title: "feat: 提交标题" }),
        event({ kind: "archived", label: "标准流程归档", ts: "2026-10-16T05:00:00Z" }),
      ],
    });
    const commit = rows.find((r) => r.commitSha === "a1b2c3d");
    expect(commit?.commitTitle).toBe("feat: 提交标题");
    const archived = rows.find((r) => r.title === "标准流程归档");
    expect(archived?.stage).toBe("archive");
    expect(archived?.tone).toBe("success");
  });

  it("步骤侧 kind=event 的履历事件行 meta 标注为「履历事件」", () => {
    const rows = merge({
      steps: [step({ kind: "event", event_type: "owner_change", name: "负责人 变更 A → B" })],
    });
    expect(rows[0]?.meta).toBe("履历事件");
    expect(rows[0]?.tone).toBe("default");
  });
});

describe("inferTaskTimeStatus / isTaskTimeChainBroken", () => {
  it("勾选并有时刻 → checked（时刻透传）", () => {
    const status = inferTaskTimeStatus(
      [task({ checked: true, time: "2026-10-16T01:00:00Z" })],
      [],
    );
    expect(status[0]).toEqual({ status: "checked", at: "2026-10-16T01:00:00Z" });
  });

  it("未勾选 → unchecked（不算断链）", () => {
    const status = inferTaskTimeStatus([task({ checked: false, time: null })], []);
    expect(status[0]).toEqual({ status: "unchecked", at: null });
  });

  it("已勾选但无时刻 → broken（观测断链，UI 显示「时刻不可推断」）", () => {
    const status = inferTaskTimeStatus([task({ checked: true, time: null })], []);
    expect(status[0]).toEqual({ status: "broken", at: null });
  });

  it("游标不连续即断链；非 tasks 域前缀不参与判定", () => {
    expect(
      isTaskTimeChainBroken([event({ kind: "task-done", label: "tasks · checked 2→4" })]),
    ).toBe(true);
    expect(
      isTaskTimeChainBroken([event({ kind: "task-done", label: "design · checked 3→9" })]),
    ).toBe(false);
    expect(
      isTaskTimeChainBroken([
        event({ kind: "task-done", label: "checked 0→2" }),
        event({ kind: "task-done", label: "checked 2→5", ts: "2026-10-16T02:00:00Z" }),
      ]),
    ).toBe(false);
  });
});
