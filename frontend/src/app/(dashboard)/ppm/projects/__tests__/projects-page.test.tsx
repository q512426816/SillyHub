/**
 * 项目维护页面测试：行操作「Agent 团队」入口跳转。
 *
 * 覆盖：
 * 1. 列表加载后每行显示「Agent 团队」按钮
 * 2. 点击按钮跳转到 /projects/{id}/missions
 *
 * mock 范式：
 * - vi.hoisted 同组 vi.fn；
 * - 部分 mock @/lib/ppm/project（保留类型与 ApiError 真身）；
 * - next/navigation mock useRouter；
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PpmProjectsPage from "@/app/(dashboard)/ppm/projects/page";
import type { ProjectMaintenance } from "@/lib/ppm/types";

const mocks = vi.hoisted(() => ({
  pageProjects: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/ppm/project", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ppm/project")>("@/lib/ppm/project");
  return { ...actual, pageProjects: mocks.pageProjects };
});

vi.mock("next/navigation", async () => {
  const actual =
    await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push: mocks.push }),
  };
});

const sampleProject: ProjectMaintenance = {
  id: "proj-uuid-1",
  project_code: "P2024001",
  project_name: "示例项目",
  company_name: "示例公司",
  project_type: "1",
  project_status: "1",
  create_name: "admin",
  project_effective_start_time: "2024-01-01T00:00:00Z",
  project_effective_end_time: "2024-12-31T00:00:00Z",
  project_maintenance_end_time: "2025-12-31T00:00:00Z",
  created_by: "user-uuid",
  updated_by: "user-uuid",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const renderPage = () => render(<PpmProjectsPage />);

describe("PpmProjectsPage / 发起团队入口", () => {
  beforeEach(() => {
    mocks.pageProjects.mockResolvedValue({
      items: [sampleProject],
      total: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders 发起团队 action button for each project row", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("示例项目")).toBeInTheDocument();
    });

    const teamButton = screen.getByRole("button", { name: /发起\s*团队/ });
    expect(teamButton).toBeInTheDocument();
  });

  it("navigates to /sessions?new=1 (直达新建预会话，ql-20260823-005) on click", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("示例项目")).toBeInTheDocument();
    });

    const teamButton = screen.getByRole("button", { name: /发起\s*团队/ });
    teamButton.click();

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/sessions?new=1");
    });
  });
});
