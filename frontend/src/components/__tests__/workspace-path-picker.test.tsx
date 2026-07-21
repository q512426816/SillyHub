// task-02 (2026-07-21-workspace-path-dir-picker)：WorkspacePathPicker 组件单测。
//
// 覆盖：
//   - canBrowse 判定：daemonId="" → 按钮 disabled + title 提示
//   - daemonId 有效 + 在线 runtime → canBrowse=true，浏览按钮 enabled
//   - 点浏览按钮 → RemoteFolderPicker 弹窗 open
//   - onPick 回调 → onChange 调用 + 弹窗关闭
//   - Input 手输 → onChange 调用
//   - disabled prop → Input 和按钮都禁用
//   - value prop 更新 → Input 显示新值

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// ── mocks ──

vi.mock("@/lib/daemon", () => ({
  listDaemonRuntimes: vi.fn(),
}));

// 桩组件：避免 antd 依赖，同时暴露 onPick 供测试触发回调。
let lastOnPick: ((path: string) => void) | null = null;
vi.mock("@/components/daemon/remote-folder-picker", () => ({
  RemoteFolderPicker: (props: any) => {
    lastOnPick = props.onPick ?? null;
    return (
      <div data-testid="remote-folder-picker">
        {props.open ? "open" : "closed"}
      </div>
    );
  },
}));

import { WorkspacePathPicker } from "@/components/workspace-path-picker";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";

const mockedList = vi.mocked(listDaemonRuntimes);

function mkRuntime(
  o: Partial<DaemonRuntimeRead> & { id: string },
): DaemonRuntimeRead {
  return {
    id: o.id,
    name: o.name ?? "runtime-1",
    provider: o.provider ?? "claude",
    status: o.status ?? "online",
    last_heartbeat_at: o.last_heartbeat_at ?? null,
    capabilities: o.capabilities ?? null,
    allowed_roots: o.allowed_roots ?? [],
    daemon_instance_id: o.daemon_instance_id ?? null,
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: o.updated_at ?? "2026-01-01T00:00:00Z",
    display_alias: o.display_alias ?? null,
    version: o.version ?? null,
    os: o.os ?? null,
    arch: o.arch ?? null,
    owner: o.owner ?? null,
    daemon_version: o.daemon_version ?? null,
    daemon_build_id: o.daemon_build_id ?? null,
  };
}

describe("WorkspacePathPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastOnPick = null;
  });

  // ── test 1：canBrowse 判定——daemonId="" ──
  it("daemonId='' 时浏览按钮 disabled，title 提示未选守护进程", () => {
    render(
      <WorkspacePathPicker daemonId="" value="" onChange={vi.fn()} />,
    );

    const btn = screen.getByRole("button", { name: /浏览/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "请先选择在线守护进程");
  });

  // ── test 2：daemonId 有效 + 在线 runtime → canBrowse=true ──
  it("daemonId 有效且有在线 runtime 时浏览按钮 enabled，title 提示可浏览", async () => {
    mockedList.mockResolvedValue([
      mkRuntime({ id: "rt-1", daemon_instance_id: "di-1", status: "online" }),
    ]);

    render(
      <WorkspacePathPicker daemonId="di-1" value="" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /浏览/ });
      expect(btn).toBeEnabled();
      expect(btn).toHaveAttribute("title", "浏览远程目录");
    });
  });

  // ── test 3：点浏览按钮 → RemoteFolderPicker 弹窗 open ──
  it("点击浏览按钮打开 RemoteFolderPicker 弹窗", async () => {
    mockedList.mockResolvedValue([
      mkRuntime({ id: "rt-1", daemon_instance_id: "di-1", status: "online" }),
    ]);

    render(
      <WorkspacePathPicker daemonId="di-1" value="/home" onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /浏览/ })).toBeEnabled();
    });

    // 初始 closed
    const picker = screen.getByTestId("remote-folder-picker");
    expect(picker.textContent).toBe("closed");

    // 点击浏览按钮
    fireEvent.click(screen.getByRole("button", { name: /浏览/ }));

    // 弹窗应为 open
    await waitFor(() => {
      expect(picker.textContent).toBe("open");
    });
  });

  // ── test 4：onPick 回调 → onChange 调用 + 弹窗关闭 ──
  it("onPick 回调触发 onChange 并关闭弹窗", async () => {
    mockedList.mockResolvedValue([
      mkRuntime({ id: "rt-1", daemon_instance_id: "di-1", status: "online" }),
    ]);

    const onChange = vi.fn();
    render(
      <WorkspacePathPicker daemonId="di-1" value="/home" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /浏览/ })).toBeEnabled();
    });

    // 打开弹窗
    fireEvent.click(screen.getByRole("button", { name: /浏览/ }));
    const picker = screen.getByTestId("remote-folder-picker");
    await waitFor(() => expect(picker.textContent).toBe("open"));

    // 模拟 RemoteFolderPicker 的 onPick 回调
    expect(lastOnPick).not.toBeNull();
    lastOnPick!("/picked/path");

    // onChange 被调用
    expect(onChange).toHaveBeenCalledWith("/picked/path");

    // 弹窗关闭
    await waitFor(() => {
      expect(picker.textContent).toBe("closed");
    });
  });

  // ── test 5：Input 手输 → onChange 调用 ──
  it("Input 手输触发 onChange", () => {
    const onChange = vi.fn();

    render(
      <WorkspacePathPicker daemonId="" value="" onChange={onChange} />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "/new/path" } });

    expect(onChange).toHaveBeenCalledWith("/new/path");
  });

  // ── test 6：disabled prop → Input 和按钮都禁用 ──
  it("disabled 为 true 时 Input 和按钮都禁用", () => {
    render(
      <WorkspacePathPicker
        daemonId=""
        value="/test"
        onChange={vi.fn()}
        disabled={true}
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();

    const btn = screen.getByRole("button", { name: /浏览/ });
    expect(btn).toBeDisabled();
  });

  // ── test 7：value prop 更新 → Input 显示新值 ──
  it("value prop 更新后 Input 显示新值", () => {
    const { rerender } = render(
      <WorkspacePathPicker daemonId="" value="/old" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("/old");

    rerender(
      <WorkspacePathPicker daemonId="" value="/new" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("textbox")).toHaveValue("/new");
  });
});
