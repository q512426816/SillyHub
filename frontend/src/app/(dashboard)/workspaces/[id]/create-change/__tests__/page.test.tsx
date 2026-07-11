import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import CreateChangePage from "@/app/(dashboard)/workspaces/[id]/create-change/page";
import { ApiError } from "@/lib/api";
import type { CreateChangeResponse } from "@/lib/changes";
import type { Workspace } from "@/lib/workspaces";

const mocks = vi.hoisted(() => ({
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  listComponents: vi.fn(),
  createChange: vi.fn(),
  proxyCreateChange: vi.fn(),
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

vi.mock("@/lib/workspaces", () => ({
  getWorkspace: mocks.getWorkspace,
}));

function mkWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Demo",
    slug: "demo",
    root_path: "C:/demo",
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

describe("CreateChangePage proxy-create（2026-07-10 平台统一 daemon-client）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listComponents.mockResolvedValue({ items: [], total: 0 });
    mocks.getWorkspace.mockResolvedValue(mkWorkspace());
    mocks.createChange.mockResolvedValue(mkCreateResponse());
    mocks.proxyCreateChange.mockResolvedValue(mkCreateResponse());
  });

  it("走 proxy-create 且不传 runtime_id（D-002@v1）", async () => {
    // D-002@v1（2026-07-05-daemon-client-change-binding-fix）：runtime_id 不再由前端传，
    // 后端从 binding + workspace.default_agent 现算。前端不再校验 daemon 在线状态。
    // 2026-07-10：平台统一 daemon-client 语义后所有工作区都走 proxy-create。
    mocks.getWorkspace.mockResolvedValue(mkWorkspace());

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
      }),
    );
    expect(mocks.createChange).not.toHaveBeenCalled();
    expect(mocks.routerPush).toHaveBeenCalledWith("/workspaces/ws-1/changes/ch-1");
  });

  it("proxy-create 返回 DAEMON_CLIENT_NO_SESSION 时显示中文引导", async () => {
    // daemon 在线状态由后端心跳校验；离线时返回 DAEMON_CLIENT_NO_SESSION，前端渲染引导。
    mocks.getWorkspace.mockResolvedValue(mkWorkspace());
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
});
