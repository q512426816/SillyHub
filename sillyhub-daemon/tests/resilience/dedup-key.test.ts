/**
 * dedupKeyFor 单测（task-16 / FR-08 / D-001@v2）。
 *
 * 覆盖：
 *   - msg.id 存在 → 用 id（Claude SDK message）
 *   - 无 id → `${runId}:${turnSeq}:${flatSeq}`（Codex flat message）
 *   - 确定性：同输入同输出
 *   - 不同 seq 不同 key（避免 content-hash 误去重 R-01）
 *
 * @module resilience/dedup-key.test
 */

import { describe, it, expect } from "vitest";
import { dedupKeyFor } from "../../src/resilience/error-classify.js";

describe("dedupKeyFor (task-16 / FR-08)", () => {
  it("msg.id 存在 → 用 id（Claude SDK message）", () => {
    const msg = { id: "msg_abc123", type: "assistant" };
    expect(dedupKeyFor(msg, "run-1", 0, 0)).toBe("msg_abc123");
  });

  it("msg.id 空串 → 回退 runId:turnSeq:flatSeq", () => {
    const msg = { id: "", type: "assistant" };
    expect(dedupKeyFor(msg, "run-1", 2, 3)).toBe("run-1:2:3");
  });

  it("无 id 字段 → runId:turnSeq:flatSeq（Codex flat message）", () => {
    const msg = { event_type: "message", content: "hi" };
    expect(dedupKeyFor(msg, "run-9", 1, 5)).toBe("run-9:1:5");
  });

  it("id 非 string → 回退 runId:turnSeq:flatSeq", () => {
    const msg = { id: 123 };
    expect(dedupKeyFor(msg as Record<string, unknown>, "run-1", 0, 1)).toBe(
      "run-1:0:1",
    );
  });

  it("确定性：同输入同输出", () => {
    const msg = { type: "assistant" };
    expect(dedupKeyFor(msg, "run-1", 3, 7)).toBe("run-1:3:7");
    expect(dedupKeyFor(msg, "run-1", 3, 7)).toBe("run-1:3:7");
  });

  it("不同 flatSeq 不同 key（避免 content-hash 误去重 R-01）", () => {
    const msg = { content: "相同内容" };
    const k1 = dedupKeyFor(msg, "run-1", 0, 0);
    const k2 = dedupKeyFor(msg, "run-1", 0, 1);
    expect(k1).not.toBe(k2);
  });

  it("不同 runId 不同 key", () => {
    const msg = { type: "assistant" };
    expect(dedupKeyFor(msg, "run-A", 0, 0)).not.toBe(
      dedupKeyFor(msg, "run-B", 0, 0),
    );
  });
});
