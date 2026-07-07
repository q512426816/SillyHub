/**
 * task-10 / 变更 2026-07-07-skills-mcp-management-ui：workspace 详情 Skills 子页单测。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（响应契约 { skills:[{name,files}] }）
 *   - backend/app/modules/workspace/router.py:316（GET /api/workspaces/{id}/skills）
 *
 * 覆盖:
 *   1. 渲染 skill 名 + 文件清单（含 relpath，AC-列表）
 *   2. 空状态（skills:[]）
 *   3. 错误态（apiFetch reject）
 *   4. 只读：DOM 不含编辑/删除/上传按钮
 *   5. apiFetch 被以正确 URL 调用
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SkillsPage from "@/app/(dashboard)/workspaces/[id]/skills/page";
import { ApiError } from "@/lib/api";

// next/link mock（jsdom 下 Link 不需要真实路由）
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// apiFetch mock：拦截真实网络，按测试 case 返回数据/抛错。
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("workspace skills 子页（task-10）", () => {
  it("渲染 skill 名 + 文件清单", async () => {
    apiFetchMock.mockResolvedValueOnce({
      skills: [
        {
          name: "deploy-helper",
          files: ["SKILL.md", "scripts/run.sh"],
        },
        { name: "doc-gen", files: ["SKILL.md"] },
      ],
    });

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("deploy-helper")).toBeInTheDocument();
    });
    expect(screen.getByText("doc-gen")).toBeInTheDocument();
    // 文件清单 relpath（两 skill 都有 SKILL.md，用 getAllByText）
    expect(screen.getAllByText("SKILL.md")).toHaveLength(2);
    expect(screen.getByText("scripts/run.sh")).toBeInTheDocument();
    // 文件数徽标
    expect(screen.getByText("2 个文件")).toBeInTheDocument();
    expect(screen.getByText("1 个文件")).toBeInTheDocument();
    // URL 正确
    expect(apiFetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1/skills");
  });

  it("空状态展示", async () => {
    apiFetchMock.mockResolvedValueOnce({ skills: [] });

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("暂无自定义 skill")).toBeInTheDocument();
    });
  });

  it("错误态展示", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(500, {
        code: "internal_error",
        message: "加载失败",
        request_id: null,
        details: null,
      }),
    );

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
  });

  it("只读——无编辑/删除/上传按钮", async () => {
    apiFetchMock.mockResolvedValueOnce({
      skills: [{ name: "deploy-helper", files: ["SKILL.md"] }],
    });

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("deploy-helper")).toBeInTheDocument();
    });

    // 全文不应出现编辑/删除/上传/新增类按钮文案
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/编辑|删除|上传|新增|创建/);
  });
});
