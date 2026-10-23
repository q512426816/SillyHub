/**
 * 2026-10-23-session-first-window-turn-align：首屏自适应窗口编排单测。
 * 覆盖 FR-01（截断轮补全 + 小会话全量）、FR-02（已到会话开头不补拉）、
 * FR-03（直达上限截断安全合并、更早轮不采纳、游标不前进）。
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { SessionRunRead } from "@/lib/daemon/sessions";
import {
  buildInitialWindow,
  INITIAL_WINDOW_BUDGET_LOGS,
  INITIAL_WINDOW_MAX_RUNS,
  RUN_LOGS_MAX,
} from "../initial-window";

function log(
  id: string,
  runId: string,
  timestamp: string,
  channel: AgentRunLogEntry["channel"] = "stdout",
): AgentRunLogEntry {
  return { id, run_id: runId, timestamp, channel, content_redacted: id };
}

function makeLogs(
  runId: string,
  prefix: string,
  startSec: number,
  count: number,
  channel: AgentRunLogEntry["channel"] = "stdout",
): AgentRunLogEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const sec = startSec + i;
    const ts = `2026-10-23T${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(
      Math.floor((sec % 3600) / 60),
    ).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}Z`;
    return log(`${prefix}-${i}`, runId, ts, i === 0 ? channel : "stdout");
  });
}

function makeRun(id: string, createdAt: string): SessionRunRead {
  return {
    id,
    created_at: createdAt,
    status: "completed",
    error_code: null,
    failure_summary: null,
    error_detail: null,
    started_at: createdAt,
    finished_at: createdAt,
    exit_code: 0,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    user_id: "u-1",
    sender_name: null,
  } as unknown as SessionRunRead;
}

describe("buildInitialWindow", () => {
  it("单轮 546 条超窗口 → 补全该轮，轮首用户消息可见（FR-01）", async () => {
    // 底窗 400 行是该轮尾部（02:30:00 起）；该轮完整 546 行（user_input 在 02:16:55）。
    const base = makeLogs("r1", "b", 9000, 400);
    const earlier = makeLogs("r1", "e", 9000 - 146, 146);
    const full = [
      log("u-1", "r1", "2026-10-23T02:16:55Z", "user_input"),
      ...earlier.slice(0, 145),
      ...base,
    ];

    const fetchRunLogs = vi.fn().mockResolvedValue(full);
    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r1", "2026-10-23T02:16:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([earlier[0]!]),
      fetchRunLogs,
    });

    expect(result.extended).toBe(true);
    expect(fetchRunLogs).toHaveBeenCalledWith("r1");
    expect(result.logs).toHaveLength(full.length);
    expect(result.logs[0]?.channel).toBe("user_input");
    // 直达完整（含底窗最新行）→ 游标前移到合并后最旧行（轮首 user_input）。
    expect(result.cursorLog?.id).toBe("u-1");
  });

  it("多轮窗口起点截断 → 补全该轮并向前覆盖最近 2 轮（FR-01）", async () => {
    // 底窗 400 行全部属最新轮 r2（r2 共 500 行，窗口截断）。
    const baseR2 = makeLogs("r2", "b2", 9000, 400);
    const fullR2 = [...makeLogs("r2", "e2", 8900, 100), ...baseR2];
    const fullR1 = makeLogs("r1", "e1", 8000, 50);

    const fetchRunLogs = vi.fn(async (runId: string) => {
      if (runId === "r2") return fullR2;
      if (runId === "r1") return fullR1;
      return [];
    });
    const result = await buildInitialWindow({
      baseLogs: baseR2,
      runs: [makeRun("r2", "2026-10-23T03:00:00Z"), makeRun("r1", "2026-10-23T02:00:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([{ ...baseR2[0]!, id: "probe" }]),
      fetchRunLogs,
    });

    expect(result.extended).toBe(true);
    expect(fetchRunLogs.mock.calls.map(([id]) => id)).toEqual(["r2", "r1"]);
    expect(result.logs).toHaveLength(fullR2.length + fullR1.length);
    expect(result.logs[0]?.run_id).toBe("r1");
    expect(result.logs.at(-1)?.run_id).toBe("r2");
  });

  it("已到会话开头且窗口起点轮完整 → 不发起直达补拉（FR-02）", async () => {
    const base = [...makeLogs("r1", "a", 8000, 200), ...makeLogs("r2", "b", 9000, 200)];
    const fetchRunLogs = vi.fn();
    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [
        makeRun("r2", "2026-10-23T03:00:00Z"),
        makeRun("r1", "2026-10-23T02:00:00Z"),
      ],
      probeEarlier: vi.fn().mockResolvedValue([]),
      fetchRunLogs,
    });

    expect(result.extended).toBe(false);
    expect(fetchRunLogs).not.toHaveBeenCalled();
    expect(result.logs).toEqual(base);
  });

  it("锚点轮直达触达 2000 上限 → 禁止采纳，整体回退底窗（不留中段缺口，FR-03）", async () => {
    const base = makeLogs("r1", "b", 10800, 400);
    // 直达 ASC 返回前 2000 行（更早段），不含底窗尾部；模拟端点上限截断。
    const full = makeLogs("r1", "f", 7200, RUN_LOGS_MAX);
    const fetchRunLogs = vi.fn().mockResolvedValue(full);

    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r1", "2026-10-23T02:00:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([{ ...base[0]!, id: "probe" }]),
      fetchRunLogs,
    });

    // 评审 P2/P3：合并会制造 [2000..底窗) 的中段缺口且回补会双块——整体不采纳。
    expect(result.extended).toBe(false);
    expect(result.logs).toEqual(base);
    expect(result.cursorLog?.id).toBe(base[0]?.id);
  });

  it("锚点轮直达失败 → 不向前补拉、保持底窗（FR-03 失败降级）", async () => {
    const base = makeLogs("r2", "b2", 9000, 400);
    const fetchRunLogs = vi.fn(async (runId: string) => {
      if (runId === "r2") throw new Error("timeout");
      return makeLogs("r1", "e1", 8000, 50);
    });

    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r2", "2026-10-23T03:00:00Z"), makeRun("r1", "2026-10-23T01:00:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([{ ...base[0]!, id: "probe" }]),
      fetchRunLogs,
    });

    expect(result.extended).toBe(false);
    expect(result.logs).toEqual(base);
    expect(result.cursorLog?.id).toBe(base[0]?.id);
    // 锚点轮失败时不发起更早轮补拉（否则游标越洞、锚点轮缺口永久不可回补）。
    expect(fetchRunLogs.mock.calls.map(([id]) => id)).toEqual(["r2"]);
  });

  it("probe 失败 → 整体放弃自适应，不发起任何直达拉取（FR-03 失败降级）", async () => {
    const base = makeLogs("r1", "b", 9000, 400);
    const fetchRunLogs = vi.fn();

    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r1", "2026-10-23T03:00:00Z"), makeRun("r0", "2026-10-23T01:00:00Z")],
      probeEarlier: vi.fn().mockRejectedValue(new Error("network")),
      fetchRunLogs,
    });

    expect(result.extended).toBe(false);
    expect(result.logs).toEqual(base);
    expect(fetchRunLogs).not.toHaveBeenCalled();
  });

  it("向前补更早轮触达单轮上限 → 停止且不采纳该轮（避免轮间留洞，FR-03）", async () => {
    const base = makeLogs("r2", "b2", 9000, 400);
    const fullR2 = [...makeLogs("r2", "e2", 8900, 100), ...base];
    const fetchRunLogs = vi.fn(async (runId: string) => {
      if (runId === "r2") return fullR2;
      return makeLogs("r1", "e1", 4000, RUN_LOGS_MAX);
    });

    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r2", "2026-10-23T03:00:00Z"), makeRun("r1", "2026-10-23T01:00:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([{ ...base[0]!, id: "probe" }]),
      fetchRunLogs,
    });

    expect(fetchRunLogs).toHaveBeenCalledWith("r1");
    expect(result.logs).toHaveLength(fullR2.length);
    expect(result.logs.every((l) => l.run_id === "r2")).toBe(true);
  });

  it("小会话总行数不超预算 → 持续向前补到全量（评审 P1：不做 2 轮即停）", async () => {
    // 5 轮 × 150 行 = 750 行 ≤ 预算；底窗 400 行覆盖最新 3 轮的一部分。
    const runIds = ["r1", "r2", "r3", "r4", "r5"];
    const fullByRun = new Map(
      runIds.map((id, idx) => [id, makeLogs(id, id, 7000 + idx * 200, 150)]),
    );
    // 底窗 = 最后 400 行（r3 尾部 + r4 + r5），升序。
    const base = [...fullByRun.values()].flat().slice(-400);
    const fetchRunLogs = vi.fn(async (runId: string) => fullByRun.get(runId) ?? []);
    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [...runIds].reverse().map((id) => makeRun(id, `2026-10-23T0${runIds.indexOf(id)}:00:00Z`)),
      probeEarlier: vi.fn().mockResolvedValue([{ ...base[0]!, id: "probe" }]),
      fetchRunLogs,
    });

    expect(result.extended).toBe(true);
    expect(new Set(result.logs.map((l) => l.run_id))).toEqual(new Set(runIds));
    expect(result.logs).toHaveLength(750);
    // 全量后游标 = 最早轮首行（会话已到头）。
    expect(result.cursorLog?.run_id).toBe("r1");
    expect(result.cursorLog?.id).toBe("r1-0");
  });

  it("向前补拉受轮数上限约束 → 只并行拉最近 maxRuns 个更早轮（评审 P2 请求量）", async () => {
    // 10 轮 × 100 行；底窗覆盖 r7-r10，向更早的 r6/r5/r4 补（maxRuns=3），r3 及更早不拉。
    const runIds = Array.from({ length: 10 }, (_, i) => `r${i + 1}`);
    const fullByRun = new Map(
      runIds.map((id, idx) => [id, makeLogs(id, id, 6000 + idx * 100, 100)]),
    );
    const base = [...fullByRun.values()].flat().slice(-400);
    const fetchRunLogs = vi.fn(async (runId: string) => fullByRun.get(runId) ?? []);
    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [...runIds]
        .reverse()
        .map((id) => makeRun(id, `2026-10-23T${String(runIds.indexOf(id)).padStart(2, "0")}:00:00Z`)),
      probeEarlier: vi.fn().mockResolvedValue([]),
      fetchRunLogs,
      maxRuns: 3,
    });

    expect(fetchRunLogs).toHaveBeenCalledTimes(3);
    expect(fetchRunLogs.mock.calls.map(([id]) => id)).toEqual(["r6", "r5", "r4"]);
    const coveredRuns = new Set(result.logs.map((l) => l.run_id));
    for (const id of ["r4", "r5", "r6", "r7", "r8", "r9", "r10"]) {
      expect(coveredRuns.has(id)).toBe(true);
    }
    expect(coveredRuns.has("r3")).toBe(false);
    expect(result.logs).toHaveLength(700);
  });

  it("预算耗尽 → 停止向前补拉（常量口径）", async () => {
    const base = makeLogs("r2", "b2", 9000, 400);
    const fullR2 = [...makeLogs("r2", "e2", 8900, 100), ...base];
    const fullR1 = makeLogs("r1", "e1", 5000, 999);
    const fetchRunLogs = vi.fn(async (runId: string) => {
      if (runId === "r2") return fullR2;
      return fullR1;
    });

    // 预算压到刚好容不下 r1：fullR2=500 + 999 > 1400。
    const result = await buildInitialWindow({
      baseLogs: base,
      runs: [makeRun("r2", "2026-10-23T03:00:00Z"), makeRun("r1", "2026-10-23T01:00:00Z")],
      probeEarlier: vi.fn().mockResolvedValue([{ ...base[0]!, id: "probe" }]),
      fetchRunLogs,
      budget: 1400,
    });

    expect(result.logs).toHaveLength(fullR2.length);
    expect(result.logs.every((l) => l.run_id === "r2")).toBe(true);
    // 常量本身仍是 3000（防误改）。
    expect(INITIAL_WINDOW_BUDGET_LOGS).toBe(3000);
    expect(INITIAL_WINDOW_MAX_RUNS).toBe(8);
  });
});
