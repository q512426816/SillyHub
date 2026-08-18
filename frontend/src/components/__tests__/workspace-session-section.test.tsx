// ql-20260814-007：会话页仅展示本人会话。工作区会话列表跨成员可见
// （D-005@v1），但 /api/daemon/sessions/* 的 logs/dialogs/stream 端点全部
// owner-only——attach 他人会话必然全 404。断言：列表项按 author.user_id
// 过滤，本人/缺 author 的保留，他人的剔除。
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSessionSection } from "@/components/workspace-session-section";
import { useSession } from "@/stores/session";
import type { AgentSessionListItem } from "@/lib/daemon";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const mocks = vi.hoisted(() => ({
  listWorkspaceAgentSessions: vi.fn(),
  listDaemonRuntimes: vi.fn(),
}));

vi.mock("@/lib/daemon", () => ({
  ...mocks,
  PROVIDER_META: { claude: { label: "Claude" }, codex: { label: "Codex" } },
}));

vi.mock("@/lib/agent", () => ({ AgentRunLogEntry: {} }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {} }));
vi.mock("@/components/daemon/interactive-session-panel", () => ({
  InteractiveSessionPanel: () => <div data-testid="session-panel" />,
}));

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function sessionOf(
  id: string,
  userId: string | null,
  title: string,
  lastActiveHour: string,
  mode?: string,
): AgentSessionListItem {
  return {
    id,
    provider: "claude",
    status: "active",
    turn_count: 1,
    mode: mode ?? null,
    author: userId === null ? null : { user_id: userId, display_name: "作者" },
    last_active_at: `2026-08-14T${lastActiveHour}:00:00Z`,
    title,
  } as unknown as AgentSessionListItem;
}

function setCurrentUser(userId: string | null) {
  if (userId === null) {
    useSession.getState().clear();
    return;
  }
  useSession.getState().setUser({
    id: userId,
    email: "me@test.local",
    displayName: "我",
    is_platform_admin: true,
    permissions: [],
  });
}

describe("WorkspaceSessionSection 仅展示本人会话（ql-20260814-007）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.getState().clear();
  });

  it("过滤 author.user_id 非当前用户的会话，本人与缺 author 的保留", async () => {
    setCurrentUser(ME);
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      sessionOf("s-mine", ME, "我的会话", "10"),
      sessionOf("s-other", OTHER, "别人的会话", "09"),
      sessionOf("s-noauthor", null, "缺作者会话", "08"),
    ]);
    mocks.listDaemonRuntimes.mockResolvedValue([]);

    render(<WorkspaceSessionSection workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("我的会话")).toBeInTheDocument();
    });
    expect(screen.getByText("缺作者会话")).toBeInTheDocument();
    expect(screen.queryByText("别人的会话")).not.toBeInTheDocument();
  });

  it("未登录（user=null）时不过滤掉本人不可判定项之外的行为一致：全部保留缺 author 项", async () => {
    setCurrentUser(null);
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      sessionOf("s-noauthor", null, "缺作者会话", "08"),
    ]);
    mocks.listDaemonRuntimes.mockResolvedValue([]);

    render(<WorkspaceSessionSection workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("缺作者会话")).toBeInTheDocument();
    });
  });

  it("mode=scan 的会话渲染「扫描」Badge", async () => {
    setCurrentUser(ME);
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      sessionOf("s-scan", ME, "扫描会话", "10", "scan"),
      sessionOf("s-chat", ME, "对话会话", "09"),
    ]);
    mocks.listDaemonRuntimes.mockResolvedValue([]);

    render(<WorkspaceSessionSection workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("扫描会话")).toBeInTheDocument();
    });
    expect(screen.getByText("扫描")).toBeInTheDocument();
  });

  it("mode=chat 或无 mode 的会话不渲染「扫描」Badge", async () => {
    setCurrentUser(ME);
    mocks.listWorkspaceAgentSessions.mockResolvedValue([
      sessionOf("s-chat", ME, "对话会话", "10", "chat"),
      sessionOf("s-none", ME, "普通会话", "09"),
    ]);
    mocks.listDaemonRuntimes.mockResolvedValue([]);

    render(<WorkspaceSessionSection workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("对话会话")).toBeInTheDocument();
    });
    expect(screen.queryByText("扫描")).not.toBeInTheDocument();
  });
});
