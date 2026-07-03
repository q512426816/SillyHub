// workspace-access-guide 组件单测。
//
// 覆盖：
//   - 「绑定守护进程」下拉来自 listDaemonRuntimes()，online 排前，option 文案
//     含 provider 中文 + name + 中文状态；默认带「不绑定守护进程」空选项。
//   - 「路径来源」下拉显示中文（本机守护进程路径 / 服务器本地路径）。
//   - 守护进程列表为空 → 显示引导文案「请先在『守护进程』页启动一个」。
//   - 填路径 + 选 runtime + 保存 → upsertMyBinding 正确入参 + onConfigured 触发。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/daemon", () => ({
  listDaemonRuntimes: vi.fn(),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100" },
    cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100" },
  },
}));

vi.mock("@/lib/workspace-binding", () => ({
  upsertMyBinding: vi.fn(),
}));

import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { upsertMyBinding } from "@/lib/workspace-binding";

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

describe("WorkspaceAccessGuide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("「绑定守护进程」下拉 online 排前，option 含中文 provider 与状态", async () => {
    // 后端顺序故意 offline 在前，组件应把 online 排前。
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
      name: "MBP",
    });
    mockedList.mockResolvedValue([cursor, claude]);

    render(<WorkspaceAccessGuide workspaceId="ws-1" onConfigured={vi.fn()} />);

    const select = await screen.findByLabelText("绑定守护进程");
    const options = Array.from(select.querySelectorAll("option"));
    // option[0] 是「不绑定守护进程」空选项，其后 online 排前。
    expect(options[0]!.textContent).toBe("不绑定守护进程");
    expect(options[1]!.textContent).toContain("Claude Code");
    expect(options[1]!.textContent).toContain("在线");
    expect(options[2]!.textContent).toContain("Cursor");
    expect(options[2]!.textContent).toContain("离线");
  });

  it("「路径来源」下拉显示中文", async () => {
    mockedList.mockResolvedValue([]);
    render(<WorkspaceAccessGuide workspaceId="ws-1" onConfigured={vi.fn()} />);
    const select = await screen.findByLabelText("路径来源");
    const texts = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(texts).toContain("本机守护进程路径");
    expect(texts).toContain("服务器本地路径");
  });

  it("守护进程列表为空时显示引导文案", async () => {
    mockedList.mockResolvedValue([]);
    render(<WorkspaceAccessGuide workspaceId="ws-1" onConfigured={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText(/请先在「守护进程」页启动一个/),
      ).toBeInTheDocument(),
    );
  });

  it("填路径 + 选 runtime + 保存 → upsertMyBinding 正确入参并触发 onConfigured", async () => {
    const claude = mkRuntime({
      id: "rt-claude",
      provider: "claude",
      status: "online",
      name: "MBP",
    });
    mockedList.mockResolvedValue([claude]);
    mockedUpsert.mockResolvedValue({} as never);
    const onConfigured = vi.fn();

    render(
      <WorkspaceAccessGuide workspaceId="ws-1" onConfigured={onConfigured} />,
    );

    // 等下拉加载完
    await screen.findByLabelText("绑定守护进程");
    // 填本地路径
    fireEvent.change(screen.getByLabelText("本地项目路径"), {
      target: { value: "/Users/me/code" },
    });
    // 选 runtime
    fireEvent.change(screen.getByLabelText("绑定守护进程"), {
      target: { value: "rt-claude" },
    });
    // 点保存
    fireEvent.click(screen.getByText("保存我的接入配置"));

    await waitFor(() =>
      expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
        daemon_id: "rt-claude",
        root_path: "/Users/me/code",
        path_source: "daemon-client",
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  describe("编辑模式（initial 传入）", () => {
    it("传入 initial 时回填当前 runtime_id / root_path / path_source，且展示编辑文案", async () => {
      const claude = mkRuntime({
        id: "rt-claude",
        provider: "claude",
        status: "online",
        name: "MBP",
      });
      const cursor = mkRuntime({
        id: "rt-cursor",
        provider: "cursor",
        status: "offline",
        name: "DESKTOP",
      });
      mockedList.mockResolvedValue([cursor, claude]);

      render(
        <WorkspaceAccessGuide
          workspaceId="ws-1"
          onConfigured={vi.fn()}
          initial={{
            runtime_id: "rt-claude",
            root_path: "/Users/me/old-code",
            path_source: "server-local",
          }}
        />,
      );

      // 编辑模式文案
      expect(
        await screen.findByText("✏ 编辑我的接入配置"),
      ).toBeInTheDocument();
      // runtime 下拉回填到 rt-claude
      const runtimeSelect = screen.getByLabelText("绑定守护进程") as HTMLSelectElement;
      expect(runtimeSelect.value).toBe("rt-claude");
      // 路径回填
      expect(
        (screen.getByLabelText("本地项目路径") as HTMLInputElement).value,
      ).toBe("/Users/me/old-code");
      // 路径来源回填到 server-local
      const pathSourceSelect = screen.getByLabelText("路径来源") as HTMLSelectElement;
      expect(pathSourceSelect.value).toBe("server-local");
      // 编辑模式按钮文案
      expect(
        screen.getByRole("button", { name: "保存修改" }),
      ).toBeInTheDocument();
    });

    it("编辑模式改 path_source / root_path 后保存 → upsertMyBinding 用新值入参并触发 onConfigured", async () => {
      const claude = mkRuntime({
        id: "rt-claude",
        provider: "claude",
        status: "online",
        name: "MBP",
      });
      const cursor = mkRuntime({
        id: "rt-cursor",
        provider: "cursor",
        status: "online",
        name: "DESKTOP",
      });
      mockedList.mockResolvedValue([cursor, claude]);
      mockedUpsert.mockResolvedValue({} as never);
      const onConfigured = vi.fn();

      render(
        <WorkspaceAccessGuide
          workspaceId="ws-1"
          onConfigured={onConfigured}
          initial={{
            runtime_id: "rt-claude",
            root_path: "/Users/me/old-code",
            path_source: "server-local",
          }}
        />,
      );

      await screen.findByText("✏ 编辑我的接入配置");

      // 改 runtime 到 cursor
      fireEvent.change(screen.getByLabelText("绑定守护进程"), {
        target: { value: "rt-cursor" },
      });
      // 改路径
      fireEvent.change(screen.getByLabelText("本地项目路径"), {
        target: { value: "/Users/me/new-code" },
      });
      // 改路径来源到 daemon-client
      fireEvent.change(screen.getByLabelText("路径来源"), {
        target: { value: "daemon-client" },
      });
      // 点保存修改
      fireEvent.click(screen.getByText("保存修改"));

      await waitFor(() =>
        expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
          daemon_id: "rt-cursor",
          root_path: "/Users/me/new-code",
          path_source: "daemon-client",
        }),
      );
      expect(onConfigured).toHaveBeenCalledTimes(1);
    });
  });
});
