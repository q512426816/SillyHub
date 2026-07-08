/**
 * MachineCard 单测（task-10 / FR-4 / D-006 / D-003）。
 *
 * 覆盖：
 *   1. 默认折叠（expanded=false）→ 展开体不渲染 RuntimeCard 网格。
 *   2. expanded prop 受控（外部切 true/false 反映 aria-expanded + 展开体显隐）。
 *   3. 点折叠头 / chevron → onToggleExpand 被调（受控组件，不在此校验内部记忆）。
 *   4. 聚合费用胶囊 = sum(该机器 runtimes 在 usageByRuntime 的 total_cost_usd)；无用量 $0.00。
 *   5. runtime 数胶囊显示 `online_runtime_count / runtime_count` + "runtime"。
 *   6. 0-runtime 机器（runtimes=[]）展开体显空态文案「该机器暂无运行时」。
 *   7. 离线机器（status=offline）升级按钮 disabled，点击不触发 onUpgrade。
 *
 * 模式：照搬 page.test.tsx 的 QueryClientProvider 包裹（MachineCard 透传 RuntimeCard，
 * RuntimeCard 用 RuntimeUsageLineChart 走 dynamic import 链，包 QueryClientProvider 稳妥）。
 * 隔离：mock RuntimeCard 为 data-testid="runtime-card-mock-{id}" 桩，避免拉入图表副作用。
 *
 * 查询约定：MachineCard 折叠头是 <header role="button" aria-expanded>，别名/升级是 <button>，
 * getByRole("button") 会命中多个 → 用 container.querySelector('header[role="button"]') 精确定位。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 桩 RuntimeCard：避免拉入 echarts dynamic 依赖，仅断言在位 + 透传 runtime.id。
vi.mock("@/components/daemon/runtime-card", () => ({
  RuntimeCard: (props: { runtime: { id: string } }) => (
    <div data-testid={`runtime-card-mock-${props.runtime.id}`} />
  ),
}));

import { MachineCard } from "@/components/daemon/machine-card";
import type {
  DaemonMachineRead,
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

function makeMachine(overrides: Record<string, unknown> = {}): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "host-1",
    display_alias: null,
    os: "linux",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-07-07T10:00:00Z",
    version: "1.4.2",
    build_id: "a1b2c3d9e8f7",
    created_at: "2026-07-07T09:00:00Z",
    owner: null,
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime()],
    ...overrides,
  } as unknown as DaemonMachineRead;
}

function usageItem(runtimeId: string, totalCostUsd: number): RuntimeUsageItem {
  return {
    runtime_id: runtimeId,
    summary: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: totalCostUsd,
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

/** MachineCard 必填 props 默认值（每测试按需覆盖）。 */
function defaultProps(
  machine: DaemonMachineRead,
  overrides: Record<string, unknown> = {},
) {
  return {
    machine,
    expanded: false,
    onToggleExpand: vi.fn(),
    usageByRuntime: new Map<string, RuntimeUsageItem>(),
    usageWindow: "7d" as const,
    actioning: false,
    sessions: [],
    isPlatformAdmin: false,
    onEditAlias: vi.fn(),
    onUpgrade: vi.fn(),
    onRuntimeToggle: vi.fn(),
    onRuntimeOpenSession: vi.fn(),
    onRuntimeDelete: vi.fn(),
    onRuntimeEditAlias: vi.fn(),
    onRuntimeEditRoots: vi.fn(),
    ...overrides,
  };
}

/** 定位折叠头（<header role="button">，与别名/升级 <button> 区分）。 */
function getCollapsibleHeader(container: HTMLElement) {
  const header = container.querySelector('header[role="button"]');
  if (!header) throw new Error("折叠头 header[role=button] 未找到");
  return header as HTMLElement;
}

/** 从 role=button 候选中筛出真正的 <button> 元素（排除折叠头 <header role="button">）。
 *  MachineCard 升级/别名按钮嵌在折叠头 header 内，header 的 accessible name 含「升级 daemon」
 *  文本，导致 getByRole("button", {name}) 命中多个（header + 真按钮）。按 tagName 过滤。 */
function findNativeButtonByName(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name }).filter(
    (el) => el.tagName === "BUTTON",
  );
  if (matches.length === 0) {
    throw new Error(`未找到 <button> name=${name}`);
  }
  return matches[0]!;
}

/** 聚合费用胶囊 span（蓝色，class 含 border-blue-100）。返回其 textContent。 */
function getCostBadgeText(container: HTMLElement): string {
  const badge = container.querySelector("span.border-blue-100");
  if (!badge) throw new Error("聚合费用胶囊 span.border-blue-100 未找到");
  return badge.textContent ?? "";
}

describe("MachineCard（task-08 / FR-4）", () => {
  it("默认折叠（expanded=false）→ 展开体不渲染 RuntimeCard 网格", () => {
    const { container } = renderCard(<MachineCard {...defaultProps(makeMachine())} />);
    const header = getCollapsibleHeader(container);
    expect(header).toHaveAttribute("aria-expanded", "false");
    // 展开体不渲染 RuntimeCard（mock 桩不在）
    expect(screen.queryByTestId("runtime-card-mock-rt-1")).not.toBeInTheDocument();
  });

  it("expanded prop 受控（true → aria-expanded=true + 展开体渲染 RuntimeCard 网格）", () => {
    const { container } = renderCard(
      <MachineCard {...defaultProps(makeMachine(), { expanded: true })} />,
    );
    const header = getCollapsibleHeader(container);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("runtime-card-mock-rt-1")).toBeInTheDocument();
  });

  it("点折叠头 → onToggleExpand 被调（受控组件，不内部记忆 expanded）", () => {
    const onToggleExpand = vi.fn();
    const { container } = renderCard(
      <MachineCard {...defaultProps(makeMachine(), { onToggleExpand })} />,
    );
    fireEvent.click(getCollapsibleHeader(container));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("聚合费用胶囊 = sum(该机器 runtimes total_cost_usd)；7d 窗显示「7天费用 $xx.xx」", () => {
    const machine = makeMachine({
      runtimes: [makeRuntime({ id: "rt-a" }), makeRuntime({ id: "rt-b" })],
      runtime_count: 2,
      online_runtime_count: 2,
    });
    const usageByRuntime = new Map<string, RuntimeUsageItem>([
      ["rt-a", usageItem("rt-a", 12.34)],
      ["rt-b", usageItem("rt-b", 7.66)],
    ]);
    const { container } = renderCard(
      <MachineCard {...defaultProps(machine, { usageByRuntime, usageWindow: "7d" })} />,
    );
    // sum = 12.34 + 7.66 = 20.00；胶囊整体文本「7天费用 $20.00」（含中间空格）。
    const badgeText = getCostBadgeText(container);
    expect(badgeText).toMatch(/7天费用/);
    expect(badgeText).toMatch(/\$20\.00/);
  });

  it("无用量 → 聚合费用胶囊显示 $0.00", () => {
    const { container } = renderCard(
      <MachineCard {...defaultProps(makeMachine(), { usageWindow: "7d" })} />,
    );
    expect(getCostBadgeText(container)).toMatch(/\$0\.00/);
  });

  it('runtime 数胶囊显示 `online/total` + "runtime"', () => {
    const machine = makeMachine({
      runtimes: [makeRuntime({ id: "a" }), makeRuntime({ id: "b", status: "offline" })],
      runtime_count: 2,
      online_runtime_count: 1,
    });
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    // runtime 数胶囊是 bg-muted span（与费用蓝色胶囊区分）。限定到该胶囊断言文本。
    const badge = container.querySelector("span.bg-muted");
    expect(badge).not.toBeNull();
    const text = badge!.textContent ?? "";
    // 在线 1 / 总数 2 runtime（节点分开，但胶囊 textContent 含全部）。
    expect(text).toMatch(/1/); // online
    expect(text).toMatch(/2/); // total
    expect(text).toMatch(/runtime/);
  });

  it("0-runtime 机器（runtimes=[]）展开体显空态文案「该机器暂无运行时」", () => {
    const machine = makeMachine({ runtimes: [], runtime_count: 0, online_runtime_count: 0 });
    renderCard(<MachineCard {...defaultProps(machine, { expanded: true })} />);
    expect(screen.getByText("该机器暂无运行时")).toBeInTheDocument();
    // 空态下不渲染 RuntimeCard 桩
    expect(screen.queryByTestId(/runtime-card-mock/)).not.toBeInTheDocument();
  });

  it("离线机器（status=offline）升级按钮 disabled，点击不触发 onUpgrade", () => {
    const onUpgrade = vi.fn();
    const machine = makeMachine({ status: "offline" });
    renderCard(<MachineCard {...defaultProps(machine, { onUpgrade })} />);
    // 升级按钮文本「升级 daemon」嵌在折叠头 header 内，header accessible name 也含该串，
    // 故 role=button 会命中多个（header + 真按钮）。用 findNativeButtonByName 筛 <button>。
    const upgradeBtn = findNativeButtonByName(/升级 daemon/);
    expect(upgradeBtn).toBeDisabled();
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("在线机器点升级按钮 → onUpgrade 被调（stopPropagation 不冒泡折叠头）", () => {
    const onUpgrade = vi.fn();
    const machine = makeMachine({ status: "online" });
    renderCard(<MachineCard {...defaultProps(machine, { onUpgrade })} />);
    const upgradeBtn = findNativeButtonByName(/升级 daemon/);
    expect(upgradeBtn).not.toBeDisabled();
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).toHaveBeenCalledWith(machine);
  });
});
