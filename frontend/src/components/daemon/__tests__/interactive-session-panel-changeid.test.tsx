/**
 * task-15（2026-07-09-change-detail-session / FR-05）：InteractiveSessionPanel
 * changeId / workspaceId 透传测试。
 *
 * 覆盖 task-12 契约 + task-15 验收：
 *   - 传 changeId 时 createSession payload 含 change_id
 *   - 不传 changeId 时 createSession payload 不含 change_id（runtimes 页零回归）
 *
 * mock 模式复用既有 interactive-session-panel.test.tsx。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { InteractiveSessionPanel } from "@/components/daemon/interactive-session-panel";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock lib/daemon ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  fetchPendingDialogs: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
  };
});

function makeStreamMock(): { factory: ReturnType<typeof vi.fn> } {
  const factory = vi.fn((_sessionId: string, _handlers: any): any => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  return { factory };
}

function setupPanel(overrides: Record<string, any> = {}) {
  const props = {
    providers: ["claude", "codex"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<InteractiveSessionPanel {...(props as any)} />);
}

describe("InteractiveSessionPanel changeId/workspaceId 透传（task-15）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("传 changeId 时 createSession payload 含 change_id", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel({ changeId: "change-99", workspaceId: "ws-9" });
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        change_id: "change-99",
        workspace_id: "ws-9",
      }),
    );
  });

  it("不传 changeId 时 createSession payload 不含 change_id（runtimes 页零回归）", async () => {
    const { factory } = makeStreamMock();
    sessionApi.streamSession.mockImplementation(factory);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1", run_id: "run-1", lease_id: "l",
      status: "active", stream_url: "",
    });

    setupPanel(); // 无 changeId / workspaceId
    const input = screen.getByPlaceholderText(/创建会话/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    const payload = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.change_id).toBeUndefined();
    expect(payload.workspace_id).toBeUndefined();
  });
});
