// task-10 (2026-07-03-daemon-entity-binding)：WorkspaceDaemonSwitcher 组件单测。
//
// 数据源从 daemon_runtimes 改为 daemon_instances（daemon 实体 + provider 徽标）。
// 覆盖：
//   - 「切换守护进程」展开列表，显示 hostname/display_alias + provider 徽标；
//   - 当前绑定项（daemon_id 匹配）标注「当前」；
//   - 点击非当前项 → upsertMyBinding({ daemon_id, root_path, path_source }) + onChanged；
//   - 点击当前项 → 仅收起，不重复提交；
//   - upsertMyBinding 失败 → 显示错误（role=alert）且不触发 onChanged；
//   - 空列表 → 显示「暂无在线守护进程，请先启动守护进程」。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// 组件用到 listDaemonInstances + PROVIDER_META（label/icon/color 展示）。
vi.mock("@/lib/daemon", () => ({
  listDaemonInstances: vi.fn(),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100 text-purple-800" },
    codex: { label: "Codex", icon: "🟢", color: "bg-green-100 text-green-800" },
    cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100 text-amber-800" },
  },
}));

vi.mock("@/lib/workspace-binding", () => ({
  upsertMyBinding: vi.fn(),
}));

import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { listDaemonInstances, type DaemonInstanceRead } from "@/lib/daemon";
import { upsertMyBinding, type MemberBindingView } from "@/lib/workspace-binding";

const mockedList = vi.mocked(listDaemonInstances);
const mockedUpsert = vi.mocked(upsertMyBinding);

function mkInstance(
  o: Partial<DaemonInstanceRead> & { id: string },
): DaemonInstanceRead {
  return {
    id: o.id,
    hostname: o.hostname ?? "DESKTOP",
    display_alias: o.display_alias ?? null,
    status: o.status ?? "online",
    providers: o.providers ?? [{ provider: "claude", status: "online" }],
  };
}

function mkBinding(
  o: Partial<MemberBindingView> & { daemon_id?: string | null },
): MemberBindingView {
  return {
    workspace_id: o.workspace_id ?? "ws-1",
    user_id: o.user_id ?? "user-1",
    runtime_id: o.runtime_id ?? null,
    daemon_id: o.daemon_id ?? null,
    root_path: o.root_path ?? "/home/user/project",
    path_source: o.path_source ?? "daemon-client",
    synced_at: o.synced_at ?? null,
    last_scan_at: o.last_scan_at ?? null,
    init_synced_at: o.init_synced_at ?? null,
    init_synced_spec_version: o.init_synced_spec_version ?? null,
  };
}

function openList() {
  return waitFor(() => expect(screen.getByText("切换守护进程")).toBeEnabled()).then(
    () => fireEvent.click(screen.getByText("切换守护进程")),
  );
}

describe("WorkspaceDaemonSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展开后显示 daemon 实体 hostname + provider 徽标", async () => {
    const daemon1 = mkInstance({
      id: "di-claude",
      hostname: "DESKTOP-01",
      display_alias: "本机开发",
      providers: [
        { provider: "claude", status: "online" },
        { provider: "codex", status: "online" },
      ],
    });
    const daemon2 = mkInstance({
      id: "di-cursor",
      hostname: "DESKTOP-02",
      display_alias: null,
      providers: [{ provider: "cursor", status: "online" }],
    });
    mockedList.mockResolvedValue([daemon1, daemon2]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: null })}
        onChanged={vi.fn()}
      />,
    );

    await openList();
    const ul = await waitFor(() =>
      screen.getByTestId("daemon-switcher-list"),
    );
    const lis = ul.querySelectorAll("li");
    expect(lis.length).toBe(2);

    // daemon1: display_alias 展示
    expect(lis[0]!.textContent).toContain("本机开发");
    // daemon1 有 claude + codex 徽标
    expect(lis[0]!.textContent).toContain("Claude Code");
    expect(lis[0]!.textContent).toContain("Codex");

    // daemon2: 无 display_alias, 展示 hostname
    expect(lis[1]!.textContent).toContain("DESKTOP-02");
    // daemon2 有一个 cursor 徽标
    expect(lis[1]!.textContent).toContain("Cursor");
  });

  it("当前绑定项（daemon_id 匹配）标注「当前」", async () => {
    const daemon = mkInstance({
      id: "di-claude",
      hostname: "DESKTOP",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([daemon]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: "di-claude" })}
        onChanged={vi.fn()}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("当前")).toBeInTheDocument(),
    );
  });

  it("点击非当前项调 upsertMyBinding({ daemon_id }) 并触发 onChanged", async () => {
    const daemon = mkInstance({
      id: "di-claude",
      hostname: "DESKTOP",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([daemon]);
    mockedUpsert.mockResolvedValue({} as never);
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: "di-other" })}
        onChanged={onChanged}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("DESKTOP")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("DESKTOP"));

    await waitFor(() =>
      expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
        daemon_id: "di-claude",
        root_path: "/home/user/project",
        path_source: "daemon-client",
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("点击当前绑定项仅收起，不调 upsertMyBinding", async () => {
    const daemon = mkInstance({
      id: "di-claude",
      hostname: "DESKTOP",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([daemon]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: "di-claude" })}
        onChanged={vi.fn()}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("DESKTOP")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("DESKTOP"));

    await waitFor(() =>
      expect(screen.queryByTestId("daemon-switcher-list")).toBeNull(),
    );
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("upsertMyBinding 失败时显示错误且不触发 onChanged", async () => {
    const daemon = mkInstance({
      id: "di-claude",
      hostname: "DESKTOP",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([daemon]);
    mockedUpsert.mockRejectedValue(new Error("boom"));
    const onChanged = vi.fn();

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: "di-other" })}
        onChanged={onChanged}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(screen.getByText("DESKTOP")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("DESKTOP"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("空列表显示引导文案", async () => {
    mockedList.mockResolvedValue([]);

    render(
      <WorkspaceDaemonSwitcher
        workspaceId="ws-1"
        currentBinding={mkBinding({ daemon_id: null })}
        onChanged={vi.fn()}
      />,
    );

    await openList();
    await waitFor(() =>
      expect(
        screen.getByText("暂无在线守护进程，请先启动守护进程"),
      ).toBeInTheDocument(),
    );
  });
});
