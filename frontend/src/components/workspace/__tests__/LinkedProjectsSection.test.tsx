/**
 * LinkedProjectsSection 组件测试(change 2026-07-28-ppm-project-link-workspace task-12)。
 *
 * 契约(对称验证工作区侧,与 LinkWorkspaceDialog 同表):
 *  - 挂载 → listLinkedProjects(workspaceId) + listProjects() 并行,渲染已关联 + 可选
 *  - 点「绑定」→ linkProject(workspaceId, projId) → 刷新
 *  - 点「解绑」→ unlinkProject(workspaceId, projId) → 刷新
 * mock task-09 的 API 客户端 + ppm/project 列表源。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkedProjectsSection } from "@/components/workspace/LinkedProjectsSection";
import type { ProjectMaintenance } from "@/lib/ppm/types";

const workspaceApi = vi.hoisted(() => ({
  listLinkedProjects: vi.fn(),
  linkProject: vi.fn(),
  unlinkProject: vi.fn(),
}));
const projectApi = vi.hoisted(() => ({
  listProjects: vi.fn(),
}));

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return {
    ...actual,
    listLinkedProjects: workspaceApi.listLinkedProjects,
    linkProject: workspaceApi.linkProject,
    unlinkProject: workspaceApi.unlinkProject,
  };
});

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return {
    ...actual,
    listProjects: projectApi.listProjects,
  };
});

function makeProject(overrides: Partial<ProjectMaintenance> = {}): ProjectMaintenance {
  return {
    id: "proj-1",
    project_name: "项目甲",
    project_code: "P-001",
    project_status: "1",
    ...overrides,
  } as unknown as ProjectMaintenance;
}

describe("LinkedProjectsSection（task-12 / 工作区侧关联项目）", () => {
  afterEach(() => {
    cleanup();
    workspaceApi.listLinkedProjects.mockReset();
    workspaceApi.linkProject.mockReset();
    workspaceApi.unlinkProject.mockReset();
    projectApi.listProjects.mockReset();
  });

  it("挂载 → 拉取已关联 + 全量项目,渲染可选项目与「绑定」按钮", async () => {
    workspaceApi.listLinkedProjects.mockResolvedValue([]);
    projectApi.listProjects.mockResolvedValue([makeProject()]);

    render(<LinkedProjectsSection workspaceId="ws-1" />);

    await waitFor(() => {
      expect(workspaceApi.listLinkedProjects).toHaveBeenCalledWith("ws-1");
      expect(projectApi.listProjects).toHaveBeenCalled();
    });
    expect(await screen.findByText("项目甲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "绑定" })).toBeInTheDocument();
  });

  it("点「绑定」→ linkProject(ws-1, proj-1) 被调用", async () => {
    workspaceApi.listLinkedProjects.mockResolvedValue([]);
    projectApi.listProjects.mockResolvedValue([makeProject()]);

    render(<LinkedProjectsSection workspaceId="ws-1" />);

    const bindBtn = await screen.findByRole("button", { name: "绑定" });
    fireEvent.click(bindBtn);

    await waitFor(() => {
      expect(workspaceApi.linkProject).toHaveBeenCalledWith("ws-1", "proj-1");
    });
  });

  it("点「解绑」→ unlinkProject(ws-1, proj-1) 被调用", async () => {
    workspaceApi.listLinkedProjects.mockResolvedValue([
      { project_id: "proj-1", project_name: "项目甲", project_status: "1" },
    ]);
    projectApi.listProjects.mockResolvedValue([]);

    render(<LinkedProjectsSection workspaceId="ws-1" />);

    const unbindBtn = await screen.findByRole("button", { name: "解绑" });
    fireEvent.click(unbindBtn);

    await waitFor(() => {
      expect(workspaceApi.unlinkProject).toHaveBeenCalledWith("ws-1", "proj-1");
    });
  });
});
