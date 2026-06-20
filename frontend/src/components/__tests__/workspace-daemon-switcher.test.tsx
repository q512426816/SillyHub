// ql-20260619-006：WorkspaceDaemonSwitcher 组件单测。
//
// 覆盖：
//   - 「切换守护进程」展开列表，online runtime 排前；
//   - 当前绑定项标注「当前」；
//   - 点击非当前项 → updateWorkspace({ daemon_runtime_id }) + onChanged；
//   - 点击当前项 → 仅收起，不重复提交；
//   - updateWorkspace 失败 → 显示错误（role=alert）且不触发 onChanged。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// 组件用到 listDaemonRuntimes + PROVIDER_META（label 展示）。
vi.mock("@/lib/daemon", () => ({
  listDaemonRuntimes: vi.fn(),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100" },
    cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100" },
    codex: { label: "Codex", icon: "🟢", color: "bg-emerald-100" },
  },
}));

vi.mock("@/lib/workspaces", () => ({
  updateWorkspace: vi.fn(),
}));

import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { updateWorkspace } from "@/lib/workspaces";

const mockedList = vi.mocked(listDaemonRuntimes);
const mockedUpdate = vi.mocked(updateWorkspace);

function mkRuntime(
  o: Partial<DaemonRuntimeRead> & { id: string },
): DaemonRuntimeRead {
  return {
    id: o.id,
    name: o.name ?? null,
    provider: o.provider ?? "claude",
    version: o.version ?? null,
    status: o.status ?? "online",
    last_heartbeat_at: o.last_heartbeat_at ?? null,
    capabilities: o.capabilities ?? null,
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: o.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

function openList() {
  // 列表加载完成后按钮文案回到「切换守护进程」且可点。
  return waitFor(() => expect(screen.getByText("切换守护进程")).toBeEnabled()).then(
    () => fireEvent.click(screen.getByText("切换守护进程")),
  );
}

describe("WorkspaceDaemonSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展开列表后 online 排前，当前项标注「当前」", async () => {
    // 后端返回顺序故意 cursor(off) 在前，组件应把 claude(online) 排到前面。
    const cursor = mkRuntime({
      id: "rt-cursor",
      provider: "cursor",
      status: "offline",
      name: "DESKTOP",
    });
    const claude = mkRuntime({
      id: "rt-claude",
      provider: "claude",
      status: "online",
      name: "DESKTOP",
    });
    mockedList.mockResolvedValue([cursor, claude]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentRuntimeId="rt-cursor"
        onChanged={vi.fn()}
      />,
    );

    await openList();
    const ul = await waitFor(() =>
      screen.getByTestId("daemon-switcher-list"),
    );
    const lis = ul.querySelectorAll("li");
    expect(lis.length).toBe(2);
    // online claude 排前
    expect(lis[0]!.textContent).toContain("Claude Code");
    expect(lis[1]!.textContent).toContain("Cursor");
    // 当前 cursor 标注「当前」
    expect(screen.getByText("当前")).toBeInTheDocument();
  });

  it("点击非当前项调 updateWorkspace({ daemon_runtime_id }) 并触发 onChanged", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);
    mockedUpdate.mockResolvedValue({} as never);
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentRuntimeId="rt-other"
        onChanged={onChanged}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("Claude Code")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("ws-1", {
        daemon_runtime_id: "rt-claude",
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("点击当前项仅收起，不调 updateWorkspace", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentRuntimeId="rt-claude"
        onChanged={vi.fn()}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("Claude Code")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() =>
      expect(screen.queryByTestId("daemon-switcher-list")).toBeNull(),
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("updateWorkspace 失败时显示错误且不触发 onChanged", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);
    mockedUpdate.mockRejectedValue(new Error("boom"));
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentRuntimeId="rt-other"
        onChanged={onChanged}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("Claude Code")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
