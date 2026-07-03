/**
 * W1 daemon resilience 集成测试（task-06）。
 *
 * 来源：design.md §5 Phase1 / plan.md Wave1 task-06。
 * 覆盖 FR-01（cause 透传）/ FR-02（进程保活：handler 不退 + _fire 自愈）/ FR-03（断连计数）。
 *
 * 策略：
 *   - T1/T6（心跳 cause / 断连计数）：跟随 daemon.test.ts 成熟模式，real timer + start/sleep/stop
 *     （避开 preflight 在 fake timer 下卡死）。不连真实 backend，mock HubClient。
 *   - T3/T4/T5（_fire 自愈）：_heartbeatLoop 内层 catch 吞掉 heartbeat 错误不冒泡 _fire，
 *     故直接 cast 调私有 _fire + fake timer，自定义 loop 抛 Error/AbortError 验证重启语义。
 *   - T2（handler 不退进程）：dynamic import cli.ts（main 跑 commander help，无 daemon 副作用）
 *     + 临时管理 unhandledRejection listeners 避免 emit 污染 vitest。
 *
 * @module w1-resilience.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Daemon } from "../src/daemon.js";
import type { DaemonConfig } from "../src/config.js";
import type { DetectedAgent } from "../src/agent-detector.js";
import type { WsClientCallbacks } from "../src/ws-client.js";

// ── fixture ──────────────────────────────────────────────────────────────────

const baseConfig: DaemonConfig = {
  server_url: "http://localhost:8000",
  token: "tok-w1",
  runtime_id: "rt-w1-001",
  profile: "default",
  workspace_dir: "/tmp/ws",
  poll_interval: 9999,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: "debug",
  loop_restart_backoff_ms: 5000,
  disconnect_log_threshold_sec: 30,
};

function makeAgent(provider: string): DetectedAgent {
  return {
    provider,
    path: "/usr/bin/agent",
    version: "1.2.3",
    protocol: "stream_json",
    status: "available",
    versionWarning: null,
  };
}

interface MockClient {
  register: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  markOffline: ReturnType<typeof vi.fn>;
  claimLease: ReturnType<typeof vi.fn>;
  startLease: ReturnType<typeof vi.fn>;
  submitMessages: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  getPendingLeases: ReturnType<typeof vi.fn>;
  getExecutionContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    register: vi.fn(async () => ({
    daemon_instance_id: "srv-inst",
    runtimes: [{ provider: "claude", runtime_id: "srv-rid-1" }],
  })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: "tok", payload: {} })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: "run-1", claude_md: "" })),
    close: vi.fn(),
    ...overrides,
  };
}

function makeWsFactory(): {
  factory: (opts: { callbacks: WsClientCallbacks }) => {
    connect: () => void;
    close: () => void;
  };
} {
  return {
    factory: vi.fn(() => ({
      connect: () => undefined,
      close: () => undefined,
    })),
  };
}

function build(opts: {
  client?: MockClient;
  config?: Partial<DaemonConfig>;
} = {}): { daemon: Daemon; client: MockClient } {
  const client = opts.client ?? makeClient();
  const detector = { detectAgents: vi.fn(async () => [makeAgent("claude")]) };
  const { factory } = makeWsFactory();
  const config = { ...baseConfig, ...(opts.config ?? {}) };
  const daemon = new Daemon(config, client as never, null, {
    detector: detector as never,
    wsClientFactory: factory as never,
  });
  return { daemon, client };
}

/** 捕获 console（daemon createLogger 走 console.log/warn/error）。 */
function captureConsole(): {
  lines: string[];
  restore: () => void;
  filter: (substr: string) => string[];
} {
  const lines: string[] = [];
  const spies = (["log", "warn", "error", "info"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    }),
  );
  return {
    lines,
    restore: () => spies.forEach((s) => s.mockRestore()),
    filter: (substr: string) => lines.filter((l) => l.includes(substr)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** flush microtask 队列（real + fake timer 通用：纯 microtask，不依赖 setImmediate/timer）。 */
function flush(): Promise<void> {
  return Promise.resolve();
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe("W1 daemon resilience", () => {
  let daemons: Daemon[] = [];
  let origExit: typeof process.exit | null = null;

  beforeEach(() => {
    daemons = [];
    origExit = process.exit;
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    if (origExit) process.exit = origExit;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function track<T extends Daemon>(d: T): T {
    daemons.push(d);
    return d;
  }

  // T1: FR-01 cause 透传 —— heartbeat fetch reject 暴露底层 undici code。
  it("T1: heartbeat 失败 warn 含 cause.code（FR-01）", async () => {
    const connErr = new TypeError("fetch failed");
    (connErr as Error & { cause?: unknown }).cause = {
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:8000",
    };
    const client = makeClient({ heartbeat: vi.fn(async () => Promise.reject(connErr)) });
    const { daemon } = build({ client });
    track(daemon);

    const cap = captureConsole();
    await daemon.start();
    await sleep(60); // 等一次心跳循环（interval 0.02s）

    const hbFails = cap.filter("heartbeat_failed");
    expect(hbFails.length).toBeGreaterThan(0);
    expect(hbFails.some((l) => l.includes("ECONNREFUSED"))).toBe(true);

    await daemon.stop();
    cap.restore();
  });

  // T2: FR-02 handler 不退进程 —— unhandledRejection 记 FATAL 且不 process.exit。
  it("T2: unhandledRejection 不退进程且记 FATAL（FR-02）", async () => {
    vi.resetModules();
    // 保存 vitest 已注册的 unhandledRejection listeners，emit 时临时摘除避免污染。
    const savedListeners = process.listeners("unhandledRejection").slice();
    // stub argv/exit：无子命令 → commander help 正常返回，不启动 daemon。
    const origArgv = process.argv;
    process.argv = ["node", "cli-w1"];
    const exitSpy = vi.fn((code?: number) => undefined as never);
    process.exit = exitSpy as never;

    const writes: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });

    // dynamic import cli.ts → 顶层注册 handler + void main()（help）。
    await import("../src/cli.js");
    await sleep(30); // 等 main parseAsync flush（commander help 可能调 exit，属无关副作用）

    // 摘除 vitest 的 listeners，仅留 cli 注册的 handler。
    const afterImport = process.listeners("unhandledRejection");
    for (const l of afterImport) {
      if (savedListeners.includes(l)) process.off("unhandledRejection", l);
    }
    // 清零 exit 计数：commander help 的 exit 与本断言无关，只看 emit 之后是否退进程。
    exitSpy.mockClear();
    // emit 同步触发 cli handler 写 stderr。
    process.emit("unhandledRejection", new Error("boom-w1"), Promise.resolve());

    // 恢复 vitest listeners + 清理 cli handler（防泄漏到后续测试）。
    const afterEmit = process.listeners("unhandledRejection");
    for (const l of afterEmit) process.off("unhandledRejection", l);
    for (const l of savedListeners) process.on("unhandledRejection", l);

    const out = writes.join("");
    expect(out).toContain("[FATAL unhandledRejection]");
    expect(out).toContain("boom-w1");
    expect(out).toContain("进程不退出");
    expect(exitSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
    process.argv = origArgv;
  });

  // T3: FR-02 _fire 自愈 —— loop 非 AbortError 后带退避重启。
  it("T3: _fire 非 AbortError 后带退避重启（FR-02）", async () => {
    vi.useFakeTimers();
    const { daemon } = build({ config: { loop_restart_backoff_ms: 100 } });
    track(daemon);
    const d = daemon as unknown as {
      _running: boolean;
      _fire(loop: (signal: AbortSignal) => Promise<void>): void;
    };
    d._running = true;

    let callCount = 0;
    const loop = async (): Promise<void> => {
      callCount++;
      if (callCount === 1) throw new Error("net crash"); // 首次崩，之后正常返回
    };
    d._fire(loop);
    await flush(); // 首次 loop 抛 Error → 进 catch
    expect(callCount).toBe(1);

    // 推进退避 100ms → sleep resolve → _fire 重启 → loop 第二次（正常返回）
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(callCount).toBe(2);
  });

  // T4: FR-02 _fire AbortError 不重启。
  it("T4: _fire AbortError 不重启（FR-02）", async () => {
    vi.useFakeTimers();
    const { daemon } = build({ config: { loop_restart_backoff_ms: 100 } });
    track(daemon);
    const d = daemon as unknown as {
      _running: boolean;
      _fire(loop: (signal: AbortSignal) => Promise<void>): void;
    };
    d._running = true;

    let callCount = 0;
    const loop = async (): Promise<void> => {
      callCount++;
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    };
    d._fire(loop);
    await flush();
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(callCount).toBe(1); // AbortError 不重启
  });

  // T5: FR-02 stop 后不重启 —— _running=false 时 loop 崩不复活。
  it("T5: stop 后 loop 崩不重启（FR-02）", async () => {
    const { daemon } = build({ config: { loop_restart_backoff_ms: 100 } });
    track(daemon);
    const d = daemon as unknown as {
      _running: boolean;
      _fire(loop: (signal: AbortSignal) => Promise<void>): void;
    };
    d._running = false; // 模拟已 stop

    let callCount = 0;
    const loop = async (): Promise<void> => {
      callCount++;
      throw new Error("net crash");
    };
    d._fire(loop);
    await flush();
    await flush();
    expect(callCount).toBe(1); // _running=false → catch 内 return，不重启
  });

  // T6: FR-03 断连计数 —— 超阈值记一次 FATAL，持续不风暴，恢复后可再告警。
  it("T6: 断连超阈值记 daemon_disconnect_degraded 一次，持续不风暴，恢复清零（FR-03）", async () => {
    const client = makeClient({
      heartbeat: vi.fn(async () => Promise.reject(new Error("net down"))),
    });
    const { daemon } = build({
      client,
      config: { heartbeat_interval: 0.05, disconnect_log_threshold_sec: 1 },
    });
    track(daemon);
    const cap = captureConsole();
    await daemon.start();

    // 首次失败 + 累计超 1s 阈值 → FATAL 一次
    await sleep(1300);
    expect(cap.filter("daemon_disconnect_degraded").length).toBe(1);

    // 持续断连至 ~2.5s，仍 1 次（_degradedWarned 防风暴）
    await sleep(1200);
    expect(cap.filter("daemon_disconnect_degraded").length).toBe(1);

    // 恢复：heartbeat 成功 → 清零 + 清 warned
    client.heartbeat.mockResolvedValue({});
    await sleep(150);

    // 再次失败 → 可重新告警
    client.heartbeat.mockRejectedValue(new Error("net down again"));
    await sleep(1300);
    expect(cap.filter("daemon_disconnect_degraded").length).toBe(2);

    await daemon.stop();
    cap.restore();
  }, 20000);
});
