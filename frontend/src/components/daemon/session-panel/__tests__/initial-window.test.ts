/**
 * 2026-10-23-session-first-window-turn-align：首屏自适应窗口编排单测。
 * 覆盖 FR-01（截断轮补全 + 最小 2 轮 / 小会话全量）、FR-02（已满足不补拉）、
 * FR-03（直达上限截断安全合并、更早轮不采纳）。
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { SessionRunRead } from "@/lib/daemon/sessions";
import {
  buildInitialWindow,
  INITIAL_WINDOW_BUDGET_LOGS,
  INITIAL_WINDOW_MIN_TURNS,
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

  it("窗口已覆盖最近 2 轮且起点轮完整 → 不发起直达补拉（FR-02）", async () => {
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

  it("直达触达 2000 上限 → 与窗口行合并去重，不丢窗口尾部（FR-03）", async () => {
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

    expect(result.logs).toHaveLength(RUN_LOGS_MAX + base.length);
    const ids = new Set(result.logs.map((l) => l.id));
    for (const line of base) expect(ids.has(line.id)).toBe(true);
    expect(result.logs.at(-1)?.id).toBe(base.at(-1)?.id);
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
    expect(INITIAL_WINDOW_MIN_TURNS).toBe(2);
  });
});
