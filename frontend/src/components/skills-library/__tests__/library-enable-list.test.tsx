/**
 * LibraryEnableList 组件级用例（变更 2026-09-11-skills-central-library / task-04）。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-09-11-skills-central-library/tasks/task-04.md
 *     （acceptance：git 默认未启用 D-003 / 开关乐观回滚 / 成功后失效刷新 manifest）
 *   - backend/app/modules/skill_source/schema.py（LibraryView/LibrarySkillItem 契约：
 *     git skill_key = <source_id>:<目录名> 恒含冒号；sillyspec/custom 恒启用不可 enable）
 *
 * 覆盖:
 *   1. 三源分组渲染（系统自带/我的自定义/git 按源分组，组头带源 url+branch）
 *   2. git 技能默认未启用（D-003）+ sillyspec/custom「恒启用」无开关
 *   3. 打开开关 → POST /api/skills/{encodeURIComponent(skill_key)}/enable
 *      （skill_key 含冒号 → %3A 编码）+ 成功后失效 library 与 manifest
 *   4. 乐观更新失败回滚：POST 拒绝 → 开关回到未启用
 *   5. 关闭已启用开关 → DELETE /api/skills/{skill_key}/enable
 *
 * 测试模式：mock @/lib/api 的 apiFetch（按 path+method 路由）+ AntApp 包裹 +
 * 独立 QueryClient（invalidateQueries spy 验证 manifest 失效）。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { ReactElement } from "react";

import { LibraryEnableList } from "@/components/skills-library/library-enable-list";
import type { LibraryView } from "@/components/skills-library/skill-source-api";

// ── apiFetch mock（按 path+method 路由） ───────────────────────────────────

const api = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: api.fetch,
}));

const GIT_SKILL_KEY = "src-1:deploy-helper";

const LIBRARY: LibraryView = {
  sources: [
    {
      id: "src-1",
      url: "https://github.com/foo/skills-repo.git",
      branch: "main",
      subdir: null,
      enabled: true,
      last_commit: "abcdef1",
      last_fetched_at: "2026-09-11T00:00:00Z",
      last_error: null,
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-11T00:00:00Z",
    },
  ],
  skills: [
    {
      skill_key: "sillyspec-archive",
      name: "sillyspec-archive",
      description: "归档变更",
      source: "sillyspec",
      enabled: true,
      source_id: null,
    },
    {
      skill_key: "my-helper",
      name: "my-helper",
      description: "辅助技能",
      source: "custom",
      enabled: true,
      source_id: null,
    },
    {
      skill_key: GIT_SKILL_KEY,
      name: "deploy-helper",
      description: "部署辅助",
      source: "git",
      enabled: false,
      source_id: "src-1",
    },
  ],
};

/** enable POST 行为开关：默认成功；rollback 用例切 reject。 */
let enablePostRejects = false;

/** 改 git 技能启用态（生成类型 skills 可选——按 source 定位防索引越界）。 */
function setGitSkillEnabled(enabled: boolean) {
  const git = LIBRARY.skills?.find((s) => s.source === "git");
  if (git) git.enabled = enabled;
}

function routeFetch() {
  api.fetch.mockImplementation(async (path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path === "/api/skills/library") return LIBRARY;
    if (path === `/api/skills/${encodeURIComponent(GIT_SKILL_KEY)}/enable`) {
      if (method === "POST") {
        if (enablePostRejects) throw new Error("boom");
        return undefined;
      }
      if (method === "DELETE") return undefined;
    }
    throw new Error(`unexpected apiFetch: ${method} ${path}`);
  });
}

function renderList(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy };
}

beforeEach(() => {
  enablePostRejects = false;
  routeFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LibraryEnableList（技能库区块，全员）", () => {
  it("三源分组渲染：组头 + 行徽标（系统自带/我的自定义/git）+ git 组头带源信息", async () => {
    renderList(<LibraryEnableList />);

    // 三个组头
    expect(await screen.findByText("系统自带（sillyspec）")).toBeInTheDocument();
    expect(screen.getByText("我的自定义技能")).toBeInTheDocument();
    expect(screen.getByText("git 技能源")).toBeInTheDocument();
    // git 组头 extra：源 url 短显 @ branch
    expect(screen.getByText("github.com/foo/skills-repo.git @ main")).toBeInTheDocument();

    // 行 name + source 徽标
    expect(screen.getByText("sillyspec-archive")).toBeInTheDocument();
    expect(screen.getByText("my-helper")).toBeInTheDocument();
    expect(screen.getByText("deploy-helper")).toBeInTheDocument();
    expect(screen.getByText("git", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("系统自带", { exact: true }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("我的自定义", { exact: true }).length).toBeGreaterThanOrEqual(1);
  });

  it("git 技能默认未启用（D-003）；sillyspec/custom 恒启用无开关", async () => {
    renderList(<LibraryEnableList />);

    const sw = await screen.findByRole("switch", { name: "启用技能 deploy-helper" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("未启用")).toBeInTheDocument();
    // 三行只有 git 一个开关
    expect(screen.getAllByRole("switch").length).toBe(1);
    expect(screen.getAllByText("恒启用").length).toBe(2);
  });

  it("打开开关 → POST enable（skill_key 冒号 %3A 编码）+ 成功后失效 library 与 manifest", async () => {
    const { invalidateSpy } = renderList(<LibraryEnableList />);
    const sw = await screen.findByRole("switch", { name: "启用技能 deploy-helper" });

    fireEvent.click(sw);

    // 冒号 URL 编码（encodeURIComponent → %3A）
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        "/api/skills/src-1%3Adeploy-helper/enable",
        { method: "POST", json: { enabled: true } },
      );
    });
    // 成功后失效：library（启用态以服务端为准）+ manifest（bundle version 随启用变化）
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customSkills", "library"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["customSkills", "manifest"] });
    });
  });

  it("乐观更新失败回滚：POST 拒绝 → 开关回到未启用", async () => {
    enablePostRejects = true;
    renderList(<LibraryEnableList />);
    const sw = await screen.findByRole("switch", { name: "启用技能 deploy-helper" });
    expect(screen.getByText("未启用")).toBeInTheDocument();

    fireEvent.click(sw);

    // 乐观翻转瞬间可见「已启用」，失败后回滚「未启用」
    await waitFor(
      () => {
        expect(screen.getByText("未启用")).toBeInTheDocument();
        expect(sw.getAttribute("aria-checked")).toBe("false");
      },
      { timeout: 3000 },
    );
  });

  it("关闭已启用开关 → DELETE /api/skills/{skill_key}/enable", async () => {
    // 服务端该 git 技能已启用（用户此前开过）
    setGitSkillEnabled(true);
    routeFetch();
    renderList(<LibraryEnableList />);
    const sw = await screen.findByRole("switch", { name: "启用技能 deploy-helper" });
    expect(sw.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sw);

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith(
        "/api/skills/src-1%3Adeploy-helper/enable",
        { method: "DELETE" },
      );
    });
    setGitSkillEnabled(false);
  });
});
