/**
 * LinkWorkspaceDialog 组件测试(change 2026-07-28-ppm-project-link-workspace task-12)。
 *
 * 契约(对称验证项目侧):
 *  - 打开 → listProjectWorkspaces(projectId) + listWorkspaces() 并行,渲染已关联 + 可选
 *  - 点「绑定」→ linkWorkspace(projectId, wsId) → 刷新列表
 *  - 点「解绑」→ unlinkWorkspace(projectId, wsId) → 刷新列表
 * mock task-09 的 API 客户端,验证调用参数 + 列表反映。
 *
 * task-07 / 2026-08-18-workspace-role-type / FR-06:补类型徽标断言——
 * 已关联/可选两侧列表按 workspaceTypeBadge 渲染(词表值→中文标签,如
 * frontend-code→「前端代码」;null→「未分类」灰兜底),li title 带 role/description 摘要。
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
    // task-07 / FR-06:makeWorkspace 默认 type=null → 可选列表渲染「未分类」灰徽标
    expect(screen.getByText("未分类")).toBeInTheDocument();
  });

  // ── task-07 / FR-06:类型徽标 + title 摘要 ───────────────────────────────────

  it("已关联列表:type=frontend-code 渲染「前端代码」徽标,title 带 role/description 摘要", async () => {
    workspaceApi.listProjectWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-1",
        name: "工作区A",
        status: "active",
        type: "frontend-code",
        role: "订单模块",
        description: "订单域前端界面与交互",
      },
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

    // 词表值 → 中文标签徽标;原始字符串 frontend-code 不再直接出现
    expect(await screen.findByText("前端代码")).toBeInTheDocument();
    expect(screen.queryByText("frontend-code")).not.toBeInTheDocument();
    // li title 摘要(两段拼接)
    expect(
      screen.getByTitle("角色:订单模块 描述:订单域前端界面与交互"),
    ).toBeInTheDocument();
  });

  it("已关联列表:type=null 渲染「未分类」徽标,role/description 皆空不带 title", async () => {
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

    expect(await screen.findByText("未分类")).toBeInTheDocument();
    // 已关联行 li:两段摘要皆空 → 不挂 title
    const unbindBtn = screen.getByRole("button", { name: /解\s*绑/ });
    const li = unbindBtn.closest("li");
    expect(li).not.toHaveAttribute("title");
  });

  it("可选列表:type=backend-code 渲染「后端代码」徽标", async () => {
    workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
    workspacesApi.listWorkspaces.mockResolvedValue({
      items: [makeWorkspace({ id: "ws-1", name: "工作区A", type: "backend-code" })],
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

    expect(await screen.findByText("后端代码")).toBeInTheDocument();
    expect(screen.queryByText("未分类")).not.toBeInTheDocument();
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
