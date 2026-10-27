/**
 * 2026-10-28-bg-task-status-report task-05：后台任务终态条目翻转（FR-03）。
 *
 * buildConversationTurns 纯函数级：task-notification 系统注入段（user_input +
 * bg_task_final 附着）按 toolUseId 配对后台工具卡（无 tool_result 跟随的
 * tool_use 段）——命中即 hasResult=true + success 三态映射 + durationMs 取
 * 附着段 ts 差；未命中（旧 daemon / 运行中）维持现状；重复附着幂等（首个生效）。
 */
import { describe, expect, it } from "vitest";

import { buildConversationTurns } from "@/components/daemon/agent-log-card";

type Msg = Parameters<typeof buildConversationTurns>[0][number];

function toolUse(seq: number, id: string, ts: string): Msg {
  return {
    seq,
    kind: "tool_use",
    tool_name: "Bash",
    tool_use_id: id,
    tool_input: '{"command":"pnpm build","run_in_background":true}',
    ts,
  } as unknown as Msg;
}

function finalNote(seq: number, toolUseId: string, status: string, ts: string): Msg {
  return {
    seq,
    kind: "user_input",
    text: "<task-notification>…</task-notification>",
    sender: "system_event",
    bg_task_final: { taskId: "t-1", toolUseId, status, outputFile: null },
    ts,
  } as unknown as Msg;
}

function toolSegments(msgs: Msg[]) {
  const out: Array<{ hasResult: boolean; success: boolean; durationMs?: number }> = [];
  for (const turn of buildConversationTurns(msgs)) {
    if (turn.role !== "assistant") continue;
    for (const seg of turn.segments) {
      if (seg.kind === "tool_use") {
        out.push({ hasResult: seg.hasResult, success: seg.entry.success, durationMs: seg.durationMs });
      }
    }
  }
  return out;
}

describe("buildConversationTurns · bg_task_final 终态配对（FR-03）", () => {
  it("completed 附着命中 → hasResult=true + success=true + 时长=附着段 ts 差", () => {
    const segs = toolSegments([
      toolUse(1, "tu-1", "2026-10-28T10:00:00Z"),
      finalNote(2, "tu-1", "completed", "2026-10-28T10:02:14Z"),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.hasResult).toBe(true);
    expect(segs[0]!.success).toBe(true);
    expect(segs[0]!.durationMs).toBe(134_000);
  });

  it("failed / stopped → success=false（终态红）", () => {
    for (const st of ["failed", "stopped"]) {
      const segs = toolSegments([
        toolUse(1, "tu-1", "2026-10-28T10:00:00Z"),
        finalNote(2, "tu-1", st, "2026-10-28T10:00:05Z"),
      ]);
      expect(segs[0]!.hasResult).toBe(true);
      expect(segs[0]!.success).toBe(false);
    }
  });

  it("无附着（旧 daemon / 运行中）→ 维持现状 hasResult=false success=false", () => {
    const segs = toolSegments([toolUse(1, "tu-1", "2026-10-28T10:00:00Z")]);
    expect(segs[0]!.hasResult).toBe(false);
    expect(segs[0]!.success).toBe(false);
  });

  it("重复附着幂等（首个生效）+ 孤儿附着（无对应 tool_use）零副作用", () => {
    const segs = toolSegments([
      toolUse(1, "tu-1", "2026-10-28T10:00:00Z"),
      finalNote(2, "tu-1", "completed", "2026-10-28T10:01:00Z"),
      finalNote(3, "tu-1", "failed", "2026-10-28T10:02:00Z"),
      finalNote(4, "tu-ghost", "completed", "2026-10-28T10:03:00Z"),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.success).toBe(true); // 首个 completed 生效，重复 failed 不翻转
    expect(segs[0]!.durationMs).toBe(60_000);
  });

  it("真 tool_result 到达时优先于附着（result 配对不受影响）", () => {
    const segs = toolSegments([
      toolUse(1, "tu-1", "2026-10-28T10:00:00Z"),
      {
        seq: 2,
        kind: "tool_result",
        tool_use_id: "tu-1",
        tool_result: "done",
        is_error: false,
        ts: "2026-10-28T10:00:30Z",
      } as unknown as Msg,
      finalNote(3, "tu-1", "completed", "2026-10-28T10:01:00Z"),
    ]);
    expect(segs[0]!.durationMs).toBe(30_000); // result 的 ts 优先
  });
});
