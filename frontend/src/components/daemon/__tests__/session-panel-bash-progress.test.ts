// 2026-08-25 P1 修复：bash 进度状态归约 helper（session-panel 底部纯函数区，
// page / dialog 两模式共用的 applyBashStatusEvent / appendBashChunk）单测。
//
// 覆盖：
//   1. 跨命令 chunks 污染——同 runId 两条不同 command 的 bash_status 序列，
//      第二条命令 chunks 清空重新累积（旧实现沿用上一条的 chunks 含 is_final，
//      新命令 spinner 被提前终止、输出拼接错乱）；
//   2. 不同 runId 覆盖为新的 bash 任务（单卡片语义保持）；
//   3. 同 run 同 command 终态→running 翻转兜底重置（重跑不沿用旧输出）；
//   4. 同 run 同 command 正常状态推进保留 chunks；
//   5. appendBashChunk 环形截断——条数超 600 从头部丢弃、字节超 256KB 从头部
//      丢弃整条 chunk、保底留最后一条、最后一条 is_final 不丢。

import { describe, it, expect } from "vitest";

import {
  appendBashChunk,
  applyBashStatusEvent,
  type BashProgressState,
} from "../session-panel";
import type { BashChunkItem } from "@/components/daemon/bash-progress-card";

function statusEvent(overrides: Partial<Parameters<typeof applyBashStatusEvent>[1]>) {
  return {
    run_id: "run-1",
    command: "echo a",
    status: "running" as const,
    exit_code: null,
    elapsed_ms: null,
    ...overrides,
  };
}

function chunk(content: string, overrides: Partial<BashChunkItem> = {}): BashChunkItem {
  return { channel: "stdout", content, ...overrides };
}

describe("applyBashStatusEvent（bash_status 归约）", () => {
  it("同 runId 两条不同 command：第二条命令 chunks 清空重新累积（跨命令污染修复）", () => {
    let state: BashProgressState | null = applyBashStatusEvent(null, statusEvent({}));
    state = appendBashChunk(state!, chunk("out-a-1"));
    state = appendBashChunk(state!, chunk("out-a-2", { is_final: true }));
    state = applyBashStatusEvent(
      state,
      statusEvent({ command: "echo b" }),
    );
    // 第二条命令开始：chunks 重置（旧 is_final 不再提前停 spinner）。
    expect(state).toMatchObject({
      runId: "run-1",
      command: "echo b",
      status: "running",
      chunks: [],
    });

    state = appendBashChunk(state!, chunk("out-b-1"));
    expect(state!.chunks).toEqual([chunk("out-b-1")]);
    // 无 is_final chunk → 卡片 isRunning 判定（status==="running" && 无 is_final）为 true。
    expect(state!.chunks.some((c) => c.is_final)).toBe(false);
  });

  it("不同 runId：覆盖为新的 bash 任务（单卡片语义，chunks 不沿用）", () => {
    let state = applyBashStatusEvent(null, statusEvent({}));
    state = appendBashChunk(state!, chunk("old-run-out"));
    state = applyBashStatusEvent(state, statusEvent({ run_id: "run-2" }));
    expect(state).toMatchObject({ runId: "run-2", chunks: [] });
  });

  it("同 run 同 command 终态翻回 running（重跑兜底）：重置 chunks", () => {
    let state = applyBashStatusEvent(null, statusEvent({}));
    state = appendBashChunk(state!, chunk("first-pass"));
    state = applyBashStatusEvent(
      state,
      statusEvent({ status: "completed", exit_code: 0, elapsed_ms: 1200 }),
    );
    state = applyBashStatusEvent(state, statusEvent({ status: "running" }));
    expect(state).toMatchObject({ status: "running", chunks: [] });
  });

  it("同 run 同 command 正常状态推进：保留已累积 chunks（不误重置）", () => {
    let state = applyBashStatusEvent(null, statusEvent({}));
    state = appendBashChunk(state!, chunk("partial"));
    state = applyBashStatusEvent(
      state,
      statusEvent({ status: "completed", exit_code: 0, elapsed_ms: 800 }),
    );
    expect(state).toMatchObject({
      status: "completed",
      exitCode: 0,
      elapsedMs: 800,
      chunks: [chunk("partial")],
    });
  });
});

describe("appendBashChunk（bash_chunk 归约 + 环形截断）", () => {
  function baseState(chunks: BashChunkItem[]): BashProgressState {
    return {
      runId: "run-1",
      command: "long-run",
      status: "running",
      exitCode: null,
      elapsedMs: null,
      chunks,
    };
  }

  it("常规追加：chunks 顺序累积", () => {
    let state = baseState([]);
    state = appendBashChunk(state, chunk("a"));
    state = appendBashChunk(state, chunk("b", { channel: "stderr" }));
    expect(state.chunks).toEqual([
      chunk("a"),
      chunk("b", { channel: "stderr" }),
    ]);
  });

  it("条数超 600：从头部丢弃，总量封顶且保留最新", () => {
    let state = baseState([]);
    for (let i = 0; i < 700; i++) {
      state = appendBashChunk(state, chunk(`line-${i}\n`));
    }
    expect(state.chunks.length).toBe(600);
    // 头部是最早保留的第 100 条，尾部是最新第 699 条。
    expect(state.chunks[0]!.content).toBe("line-100\n");
    expect(state.chunks[state.chunks.length - 1]!.content).toBe("line-699\n");
  });

  it("累计字节超约 256KB：从头部丢弃整条 chunk 回到预算内", () => {
    // 3 条 100KB（ASCII 102400 字节）：总量 300KB > 256KB，从头部丢 1 条留 2 条
    //（2×100KB=200KB ≤ 256KB 回到预算内）。
    const big = "x".repeat(100 * 1024);
    let state = baseState([]);
    state = appendBashChunk(state, chunk(big));
    state = appendBashChunk(state, chunk(big));
    state = appendBashChunk(state, chunk(big));
    expect(state.chunks.length).toBe(2);
    const totalBytes = state.chunks.reduce(
      (sum, c) => sum + new TextEncoder().encode(c.content).length,
      0,
    );
    expect(totalBytes).toBeLessThanOrEqual(256 * 1024);
  });

  it("字节预算保底：单条即超预算也不清空（至少留最后一条）", () => {
    const huge = "y".repeat(300 * 1024);
    let state = baseState([]);
    state = appendBashChunk(state, chunk(huge));
    expect(state.chunks.length).toBe(1);
  });

  it("最后一条 is_final 不被截断丢弃（保 isRunning 提前停表语义）", () => {
    // 构造：一条 is_final + 足量后续 chunk 把它推向头部（条数截断后已丢普通头，
    // 字节路径再触发时唯一 is_final 保护生效）。
    const big = "z".repeat(90 * 1024); // 3 条即 270KB > 256KB 触发字节截断
    let state = baseState([]);
    state = appendBashChunk(state, chunk(big, { is_final: true }));
    state = appendBashChunk(state, chunk(big));
    state = appendBashChunk(state, chunk(big));
    // is_final 处于头部且预算超限：保护不丢（宁可略超预算）。
    expect(state.chunks.some((c) => c.is_final)).toBe(true);
  });
});
