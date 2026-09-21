/**
 * ql-20260921-004-92f8：直发占位轮 SSE 抢先认领单测。
 *
 * 背景：backend `_inject_into_session` commit 后立即补发 user_input log 事件，
 * 而 inject HTTP 响应要等 ready 等待（≤8s）+ WS 派发才返回——SSE 先到时
 * upsertTurn 按真实 run_id 另建一轮，占位轮（排队中）与真实轮同屏双显，
 * 响应到达才被 replacePlaceholderTurn 合并（用户实证：同一消息两条气泡、
 * 数秒后自动合并）。claimPendingPlaceholderTurn 把合并收敛前移到 SSE 首事件。
 */
import { claimPendingPlaceholderTurn } from "@/components/daemon/session-panel/session-panel-page";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";

function makeTurn(overrides: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-x",
    turn: null,
    prompt: "",
    output: "",
    status: "running",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    errorDetail: null,
    processItems: [],
    segments: [],
    turnStartedAt: 1_000,
    ...overrides,
  };
}

const PLACEHOLDER_ID = "__pending_inject_1695267063000__";

function makePlaceholder(prompt: string): SessionTurnView {
  return makeTurn({
    runId: PLACEHOLDER_ID,
    prompt,
    status: "pending",
    turnStartedAt: 1_234,
  });
}

describe("claimPendingPlaceholderTurn", () => {
  it("同文 user_input 事件 → 占位轮原地改名为真实 run_id（不新建轮，prompt/锚点保留）", () => {
    const history = makeTurn({ runId: "run-1", prompt: "上一轮", status: "completed" });
    const placeholder = makePlaceholder("完成了吗？");
    const turns = [history, placeholder];

    const next = claimPendingPlaceholderTurn(turns, "run-9", "完成了吗？");

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(history);
    expect(next[1]!.runId).toBe("run-9");
    expect(next[1]!.status).toBe("running");
    expect(next[1]!.prompt).toBe("完成了吗？");
    expect(next[1]!.turnStartedAt).toBe(1_234);
  });

  it("附件标记行同构（占位含标记行 / 事件为 daemon 裸文本版）→ 同键认领", () => {
    // 标记行 id 须为 UUID（parseAttachmentMarkers UUID 锚定，防伪标记误报）。
    const placeholder = makePlaceholder(
      "[附件:00000000-0000-4000-8000-000000000001|file|图.png]\n看图说话",
    );
    const turns = [placeholder];

    const next = claimPendingPlaceholderTurn(turns, "run-9", "看图说话");

    expect(next).toHaveLength(1);
    expect(next[0]!.runId).toBe("run-9");
  });

  it("该 run_id 已有对应轮（raced 已建轮 / mid-turn 注入活跃轮）→ 原样返回", () => {
    const placeholder = makePlaceholder("完成了吗？");
    const raced = makeTurn({ runId: "run-9", prompt: "完成了吗？" });
    const turns = [placeholder, raced];

    expect(claimPendingPlaceholderTurn(turns, "run-9", "完成了吗？")).toBe(turns);
  });

  it("无占位轮（排队派发轮场景）→ 原样返回", () => {
    const turns = [makeTurn({ runId: "run-1", prompt: "旧轮", status: "completed" })];
    expect(claimPendingPlaceholderTurn(turns, "run-9", "新消息")).toBe(turns);
  });

  it("正文不同文（极端并发：他轮同窗口派发）→ 不认领，原样返回", () => {
    const placeholder = makePlaceholder("完成了吗？");
    const turns = [placeholder];
    expect(claimPendingPlaceholderTurn(turns, "run-9", "另一条排队消息")).toBe(turns);
    expect(turns[0]!.runId).toBe(PLACEHOLDER_ID);
  });

  it("同文键为空（附件-only 空 prompt）→ 不认领，回落响应侧收敛", () => {
    const placeholder = makePlaceholder("[附件:00000000-0000-4000-8000-000000000002|file|图.png]");
    const turns = [placeholder];
    expect(
      claimPendingPlaceholderTurn(
        turns,
        "run-9",
        "[附件:00000000-0000-4000-8000-000000000002|file|图.png]",
      ),
    ).toBe(turns);
  });

  it("多条占位（防御场景）→ 认领最末一条同文的", () => {
    const older = makePlaceholder("旧占位");
    const newer = makePlaceholder("新占位");
    const turns = [older, newer];

    const next = claimPendingPlaceholderTurn(turns, "run-9", "新占位");

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(older);
    expect(next[1]!.runId).toBe("run-9");
  });
});
