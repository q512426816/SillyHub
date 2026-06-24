/**
 * FileOutbox 单测（task-15 / FR-06 / FR-09）。
 *
 * 覆盖：enqueue 落盘 / markDelivered 移除 + 空文件删 / load 恢复 / 容量上限丢最旧 /
 *      损坏行跳过 / runs() 列表。
 *
 * @module resilience/outbox.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileOutbox, type OutboxEntry, type Envelope } from "../../src/resilience/outbox.js";

function noopLogger() {
  return { warn: () => undefined, info: () => undefined };
}

function entry(runId: string, dedupKeys: string[], leaseId = "l", token = "t"): OutboxEntry {
  const envelopes: Envelope[] = dedupKeys.map((k) => ({ message: { seq: k }, dedup_key: k }));
  return { leaseId, claimToken: token, runId, envelopes, ts: `2026-01-0${dedupKeys[0]}` };
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
});
