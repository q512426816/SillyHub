/**
 * MachineCard sillyspec 徽标/按钮/横幅单测（2026-08-31-machine-sillyspec-version
 * task-07 / FR-01~FR-03）。
 *
 * 覆盖：
 *   1. 徽标三形态（原型①②⑦）：已最新 → 常色仅版本号；落后 → warning 色阶
 *      「当前 → 最新」+「有新版本」小标签；未安装（null/缺省含旧后端）→
 *      destructive「sillyspec 未安装」。latest 未知不比较按常色；本机高于
 *      latest 不算落后；semver 不等长（3.27 < 3.27.1）判落后。
 *   2. 「升级 sillyspec」按钮五态：默认可用点击触发 onUpgradeSillySpec；
 *      离线 / sillyspec_update running / deferred / 本地 upgradingSillySpec
 *      禁用（title 说明原因）；未安装文案「安装 sillyspec」；failed 文案
 *      「重试升级」；落后时 warning 高亮；缺省 onUpgradeSillySpec 渲染不崩。
 *   3. sillyspec_update 横幅四态（data-machine-sillyspec-banner 定位，不复用
 *      pending 槽位）：running=info「正在升级 sillyspec（from → to）」/
 *      deferred=warning（每 30s 复查）/ success=success「已升级到 to」/
 *      failed=destructive「升级失败：error」；与 pending_update 横幅独立共存。
 *   4. sillyspec_update=null / 缺省（旧后端按 undefined 消费）→ 不渲染横幅。
 *
 * 模式：照搬 machine-card-pending.test.tsx——mock RuntimeCard 为 data-testid 桩
 * （避免 echarts dynamic 副作用），QueryClientProvider 包裹，<button> 按 tagName
 * 过滤定位（折叠头 <header role="button"> 的 accessible name 也含按钮文本）。
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

/** sillyspec_update 载荷类型（api-types 生成版 MachineSillySpecUpdateRead，经
 *  DaemonMachineRead.sillyspec_update 派生，不手写 DTO）。 */
type SillySpecUpdate = NonNullable<DaemonMachineRead["sillyspec_update"]>;

function makeRuntime(overrides: Record<string, unknown> = {}): DaemonRuntimeRead {
  return {
    id: "rt-1",
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    status: "online",
    last_heartbeat_at: "2026-08-31T10:00:00Z",
    capabilities: { protocol: "ws", agents: ["claude"] },
    allowed_roots: [],
    created_at: "2026-08-31T09:00:00Z",
    updated_at: "2026-08-31T10:00:00Z",
    ...overrides,
  } as unknown as DaemonRuntimeRead;
}

/** 默认已安装且已最新（场景①：sillyspec 3.27.11，latest 3.27.11）。 */
function makeMachine(overrides: Record<string, unknown> = {}): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "host-1",
    display_alias: null,
    os: "linux",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-31T10:00:00Z",
    version: "0.4.1",
    build_id: "a1b2c3d9e8f7",
    created_at: "2026-08-31T09:00:00Z",
    owner: null,
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime()],
    sillyspec_version: "3.27.11",
    sillyspec_latest_version: "3.27.11",
    sillyspec_update: null,
    ...overrides,
  } as unknown as DaemonMachineRead;
}

/** sillyspec_update 载荷（六字段全 nullable；默认 running 快照，按需覆盖）。 */
function makeSillySpecUpdate(
  overrides: Partial<SillySpecUpdate> = {},
): SillySpecUpdate {
  return {
    state: "running",
    trigger: "server_command",
    from_version: "3.26.15",
    to_version: "3.27.11",
    error: null,
    since: "2026-08-31T10:00:00Z",
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

/** 按钮嵌在折叠头 <header role="button"> 内，header 的 accessible name 也含
 *  按钮文本 → 按 tagName=BUTTON 过滤出真按钮（照搬 pending 测试同款）。 */
function findNativeButtonByName(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name }).filter(
    (el) => el.tagName === "BUTTON",
  );
  if (matches.length === 0) {
    throw new Error(`未找到 <button> name=${name}`);
  }
  return matches[0]!;
}

/** sillyspec 版本徽标定位（data-machine-sillyspec-badge=ok|outdated|none）。 */
function getSillySpecBadge(container: HTMLElement, form?: string) {
  return container.querySelector(
    form
      ? `[data-machine-sillyspec-badge="${form}"]`
      : "[data-machine-sillyspec-badge]",
  );
}

/** sillyspec_update 横幅定位（data-machine-sillyspec-banner=state）。 */
function getSillySpecBanner(container: HTMLElement, state?: string) {
  return container.querySelector(
    state
      ? `[data-machine-sillyspec-banner="${state}"]`
      : "[data-machine-sillyspec-banner]",
  );
}

describe("MachineCard sillyspec 版本徽标三形态（task-07 / FR-01）", () => {
  it("已最新 → 常色徽标仅显示本机版本，无箭头无「有新版本」", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.27.11",
            sillyspec_latest_version: "3.27.11",
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "ok");
    expect(badge).not.toBeNull();
    const text = badge!.textContent ?? "";
    expect(text).toContain("sillyspec 3.27.11");
    expect(text).not.toContain("有新版本");
    expect(text).not.toContain("→");
    // 常色：不带 warning/destructive 语义色阶。
    const cls = badge!.className;
    expect(cls).not.toContain("text-warning");
    expect(cls).not.toContain("text-destructive");
  });

  it("落后 → warning 色阶「当前 → 最新」+「有新版本」小标签（原型②）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_latest_version: "3.27.11",
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "outdated");
    expect(badge).not.toBeNull();
    const cls = badge!.className;
    expect(cls).toContain("text-warning");
    const text = badge!.textContent ?? "";
    expect(text).toContain("sillyspec 3.26.15");
    expect(text).toContain("→");
    expect(text).toContain("3.27.11");
    expect(text).toContain("有新版本");
  });

  it("未安装（sillyspec_version=null）→ destructive「sillyspec 未安装」（原型⑦）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: null,
            sillyspec_latest_version: "3.27.11",
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "none");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("text-destructive");
    expect(badge!.textContent).toContain("sillyspec 未安装");
  });

  it("字段缺省（旧后端 undefined）→ 同未安装红色徽标消费（零回归）", () => {
    const machine = makeMachine();
    delete (machine as Partial<DaemonMachineRead>).sillyspec_version;
    delete (machine as Partial<DaemonMachineRead>).sillyspec_latest_version;
    delete (machine as Partial<DaemonMachineRead>).sillyspec_update;
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    expect(getSillySpecBadge(container, "none")).not.toBeNull();
  });

  it("latest 未知（null）→ 无法比较按常色仅显示本机版本", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_latest_version: null,
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "ok");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("sillyspec 3.26.15");
    expect(badge!.textContent).not.toContain("3.27.11");
    expect(badge!.className).not.toContain("text-warning");
  });

  it("本机版本高于 latest → 不算落后按常色", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.28.0",
            sillyspec_latest_version: "3.27.11",
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "ok");
    expect(badge).not.toBeNull();
    expect(badge!.className).not.toContain("text-warning");
  });

  it("semver 不等长：3.27 < 3.27.1 判落后（缺省段按 0）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.27",
            sillyspec_latest_version: "3.27.1",
          }),
        )}
      />,
    );
    const badge = getSillySpecBadge(container, "outdated");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("3.27.1");
  });
});

describe("MachineCard「升级 sillyspec」按钮五态（task-07 / FR-02）", () => {
  // ql-20260902-003：已最新（默认场景）→ 禁用换「已是最新」，免下发后 daemon
  // 侧版本门静默 no-op 产生困惑；落后才是可点的升级入口。
  it("已最新（默认 3.27.11 == latest）→ 禁用，文案「已是最新」，title 带版本，点击不触发", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard {...defaultProps(makeMachine(), { onUpgradeSillySpec })} />,
    );
    const btn = findNativeButtonByName(/已是最新/);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "已是最新 3.27.11");
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).not.toHaveBeenCalled();
  });

  it("落后（3.26.15 < 3.27.11）→ 可用，文案「升级 sillyspec」，点击触发 onUpgradeSillySpec", () => {
    const onUpgradeSillySpec = vi.fn();
    const machine = makeMachine({ sillyspec_version: "3.26.15" });
    renderCard(
      <MachineCard {...defaultProps(machine, { onUpgradeSillySpec })} />,
    );
    const btn = findNativeButtonByName(/升级 sillyspec/);
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).toHaveBeenCalledWith(machine);
  });

  it("离线 → 禁用 + title 离线说明，点击不触发（原型⑧）", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({ status: "offline" }),
          { onUpgradeSillySpec },
        )}
      />,
    );
    // ql-20260902-003：默认机器已最新，文案为「已是最新」（disabled 原因仍是离线，title 离线说明优先）。
    const btn = findNativeButtonByName(/已是最新/);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "离线，无法升级；下次启动时会自动升级");
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).not.toHaveBeenCalled();
  });

  it("sillyspec_update.state=running → 禁用，文案「升级中…」，title「升级中…」（原型③）", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({ state: "running" }),
          }),
          { onUpgradeSillySpec },
        )}
      />,
    );
    const btn = findNativeButtonByName(/升级中…/);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "升级中…");
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).not.toHaveBeenCalled();
  });

  it("sillyspec_update.state=deferred → 禁用，文案「等待空闲」，title「等待空闲执行」（原型④）", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({ state: "deferred" }),
          }),
          { onUpgradeSillySpec },
        )}
      />,
    );
    const btn = findNativeButtonByName(/等待空闲/);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "等待空闲执行");
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).not.toHaveBeenCalled();
  });

  it("本地 upgradingSillySpec=true → 即时禁用（POST 窗口兜底，15s 轮询接管前）", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard
        {...defaultProps(makeMachine(), {
          onUpgradeSillySpec,
          upgradingSillySpec: true,
        })}
      />,
    );
    const btn = findNativeButtonByName(/升级中…/);
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).not.toHaveBeenCalled();
  });

  it("未安装 → 文案「安装 sillyspec」，可用点击触发（原型⑦）", () => {
    const onUpgradeSillySpec = vi.fn();
    const machine = makeMachine({ sillyspec_version: null });
    renderCard(
      <MachineCard {...defaultProps(machine, { onUpgradeSillySpec })} />,
    );
    const btn = findNativeButtonByName(/安装 sillyspec/);
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("title", "远程安装最新版 sillyspec");
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).toHaveBeenCalledWith(machine);
  });

  it("sillyspec_update.state=failed → 文案「重试升级」，可用（原型⑥）", () => {
    const onUpgradeSillySpec = vi.fn();
    renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({
              state: "failed",
              error: "npm install 退出码 1（network timeout）",
            }),
          }),
          { onUpgradeSillySpec },
        )}
      />,
    );
    const btn = findNativeButtonByName(/重试升级/);
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onUpgradeSillySpec).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m-1" }),
    );
  });

  it("落后时按钮 warning 高亮（border-warning / text-warning）", () => {
    renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_latest_version: "3.27.11",
          }),
        )}
      />,
    );
    const btn = findNativeButtonByName(/升级 sillyspec/);
    const cls = btn.className;
    expect(cls).toContain("border-warning");
    expect(cls).toContain("text-warning");
  });

  it("已最新且空闲 → 按钮回 btnOutlineTiny 底色（不带 warning 高亮，原型①注）", () => {
    renderCard(<MachineCard {...defaultProps(makeMachine())} />);
    // ql-20260902-003：已最新换文案「已是最新」（禁用态仍走底色样式）。
    const btn = findNativeButtonByName(/已是最新/);
    expect(btn.className).not.toContain("warning");
  });

  it("onUpgradeSillySpec 缺省（可选 props）→ 按钮仍渲染，点击不崩", () => {
    renderCard(<MachineCard {...defaultProps(makeMachine())} />);
    const btn = findNativeButtonByName(/已是最新/);
    expect(btn).toBeInTheDocument();
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});

describe("MachineCard sillyspec_update 横幅四态（task-07 / FR-03）", () => {
  it("running → info 色阶旋转横幅「正在升级 sillyspec（from → to）」（原型③）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({ state: "running" }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "running");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "status");
    const cls = banner!.className;
    expect(cls).toContain("border-info/30");
    expect(cls).toContain("bg-info/10");
    expect(cls).toContain("text-info");
    const text = banner!.textContent ?? "";
    expect(text).toContain("正在升级 sillyspec（3.26.15 → 3.27.11）");
    expect(text).toContain("npm install -g sillyspec@latest");
  });

  it("running 无 to_version → 兜底「latest」不渲染 undefined（六字段全 nullable）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_update: makeSillySpecUpdate({
              state: "running",
              to_version: null,
            }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "running");
    expect(banner).not.toBeNull();
    const text = banner!.textContent ?? "";
    expect(text).toContain("3.26.15 → latest");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("deferred → warning 色阶「等待空闲自动执行（每 30s 复查）」+ 版本副行（原型④）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({ state: "deferred" }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "deferred");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "status");
    const cls = banner!.className;
    expect(cls).toContain("border-warning/30");
    expect(cls).toContain("bg-warning/10");
    expect(cls).toContain("text-warning");
    const text = banner!.textContent ?? "";
    expect(text).toContain("升级已排队等待空闲自动执行（每 30s 复查）");
    expect(text).toContain("新版本 3.27.11 已就绪（当前 3.26.15）");
  });

  it("success → success 色阶「sillyspec 已升级到 to」+ 副行 since 完成时刻（原型⑤）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_update: makeSillySpecUpdate({ state: "success" }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "success");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "status");
    const cls = banner!.className;
    expect(cls).toContain("border-success/30");
    expect(cls).toContain("bg-success/10");
    expect(cls).toContain("text-success");
    const text = banner!.textContent ?? "";
    expect(text).toContain("sillyspec 已升级到 3.27.11");
    // QA 返工（原型⑤）：since（默认 2026-08-31T10:00:00Z）渲染「升级完成于
    // HH:mm:ss；」——时区无关，按时刻形态断言（zh-CN hour12:false）。
    expect(text).toMatch(/升级完成于 \d{1,2}:\d{2}:\d{2}；/);
    expect(text).toContain("横幅展示 10 分钟后自动消失，版本徽标常驻");
  });

  it("success since=null → 副行不渲染「升级完成于」句（六字段全 nullable 兜底）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_update: makeSillySpecUpdate({ state: "success", since: null }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "success");
    expect(banner).not.toBeNull();
    const text = banner!.textContent ?? "";
    expect(text).toContain("sillyspec 已升级到 3.27.11");
    expect(text).not.toContain("升级完成于");
    expect(text).toContain("横幅展示 10 分钟后自动消失，版本徽标常驻");
  });

  it("failed → destructive 色阶「sillyspec 升级失败：error」（原型⑥）", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_version: "3.26.15",
            sillyspec_update: makeSillySpecUpdate({
              state: "failed",
              error: "npm install 退出码 1（network timeout）",
            }),
          }),
        )}
      />,
    );
    const banner = getSillySpecBanner(container, "failed");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "status");
    const cls = banner!.className;
    expect(cls).toContain("border-destructive/30");
    expect(cls).toContain("bg-destructive/10");
    expect(cls).toContain("text-destructive");
    const text = banner!.textContent ?? "";
    expect(text).toContain("sillyspec 升级失败：npm install 退出码 1（network timeout）");
    expect(text).toContain("重试升级");
  });

  it("sillyspec_update=null → 不渲染横幅", () => {
    const { container } = renderCard(
      <MachineCard {...defaultProps(makeMachine({ sillyspec_update: null }))} />,
    );
    expect(getSillySpecBanner(container)).toBeNull();
  });

  it("未知 state（宁宽勿断的心跳通道）→ 四态之外不渲染横幅", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_update: makeSillySpecUpdate({ state: "weird_state" }),
          }),
        )}
      />,
    );
    expect(getSillySpecBanner(container)).toBeNull();
  });

  it("与 pending_update 横幅独立共存（各自 data 属性槽位，不互相覆盖）", () => {
    const machine = makeMachine({
      pending_update: {
        reason: "server_command",
        current_version: "0.4.1",
        target_version: "0.4.2",
        since: "2026-08-31T10:00:00Z",
      } as MachinePendingUpdate,
      sillyspec_update: makeSillySpecUpdate({ state: "running" }),
    });
    const { container } = renderCard(<MachineCard {...defaultProps(machine)} />);
    expect(
      container.querySelector('[data-machine-pending-banner="server_command"]'),
    ).not.toBeNull();
    expect(getSillySpecBanner(container, "running")).not.toBeNull();
  });

  it("折叠态（expanded=false）也渲染横幅——running 期按钮禁用的原因需始终可见", () => {
    const { container } = renderCard(
      <MachineCard
        {...defaultProps(
          makeMachine({
            sillyspec_update: makeSillySpecUpdate({ state: "running" }),
          }),
          { expanded: false },
        )}
      />,
    );
    expect(screen.queryByTestId("runtime-card-mock-rt-1")).not.toBeInTheDocument();
    expect(getSillySpecBanner(container, "running")).not.toBeNull();
  });
});
