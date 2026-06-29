import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import CreateChangePage from "@/app/(dashboard)/workspaces/[id]/create-change/page";
import { ApiError } from "@/lib/api";
import type { CreateChangeResponse } from "@/lib/changes";
import type { DaemonRuntimeRead } from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";

const mocks = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  listComponents: vi.fn(),
  createChange: vi.fn(),
  proxyCreateChange: vi.fn(),
  listDaemonRuntimes: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: mocks.routerBack,
    push: mocks.routerPush,
  }),
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({
      href,
      children,
      ...props
    }: {
      href: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) => React.createElement("a", { ...props, href }, children),
  };
});

vi.mock("@/lib/components", () => ({
  listComponents: mocks.listComponents,
}));

vi.mock("@/lib/changes", () => ({
  createChange: mocks.createChange,
  proxyCreateChange: mocks.proxyCreateChange,
}));

vi.mock("@/lib/daemon", () => ({
  listDaemonRuntimes: mocks.listDaemonRuntimes,
}));

vi.mock("@/lib/workspaces", () => ({
  getWorkspace: mocks.getWorkspace,
}));

function mkWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Demo",
    slug: "demo",
    root_path: "C:/demo",
    path_source: "server-local",
    daemon_runtime_id: null,
    status: "active",
    component_key: null,
    type: null,
    role: null,
    repo_url: null,
    default_branch: null,
    default_agent: null,
    default_model: null,
    tech_stack: [],
    build_command: null,
    test_command: null,
    source_yaml_path: null,
    created_by: null,
    created_at: "2026-06-26T00:00:00Z",
    updated_at: "2026-06-26T00:00:00Z",
    last_scanned_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function mkRuntime(
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id: "rt-1",
    display_alias: null,
    name: "daemon",
    provider: "claude",
    version: "1.0.0",
    os: "win32",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-06-26T00:00:00Z",
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-06-26T00:00:00Z",
    updated_at: "2026-06-26T00:00:00Z",
    ...overrides,
  };
}

function mkCreateResponse(
  overrides: Partial<CreateChangeResponse> = {},
): CreateChangeResponse {
  return {
    id: "ch-1",
    workspace_id: "ws-1",
    change_key: "2026-06-26-demo",
    title: "demo",
    status: "draft",
    path: "changes/2026-06-26-demo",
    current_stage: "draft",
    created_at: "2026-06-26T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(<CreateChangePage params={{ id: "ws-1" }} />);
}

function fillDescription(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/描述你的需求/), {
    target: { value: text },
  });
}

describe("CreateChangePage daemon-client proxy create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listComponents.mockResolvedValue({ items: [], total: 0 });
    mocks.getWorkspace.mockResolvedValue(mkWorkspace());
    mocks.listDaemonRuntimes.mockResolvedValue([]);
    mocks.createChange.mockResolvedValue(mkCreateResponse());
    mocks.proxyCreateChange.mockResolvedValue(mkCreateResponse());
  });

  it("daemon-client 工作区且 daemon 在线时走 proxy-create 并带 runtime_id", async () => {
    mocks.getWorkspace.mockResolvedValue(
      mkWorkspace({
        path_source: "daemon-client",
        daemon_runtime_id: "rt-1",
      }),
    );
    mocks.listDaemonRuntimes.mockResolvedValue([mkRuntime({ id: "rt-1" })]);

    renderPage();
    fillDescription("支持 daemon 代写");
    const submit = screen.getByRole("button", { name: "提交需求" });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.proxyCreateChange).toHaveBeenCalledWith("ws-1", {
        title: "支持 daemon 代写",
        description: "支持 daemon 代写",
        change_type: undefined,
        runtime_id: "rt-1",
      }),
    );
    expect(mocks.createChange).not.toHaveBeenCalled();
    expect(mocks.routerPush).toHaveBeenCalledWith("/workspaces/ws-1/changes/ch-1");
  });

  it("daemon-client 工作区 daemon 离线时禁用提交并显示 title 引导", async () => {
    mocks.getWorkspace.mockResolvedValue(
      mkWorkspace({
        path_source: "daemon-client",
        daemon_runtime_id: "rt-1",
      }),
    );
    mocks.listDaemonRuntimes.mockResolvedValue([
      mkRuntime({ id: "rt-1", status: "offline" }),
    ]);

    renderPage();
    fillDescription("离线时不能创建");
    const submit = screen.getByRole("button", { name: "提交需求" });

    await waitFor(() =>
      expect(submit).toHaveAttribute(
        "title",
        "需要在线 daemon 才能在客户端工作区创建变更",
      ),
    );
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(mocks.proxyCreateChange).not.toHaveBeenCalled();
    expect(mocks.createChange).not.toHaveBeenCalled();
  });

  it("proxy-create 返回 DAEMON_CLIENT_NO_SESSION 时显示中文引导", async () => {
    mocks.getWorkspace.mockResolvedValue(
      mkWorkspace({
        path_source: "daemon-client",
        daemon_runtime_id: "rt-1",
      }),
    );
    mocks.listDaemonRuntimes.mockResolvedValue([mkRuntime({ id: "rt-1" })]);
    mocks.proxyCreateChange.mockRejectedValue(
      new ApiError(400, {
        code: "DAEMON_CLIENT_NO_SESSION",
        message: "backend",
        request_id: "req-1",
        details: null,
      }),
    );

    renderPage();
    fillDescription("提交时 daemon 掉线");
    const submit = screen.getByRole("button", { name: "提交需求" });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);

    await waitFor(() =>
      expect(
        screen.getByText(
          "当前 daemon 未在线，无法在客户端工作区创建变更，请启动 daemon 后重试",
        ),
      ).toBeInTheDocument(),
    );
    expect(mocks.createChange).not.toHaveBeenCalled();
  });

  it("server-local 工作区保持原 createChange 行为", async () => {
    mocks.getWorkspace.mockResolvedValue(
      mkWorkspace({ path_source: "server-local", daemon_runtime_id: null }),
    );

    renderPage();
    fillDescription("服务端本地创建");
    const submit = screen.getByRole("button", { name: "提交需求" });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.createChange).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          title: "服务端本地创建",
          description: "服务端本地创建",
        }),
      ),
    );
    expect(mocks.proxyCreateChange).not.toHaveBeenCalled();
    expect(mocks.routerPush).toHaveBeenCalledWith("/workspaces/ws-1/changes/ch-1");
  });
});
