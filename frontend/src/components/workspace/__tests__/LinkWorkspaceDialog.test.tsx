/**
 * LinkWorkspaceDialog 组件测试(change 2026-07-28-ppm-project-link-workspace task-12)。
 *
 * 契约(对称验证项目侧):
 *  - 打开 → listProjectWorkspaces(projectId) + listWorkspaces() 并行,渲染已关联 + 可选
 *  - 点「绑定」→ linkWorkspace(projectId, wsId) → 刷新列表
 *  - 点「解绑」→ unlinkWorkspace(projectId, wsId) → 刷新列表
 * mock task-09 的 API 客户端,验证调用参数 + 列表反映。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkWorkspaceDialog } from "@/components/workspace/LinkWorkspaceDialog";
import type { Workspace } from "@/lib/workspaces";

const workspaceApi = vi.hoisted(() => ({
  listProjectWorkspaces: vi.fn(),
  linkWorkspace: vi.fn(),
  unlinkWorkspace: vi.fn(),
}));
const workspacesApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return {
    ...actual,
    listProjectWorkspaces: workspaceApi.listProjectWorkspaces,
    linkWorkspace: workspaceApi.linkWorkspace,
    unlinkWorkspace: workspaceApi.unlinkWorkspace,
  };
});

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return {
    ...actual,
    listWorkspaces: workspacesApi.listWorkspaces,
  };
});

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "工作区A",
    slug: "ws-a",
    root_path: "/ws-a",
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
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    last_scanned_at: null,
    deleted_at: null,
    owner: null,
    ...overrides,
  } as unknown as Workspace;
}

describe("LinkWorkspaceDialog（task-12 / 项目侧关联工作区）", () => {
  afterEach(() => {
    cleanup();
    workspaceApi.listProjectWorkspaces.mockReset();
    workspaceApi.linkWorkspace.mockReset();
    workspaceApi.unlinkWorkspace.mockReset();
    workspacesApi.listWorkspaces.mockReset();
  });

  it("打开 → 拉取已关联 + 全量,渲染弹窗标题与可选工作区", async () => {
    workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [makeWorkspace({ id: "ws-1", name: "工作区A" })],
      total: 1,
    });

    render(
      <LinkWorkspaceDialog
        open
        projectId="proj-1"
        projectName="项目甲"
        onClose={() => {}}
      />,
    );

    // 标题含项目名
    await waitFor(() => {
      expect(workspaceApi.listProjectWorkspaces).toHaveBeenCalledWith("proj-1");
      expect(workspacesApi.listWorkspaces).toHaveBeenCalled();
    });
    // 可选列表渲染工作区A
    expect(await screen.findByText("工作区A")).toBeInTheDocument();
    // 有「绑定」按钮(antd 两字汉字按钮自动插空格「绑 定」→ 用正则容错)
    expect(screen.getByRole("button", { name: /绑\s*定/ })).toBeInTheDocument();
  });

  it("点「绑定」→ linkWorkspace(proj-1, ws-1) 被调用", async () => {
    workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [makeWorkspace({ id: "ws-1", name: "工作区A" })],
      total: 1,
    });

    render(
      <LinkWorkspaceDialog
        open
        projectId="proj-1"
        projectName="项目甲"
        onClose={() => {}}
      />,
    );

    const bindBtn = await screen.findByRole("button", { name: /绑\s*定/ });
    fireEvent.click(bindBtn);

    await waitFor(() => {
      expect(workspaceApi.linkWorkspace).toHaveBeenCalledWith("proj-1", "ws-1");
    });
  });

  it("点「解绑」→ unlinkWorkspace(proj-1, ws-1) 被调用", async () => {
    // 已关联 ws-1 → 列表渲染「解绑」按钮
    workspaceApi.listProjectWorkspaces.mockResolvedValue([
      { workspace_id: "ws-1", name: "工作区A", status: "active", type: null },
    ]);
    workspacesApi.listWorkspaces.mockResolvedValue({ items: [], total: 0 });

    render(
      <LinkWorkspaceDialog
        open
        projectId="proj-1"
        projectName="项目甲"
        onClose={() => {}}
      />,
    );

    const unbindBtn = await screen.findByRole("button", { name: /解\s*绑/ });
    fireEvent.click(unbindBtn);

    await waitFor(() => {
      expect(workspaceApi.unlinkWorkspace).toHaveBeenCalledWith("proj-1", "ws-1");
    });
  });
});
