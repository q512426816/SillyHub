// workspace-access-guide 组件单测。
//
// 2026-07-03-daemon-entity-binding（D-004/D-006）：下拉改 daemon 实体维度。
// 2026-07-10-remove-server-local-workspace-mode：删「路径来源」下拉 case（server-local
// 模式移除后 path_source 固定 "daemon-client"，组件不再暴露路径来源选择）。
//
// 覆盖：
//   - 「绑定守护进程」下拉来自 listDaemonInstances()（守护进程实体），online 排前，
//     option 文案含 hostname + provider 列表 + 中文状态；默认带「不绑定守护进程」空选项。
//   - 守护进程列表为空 → 显示引导文案。
//   - 填路径 + 选 daemon + 保存 → upsertMyBinding 正确入参（daemon_id + 固定 path_source=daemon-client）
//     + onConfigured 触发。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/daemon", () => ({
  listDaemonInstances: vi.fn(),
  listDaemonRuntimes: vi.fn().mockResolvedValue([]),
  PROVIDER_META: {
    claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100" },
    cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100" },
  },
}));

vi.mock("@/lib/workspace-binding", () => ({
  upsertMyBinding: vi.fn(),
}));

import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { listDaemonInstances, type DaemonInstanceRead } from "@/lib/daemon";
import { upsertMyBinding } from "@/lib/workspace-binding";

const mockedList = vi.mocked(listDaemonInstances);
const mockedUpsert = vi.mocked(upsertMyBinding);

function mkInstance(
  o: Partial<DaemonInstanceRead> & { id: string },
): DaemonInstanceRead {
  return {
    id: o.id,
    hostname: o.hostname ?? "HOST",
    display_alias: o.display_alias ?? null,
    status: o.status ?? "online",
    providers: o.providers ?? [{ provider: "claude", status: "online" }],
  };
}

describe("WorkspaceAccessGuide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("「绑定守护进程」下拉 online 排前，option 含 hostname + provider 列表 + 状态", async () => {
    // 后端顺序故意 offline 在前，组件应把 online 排前。
    const desktop = mkInstance({
      id: "inst-desktop",
      hostname: "DESKTOP",
      status: "offline",
      providers: [{ provider: "cursor", status: "offline" }],
    });
    const mbp = mkInstance({
      id: "inst-mbp",
      hostname: "MBP",
      status: "online",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([desktop, mbp]);

    render(<WorkspaceAccessGuide workspaceId="ws-1" onConfigured={vi.fn()} />);

    const select = await screen.findByLabelText("绑定守护进程");
    const options = Array.from(select.querySelectorAll("option"));
    // option[0] 是「不绑定守护进程」空选项，其后 online 排前。
    expect(options[0]!.textContent).toBe("不绑定守护进程");
    expect(options[1]!.textContent).toContain("MBP");
    expect(options[1]!.textContent).toContain("Claude Code");
    expect(options[1]!.textContent).toContain("在线");
    expect(options[2]!.textContent).toContain("DESKTOP");
    expect(options[2]!.textContent).toContain("Cursor");
    expect(options[2]!.textContent).toContain("离线");
  });

  it("守护进程列表为空时显示引导文案", async () => {
    mockedList.mockResolvedValue([]);
    render(<WorkspaceAccessGuide workspaceId="ws-1" onConfigured={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/还没有在线守护进程/)).toBeInTheDocument(),
    );
  });

  it("填路径 + 选 daemon + 保存 → upsertMyBinding 正确入参并触发 onConfigured", async () => {
    const mbp = mkInstance({
      id: "inst-mbp",
      hostname: "MBP",
      status: "online",
      providers: [{ provider: "claude", status: "online" }],
    });
    mockedList.mockResolvedValue([mbp]);
    mockedUpsert.mockResolvedValue({} as never);
    const onConfigured = vi.fn();

    render(
      <WorkspaceAccessGuide workspaceId="ws-1" onConfigured={onConfigured} />,
    );

    // 等下拉加载完
    await screen.findByLabelText("绑定守护进程");
    // 填本地路径
    fireEvent.change(screen.getByPlaceholderText("/Users/you/code/project"), {
      target: { value: "/Users/me/code" },
    });
    // 选 daemon
    fireEvent.change(screen.getByLabelText("绑定守护进程"), {
      target: { value: "inst-mbp" },
    });
    // 点保存
    fireEvent.click(screen.getByText("保存我的接入配置"));

    await waitFor(() =>
      expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
        daemon_id: "inst-mbp",
        root_path: "/Users/me/code",
        path_source: "daemon-client",
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  describe("编辑模式（initial 传入）", () => {
    it("传入 initial 时回填当前 daemon_id / root_path，且展示编辑文案", async () => {
      const mbp = mkInstance({
        id: "inst-mbp",
        hostname: "MBP",
        status: "online",
        providers: [{ provider: "claude", status: "online" }],
      });
      const desktop = mkInstance({
        id: "inst-desktop",
        hostname: "DESKTOP",
        status: "offline",
        providers: [{ provider: "cursor", status: "offline" }],
      });
      mockedList.mockResolvedValue([desktop, mbp]);

      render(
        <WorkspaceAccessGuide
          workspaceId="ws-1"
          onConfigured={vi.fn()}
          initial={{
            daemon_id: "inst-mbp",
            root_path: "/Users/me/old-code",
          }}
        />,
      );

      // 编辑模式文案
      expect(
        await screen.findByText("✏ 编辑我的接入配置"),
      ).toBeInTheDocument();
      // daemon 下拉回填到 inst-mbp
      const daemonSelect = screen.getByLabelText(
        "绑定守护进程",
      ) as HTMLSelectElement;
      expect(daemonSelect.value).toBe("inst-mbp");
      // 路径回填
      expect(
        (screen.getByPlaceholderText("/Users/you/code/project") as HTMLInputElement).value,
      ).toBe("/Users/me/old-code");
      // 编辑模式按钮文案
      expect(
        screen.getByRole("button", { name: "保存修改" }),
      ).toBeInTheDocument();
    });

    it("编辑模式改 daemon / root_path 后保存 → upsertMyBinding 用新值入参并触发 onConfigured", async () => {
      const mbp = mkInstance({
        id: "inst-mbp",
        hostname: "MBP",
        status: "online",
      });
      const desktop = mkInstance({
        id: "inst-desktop",
        hostname: "DESKTOP",
        status: "online",
      });
      mockedList.mockResolvedValue([mbp, desktop]);
      mockedUpsert.mockResolvedValue({} as never);
      const onConfigured = vi.fn();

      render(
        <WorkspaceAccessGuide
          workspaceId="ws-1"
          onConfigured={onConfigured}
          initial={{
            daemon_id: "inst-mbp",
            root_path: "/Users/me/old-code",
          }}
        />,
      );

      await screen.findByText("✏ 编辑我的接入配置");

      // 改 daemon 到 desktop
      fireEvent.change(screen.getByLabelText("绑定守护进程"), {
        target: { value: "inst-desktop" },
      });
      // 改路径
      fireEvent.change(screen.getByPlaceholderText("/Users/you/code/project"), {
        target: { value: "/Users/me/new-code" },
      });
      // 点保存修改
      fireEvent.click(screen.getByText("保存修改"));

      await waitFor(() =>
        expect(mockedUpsert).toHaveBeenCalledWith("ws-1", {
          daemon_id: "inst-desktop",
          root_path: "/Users/me/new-code",
          path_source: "daemon-client",
        }),
      );
      expect(onConfigured).toHaveBeenCalledTimes(1);
    });
  });
});
