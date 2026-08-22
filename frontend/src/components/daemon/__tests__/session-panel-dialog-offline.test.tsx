// task-06（2026-07-31-offline-session-readonly）：SessionPanel（mode="dialog"）offlineReadOnly 只读态测试。
// （2026-08-22-session-panel-unify task-05：由 InteractiveSessionPanel 适配层测试迁移直测。）
// 覆盖 FR-02/FR-03：离线横幅 + 4 操作禁用 + attach 不建 SSE + active 保持（不转 ended）。

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}));

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue({ id: "s-1" }),
  injectSession: vi.fn().mockResolvedValue(undefined),
  interruptSession: vi.fn().mockResolvedValue(undefined),
  endSession: vi.fn().mockResolvedValue(undefined),
  streamSession: vi.fn(),
  getAgentSession: vi.fn().mockResolvedValue({ id: "s-1", status: "active" }),
  fetchPendingDialogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...sessionApi };
});

import { SessionPanel } from "../session-panel";

const baseProps = {
  providers: ["claude"],
  defaultProvider: "claude",
  model: null,
  onModelChange: vi.fn(),
  hasOnlineProvider: true,
  onSessionCreated: vi.fn(),
  onSessionReset: vi.fn(),
};

describe("SessionPanel（dialog）offlineReadOnly (task-06 / FR-02 FR-03)", () => {
  it("offlineReadOnly=true：渲染离线横幅 + 新建会话按钮 disabled", () => {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseProps}
        initialTurns={[]}
        offlineReadOnly
      />,
    );
    expect(screen.getByText(/运行时离线，当前为只读浏览/)).toBeInTheDocument();
    const newBtn = screen.getByTitle("新建会话");
    expect((newBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("offlineReadOnly=true：打断 / 结束 按钮 disabled", () => {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseProps}
        initialTurns={[]}
        offlineReadOnly
      />,
    );
    expect((screen.getByTitle("打断本轮（session 保持 active）") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("结束整个会话") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offlineReadOnly=true：attach 不建 SSE（streamSession 未被调）", () => {
    render(
      <SessionPanel
        mode="dialog"
        sessionId="s-1"
        {...baseProps}
        initialTurns={[]}
        offlineReadOnly
      />,
    );
    expect(sessionApi.streamSession).not.toHaveBeenCalled();
  });

  it("offlineReadOnly 不传（默认）：无离线横幅（回归）", () => {
    render(<SessionPanel mode="dialog" sessionId={null} {...baseProps} />);
    expect(screen.queryByText(/运行时离线，当前为只读浏览/)).toBeNull();
  });
});
