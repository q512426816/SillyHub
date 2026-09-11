/**
 * SourceManageCard 组件级用例（变更 2026-09-11-skills-central-library / task-04）。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-09-11-skills-central-library/tasks/task-04.md
 *     （implementation：组件级用例 mock apiFetch 断言请求路径与方法）
 *   - backend/app/modules/skill_source/router.py（task-03 端点契约）
 *
 * 覆盖:
 *   1. 源卡渲染：url 短显 / branch 徽标 / subdir / commit 短显(slice 7) / last_error 告警文本
 *   2. enabled 源级开关 → PATCH /api/skill-sources/{id}（json {enabled:false}）
 *   3. 新增表单 → POST /api/skill-sources（url/branch/subdir body）
 *   4. 手动刷新 → POST /api/skill-sources/{id}/refresh
 *   5. 删除（confirm 后）→ DELETE /api/skill-sources/{id}
 *
 * 测试模式：mock @/lib/api 的 apiFetch（按 path+method 路由）+ AntApp 包裹
 * （useNotify 走 antd App.useApp）+ 独立 QueryClient，照 settings/mcp/page.test.tsx 脚手架。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { ReactElement } from "react";

import { SourceManageCard } from "@/components/skills-library/source-manage-card";
import type { SkillSourceRead } from "@/components/skills-library/skill-source-api";

// ── apiFetch mock（按 path+method 路由；断言请求路径与方法） ───────────────

const api = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: api.fetch,
}));

function makeSource(over: Partial<SkillSourceRead> = {}): SkillSourceRead {
  return {
    id: "src-1",
    url: "https://github.com/foo/skills-repo.git",
    branch: "main",
    subdir: null,
    enabled: true,
    last_commit: "abcdef1234567890",
    last_fetched_at: "2026-09-11T00:00:00Z",
    last_error: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-11T00:00:00Z",
    ...over,
  };
}

function renderCard(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
}

const SOURCE = makeSource();

/** library 端点返回的源列表（invalidate 后 refetch 复用同一 mock 实现）。 */
let librarySources: SkillSourceRead[] = [SOURCE];

function routeFetch() {
  api.fetch.mockImplementation(
    async (path: string, opts?: { method?: string; json?: unknown }) => {
      const method = opts?.method ?? "GET";
      if (path === "/api/skills/library") {
        return { sources: librarySources, skills: [] };
      }
      if (path === "/api/skill-sources" && method === "POST") {
        const created = makeSource({
          id: "src-2",
          url: (opts?.json as { url: string }).url,
        });
        librarySources = [...librarySources, created];
        return created;
      }
      if (path === "/api/skill-sources/src-1" && method === "PATCH") {
        return makeSource({ ...(opts?.json as Partial<SkillSourceRead>) });
      }
      if (path === "/api/skill-sources/src-1" && method === "DELETE") {
        librarySources = librarySources.filter((s) => s.id !== "src-1");
        return undefined;
      }
      if (path === "/api/skill-sources/src-1/refresh") {
        return makeSource({ last_commit: "fffccc123", last_error: null });
      }
      throw new Error(`unexpected apiFetch: ${method} ${path}`);
    },
  );
}

beforeEach(() => {
  librarySources = [SOURCE];
  routeFetch();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SourceManageCard（admin 源管理区块）", () => {
  it("渲染源卡：url 短显 + branch 徽标 + subdir + commit 短显 + last_error 告警", async () => {
    librarySources = [
      makeSource({
        subdir: "skills",
        last_commit: "abcdef1234567890",
        last_error: "git pull 失败：网络超时",
      }),
    ];
    renderCard(<SourceManageCard />);

    // url 剥 https:// 短显
    expect(await screen.findByText("github.com/foo/skills-repo.git")).toBeInTheDocument();
    // branch 徽标 + subdir 徽标
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("skills")).toBeInTheDocument();
    // commit 短显（slice 7）
    expect(await screen.findByText("abcdef1")).toBeInTheDocument();
    // last_error 告警色文本（destructive）
    expect(screen.getByTestId("source-last-error-src-1").textContent).toContain(
      "git pull 失败：网络超时",
    );
  });

  it("enabled 开关 → PATCH /api/skill-sources/{id}（json enabled=false）", async () => {
    renderCard(<SourceManageCard />);
    const sw = await screen.findByRole("switch", { name: /源开关/ });
    expect(sw).toBeEnabled();

    fireEvent.click(sw);

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith("/api/skill-sources/src-1", {
        method: "PATCH",
        json: { enabled: false },
      });
    });
  });

  it("新增表单：url/branch/subdir → POST /api/skill-sources", async () => {
    renderCard(<SourceManageCard />);
    await screen.findByText("github.com/foo/skills-repo.git");

    fireEvent.change(screen.getByTestId("source-form-url"), {
      target: { value: "https://github.com/bar/another-repo.git" },
    });
    fireEvent.change(screen.getByTestId("source-form-branch"), {
      target: { value: "release" },
    });
    fireEvent.change(screen.getByTestId("source-form-subdir"), {
      target: { value: "agents/skills" },
    });
    fireEvent.click(screen.getByText("添加源"));

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith("/api/skill-sources", {
        method: "POST",
        json: {
          url: "https://github.com/bar/another-repo.git",
          branch: "release",
          subdir: "agents/skills",
        },
      });
    });
  });

  it("手动刷新 → POST /api/skill-sources/{id}/refresh", async () => {
    renderCard(<SourceManageCard />);
    fireEvent.click(await screen.findByText("刷新"));

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith("/api/skill-sources/src-1/refresh", {
        method: "POST",
      });
    });
  });

  it("删除（confirm 后）→ DELETE /api/skill-sources/{id}", async () => {
    renderCard(<SourceManageCard />);
    fireEvent.click(await screen.findByText("删除"));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith("/api/skill-sources/src-1", {
        method: "DELETE",
      });
    });
  });
});
