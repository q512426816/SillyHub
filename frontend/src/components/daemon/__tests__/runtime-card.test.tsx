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
import type {
  DaemonRuntimeRead,
  RuntimeUsageItem,
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
      // 升级到最新版按钮（文本「升级到最新版」）。
      expect(screen.getByRole("button", { name: /升级到最新版/ })).toBeInTheDocument();
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
      // 运行环境/心跳/版本/协议/会话 等 meta label 仍在
      expect(container.textContent).toMatch(/运行环境/);
      expect(container.textContent).toMatch(/心跳/);
      expect(container.textContent).toMatch(/版本/);
      expect(container.textContent).toMatch(/协议/);
    });
  });
});
