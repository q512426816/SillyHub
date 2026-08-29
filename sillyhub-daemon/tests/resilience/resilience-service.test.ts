/**
 * ResilienceService 单测（task-08 / FR-04 / FR-05 / D-005@v1；task-07 扩展）。
 *
 * 策略：重试用 real timer + baseDelayMs=0（_sleep(0) 几乎瞬时，总耗时几 ms，避免
 * fake timer + 连续异步重试的 unhandled rejection 竞态）；仅退避递增断言（AC-05）
 * 用 fake timer 精确捕获 setTimeout delay。
 *
 * 覆盖：
 *   - submitWithRetry：成功 1 次 / 可重试失败重试 maxAttempts 次 / 其它 4xx fail-fast /
 *     422 入箱+触发一次 token 刷新（task-07 A3）/ 用尽入 outbox / outbox null warn
 *     不崩 / 退避递增
 *   - retryTerminal：成功 / 重试后成功 / 4xx 抛 / 用尽抛不暂存
 *   - 终态入箱（task-07）：enqueueRunResult / enqueueSessionEnd /
 *     enqueuePendingToken 的 entry 形状（kind/pending_token/payload）
 *   - drainOutbox：按 kind 路由三类 entry（messages/run_result/session_end）、
 *     pending_token 经 refresher 取新 token 重放、fake 缺扩展方法丢弃
 *
 * @module resilience/resilience-service.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ResilienceService,
  type SubmitClient,
  type Outbox,
  type RetryConfig,
  type ResilienceLogger,
  type Envelope,
  type OutboxEntry,
} from "../../src/resilience/service.js";
import { HubHttpError } from "../../src/hub-client.js";

// ── fixture ──────────────────────────────────────────────────────────────────

/** 瞬时重试配置：baseDelay=0 → _sleep(0) 几乎瞬时，real timer 下总耗时极短。 */
const fastRetry: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 0,
  backoffFactor: 2,
  jitter: 0,
};

function noopLogger(): ResilienceLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

/**
 * task-07：fake client 同步扩展两可选方法（drain 按 kind 路由的补发目标）。
 * 缺省 vi.fn 成功——测试按需覆盖 mockRejectedValue / mockImplementation。
 */
function makeClient(
  submitImpl: ReturnType<typeof vi.fn>,
  extra?: {
    notifyRunResult?: ReturnType<typeof vi.fn>;
    notifySessionEnd?: ReturnType<typeof vi.fn>;
  },
): SubmitClient {
  const client: SubmitClient = { submitMessages: submitImpl };
  if (extra?.notifyRunResult) client.notifyRunResult = extra.notifyRunResult;
  if (extra?.notifySessionEnd) client.notifySessionEnd = extra.notifySessionEnd;
  return client;
}

function makeOutbox(): Outbox & {
  enqueue: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
} {
  return {
    enqueue: vi.fn(async () => undefined),
    markDelivered: vi.fn(async () => undefined),
    pendingByRun: vi.fn(() => []),
    load: vi.fn(async () => undefined),
  };
}

function envs(runId = "run-1", n = 1): Envelope[] {
  return Array.from({ length: n }, (_, i) => ({
    message: { seq: i },
    dedup_key: `dk-${i}`,
  }));
}

/** flush microtasks（real timer 下让 async 重试循环推进）。 */
function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

// ── submitWithRetry ─────────────────────────────────────────────────────────

describe("submitWithRetry (task-08 / FR-04)", () => {
  it("AC-01 成功 1 次（不重试）", async () => {
    const submit = vi.fn(async () => ({}));
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(submit),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.submitWithRetry("l", "t", "run-1", envs());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["dk-0"]);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("AC-02 可重试失败重试 maxAttempts 次", async () => {
    const submit = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(submit),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.submitWithRetry("l", "t", "run-1", envs());
    await flush();
    expect(submit).toHaveBeenCalledTimes(3);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("AC-04 其它 4xx fail-fast 立即抛不重试（422 除外，见下方 A3 用例）", async () => {
    const submit = vi.fn(async () => {
      throw new HubHttpError(404, "nf", "u", "POST");
    });
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(submit),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await expect(svc.submitWithRetry("l", "t", "run-1", envs())).rejects.toThrow();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("task-07 A3: 422（claim_token 失效）不抛——入箱带 pending_token + 触发一次刷新", async () => {
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(submit),
      outbox,
      fastRetry,
      noopLogger(),
    );
    const refresh = vi.fn(async () => "new-token");
    svc.setClaimTokenRefresher(refresh);
    // 422 不再向上抛（fail-closed 改为入箱对账）。
    await expect(svc.submitWithRetry("l", "t", "run-1", envs())).resolves.toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        kind: "messages",
        pending_token: true,
      }),
    );
    // 触发一次 claim_token 刷新（每 run 防抖：重复 422 不再触发）。
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(svc.submitWithRetry("l", "t", "run-1", envs())).resolves.toBeUndefined();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("task-07 A3: 422 刷新取不到 token 仅 warn 不崩（backend dedup 兜底）", async () => {
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const outbox = makeOutbox();
    const logger = noopLogger();
    const warnSpy = vi.spyOn(logger, "warn");
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, logger);
    const refresh = vi.fn(async () => null);
    svc.setClaimTokenRefresher(refresh);
    await expect(svc.submitWithRetry("l", "t", "run-1", envs())).resolves.toBeUndefined();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "claim_token_refresh_unavailable",
      expect.objectContaining({ run_id: "run-1" }),
    );
  });

  it("AC-03 用尽入 outbox（注入时 enqueue 被调）", async () => {
    const submit = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(submit),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.submitWithRetry("l", "tok", "run-1", envs());
    await flush();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseId: "l",
        claimToken: "tok",
        runId: "run-1",
        envelopes: expect.any(Array),
      }),
    );
  });

  it("AC-07 outbox null 时用尽 warn 不崩不抛", async () => {
    const submit = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const logger = noopLogger();
    const warnSpy = vi.spyOn(logger, "warn");
    const svc = new ResilienceService(makeClient(submit), null, fastRetry, logger);
    await svc.submitWithRetry("l", "t", "run-1", envs());
    await flush();
    expect(submit).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith(
      "submit_exhausted_no_outbox",
      expect.objectContaining({ run_id: "run-1" }),
    );
  });

  it("AC-05 退避递增（1s/2s 量级）", async () => {
    vi.useFakeTimers();
    const backoffConfig: RetryConfig = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      backoffFactor: 2,
      jitter: 0,
    };
    const delays: number[] = [];
    let calls = 0;
    const submit = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError("fetch failed");
      return {};
    });
    // 捕获 _sleep 的 setTimeout delay（jitter=0 时 delay 精确）。
    const orig = global.setTimeout;
    (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      cb: () => void,
      ms?: number,
    ) => {
      if (typeof ms === "number" && ms > 0) delays.push(ms);
      return orig(cb, ms);
    }) as typeof setTimeout;
    try {
      const svc = new ResilienceService(
        makeClient(submit),
        null,
        backoffConfig,
        noopLogger(),
      );
      const p = svc.submitWithRetry("l", "t", "run-1", envs());
      await vi.advanceTimersByTimeAsync(10000);
      await p;
    } finally {
      (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = orig;
    }
    // 两次退避：1000 / 2000
    expect(delays).toEqual([1000, 2000]);
    expect(submit).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

// ── retryTerminal ────────────────────────────────────────────────────────────

describe("retryTerminal (task-08 / FR-05)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("成功不重试", async () => {
    const call = vi.fn(async () => "ok");
    const svc = new ResilienceService(makeClient(vi.fn()), null, fastRetry, noopLogger());
    await expect(svc.retryTerminal(call)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("可重试失败重试后成功", async () => {
    let n = 0;
    const call = vi.fn(async () => {
      n++;
      if (n < 3) throw new TypeError("fetch failed");
      return "ok";
    });
    const svc = new ResilienceService(makeClient(vi.fn()), null, fastRetry, noopLogger());
    await expect(svc.retryTerminal(call)).resolves.toBe("ok");
    await flush();
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("4xx fail-fast 立即抛", async () => {
    const call = vi.fn(async () => {
      throw new HubHttpError(404, "nf", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(vi.fn()), null, fastRetry, noopLogger());
    await expect(svc.retryTerminal(call)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("AC-06 用尽抛不暂存（不调 outbox）", async () => {
    const call = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const outbox = makeOutbox();
    const svc = new ResilienceService(
      makeClient(vi.fn()),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await expect(svc.retryTerminal(call)).rejects.toThrow();
    await flush();
    expect(call).toHaveBeenCalledTimes(3);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});

// ── 终态入箱（task-07 / A3）─────────────────────────────────────────────────

describe("enqueueRunResult / enqueueSessionEnd / enqueuePendingToken (task-07)", () => {
  it("run_result 入箱：payload 进 envelopes[0]、dedup_key=runId、空 token 带 pending_token", async () => {
    const outbox = makeOutbox();
    const svc = new ResilienceService(makeClient(vi.fn()), outbox, fastRetry, noopLogger());
    await svc.enqueueRunResult("l", "tok", "run-1", { status: "success", is_error: false });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run_result",
        runId: "run-1",
        envelopes: [
          { message: { status: "success", is_error: false }, dedup_key: "run-1" },
        ],
      }),
    );
    // 空窗：claimToken 空串 → pending_token 标记。
    await svc.enqueueRunResult("l", "", "run-2", { status: "failed", is_error: true });
    expect(outbox.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "run_result", pending_token: true }),
    );
  });

  it("run_result 同 run 已有未补发 entry 时跳过（不重复滞留）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-1",
        [{
          leaseId: "l",
          claimToken: "t",
          runId: "run-1",
          envelopes: [{ message: {}, dedup_key: "run-1" }],
          ts: "x",
          kind: "run_result",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const svc = new ResilienceService(makeClient(vi.fn()), outbox, fastRetry, noopLogger());
    await svc.enqueueRunResult("l", "t", "run-1", { status: "success", is_error: false });
    expect(store.get("run-1")?.length).toBe(1);
  });

  it("session_end 入箱：dedupId=sessionId、无 lease/token 语义", async () => {
    const outbox = makeOutbox();
    const svc = new ResilienceService(makeClient(vi.fn()), outbox, fastRetry, noopLogger());
    await svc.enqueueSessionEnd("sess-1", "failed", "driver_error");
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "session_end",
        runId: "sess-1",
        leaseId: "",
        claimToken: "",
        envelopes: [
          { message: { status: "failed", reason: "driver_error" }, dedup_key: "sess-1" },
        ],
      }),
    );
  });

  it("pending_token 消息入箱：claimToken 空 + pending_token 标记", async () => {
    const outbox = makeOutbox();
    const svc = new ResilienceService(makeClient(vi.fn()), outbox, fastRetry, noopLogger());
    await svc.enqueuePendingToken("l", "run-1", envs());
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "messages",
        claimToken: "",
        pending_token: true,
      }),
    );
  });
});

// ── drainOutbox（task-18 / FR-07 / D-004@v1）──────────────────────────────────

/** 内存 Outbox mock（drain 测试不依赖文件系统）。 */
function memOutbox(initial: Map<string, OutboxEntry[]>): Outbox {
  return {
    enqueue: vi.fn(async () => undefined),
    markDelivered: vi.fn(async (runId, keys) => {
      const list = initial.get(runId);
      if (!list || keys.length === 0) return;
      const keySet = new Set(keys);
      const kept = list.filter(
        (e) => !e.envelopes.every((env) => keySet.has(env.dedup_key)),
      );
      if (kept.length === 0) initial.delete(runId);
      else initial.set(runId, kept);
    }),
    pendingByRun: (runId) => [...(initial.get(runId) ?? [])],
    runs: () => [...initial.keys()],
    load: vi.fn(async () => undefined),
  };
}

describe("drainOutbox (task-18 / FR-07)", () => {
  it("AC-03 pending 补发成功 → markDelivered", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: { a: 1 }, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    await svc.drainOutbox();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["dk-1"]);
    expect(store.has("run-1")).toBe(false); // 补发后清空
  });

  it("AC-06 422 token 失效 → 丢弃该条（不重试）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    await svc.drainOutbox();
    await flush();
    // 422 被丢弃：markDelivered 清空，不再重试
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["dk-1"]);
    expect(store.has("run-1")).toBe(false);
  });

  it("AC-04 session ended（validity）→ 丢弃不补发", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const validity = {
      isLeaseValid: () => true,
      isSessionEnded: () => true, // session 已结束
    };
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger(), validity);
    await svc.drainOutbox();
    await flush();
    expect(submit).not.toHaveBeenCalled(); // 不补发
    expect(outbox.markDelivered).toHaveBeenCalled(); // 丢弃
  });

  it("AC-05 lease 过期（validity）→ 丢弃不补发", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const validity = {
      isLeaseValid: () => false, // lease 过期
      isSessionEnded: () => false,
    };
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger(), validity);
    await svc.drainOutbox();
    await flush();
    expect(submit).not.toHaveBeenCalled();
    expect(outbox.markDelivered).toHaveBeenCalled();
  });

  it("AC-07 防重入（_draining 并发不重复）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    // 并发触发两次 drain
    await Promise.all([svc.drainOutbox(), svc.drainOutbox()]);
    await flush();
    // 第二次因 _draining 标记直接返回，submit 仅被调用一次
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("不健康（_healthy=false）时不 drain", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    svc.notifyHeartbeatResult(false);
    await svc.drainOutbox();
    await flush();
    expect(submit).not.toHaveBeenCalled();
  });

  it("L3: 404 终态（lease/run 不存在）→ 丢弃不补发", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new HubHttpError(404, "not found", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    await svc.drainOutbox();
    await flush();
    // 404 是终态业务错误：retryTerminal fail-fast 抛 → drain 丢弃该条
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["dk-1"]);
    expect(store.has("run-1")).toBe(false);
  });

  it("L3: 可重试网络错误用尽 → 保留 entry 待下轮", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-1", [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: {}, dedup_key: "dk-1" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    await svc.drainOutbox();
    await flush();
    // 可重试错误用尽：保留 entry（不 markDelivered），待下轮 drain 网络恢复后重试
    expect(outbox.markDelivered).not.toHaveBeenCalled();
    expect(store.has("run-1")).toBe(true);
  });

  // ── task-07：drain 按 kind 路由三类 entry（D-007@v1）──────────────────────

  it("task-07: kind=run_result → 路由 notifyRunResult，成功后 markDelivered", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-1",
        [{
          leaseId: "l",
          claimToken: "t",
          runId: "run-1",
          envelopes: [{ message: { status: "success", is_error: false }, dedup_key: "run-1" }],
          ts: "x",
          kind: "run_result",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const notifyRunResult = vi.fn(async () => ({}));
    const svc = new ResilienceService(
      makeClient(submit, { notifyRunResult }),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.drainOutbox();
    await flush();
    expect(notifyRunResult).toHaveBeenCalledWith(
      "l",
      "t",
      "run-1",
      { status: "success", is_error: false },
    );
    expect(submit).not.toHaveBeenCalled(); // 不走 messages 通道
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["run-1"]);
    expect(store.has("run-1")).toBe(false);
  });

  it("task-07: kind=session_end → 路由 notifySessionEnd（dedupId=sessionId）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "sess-1",
        [{
          leaseId: "",
          claimToken: "",
          runId: "sess-1",
          envelopes: [{ message: { status: "failed", reason: "driver_error" }, dedup_key: "sess-1" }],
          ts: "x",
          kind: "session_end",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const notifySessionEnd = vi.fn(async () => ({}));
    const svc = new ResilienceService(
      makeClient(submit, { notifySessionEnd }),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.drainOutbox();
    await flush();
    expect(notifySessionEnd).toHaveBeenCalledWith("sess-1", "failed", "driver_error");
    expect(submit).not.toHaveBeenCalled();
    expect(outbox.markDelivered).toHaveBeenCalledWith("sess-1", ["sess-1"]);
    expect(store.has("sess-1")).toBe(false);
  });

  it("task-07: 422 后 token 刷新可重放——pending_token entry 经 refresher 取新 token 补发", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-1",
        [{
          leaseId: "l",
          claimToken: "stale-token",
          runId: "run-1",
          envelopes: [{ message: { a: 1 }, dedup_key: "dk-1" }],
          ts: "x",
          kind: "messages",
          pending_token: true,
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    // SESSION_INJECT 已刷新 token（daemon SessionState 持有新值）。
    svc.setClaimTokenRefresher(async () => "fresh-token");
    await svc.drainOutbox();
    await flush();
    expect(submit).toHaveBeenCalledWith(
      "l",
      "fresh-token",
      "run-1",
      [{ a: 1, dedup_key: "dk-1" }],
    );
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-1", ["dk-1"]);
    expect(store.has("run-1")).toBe(false);
  });

  it("task-07: pending_token run_result 经 refresher 取新 token 重放成功", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-9",
        [{
          leaseId: "l",
          claimToken: "",
          runId: "run-9",
          envelopes: [{ message: { status: "success", is_error: false }, dedup_key: "run-9" }],
          ts: "x",
          kind: "run_result",
          pending_token: true,
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const notifyRunResult = vi.fn(async () => ({}));
    const svc = new ResilienceService(
      makeClient(vi.fn(), { notifyRunResult }),
      outbox,
      fastRetry,
      noopLogger(),
    );
    svc.setClaimTokenRefresher(async () => "token-after-inject");
    await svc.drainOutbox();
    await flush();
    expect(notifyRunResult).toHaveBeenCalledWith(
      "l",
      "token-after-inject",
      "run-9",
      { status: "success", is_error: false },
    );
    expect(store.has("run-9")).toBe(false);
  });

  it("task-07: fake 未实现扩展方法 → run_result/session_end entry warn 丢弃（不无限滞留）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-1",
        [{
          leaseId: "l",
          claimToken: "t",
          runId: "run-1",
          envelopes: [{ message: {}, dedup_key: "run-1" }],
          ts: "x",
          kind: "run_result",
        }],
      ],
      [
        "sess-1",
        [{
          leaseId: "",
          claimToken: "",
          runId: "sess-1",
          envelopes: [{ message: { status: "ended", reason: "manual" }, dedup_key: "sess-1" }],
          ts: "x",
          kind: "session_end",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    await svc.drainOutbox();
    await flush();
    expect(submit).not.toHaveBeenCalled();
    expect(store.has("run-1")).toBe(false);
    expect(store.has("sess-1")).toBe(false);
  });

  it("task-07: 混合三类 entry 同轮 drain 全部路由（messages/run_result/session_end）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "run-1",
        [{ leaseId: "l", claimToken: "t", runId: "run-1", envelopes: [{ message: { a: 1 }, dedup_key: "dk-1" }], ts: "x" }],
      ],
      [
        "run-2",
        [{
          leaseId: "l",
          claimToken: "t",
          runId: "run-2",
          envelopes: [{ message: { status: "success", is_error: false }, dedup_key: "run-2" }],
          ts: "x",
          kind: "run_result",
        }],
      ],
      [
        "sess-1",
        [{
          leaseId: "",
          claimToken: "",
          runId: "sess-1",
          envelopes: [{ message: { status: "ended", reason: "manual" }, dedup_key: "sess-1" }],
          ts: "x",
          kind: "session_end",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => ({}));
    const notifyRunResult = vi.fn(async () => ({}));
    const notifySessionEnd = vi.fn(async () => ({}));
    const svc = new ResilienceService(
      makeClient(submit, { notifyRunResult, notifySessionEnd }),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.drainOutbox();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(notifyRunResult).toHaveBeenCalledTimes(1);
    expect(notifySessionEnd).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  it("task-07: session_end 4xx（终态业务错误）→ 丢弃该条（backend 幂等 no-op 兜底）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      [
        "sess-1",
        [{
          leaseId: "",
          claimToken: "",
          runId: "sess-1",
          envelopes: [{ message: { status: "ended", reason: "manual" }, dedup_key: "sess-1" }],
          ts: "x",
          kind: "session_end",
        }],
      ],
    ]);
    const outbox = memOutbox(store);
    const notifySessionEnd = vi.fn(async () => {
      throw new HubHttpError(404, "not found", "u", "POST");
    });
    const svc = new ResilienceService(
      makeClient(vi.fn(), { notifySessionEnd }),
      outbox,
      fastRetry,
      noopLogger(),
    );
    await svc.drainOutbox();
    await flush();
    expect(store.has("sess-1")).toBe(false);
  });
});

// ── R4（2026-08-30 审计）：stale-token 422 有界保留重试 ────────────────────────

describe("drainOutbox stale-token 422 keep-retry (R4)", () => {
  function pendingEntry(): OutboxEntry {
    return {
      leaseId: "l",
      claimToken: "stale",
      runId: "run-r4",
      envelopes: [{ message: { a: 1 }, dedup_key: "dk-r4" }],
      ts: "x",
      pending_token: true,
    };
  }

  it("刷新取不到新 token 的 422 → 保留 entry 下轮重试（不 markDelivered）", async () => {
    const store = new Map<string, OutboxEntry[]>([["run-r4", [pendingEntry()]]]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    // 刷新回调取不到（daemon 刚重启 SessionState 未建窗口）
    svc.setClaimTokenRefresher(async () => null);

    await svc.drainOutbox();
    await flush();

    expect(submit).toHaveBeenCalledTimes(1); // 用旧 token 重放了一次
    expect(outbox.markDelivered).not.toHaveBeenCalled(); // 保留不丢弃
    expect(store.has("run-r4")).toBe(true);
  });

  it("保留后下轮刷新成功 → 正常补发 markDelivered（窗口自愈）", async () => {
    const store = new Map<string, OutboxEntry[]>([["run-r4", [pendingEntry()]]]);
    const outbox = memOutbox(store);
    let fresh = false; // 刷新回调能否取到新 token
    let backendOk = false; // backend 是否仍拒旧 token
    const submit = vi.fn(async () => {
      if (!backendOk) throw new HubHttpError(422, "token rotated", "u", "POST");
      return {};
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    svc.setClaimTokenRefresher(async () => (fresh ? "tok-new" : null));

    await svc.drainOutbox(); // 第一轮：旧 token 422 → 保留
    fresh = true; // SESSION_INJECT 到达，刷新可用
    backendOk = true; // 新 token 被 backend 接受
    await svc.drainOutbox(); // 第二轮：新 token 补发成功
    await flush();

    expect(submit).toHaveBeenCalledTimes(2);
    expect(outbox.markDelivered).toHaveBeenCalledWith("run-r4", ["dk-r4"]);
    expect(store.has("run-r4")).toBe(false);
  });

  it("持续刷新失败超过 TOKEN_422_KEEP_RETRIES(5) 轮 → 落回丢弃（防毒丸）", async () => {
    const store = new Map<string, OutboxEntry[]>([["run-r4", [pendingEntry()]]]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    svc.setClaimTokenRefresher(async () => null);

    for (let i = 0; i < 6; i++) {
      await svc.drainOutbox();
    }
    await flush();

    expect(outbox.markDelivered).toHaveBeenCalledWith("run-r4", ["dk-r4"]); // 第 6 轮丢弃
    expect(store.has("run-r4")).toBe(false);
  });

  it("非 pending entry 的 422 仍立即丢弃（既有 R-10 语义零回归）", async () => {
    const store = new Map<string, OutboxEntry[]>([
      ["run-r4", [{ leaseId: "l", claimToken: "t", runId: "run-r4", envelopes: [{ message: {}, dedup_key: "dk-r4" }], ts: "x" }]],
    ]);
    const outbox = memOutbox(store);
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "token rotated", "u", "POST");
    });
    const svc = new ResilienceService(makeClient(submit), outbox, fastRetry, noopLogger());
    svc.setClaimTokenRefresher(async () => "tok-new"); // 有 refresher 但 entry 非 pending

    await svc.drainOutbox();
    await flush();

    expect(outbox.markDelivered).toHaveBeenCalledWith("run-r4", ["dk-r4"]);
    expect(store.has("run-r4")).toBe(false);
  });
});
