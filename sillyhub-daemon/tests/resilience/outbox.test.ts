/**
 * FileOutbox 单测（task-15 / FR-06 / FR-09；task-07 kind/dedupId 扩展）。
 *
 * 覆盖：enqueue 落盘 / markDelivered 移除 + 空文件删 / load 恢复 / 容量上限丢最旧 /
 *      损坏行跳过 / runs() 列表 / kind 三态 entry（messages 缺省、run_result、
 *      session_end 按 sessionId 命名）/ 旧文件缺 kind 按 messages 兼容。
 *
 * @module resilience/outbox.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileOutbox,
  type OutboxEntry,
  type OutboxEntryKind,
  type Envelope,
} from "../../src/resilience/outbox.js";

function noopLogger() {
  return { warn: () => undefined, info: () => undefined };
}

function entry(runId: string, dedupKeys: string[], leaseId = "l", token = "t"): OutboxEntry {
  const envelopes: Envelope[] = dedupKeys.map((k) => ({ message: { seq: k }, dedup_key: k }));
  return { leaseId, claimToken: token, runId, envelopes, ts: `2026-01-0${dedupKeys[0]}` };
}

/** task-07：带 kind 的终态 entry（payload 携带于 envelopes[0].message）。 */
function typedEntry(
  kind: OutboxEntryKind,
  dedupId: string,
  payload: Record<string, unknown>,
): OutboxEntry {
  return {
    leaseId: kind === "session_end" ? "" : "l",
    claimToken: kind === "session_end" ? "" : "t",
    runId: dedupId,
    envelopes: [{ message: payload, dedup_key: dedupId }],
    ts: "2026-08-29",
    kind,
  };
}

describe("FileOutbox (task-15 / FR-06 / FR-09)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "outbox-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("AC-01 enqueue 落盘 + 文件存在", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-1", ["dk-1"]));
    const content = await readFile(join(dir, "run-1.jsonl"), "utf-8");
    expect(content).toContain("dk-1");
    expect(ob.pendingByRun("run-1").length).toBe(1);
  });

  it("AC-02 markDelivered 移除匹配 dedup_key", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-1", ["dk-1"], "l", "t1"));
    await ob.enqueue(entry("run-1", ["dk-2"], "l", "t2"));
    await ob.markDelivered("run-1", ["dk-1"]);
    const pending = ob.pendingByRun("run-1");
    expect(pending.length).toBe(1);
    expect(pending[0].envelopes[0].dedup_key).toBe("dk-2");
  });

  it("AC-03 全部移除后文件 unlink", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-1", ["dk-1"]));
    await ob.markDelivered("run-1", ["dk-1"]);
    await expect(access(join(dir, "run-1.jsonl"))).rejects.toThrow();
    expect(ob.runs().length).toBe(0);
  });

  it("AC-04 load 恢复 pending（模拟重启）", async () => {
    // 先写入两个 run
    const ob1 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob1.enqueue(entry("run-1", ["dk-1"]));
    await ob1.enqueue(entry("run-2", ["dk-9"]));
    // 新实例（模拟重启）load
    const ob2 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob2.load();
    expect(ob2.pendingByRun("run-1").length).toBe(1);
    expect(ob2.pendingByRun("run-2").length).toBe(1);
    expect(ob2.runs().sort()).toEqual(["run-1", "run-2"]);
  });

  it("AC-05 容量上限 per-run 丢最旧", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 2, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-1", ["1"]));
    await ob.enqueue(entry("run-1", ["2"]));
    await ob.enqueue(entry("run-1", ["3"])); // 超 maxPerRun=2，丢最旧（dk-1）
    const pending = ob.pendingByRun("run-1");
    expect(pending.length).toBe(2);
    const keys = pending.flatMap((e) => e.envelopes.map((x) => x.dedup_key));
    expect(keys).not.toContain("1");
  });

  it("AC-06 损坏行跳过不崩", async () => {
    const ob1 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob1.enqueue(entry("run-1", ["dk-1"]));
    // 手动追加一行损坏 JSON
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "run-1.jsonl"), "this is not json\n", "utf-8");
    const ob2 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob2.load();
    // 合法行恢复，损坏行跳过
    expect(ob2.pendingByRun("run-1").length).toBe(1);
  });

  it("runs() 返回所有 pending run", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-A", ["1"]));
    await ob.enqueue(entry("run-B", ["2"]));
    expect(ob.runs().sort()).toEqual(["run-A", "run-B"]);
  });

  it("markDelivered 无匹配 no-op", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(entry("run-1", ["dk-1"]));
    await ob.markDelivered("run-1", ["nonexistent"]);
    expect(ob.pendingByRun("run-1").length).toBe(1);
  });

  // ── task-07（D-007 kind/dedupId 扩展）───────────────────────────────────────

  it("task-07: kind=run_result 文件沿用 runId 命名，entry 携带完整 payload", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(typedEntry("run_result", "run-9", { status: "success", is_error: false }));
    const content = await readFile(join(dir, "run-9.jsonl"), "utf-8");
    expect(content).toContain('"kind":"run_result"');
    expect(content).toContain('"status":"success"');
    const pending = ob.pendingByRun("run-9");
    expect(pending[0].kind).toBe("run_result");
    expect(pending[0].envelopes[0].dedup_key).toBe("run-9");
  });

  it("task-07: kind=session_end 文件按 sessionId 命名（dedupId 泛化）", async () => {
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.enqueue(typedEntry("session_end", "sess-1", { status: "failed", reason: "driver_error" }));
    // dedupId = sessionId → <sessionId>.jsonl，不再有 <runId> 语义。
    const content = await readFile(join(dir, "sess-1.jsonl"), "utf-8");
    expect(content).toContain('"kind":"session_end"');
    expect(ob.runs()).toEqual(["sess-1"]);
    // markDelivered 按 sessionId 维度移除。
    await ob.markDelivered("sess-1", ["sess-1"]);
    expect(ob.runs().length).toBe(0);
    await expect(access(join(dir, "sess-1.jsonl"))).rejects.toThrow();
  });

  it("task-07: 旧文件缺 kind → load 按 messages 兼容解析", async () => {
    // 手写旧格式（task-15 形状，无 kind 字段）的 <runId>.jsonl。
    const legacy = {
      leaseId: "l",
      claimToken: "t",
      runId: "run-legacy",
      envelopes: [{ message: { a: 1 }, dedup_key: "dk-legacy" }],
      ts: "2026-01-01",
    };
    await writeFile(
      join(dir, "run-legacy.jsonl"),
      JSON.stringify(legacy) + "\n",
      "utf-8",
    );
    const ob = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob.load();
    const pending = ob.pendingByRun("run-legacy");
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe("messages");
  });

  it("task-07: 三类 kind 混合 load 后各自保留（dedupId 维度互不串扰）", async () => {
    const ob1 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob1.enqueue(entry("run-1", ["dk-1"]));
    await ob1.enqueue(typedEntry("run_result", "run-1", { status: "success", is_error: false }));
    await ob1.enqueue(typedEntry("session_end", "sess-1", { status: "ended", reason: "manual" }));
    const ob2 = new FileOutbox(dir, { maxPerRun: 500, maxTotal: 5000 }, noopLogger());
    await ob2.load();
    expect(ob2.runs().sort()).toEqual(["run-1", "sess-1"]);
    const runEntries = ob2.pendingByRun("run-1");
    expect(runEntries.map((e) => e.kind).sort()).toEqual(["messages", "run_result"]);
    // markDelivered(dk-1) 只清 messages entry，run_result entry 的 dedup_key=run-1 不受影响。
    await ob2.markDelivered("run-1", ["dk-1"]);
    const left = ob2.pendingByRun("run-1");
    expect(left.length).toBe(1);
    expect(left[0].kind).toBe("run_result");
  });
});
