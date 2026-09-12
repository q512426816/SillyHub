// 2026-09-12-chat-turn-auto-recovery / FR-5.1：autoRecoverHintForTurn 双信号
// 推导单测（error_detail 类型 + pending 恢复条目存在性，D-009@v2）。

import { describe, expect, it } from "vitest";

import {
  autoRecoverHintForTurn,
  type AutoResumeEntry,
} from "@/components/daemon/turn-timeline";
import type { ErrorLogItem } from "@/components/agent-log/normalize";

function err(partial: Partial<ErrorLogItem>): ErrorLogItem {
  return {
    type: "provider_error",
    code: null,
    message: "运行失败",
    retryable: true,
    hint: null,
    raw: null,
    ...partial,
  };
}

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const SCHED: AutoResumeEntry[] = [
  { origin: `auto_resume:${RUN_ID}`, kind: "scheduled", dispatchAt: "2026-09-12T10:03:59+08:00" },
];
const QUEUED: AutoResumeEntry[] = [
  { origin: `auto_resume:${RUN_ID}`, kind: "queued", dispatchAt: null },
];

describe("autoRecoverHintForTurn（2026-09-12 FR-5.1 双信号推导）", () => {
  it("quota + reset_at + 定时条目 → 额度提示含本地时间与取消入口", () => {
    const hint = autoRecoverHintForTurn(
      { runId: RUN_ID, errorDetail: err({ type: "quota_exceeded", reset_at: "2026-09-12T10:03:59+08:00" }) },
      SCHED,
    );
    expect(hint).toContain("额度耗尽");
    expect(hint).toContain("自动继续");
    expect(hint).toContain("可在定时消息中取消");
    expect(hint).toContain("10:03");
  });

  it("瞬时四类 + 排队条目 → 上游瞬时故障已自动重发", () => {
    for (const t of ["rate_limited", "timeout", "network", "provider_error"] as const) {
      expect(
        autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: err({ type: t }) }, QUEUED),
      ).toBe("上游瞬时故障，已自动重发");
    }
  });

  it("静默中断 raw（silent stream truncation）+ 条目 → 输出流中断已自动续跑", () => {
    const hint = autoRecoverHintForTurn(
      {
        runId: RUN_ID,
        errorDetail: err({ raw: "[silent stream truncation] 上一轮输出流中断，未产生收尾回复" }),
      },
      QUEUED,
    );
    expect(hint).toBe("输出流中断，已自动续跑");
  });

  it("无恢复条目（第二信号缺失）→ undefined——防静态文案误导（D-009@v2）", () => {
    expect(
      autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: err({ type: "provider_error" }) }, []),
    ).toBeUndefined();
    expect(
      autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: err({ type: "provider_error" }) }, undefined),
    ).toBeUndefined();
  });

  it("origin 不匹配（条目属其它 run）→ undefined", () => {
    const other: AutoResumeEntry[] = [
      { origin: "auto_resume:22222222-2222-2222-2222-222222222222", kind: "queued" },
    ];
    expect(
      autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: err({ type: "provider_error" }) }, other),
    ).toBeUndefined();
  });

  it("quota 无 reset_at / 非恢复类（auth/unknown）→ undefined", () => {
    expect(
      autoRecoverHintForTurn(
        { runId: RUN_ID, errorDetail: err({ type: "quota_exceeded" }) },
        SCHED,
      ),
    ).toBeUndefined();
    expect(
      autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: err({ type: "auth_failed" }) }, QUEUED),
    ).toBeUndefined();
  });

  it("无 errorDetail / 无 runId → undefined", () => {
    expect(autoRecoverHintForTurn({ runId: RUN_ID, errorDetail: null }, QUEUED)).toBeUndefined();
    expect(
      autoRecoverHintForTurn({ runId: null, errorDetail: err({ type: "provider_error" }) }, QUEUED),
    ).toBeUndefined();
  });
});
