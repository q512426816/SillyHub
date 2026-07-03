// ql-20260619-006：WorkspaceDaemonSwitcher 组件单测。
//
// 覆盖：
//   - 「切换守护进程」展开列表，online runtime 排前；
//   - 当前绑定项标注「当前」；
//   - 点击非当前项 → upsertMyBinding({runtime_id, root_path, path_source}) + onChanged；
//   - 点击当前项 → 仅收起，不重复提交；
//   - upsertMyBinding 失败 → 显示错误（role=alert）且不触发 onChanged。

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

vi.mock("@/lib/workspace-binding", () => ({
  upsertMyBinding: vi.fn(),
}));

import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { upsertMyBinding, type MemberBindingView } from "@/lib/workspace-binding";

const mockedList = vi.mocked(listDaemonRuntimes);
const mockedUpsert = vi.mocked(upsertMyBinding);

function mkRuntime(
  o: Partial<DaemonRuntimeRead> & { id: string },
): DaemonRuntimeRead {
  return {
    id: o.id,
    name: o.name ?? null,
    provider: o.provider ?? "claude",
    version: o.version ?? null,
    os: o.os ?? null,
    arch: o.arch ?? null,
    status: o.status ?? "online",
    last_heartbeat_at: o.last_heartbeat_at ?? null,
    capabilities: o.capabilities ?? null,
    allowed_roots: o.allowed_roots ?? [],
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: o.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

function mkBinding(
  o: Partial<MemberBindingView> & { runtime_id?: string | null },
): MemberBindingView {
  return {
    workspace_id: o.workspace_id ?? "ws-1",
    user_id: o.user_id ?? "user-1",
    runtime_id: o.runtime_id ?? null,
    root_path: o.root_path ?? "/home/user/project",
    path_source: o.path_source ?? "daemon-client",
    synced_at: o.synced_at ?? null,
    last_scan_at: o.last_scan_at ?? null,
    init_synced_at: o.init_synced_at ?? null,
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
        currentBinding={mkBinding({ runtime_id: "rt-cursor" })}
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

  it("点击非当前项调 upsertMyBinding({runtime_id, root_path, path_source}) 并触发 onChanged", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);
    mockedUpsert.mockResolvedValue({} as never);
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ runtime_id: "rt-other" })}
        onChanged={onChanged}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("Claude Code")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() =>
      expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
        runtime_id: "rt-claude",
        root_path: "/home/user/project",
        path_source: "daemon-client",
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("点击当前项仅收起，不调 upsertMyBinding", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ runtime_id: "rt-claude" })}
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
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("upsertMyBinding 失败时显示错误且不触发 onChanged", async () => {
    const claude = mkRuntime({ id: "rt-claude", provider: "claude" });
    mockedList.mockResolvedValue([claude]);
    mockedUpsert.mockRejectedValue(new Error("boom"));
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ runtime_id: "rt-other" })}
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
