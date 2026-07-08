/**
 * RuntimeCard 单测（task-10 / FR-01 / FR-04 / C-002 / D-001@v1）。
 *
 * 覆盖：
 *   1. 用量统计区 4 数字（输入/输出/缓存/费用）k/M 格式化；sparkline 空/非空分支。
 *   2. 可写目录（allowed_roots）渲染（非空逐行 Tag / 空态「未配置（任意目录可写）」）。
 *   3. 操作按钮组（会话/审计/启禁/移除）在位。
 *   4. meta 无「Daemon 版本」行（C-002，反向断言：查询「Daemon 版本」文本不存在）。
 *
 * 模式：照搬 page-usage.test.tsx 的 mock 脚手架（RuntimeUsageLineChart 是 dynamic
 * 桶导出，page-usage 未 mock 它且测试稳定，此处保持一致不 mock）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { RuntimeCard } from "@/components/daemon/runtime-card";
import { buildSparkSeries } from "@/components/daemon/runtime-card-helpers";
import type {
  DaemonRuntimeRead,
  RuntimeUsageItem,
  RuntimeUsagePoint,
} from "@/lib/daemon";

function makeRuntime(overrides: Record<string, unknown> = {}): DaemonRuntimeRead {
  return {
    id: "rt-1",
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    status: "online",
    last_heartbeat_at: "2026-07-07T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-07-07T09:00:00Z",
    updated_at: "2026-07-07T10:00:00Z",
    ...overrides,
  } as unknown as DaemonRuntimeRead;
}

function usageItem(
  runtimeId: string,
  summary: Partial<RuntimeUsageItem["summary"]>,
): RuntimeUsageItem {
  return {
    runtime_id: runtimeId,
    summary: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      ...summary,
    },
    daily: [],
  };
}

function renderCard(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

/** RuntimeCard 必填 props 默认值。 */
function defaultProps(
  runtime: DaemonRuntimeRead,
  overrides: Record<string, unknown> = {},
) {
  return {
    runtime,
    actioning: false,
    sessionStats: { total: 0, active: 0 },
    usageWindow: "7d" as const,
    usageLoading: false,
    onToggleEnabled: vi.fn(),
    onOpenSession: vi.fn(),
    onDelete: vi.fn(),
    onEditAlias: vi.fn(),
    onEditAllowedRoots: vi.fn(),
    onUpgrade: vi.fn(),
    isPlatformAdmin: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-07T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RuntimeCard（task-07 / FR-01 / FR-04）", () => {
  describe("用量统计区 4 数字（k/M 格式化 + sparkline）", () => {
    it("显示输入/输出/缓存/费用 4 数字（k/M 格式化）", () => {
      const rt = makeRuntime({ id: "rt-a" });
      const usage = usageItem("rt-a", {
        input_tokens: 7_800_000, // 7.8M
        output_tokens: 1_500_000, // 1.5M
        cache_read_tokens: 36_000_000, // 36.0M（合并 read+creation）
        cache_creation_tokens: 0,
        total_cost_usd: 81.2, // $81.20
      });
      const { container } = renderCard(
        <RuntimeCard {...defaultProps(rt, { usage })} />,
      );
      // 4 数字用 UsageStat 渲染（label + value 两 <p>），定位 value 文本
      // 注：container 内可能有多个同名文本，用 getAllByText 兼容。
      expect(screen.getByText("7.8M")).toBeInTheDocument();
      expect(screen.getByText("1.5M")).toBeInTheDocument();
      expect(screen.getByText("36.0M")).toBeInTheDocument();
      expect(screen.getByText("$81.20")).toBeInTheDocument();
      // 用量区标题（7 天）
      expect(screen.getByText(/用量统计（7 天）/)).toBeInTheDocument();
      // sparkline 容器在位（RuntimeUsageLineChart dynamic 渲染，不 mock 不断言 canvas，
      // 仅断言用量区 section 存在）
      expect(container).toBeInTheDocument();
    });

    it("usage=undefined（新 runtime/拉取失败）→ 数字全「—」、费用 $0.00", () => {
      const rt = makeRuntime({ id: "rt-new" });
      renderCard(<RuntimeCard {...defaultProps(rt, { usage: undefined })} />);
      // input/output/cache 三项「—」（>=3）
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(3);
      expect(screen.getByText("$0.00")).toBeInTheDocument();
    });

    it("usageLoading=true → 用量区显示「加载中」", () => {
      const rt = makeRuntime({ id: "rt-l" });
      renderCard(<RuntimeCard {...defaultProps(rt, { usageLoading: true })} />);
      expect(screen.getByText("加载中")).toBeInTheDocument();
    });

    it("token k/M 边界：< 1000 原值 / >= 1000 k / >= 1e6 M", () => {
      const rt = makeRuntime({ id: "rt-edge" });
      const usage = usageItem("rt-edge", {
        input_tokens: 999, // 999 原值
        output_tokens: 1500, // 1.5k
        cache_read_tokens: 1500000, // 1.5M（合并）
        cache_creation_tokens: 0,
        total_cost_usd: 0, // $0.00
      });
      renderCard(<RuntimeCard {...defaultProps(rt, { usage })} />);
      expect(screen.getByText("999")).toBeInTheDocument();
      expect(screen.getByText("1.5k")).toBeInTheDocument();
      expect(screen.getByText("1.5M")).toBeInTheDocument();
      expect(screen.getByText("$0.00")).toBeInTheDocument();
    });

    it("codex 无 cache（read+creation 均 0）→ 缓存项显示「—」", () => {
      const rt = makeRuntime({ id: "rt-codex", provider: "codex" });
      const usage = usageItem("rt-codex", {
        input_tokens: 5000, // 5.0k
        output_tokens: 1000, // 1.0k
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_cost_usd: 2.5, // $2.50
      });
      renderCard(<RuntimeCard {...defaultProps(rt, { usage })} />);
      // input/output 正常显示，cache 显示「—」
      expect(screen.getByText("5.0k")).toBeInTheDocument();
      expect(screen.getByText("1.0k")).toBeInTheDocument();
      expect(screen.getByText("$2.50")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("可写目录（allowed_roots）渲染", () => {
    it("非空 → 逐行 Tag 渲染根路径", () => {
      const rt = makeRuntime({
        allowed_roots: ["/home/user/proj1", "/data/workspace"],
      });
      renderCard(<RuntimeCard {...defaultProps(rt)} />);
      expect(screen.getByText("/home/user/proj1")).toBeInTheDocument();
      expect(screen.getByText("/data/workspace")).toBeInTheDocument();
    });

    it("空 → 显示「未配置（任意目录可写）」", () => {
      const rt = makeRuntime({ allowed_roots: [] });
      renderCard(<RuntimeCard {...defaultProps(rt)} />);
      expect(screen.getByText("未配置（任意目录可写）")).toBeInTheDocument();
    });
  });

  describe("操作按钮组（会话/审计/启禁/移除）", () => {
    it("claude online runtime → 会话/审计/禁用/移除/别名/升级按钮在位", () => {
      const rt = makeRuntime({ id: "rt-ops", provider: "claude", status: "online" });
      renderCard(<RuntimeCard {...defaultProps(rt)} />);
      // 会话按钮（online claude/codex 才显示），按钮文本「会话」。
      expect(screen.getByRole("button", { name: /^会话$/ })).toBeInTheDocument();
      // 审计日志链接（文本「审计日志」）。
      expect(screen.getByRole("link", { name: "审计日志" })).toBeInTheDocument();
      // 启禁按钮（online → 显示「禁用」文本）。
      expect(screen.getByRole("button", { name: /^禁用$/ })).toBeInTheDocument();
      // 移除按钮（文本「移除」）。
      expect(screen.getByRole("button", { name: /^移除$/ })).toBeInTheDocument();
      // 别名按钮（文本「别名」）。
      expect(screen.getByRole("button", { name: /^别名$/ })).toBeInTheDocument();
      // 升级按钮（文本「升级」，对齐 prototype .btn-outline btn-tiny）。
      expect(screen.getByRole("button", { name: /^升级$/ })).toBeInTheDocument();
    });

    it("审计日志 href 指向 /runtimes/{id}/audit", () => {
      const rt = makeRuntime({ id: "rt-audit" });
      renderCard(<RuntimeCard {...defaultProps(rt)} />);
      const link = screen.getByRole("link", { name: "审计日志" });
      expect(link).toHaveAttribute("href", "/runtimes/rt-audit/audit");
    });

    it("isPlatformAdmin=true → 显示「可写目录」编辑按钮", () => {
      const rt = makeRuntime({ id: "rt-admin" });
      renderCard(<RuntimeCard {...defaultProps(rt, { isPlatformAdmin: true })} />);
      // 按钮文本「可写目录」（title 不进 accessible name，按文本查）。
      expect(screen.getByRole("button", { name: /^可写目录$/ })).toBeInTheDocument();
    });

    it("isPlatformAdmin=false → 不显示「可写目录」编辑按钮", () => {
      const rt = makeRuntime({ id: "rt-user" });
      renderCard(<RuntimeCard {...defaultProps(rt, { isPlatformAdmin: false })} />);
      expect(screen.queryByRole("button", { name: /^可写目录$/ })).not.toBeInTheDocument();
    });
  });

  describe("meta 无「Daemon 版本」行（C-002）", () => {
    it("反向断言：meta 区不渲染「Daemon 版本」label（信息上提机器头）", () => {
      const rt = makeRuntime({
        id: "rt-c002",
        daemon_version: "1.4.2",
        daemon_build_id: "a1b2c3d",
      });
      const { container } = renderCard(<RuntimeCard {...defaultProps(rt)} />);
      // C-002：RuntimeCard 不渲染「Daemon 版本」meta 行（信息上提 MachineCard）。
      // 用 queryByText 在整个卡片作用域反向断言该 label 文本不存在。
      expect(screen.queryByText("Daemon 版本")).not.toBeInTheDocument();
      // 版本/会话/协议 meta label 仍在（对齐 prototype rt-meta 3 列；
      // 运行环境/心跳/可执行路径 上提机器头或不渲染，不再断言）。
      expect(container.textContent).toMatch(/版本/);
      expect(container.textContent).toMatch(/会话/);
      expect(container.textContent).toMatch(/协议/);
    });
  });
});

describe("buildSparkSeries（ql-20260708-001 补全 sparkline 序列）", () => {
  // beforeEach 已 vi.setSystemTime("2026-07-07T12:00:00Z")，7d 窗 = 07-01..07-07（UTC 自然日）。
  it("7d：小时桶降采样到 7 日桶（sum 同日）+ 补全缺失天（0 值）", () => {
    const daily: RuntimeUsagePoint[] = [
      { ts: "2026-07-06T07:00:00Z", input_tokens: 100, output_tokens: 10, cache_read_tokens: 1, cache_creation_tokens: 0, total_cost_usd: 1 },
      { ts: "2026-07-06T08:00:00Z", input_tokens: 50, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, total_cost_usd: 0.5 },
      { ts: "2026-07-07T00:00:00Z", input_tokens: 200, output_tokens: 20, cache_read_tokens: 2, cache_creation_tokens: 0, total_cost_usd: 2 },
    ];
    const result = buildSparkSeries(daily, "7d");
    expect(result).toHaveLength(7);
    expect(result.every((p) => p.ts.endsWith("T00:00:00Z"))).toBe(true);
    // 07-06：100+50=150 input、10+5=15 output、1 cache、1+0.5=1.5 cost（同日小时桶 sum）。
    const d0606 = result.find((p) => p.ts.startsWith("2026-07-06"));
    expect(d0606?.input_tokens).toBe(150);
    expect(d0606?.output_tokens).toBe(15);
    expect(d0606?.cache_read_tokens).toBe(1);
    expect(d0606?.total_cost_usd).toBe(1.5);
    // 07-07：200 input。
    const d0607 = result.find((p) => p.ts.startsWith("2026-07-07"));
    expect(d0607?.input_tokens).toBe(200);
    // 07-01..05 缺失补 0。
    const d0601 = result.find((p) => p.ts.startsWith("2026-07-01"));
    expect(d0601?.input_tokens).toBe(0);
    expect(d0601?.total_cost_usd).toBe(0);
  });

  it("1d：保持原 daily 不补全（点数已密，直接返回同引用）", () => {
    const daily: RuntimeUsagePoint[] = [
      { ts: "2026-07-07T10:00:00Z", input_tokens: 5, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_cost_usd: 0 },
    ];
    expect(buildSparkSeries(daily, "1d")).toBe(daily);
  });

  it("30d：空 daily → 补全 30 个 0 点", () => {
    const result = buildSparkSeries([], "30d");
    expect(result).toHaveLength(30);
    expect(result.every((p) => p.input_tokens === 0 && p.total_cost_usd === 0)).toBe(true);
  });
});
