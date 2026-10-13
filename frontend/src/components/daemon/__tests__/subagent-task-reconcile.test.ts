/**
 * 2026-10-13-subagent-stub-reconcile 回归测试：
 *   - buildSubagentTaskLookup（FR-01）：tool_use_id 索引、终态优先序、同优先序
 *     取 updated_at 最新、无 toolUseId 行跳过；
 *   - subagentHeaderOf 第三参对账（FR-01/02）：stub 命中终态收敛名称/徽标/时长、
 *     未命中维持现状、tool 段三级优先（元数据 > 对账 > 段三态）、已配对结果
 *     段不被覆盖（FR-03）。
 *
 * 纪律对齐既有套件：纯函数直测 + 真实段结构构造，不 mock 被测函数。
 */

import { describe, it, expect } from "vitest";

import {
  buildSubagentTaskLookup,
  type AgentSessionTaskView,
} from "@/hooks/use-session-tasks";
import {
  subagentHeaderOf,
  type SubagentContainerSegment,
  type SubagentReconciledTask,
} from "../turn-segment-views";
import type { ToolTurnSegment } from "../session-log-assembler";

/* ───────── 夹具 ───────── */

function row(over: Partial<AgentSessionTaskView> & { taskId: string }): AgentSessionTaskView {
  return {
    taskName: "默认任务名",
    status: "running",
    progress: null,
    message: null,
    isAsync: true,
    lastToolName: null,
    summary: null,
    elapsedMs: null,
    elapsedSyncedAt: null,
    startedAt: null,
    lastActivityAt: null,
    terminalAt: null,
    totalTokens: null,
    toolUses: null,
    ...over,
  } as AgentSessionTaskView;
}

const stubSeg: SubagentContainerSegment = {
  kind: "subagent_stub",
  id: "call_a",
  subagentType: "general-purpose",
  children: [],
};

function toolSeg(over: Partial<ToolTurnSegment>): SubagentContainerSegment {
  return {
    kind: "tool",
    id: "call_t",
    raw: '{"tool":"Task"}',
    status: "running",
    toolName: "Task",
    primary: null,
    startedAt: null,
    endedAt: null,
    children: [],
    subagentType: "general-purpose",
    ...over,
  };
}

const reconciledCompleted: SubagentReconciledTask = {
  taskName: "独立评审单位弹窗重排",
  status: "completed",
  elapsedMs: 169_000,
};

/* ── FR-01：buildSubagentTaskLookup ─────────────────────────────── */

describe("buildSubagentTaskLookup（FR-01：tool_use_id 对账索引）", () => {
  it("终态优先序：completed 压过同名 tool_use_id 的 running/stopped 行", () => {
    const lookup = buildSubagentTaskLookup([
      row({ taskId: "k1", toolUseId: "call_a", status: "running", taskName: "在途" }),
      row({ taskId: "k2", toolUseId: "call_a", status: "stopped", taskName: "清扫影" }),
      row({ taskId: "k3", toolUseId: "call_a", status: "completed", taskName: "真终态", elapsedMs: 1000 }),
    ]);
    expect(lookup.get("call_a")).toEqual({
      taskName: "真终态",
      status: "completed",
      elapsedMs: 1000,
    });
  });

  it("同优先序取 updated_at 最新；failed > stopped", () => {
    const lookup = buildSubagentTaskLookup([
      row({ taskId: "k1", toolUseId: "call_b", status: "failed", taskName: "旧失败", updatedAt: "2026-10-13T01:00:00Z" }),
      row({ taskId: "k2", toolUseId: "call_b", status: "failed", taskName: "新失败", updatedAt: "2026-10-13T02:00:00Z" }),
      row({ taskId: "k3", toolUseId: "call_c", status: "stopped", taskName: "停" }),
      row({ taskId: "k4", toolUseId: "call_c", status: "failed", taskName: "败" }),
    ]);
    expect(lookup.get("call_b")?.taskName).toBe("新失败");
    expect(lookup.get("call_c")?.status).toBe("failed");
  });

  it("无 toolUseId 的行跳过（无关联键不参账）", () => {
    const lookup = buildSubagentTaskLookup([
      row({ taskId: "k1", toolUseId: null, status: "completed", taskName: "x" }),
      row({ taskId: "k2", status: "completed", taskName: "y" }),
    ]);
    expect(lookup.size).toBe(0);
  });
});

/* ── FR-01/02：subagentHeaderOf 对账 ────────────────────────────── */

describe("subagentHeaderOf 对账（FR-01：stub 命中终态收敛）", () => {
  it("stub 命中 completed → 名称=快照 task_name、徽标「已完成」、权威时长、非 running", () => {
    const h = subagentHeaderOf(stubSeg, 0, reconciledCompleted);
    expect(h.name).toBe("独立评审单位弹窗重排");
    expect(h.status).toBe("completed");
    expect(h.running).toBe(false);
    expect(h.badge?.label).toBe("已完成");
    expect(h.durationText).toBe("02:49"); // 169000ms → mm:ss 权威时长
    expect(h.dotCls).not.toContain("animate-pulse");
  });

  it("stub 未命中 → 维持现状（名称=subagentType、durationText=运行中）", () => {
    const h = subagentHeaderOf(stubSeg, 0, null);
    expect(h.name).toBe("general-purpose");
    expect(h.status).toBe("running");
    expect(h.durationText).toBe("运行中");
    expect(h.badge).toBeNull();
  });

  it("stub 命中 failed / stopped → 徽标与状态点随行", () => {
    const failed = subagentHeaderOf(stubSeg, 0, { taskName: "x", status: "failed", elapsedMs: null });
    expect(failed.status).toBe("failed");
    expect(failed.badge?.label).toBe("失败");
    expect(failed.dotCls).toContain("bg-destructive");
    expect(failed.durationText).toBeNull(); // 无 elapsed 不伪造
    const stopped = subagentHeaderOf(stubSeg, 0, { taskName: "y", status: "stopped", elapsedMs: 60_000 });
    expect(stopped.badge?.label).toBe("已停止");
    expect(stopped.durationText).toBe("01:00");
  });

  it("FR-03：带 [TASK_*] 元数据的 tool 段元数据优先，对账不覆盖", () => {
    const seg = toolSeg({ id: "call_a", taskStatus: "running", taskAsync: true, startedAt: 1000 });
    const h = subagentHeaderOf(seg, 5000, reconciledCompleted);
    expect(h.metaStatus).toBe("running");
    expect(h.status).toBe("running"); // 元数据权威——对账 completed 不抢
    expect(h.badge?.label).toBe("后台运行中");
  });

  it("FR-01：无元数据且 running 的 tool 段对账收敛（窗口截断形态）", () => {
    const seg = toolSeg({ id: "call_t", primary: null });
    const h = subagentHeaderOf(seg, 0, reconciledCompleted);
    expect(h.status).toBe("completed");
    expect(h.name).toBe("独立评审单位弹窗重排"); // primary 空 → 快照名
    expect(h.badge?.label).toBe("已完成");
  });

  it("FR-03：已配对结果段（ok）不被对账覆盖，徽标不渲染", () => {
    const seg = toolSeg({ id: "call_a", status: "ok", startedAt: 0, endedAt: 8000, primary: "已有结果" });
    const h = subagentHeaderOf(seg, 0, reconciledCompleted);
    expect(h.status).toBe("ok");
    expect(h.badge).toBeNull(); // 段三态胜出——metaStatus/reconciledStatus 均空
    expect(h.name).toBe("已有结果"); // primary 优先
    expect(h.durationText).toBe("00:08"); // 原起止时长路径（mm:ss 格式）
  });
});
