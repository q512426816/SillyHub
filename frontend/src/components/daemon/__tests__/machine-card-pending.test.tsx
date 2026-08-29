/**
 * MachineCard pending_update 三状态单测（2026-08-29-daemon-selfupdate-safety
 * task-07 / FR-05 / D-003@v2 + D-004@v1）。
 *
 * 覆盖：
 *   1. reason=server_command → warning 横幅：主文案「等待空闲后自动升级（每 30s
 *      复查）」+ 副行版本对比（target / current 均正确渲染）；色阶类名
 *      border-warning/30 bg-warning/10 text-warning，且不带 info 色阶。
 *   2. reason=disk_change → info 横幅：主文案「检测到程序文件已变更，等待空闲
 *      自动加载新版本」+ 副行「来源：磁盘旁路探测——{target_version}」；色阶
 *      类名 border-info/30 bg-info/10 text-info，且不带 warning 色阶。
 *   3. pending 期「升级 daemon」按钮 disabled + title「升级进行中」，点击不触发
 *      onUpgrade（两种 reason 都禁用）。
 *   4. pending_update=null / 缺省（旧后端按 undefined 消费）→ 无横幅；在线非
 *      升级期按钮回到既有可用判定（title「下发 daemon 自更新指令」）。
 *   5. 横幅结构：role=status + data-machine-pending-banner=reason；折叠态
 *      （expanded=false）也渲染（横幅在折叠头之外，禁用按钮的原因需始终可见）。
 *
 * 模式：照搬 machine-card.test.tsx——mock RuntimeCard 为 data-testid 桩（避免
 * echarts dynamic 副作用），QueryClientProvider 包裹，<button> 按 tagName 过滤
 * 定位（折叠头 <header role="button"> 的 accessible name 也含「升级 daemon」）。
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
  MachinePendingUpdate,
  RuntimeUsageItem,
} from "@/lib/daemon";

function makeRuntime(overrides: Record<string, unknown> = {}): DaemonRuntimeRead {
  return {
    id: "rt-1",
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    status: "online",
    last_heartbeat_at: "2026-08-29T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-08-29T09:00:00Z",
    updated_at: "2026-08-29T10:00:00Z",
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
    last_heartbeat_at: "2026-08-29T10:00:00Z",
    version: "0.4.1",
    build_id: "a1b2c3d9e8f7",
    created_at: "2026-08-29T09:00:00Z",
    owner: null,
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime()],
    ...overrides,
  } as unknown as DaemonMachineRead;
}

/** pending_update 载荷（对齐后端 task-06 MachinePendingUpdateRead 蛇形四字段）。 */
function makePending(
  overrides: Partial<MachinePendingUpdate> = {},
): MachinePendingUpdate {
  return {
    reason: "server_command",
    current_version: "0.4.1",
    target_version: "0.4.2",
    since: "2026-08-29T10:00:00Z",
    ...overrides,
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
    onEditAlias: vi.fn(),
    onUpgrade: vi.fn(),
    onCleanup: vi.fn(),
    onDeleteMachine: vi.fn(),
    onRuntimeToggle: vi.fn(),
    onRuntimeOpenSession: vi.fn(),
    onRuntimeDelete: vi.fn(),
    onRuntimeEditAlias: vi.fn(),
    onRuntimeEditRoots: vi.fn(),
    ...overrides,
  };
}

/** MachineCard 升级/别名按钮嵌在折叠头 <header role="button"> 内，header 的
 *  accessible name 也含「升级 daemon」文本 → 按 tagName=BUTTon 过滤出真按钮。 */
function findNativeButtonByName(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name }).filter(
    (el) => el.tagName === "BUTTON",
  );
  if (matches.length === 0) {
    throw new Error(`未找到 <button> name=${name}`);
  }
  return matches[0]!;
}

/** pending 横幅定位（data-machine-pending-banner=reason；不带 reason 匹配任一）。 */
function getPendingBanner(container: HTMLElement, reason?: string) {
  return container.querySelector(
    reason
      ? `[data-machine-pending-banner="${reason}"]`
      : "[data-machine-pending-banner]",
  );
}

describe("MachineCard pending_update 三状态（task-07 / FR-05）", () => {
  it("reason=server_command → warning 横幅：主文案 + 副行版本对比，色阶为主题语义 warning", () => {
    const machine = makeMachine({
      pending_update: makePending({ reason: "server_command" }),
    });
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    const banner = getPendingBanner(container, "server_command");
    expect(banner).not.toBeNull();
    // 结构：role=status（辅助技术可读的异步状态提示）。
    expect(banner).toHaveAttribute("role", "status");
    // 色阶：warning 语义 token 阶（对照原型 .b-warn），不带 info 阶。
    const cls = banner!.className;
    expect(cls).toContain("border-warning/30");
    expect(cls).toContain("bg-warning/10");
    expect(cls).toContain("text-warning");
    expect(cls).not.toContain("info");
    // 文案：主行 + 副行（target 0.4.2 / current 0.4.1 版本对比正确渲染）。
    const text = banner!.textContent ?? "";
    expect(text).toContain("等待空闲后自动升级（每 30s 复查）");
    expect(text).toContain("新版本 0.4.2 已就绪（当前 0.4.1），空闲即自动升级生效");
  });

  it("reason=disk_change → info 横幅：主文案 + 副行来源与目标版本，色阶为主题语义 info", () => {
    const machine = makeMachine({
      pending_update: makePending({
        reason: "disk_change",
        current_version: "c2860ab",
        target_version: "c2871ab",
      }),
    });
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    const banner = getPendingBanner(container, "disk_change");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "status");
    // 色阶：info 语义 token 阶（对照原型 .b-info），不带 warning 阶。
    const cls = banner!.className;
    expect(cls).toContain("border-info/30");
    expect(cls).toContain("bg-info/10");
    expect(cls).toContain("text-info");
    expect(cls).not.toContain("warning");
    // 文案：主行 + 副行（来源——磁盘旁路探测 + 目标版本，无 current 对比行）。
    const text = banner!.textContent ?? "";
    expect(text).toContain("检测到程序文件已变更，等待空闲自动加载新版本");
    expect(text).toContain("来源：磁盘旁路探测——c2871ab");
    expect(text).not.toContain("已就绪");
  });

  it("pending 期「升级 daemon」按钮 disabled + title「升级进行中」，点击不触发 onUpgrade", () => {
    const onUpgrade = vi.fn();
    const machine = makeMachine({
      pending_update: makePending({ reason: "server_command" }),
    });
    renderCard(<MachineCard {...defaultProps(machine, { onUpgrade })} />);
    const upgradeBtn = findNativeButtonByName(/升级 daemon/);
    expect(upgradeBtn).toBeDisabled();
    expect(upgradeBtn).toHaveAttribute("title", "升级进行中");
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("disk_change pending 期同样禁用升级按钮（两种 reason 共用禁用逻辑）", () => {
    const onUpgrade = vi.fn();
    const machine = makeMachine({
      pending_update: makePending({ reason: "disk_change" }),
    });
    renderCard(<MachineCard {...defaultProps(machine, { onUpgrade })} />);
    const upgradeBtn = findNativeButtonByName(/升级 daemon/);
    expect(upgradeBtn).toBeDisabled();
    expect(upgradeBtn).toHaveAttribute("title", "升级进行中");
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("pending_update=null → 无横幅；在线非升级期按钮可用回到既有判定", () => {
    const onUpgrade = vi.fn();
    const machine = makeMachine({ pending_update: null });
    const { container } = renderCard(
      <MachineCard {...defaultProps(machine, { onUpgrade })} />,
    );
    expect(getPendingBanner(container)).toBeNull();
    const upgradeBtn = findNativeButtonByName(/升级 daemon/);
    expect(upgradeBtn).not.toBeDisabled();
    expect(upgradeBtn).toHaveAttribute("title", "下发 daemon 自更新指令");
    fireEvent.click(upgradeBtn);
    expect(onUpgrade).toHaveBeenCalledWith(machine);
  });

  it("pending_update 缺省（旧后端无该字段）→ 无横幅，按钮可用（零回归消费）", () => {
    const machine = makeMachine(); // 不带 pending_update 键 → undefined
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    expect(getPendingBanner(container)).toBeNull();
    expect(findNativeButtonByName(/升级 daemon/)).not.toBeDisabled();
  });

  it("折叠态（expanded=false）也渲染横幅——pending 期禁用按钮的原因需始终可见", () => {
    const machine = makeMachine({
      pending_update: makePending({ reason: "server_command" }),
    });
    const { container } = renderCard(
      <MachineCard {...defaultProps(machine, { expanded: false })} />,
    );
    // 展开体不渲染（RuntimeCard 桩不在）但横幅在。
    expect(screen.queryByTestId("runtime-card-mock-rt-1")).not.toBeInTheDocument();
    expect(getPendingBanner(container, "server_command")).not.toBeNull();
  });

  it("展开态（expanded=true）横幅与展开体共存（横幅位于折叠头与 body 之间）", () => {
    const machine = makeMachine({
      pending_update: makePending({ reason: "disk_change" }),
    });
    const { container } = renderCard(
      <MachineCard {...defaultProps(machine, { expanded: true })} />,
    );
    expect(screen.getByTestId("runtime-card-mock-rt-1")).toBeInTheDocument();
    expect(getPendingBanner(container, "disk_change")).not.toBeNull();
  });
});
