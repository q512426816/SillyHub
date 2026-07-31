// task-05（2026-07-31-offline-session-readonly）：RuntimeCard 离线会话按钮开放测试。
// 覆盖 FR-01：离线 runtime 会话按钮仍渲染可点；在线回归；provider 限制保留。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// RuntimeUsageLineChart 走 next/dynamic ssr:false，jsdom mock 成占位。
vi.mock("@/components/charts", () => ({
  RuntimeUsageLineChart: () => <div data-testid="usage-chart" />,
}));

import { RuntimeCard } from "../runtime-card";
import type { DaemonRuntimeRead } from "@/lib/daemon";

function makeRuntime(overrides: Partial<DaemonRuntimeRead> = {}): DaemonRuntimeRead {
  return {
    id: "rt-1",
    provider: "claude",
    status: "online",
    name: "test-runtime",
    display_alias: null,
    allowed_roots: [],
    ...overrides,
  } as DaemonRuntimeRead;
}

function renderCard(overrides: Partial<DaemonRuntimeRead> = {}) {
  const onOpenSession = vi.fn();
  render(
    <RuntimeCard
      runtime={makeRuntime(overrides)}
      actioning={false}
      sessionStats={{ total: 0, active: 0 }}
      usageWindow="7d"
      onToggleEnabled={vi.fn()}
      onOpenSession={onOpenSession}
      onDelete={vi.fn()}
      onEditAlias={vi.fn()}
      onEditAllowedRoots={vi.fn()}
      onUpgrade={vi.fn()}
    />,
  );
  return { onOpenSession };
}

describe("RuntimeCard offline session button (task-05 / FR-01)", () => {
  it("离线 claude runtime 仍渲染会话按钮 + 点击触发 onOpenSession", () => {
    const { onOpenSession } = renderCard({ status: "offline" });
    const btn = screen.getByTitle("运行时离线，点击只读浏览会话历史");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onOpenSession).toHaveBeenCalledTimes(1);
  });

  it("在线 runtime 会话按钮 title 正常（回归）", () => {
    renderCard({ status: "online" });
    expect(screen.getByTitle("打开该运行时的会话窗口")).toBeInTheDocument();
  });

  it("非 claude/codex provider 不渲染会话按钮（provider 限制保留）", () => {
    renderCard({ provider: "other-x" as unknown as DaemonRuntimeRead["provider"], status: "online" });
    expect(screen.queryByTitle("打开该运行时的会话窗口")).toBeNull();
    expect(screen.queryByTitle("运行时离线，点击只读浏览会话历史")).toBeNull();
  });
});
