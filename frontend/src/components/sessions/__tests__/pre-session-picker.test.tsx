// task-04（2026-08-23-sessions-workspace-hub / FR-04 / D-107）：
// PreSessionPicker 两步轻选择浮层单测——全部态「＋」的机器→智能体两步选择。
//
// 覆盖（TaskCard acceptance）：
//   1. 两步流程：第一步仅列在线机器（离线不出现）；第二步仅列该机器
//      provider∈{claude,codex} 且在线的智能体；选完立即 onPick(runtimeId)，
//      无确认按钮；
//   2. 默认 Claude Code 高亮（aria-pressed + 「默认」Tag）；
//   3. 取消 / 遮罩点击关闭不清父层状态（仅 onCancel 回调，onPick 不触发）；
//      受控 open=false 卸载；重开重置回第一步；
//   4. 空态：无在线机器 / 该机器无可用智能体引导文案；
//   5. variant 容器形态（task-13，2026-08-26-mobile-workspace-page / FR-08 / FR-11）：
//      不传 variant 容器类与改前逐字一致（桌面零回归锚）；bottomSheet 贴底抽屉
//      （items-end/满宽/顶圆角/80dvh 滚动/安全区留白）+ 两步流程同构 + 选项行
//      ≥44px 触摸热区抽检（jsdom 不量布局，按 min-h-[44px] 类锚抽检）。
//
// 纯展示受控组件零数据请求——无网络 mock，仅断言回调与渲染。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PreSessionPicker } from "../pre-session-picker";
import type {
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

/* ----- fixture ----- */

function makeRuntime(
  id: string,
  provider: string,
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id,
    display_alias: null,
    name: "DESKTOP-1",
    provider,
    version: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "DESKTOP-1",
    display_alias: "机器一",
    os: "Windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-23T04:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 3,
    online_runtime_count: 3,
    runtimes: [
      makeRuntime("rt-claude", "claude"),
      makeRuntime("rt-codex", "codex"),
      // 白名单外引擎（第一步计数含它，第二步不列出）。
      makeRuntime("rt-copilot", "copilot"),
    ],
    ...overrides,
  };
}

function setupPicker(
  overrides: {
    open?: boolean;
    machines?: DaemonMachineRead[];
  } = {},
) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const machines = overrides.machines ?? [makeMachine()];
  const view = (open: boolean) => (
    <PreSessionPicker
      open={open}
      machines={machines}
      onCancel={onCancel}
      onPick={onPick}
    />
  );
  const result = render(view(overrides.open ?? true));
  return { ...result, onPick, onCancel, rerenderOpen: (open: boolean) => result.rerender(view(open)) };
}

/* ───────── 1. 两步流程 ───────── */

describe("PreSessionPicker 两步流程（D-107 两步即达）", () => {
  it("第一步仅列在线机器（离线不出现）；点击机器进入第二步", () => {
    setupPicker({
      machines: [
        makeMachine(),
        makeMachine({
          id: "m-2",
          hostname: "DESKTOP-OFF",
          display_alias: "离线机器",
          status: "offline",
          online_runtime_count: 0,
        }),
      ],
    });

    // 在线机器可见；离线机器不列出。
    expect(screen.getByRole("button", { name: /选择机器 机器一/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /选择机器 离线机器/ }),
    ).not.toBeInTheDocument();
    // 步骤文案 + 心跳时间（在线徽标语义随机器卡渲染）。
    expect(screen.getByText("① 机器（仅在线）")).toBeInTheDocument();
    expect(screen.getByText(/心跳 08-23/)).toBeInTheDocument();

    // 点机器 → 第二步。
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));
    expect(screen.getByText(/② 智能体 · 机器一/)).toBeInTheDocument();
    expect(
      screen.queryByText("① 机器（仅在线）"),
    ).not.toBeInTheDocument();
  });

  it("第二步仅列 claude/codex 在线智能体；点击立即 onPick(runtimeId)，无确认按钮", () => {
    const { onPick } = setupPicker();
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));

    const claude = screen.getByRole("button", { name: /选择智能体 Claude Code/ });
    expect(claude).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /选择智能体 Codex/ }),
    ).toBeInTheDocument();
    // 白名单外引擎（copilot）不列出。
    expect(screen.queryByRole("button", { name: /Copilot/ })).not.toBeInTheDocument();

    // 选完即回调，无确认按钮（无「确定/确认」类第三步操作）。
    fireEvent.click(claude);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("rt-claude");
    expect(screen.queryByRole("button", { name: /确定|确认/ })).not.toBeInTheDocument();
  });

  it("离线智能体不出现在第二步（provider 白名单 + 在线双条件）", () => {
    setupPicker({
      machines: [
        makeMachine({
          runtimes: [
            makeRuntime("rt-claude", "claude"),
            makeRuntime("rt-codex-off", "codex", { status: "offline" }),
          ],
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));

    expect(
      screen.getByRole("button", { name: /选择智能体 Claude Code/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /选择智能体 Codex/ }),
    ).not.toBeInTheDocument();
  });
});

/* ───────── 2. 默认高亮 ───────── */

describe("PreSessionPicker 默认 Claude Code 高亮", () => {
  it("claude 按钮 aria-pressed=true 且带「默认」Tag；codex 不高亮", () => {
    setupPicker();
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));

    const claude = screen.getByRole("button", {
      name: /选择智能体 Claude Code/,
    }) as HTMLButtonElement;
    expect(claude.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("默认")).toBeInTheDocument();

    const codex = screen.getByRole("button", {
      name: /选择智能体 Codex/,
    }) as HTMLButtonElement;
    expect(codex.getAttribute("aria-pressed")).toBe("false");
  });
});

/* ───────── 3. 取消 / 受控开关 ───────── */

describe("PreSessionPicker 取消与受控开关", () => {
  it("open=false 不渲染浮层", () => {
    setupPicker({ open: false });
    expect(screen.queryByTestId("pre-session-picker-mask")).not.toBeInTheDocument();
  });

  it("✕ 与遮罩点击 → 仅 onCancel 回调（onPick 不触发，不清父层状态）", () => {
    const { onCancel, onPick } = setupPicker();

    // 遮罩自身点击取消（浮层内点击不冒泡取消）。
    fireEvent.click(screen.getByTestId("pre-session-picker-mask"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // ✕ 关闭按钮取消。
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("取消后重开：重置回第一步（选中机器态不残留）", () => {
    const { rerenderOpen } = setupPicker();
    // 进入第二步。
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));
    expect(screen.getByText(/② 智能体 · 机器一/)).toBeInTheDocument();

    // 父层关闭（受控）→ 再打开 → 回到第一步。
    rerenderOpen(false);
    expect(screen.queryByTestId("pre-session-picker-mask")).not.toBeInTheDocument();
    rerenderOpen(true);
    expect(screen.getByText("① 机器（仅在线）")).toBeInTheDocument();
    expect(screen.queryByText(/② 智能体/)).not.toBeInTheDocument();
  });
});

/* ───────── 4. 空态 ───────── */

describe("PreSessionPicker 空态引导", () => {
  it("无在线机器：第一步空态文案", () => {
    setupPicker({
      machines: [
        makeMachine({
          status: "offline",
          online_runtime_count: 0,
        }),
      ],
    });
    expect(screen.getByText(/暂无在线机器，请先启动 daemon/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /选择机器/ }),
    ).not.toBeInTheDocument();
  });

  it("所选机器无 claude/codex 在线智能体：第二步空态文案", () => {
    setupPicker({
      machines: [
        makeMachine({
          runtimes: [
            makeRuntime("rt-copilot", "copilot"),
            makeRuntime("rt-codex-off", "codex", { status: "offline" }),
          ],
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /选择机器 机器一/ }));
    expect(
      screen.getByText(/该机器暂无可会话智能体（需要 Claude Code 或 Codex 在线）/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /选择智能体/ }),
    ).not.toBeInTheDocument();
  });
});

/* ───────── 5. variant 容器形态（task-13 / FR-08 / FR-11） ───────── */

// 独立渲染助手（不动既有 setupPicker——既有用例零修改）：variant 走 props 透传。
function renderVariantPicker(
  props: {
    variant?: "center" | "bottomSheet";
  } = {},
) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <PreSessionPicker
      open
      machines={[makeMachine()]}
      onCancel={onCancel}
      onPick={onPick}
      {...props}
    />,
  );
  return { ...result, onPick, onCancel };
}

describe("PreSessionPicker variant 容器形态（默认 center 零回归）", () => {
  it("不传 variant：遮罩与卡体 className 与改前逐字一致（桌面回归锚）", () => {
    renderVariantPicker();
    expect(screen.getByTestId("pre-session-picker-mask").className).toBe(
      "fixed inset-0 z-50 flex items-center justify-center bg-brand-950/30 p-4 backdrop-blur-[2px]",
    );
    expect(screen.getByRole("dialog").className).toBe(
      "w-full max-w-[360px] rounded-2xl border border-border bg-card p-4 shadow-lg",
    );
  });

  it('variant="bottomSheet"：容器为贴底抽屉（items-end/满宽/顶圆角/80dvh 滚动/安全区留白）', () => {
    renderVariantPicker({ variant: "bottomSheet" });

    const mask = screen.getByTestId("pre-session-picker-mask");
    expect(mask).toHaveClass("fixed", "inset-0", "z-50", "flex", "items-end");
    // 居中卡形态专属类不再出现（贴底 + 满宽不吃四周留白）。
    expect(mask).not.toHaveClass("items-center");
    expect(mask).not.toHaveClass("p-4");

    const card = screen.getByRole("dialog");
    expect(card).toHaveClass(
      "w-full",
      "rounded-t-2xl",
      "max-h-[80dvh]",
      "overflow-y-auto",
      "pb-[env(safe-area-inset-bottom)]",
    );
    expect(card).not.toHaveClass("max-w-[360px]");
    expect(card).not.toHaveClass("rounded-2xl");
  });

  it('variant="bottomSheet" 两步流程同构：机器→智能体→onPick(runtimeId)；遮罩/✕ 仍只 onCancel；选项行 ≥44px 触摸热区抽检', () => {
    const { onPick, onCancel } = renderVariantPicker({
      variant: "bottomSheet",
    });

    // 两步即达（与 center 同一逻辑路径）：① 机器 → ② 智能体 → onPick。
    const machine = screen.getByRole("button", { name: /选择机器 机器一/ });
    expect(machine).toHaveClass("min-h-[44px]");
    fireEvent.click(machine);
    expect(screen.getByText(/② 智能体 · 机器一/)).toBeInTheDocument();

    const claude = screen.getByRole("button", {
      name: /选择智能体 Claude Code/,
    });
    expect(claude).toHaveClass("min-h-[44px]");
    fireEvent.click(claude);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("rt-claude");

    // 取消语义不变：遮罩 / ✕ 仅 onCancel（受控语义零分叉，onPick 不再触发）。
    fireEvent.click(screen.getByTestId("pre-session-picker-mask"));
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("显式 variant=\"center\" 与默认一致：选项行不带 44px 热区类（外观差异仅 bottomSheet 生效）", () => {
    renderVariantPicker({ variant: "center" });
    expect(
      screen.getByRole("button", { name: /选择机器 机器一/ }),
    ).not.toHaveClass("min-h-[44px]");
    expect(screen.getByTestId("pre-session-picker-mask")).toHaveClass(
      "items-center",
      "p-4",
    );
  });
});
