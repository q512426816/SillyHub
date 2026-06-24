/**
 * ResilienceService 单测（task-08 / FR-04 / FR-05 / D-005@v1）。
 *
 * 策略：重试用 real timer + baseDelayMs=0（_sleep(0) 几乎瞬时，总耗时几 ms，避免
 * fake timer + 连续异步重试的 unhandled rejection 竞态）；仅退避递增断言（AC-05）
 * 用 fake timer 精确捕获 setTimeout delay。
 *
 * 覆盖：
 *   - submitWithRetry：成功 1 次 / 可重试失败重试 maxAttempts 次 / 4xx fail-fast /
 *     用尽入 outbox / outbox null warn 不崩 / 退避递增
 *   - retryTerminal：成功 / 重试后成功 / 4xx 抛 / 用尽抛不暂存
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

function makeClient(submitImpl: ReturnType<typeof vi.fn>): SubmitClient {
  return { submitMessages: submitImpl };
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

  it("AC-04 4xx fail-fast 立即抛不重试", async () => {
    const submit = vi.fn(async () => {
      throw new HubHttpError(422, "bad", "u", "POST");
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
});
