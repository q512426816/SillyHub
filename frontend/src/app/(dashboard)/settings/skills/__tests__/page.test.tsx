/**
 * 2026-07-07-skills-mcp-management-ui task-08：/settings/skills 页单测。
 * （skills-settings-p0-fixup task-04：补 useNotify mock + amber banner 断言 +
 *  placeholder 适配步骤模板。）
 * （2026-07-31-custom-skill-per-user task-13：task-09 把 is_platform_admin 门槛移除 →
 *  登录用户即可见 CRUD 按钮，amber banner 删除；新增按钮权限 + per-user 列表用例。）
 *
 * 依据文档:
 *   - .sillyspec/changes/skills-settings-p0-fixup/design.md（P0-3/4 + D-005）
 *   - .sillyspec/changes/2026-07-31-custom-skill-per-user/tasks/task-09.md / task-13.md
 *
 * 覆盖:
 *   1. 平台 skills 只读列表展示 manifest（version + 文件名 + 文件数）（AC-A）
 *   2. 自定义 skills 表格展示 list 数据（AC-B）
 *   3. 登录用户（含非 platform_admin）可见「新增技能」「编辑」「删除」按钮（FR-07）
 *   4. 点击「新增技能」打开弹窗，填写后调 createCustomSkill（AC-B/C）
 *   5. 点击删除 → confirm 后调 deleteCustomSkill
 *   6. per-user 列表：后端按当前 user 过滤，前端按返回值渲染（不二次筛选）
 *
 * 测试模式：照搬 runtimes/__tests__/page.test.tsx 的 QueryClientProvider + useSession mock 脚手架。
 */

import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import SkillsPage from "@/app/(dashboard)/settings/skills/page";

// 每 test 独立 QueryClient（retry:false + gcTime:0）。
function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ── session mock：useSession 既是 zustand hook 又带 .getState()（apiFetch 取 token）。
//    admin / 非 admin 通过切换 session.user 控制。 ─────────────────────────

const session = vi.hoisted(() => ({
  user: { id: "u1", is_platform_admin: true, permissions: [] as string[] },
}));

function buildSessionStore() {
  const store = {
    get user() {
      return session.user;
    },
    accessToken: "test-token",
    refreshToken: "test-refresh",
  };
  const useSessionHook = Object.assign(
    (selector?: (s: typeof store) => unknown) =>
      selector ? selector(store) : store,
    {
      getState: () => store,
      setState: (partial: Partial<typeof store>) => Object.assign(store, partial),
      clear: () => {
        session.user = null as unknown as typeof session.user;
      },
    },
  );
  return { useSession: useSessionHook };
}

vi.mock("@/stores/session", () => buildSessionStore());

// ── custom-skills mock：直接实现 hook，不 importActual，避免真实 listCustomSkills
//    经 react-query queryFn 触发真实 apiFetch fetch（ESM live-binding 在本项目配置下
//    未覆盖 importActual 的同名导出，故自实现 hook 返回 mock 数据更稳）。 ──────────

const skillsApi = vi.hoisted(() => ({
  listCustomSkills: vi.fn(),
  getPlatformSkillsManifest: vi.fn(),
  getCustomSkill: vi.fn(),
  createCustomSkill: vi.fn(),
  updateCustomSkill: vi.fn(),
  deleteCustomSkill: vi.fn(),
}));

vi.mock("@/lib/custom-skills", () => ({
  listCustomSkills: skillsApi.listCustomSkills,
  getPlatformSkillsManifest: skillsApi.getPlatformSkillsManifest,
  getCustomSkill: skillsApi.getCustomSkill,
  createCustomSkill: skillsApi.createCustomSkill,
  updateCustomSkill: skillsApi.updateCustomSkill,
  deleteCustomSkill: skillsApi.deleteCustomSkill,

  useCustomSkills: () => {
    const [skills, setSkills] = React.useState<unknown[]>([]);
    const [err, setErr] = React.useState<{ message: string } | null>(null);
    React.useEffect(() => {
      let on = true;
      skillsApi
        .listCustomSkills()
        .then((v: unknown[]) => on && setSkills(v))
        .catch((e: { message: string }) => on && setErr(e));
      return () => {
        on = false;
      };
    }, []);
    return {
      skills,
      isLoading: false,
      isFetching: false,
      isError: !!err,
      error: err,
      refetch: vi.fn(),
    };
  },

  usePlatformSkillsManifest: () => {
    const [manifest, setManifest] = React.useState<unknown>(null);
    const [err, setErr] = React.useState<{ message: string } | null>(null);
    React.useEffect(() => {
      let on = true;
      skillsApi
        .getPlatformSkillsManifest()
        .then((v: unknown) => on && setManifest(v))
        .catch((e: { message: string }) => on && setErr(e));
      return () => {
        on = false;
      };
    }, []);
    return {
      manifest,
      isLoading: false,
      isError: !!err,
      error: err,
      refetch: vi.fn(),
    };
  },

  useCreateCustomSkill: () => ({
    mutateAsync: skillsApi.createCustomSkill,
    isPending: false,
    isError: false,
  }),
  useUpdateCustomSkill: () => ({
    mutateAsync: skillsApi.updateCustomSkill,
    isPending: false,
    isError: false,
  }),
  useDeleteCustomSkill: () => ({
    mutate: skillsApi.deleteCustomSkill,
    mutateAsync: skillsApi.deleteCustomSkill,
    isPending: false,
    isError: false,
  }),
}));

// ── MarkdownText mock：jsdom 下 next/dynamic ssr:false 渲染 null
//    （记忆 frontend-markdown-text-jsdom-null），mock 成纯文本渲染保证 DOM 可断言。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="md-preview">{content}</div>
  ),
}));

// ── useNotify mock：弹窗 + 页面都用 useNotify（App.useApp().message），测试环境无
//    antd <App> provider，mock 成 vi.fn 避免报错；保留 errMessage 真实实现
//    （页面/弹窗内部仍用 errMessage 解析错误文案）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return {
    ...actual,
    useNotify: () => ({ success: vi.fn(), error: vi.fn() }),
  };
});

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/settings/skills 页", () => {
  beforeEach(() => {
    skillsApi.listCustomSkills.mockResolvedValue([
      {
        id: "s1",
        name: "my-helper",
        description: "一个辅助技能",
        content_preview: "# my-helper\n\n正文预览...",
        created_by: "u1",
        created_at: "2026-07-07T10:00:00Z",
        updated_at: "2026-07-07T11:00:00Z",
      },
    ]);
    skillsApi.getPlatformSkillsManifest.mockResolvedValue({
      version: "abc123def456789",
      files: [
        { path: "sillyspec-foo/SKILL.md", sha256: "aaa" },
        { path: "sillyspec-foo/helpers/x.ts", sha256: "bbb" },
        { path: "sillyspec-bar/SKILL.md", sha256: "ccc" },
      ],
    });
    session.user = { id: "u1", is_platform_admin: true, permissions: [] };
  });

  it("展示平台 skills 只读清单 + version + 文件数", async () => {
    renderPage(<SkillsPage />);

    // 平台 section 标题 + 同步状态徽标
    expect(await screen.findByText("平台 SillySpec 技能（系统自带）")).toBeInTheDocument();
    expect(await screen.findByText("已同步")).toBeInTheDocument();
    // version 短码展示（slice 12）
    expect(await screen.findByText("abc123def456")).toBeInTheDocument();

    // 聚合后的两个 skill 目录 + 文件数（foo=2, bar=1）
    const fooRow = await screen.findByText("sillyspec-foo");
    const fooCells = fooRow.closest("tr");
    expect(fooCells).not.toBeNull();
    expect(within(fooCells!).getByText("2")).toBeInTheDocument();
    const barRow = await screen.findByText("sillyspec-bar");
    const barCells = barRow.closest("tr");
    expect(within(barCells!).getByText("1")).toBeInTheDocument();
  });

  it("展示自定义 skills 表格行（登录用户可见 编辑/删除/新增）", async () => {
    renderPage(<SkillsPage />);

    expect(await screen.findByText("自定义技能（自己加的）")).toBeInTheDocument();
    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    expect(await screen.findByText("一个辅助技能")).toBeInTheDocument();
    // task-09：登录即可见（不再要求 is_platform_admin）
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
    expect(screen.getByText("新增技能")).toBeInTheDocument();
  });

  it("非 admin 登录用户也能见 新增/编辑/删除 按钮（task-09 移除 is_platform_admin 门槛，FR-07）", async () => {
    session.user = { id: "u2", is_platform_admin: false, permissions: [] };
    renderPage(<SkillsPage />);

    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    // task-09 后 amber 只读 banner 已删除
    expect(
      screen.queryByText("仅平台管理员可编辑，当前为只读视图。"),
    ).not.toBeInTheDocument();
    // 非 admin 登录用户即可见这些按钮
    expect(await screen.findByText("新增技能")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
    // 行内不再有「只读」字样
    expect(screen.queryByText("只读")).not.toBeInTheDocument();
  });

  it("非 admin 登录用户点击「新增技能」打开弹窗（FR-07）", async () => {
    session.user = { id: "u2", is_platform_admin: false, permissions: [] };
    renderPage(<SkillsPage />);

    fireEvent.click(await screen.findByText("新增技能"));
    expect(await screen.findByText("新增自定义技能")).toBeInTheDocument();
  });

  it("per-user 列表：渲染后端返回的当前用户技能（created_by 均为当前 user）", async () => {
    // 后端已按当前 user 过滤（task-04），前端直接渲染返回值。
    skillsApi.listCustomSkills.mockResolvedValue([
      {
        id: "s1",
        name: "my-helper",
        description: "一个辅助技能",
        content_preview: "# my-helper\n\n正文预览...",
        created_by: "u1",
        created_at: "2026-07-07T10:00:00Z",
        updated_at: "2026-07-07T11:00:00Z",
      },
      {
        id: "s2",
        name: "another-skill",
        description: "另一个技能",
        content_preview: "# another",
        created_by: "u1",
        created_at: "2026-07-07T10:00:00Z",
        updated_at: "2026-07-07T12:00:00Z",
      },
    ]);
    session.user = { id: "u1", is_platform_admin: false, permissions: [] };

    renderPage(<SkillsPage />);

    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    expect(screen.getByText("another-skill")).toBeInTheDocument();
    expect(screen.getByText("一个辅助技能")).toBeInTheDocument();
    expect(screen.getByText("另一个技能")).toBeInTheDocument();
  });

  it("前端不二次筛选：mock 返回他人技能数据时按后端契约渲染", async () => {
    // 后端负责按 user 过滤；前端不做 created_by / is_platform_admin 二次筛选。
    // 若后端返回了他人数据（不应发生），前端照样渲染，契约由后端兜底。
    skillsApi.listCustomSkills.mockResolvedValue([
      {
        id: "s-other",
        name: "other-user-skill",
        description: "他人技能（后端已过滤，前端不再筛选）",
        content_preview: "# other",
        created_by: "u-other",
        created_at: "2026-07-07T10:00:00Z",
        updated_at: "2026-07-07T11:00:00Z",
      },
    ]);
    session.user = { id: "u1", is_platform_admin: false, permissions: [] };

    renderPage(<SkillsPage />);

    expect(await screen.findByText("other-user-skill")).toBeInTheDocument();
    expect(
      screen.getByText("他人技能（后端已过滤，前端不再筛选）"),
    ).toBeInTheDocument();
  });

  it("点击新增技能打开弹窗 → 填写 → 调 createCustomSkill", async () => {
    skillsApi.createCustomSkill.mockResolvedValue({
      id: "s2",
      name: "new-skill",
      description: "新技能",
      content: "# new",
      content_preview: "# new",
      created_by: "u1",
      created_at: "2026-07-07T10:00:00Z",
      updated_at: "2026-07-07T10:00:00Z",
    });

    renderPage(<SkillsPage />);
    fireEvent.click(await screen.findByText("新增技能"));

    // 弹窗标题
    expect(await screen.findByText("新增自定义技能")).toBeInTheDocument();
    // 填表（正文 placeholder 已改为步骤模板，匹配「何时使用」）
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "new-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "新技能描述" },
    });
    fireEvent.change(screen.getByPlaceholderText(/何时使用/), {
      target: { value: "# new skill\n正文" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("创建技能"));
    });

    await waitFor(() => {
      expect(skillsApi.createCustomSkill).toHaveBeenCalledWith({
        name: "new-skill",
        description: "新技能描述",
        content: "# new skill\n正文",
      });
    });
  });

  it("点击删除 → confirm 后调 deleteCustomSkill", async () => {
    skillsApi.deleteCustomSkill.mockResolvedValue(undefined);
    renderPage(<SkillsPage />);
    await screen.findByText("my-helper");
    fireEvent.click(screen.getByText("删除"));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(skillsApi.deleteCustomSkill).toHaveBeenCalledWith("s1");
    });
  });

  it("编辑技能：拉详情后切预览展示 markdown 内容，保存调 updateCustomSkill", async () => {
    skillsApi.getCustomSkill.mockResolvedValue({
      id: "s1",
      name: "my-helper",
      description: "一个辅助技能",
      content_preview: "# my-helper\n\n正文预览...",
      content: "# my-helper\n\n这是完整正文。\n\n- 步骤一\n- 步骤二",
      created_by: "u1",
      created_at: "2026-07-07T10:00:00Z",
      updated_at: "2026-07-07T11:00:00Z",
    });
    skillsApi.updateCustomSkill.mockResolvedValue({
      id: "s1",
      name: "my-helper-renamed",
      description: "改后描述",
      content: "# 改",
      content_preview: "# 改",
      created_by: "u1",
      created_at: "2026-07-07T10:00:00Z",
      updated_at: "2026-07-07T12:00:00Z",
    });

    renderPage(<SkillsPage />);
    fireEvent.click(await screen.findByText("编辑"));

    expect(await screen.findByText("编辑自定义技能")).toBeInTheDocument();
    // 详情拉取后 content 已填充
    await waitFor(() => {
      expect(skillsApi.getCustomSkill).toHaveBeenCalledWith("s1");
    });

    // 改名 + 改描述
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "my-helper-renamed" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "改后描述" },
    });

    // 切到预览 tab，确认 markdown 内容进 DOM（MarkdownText 被 mock 成 data-testid=md-preview）
    fireEvent.click(screen.getByText("预览"));
    expect(screen.getByTestId("md-preview").textContent).toContain("完整正文");

    await act(async () => {
      fireEvent.click(screen.getByText("保存修改"));
    });

    await waitFor(() => {
      expect(skillsApi.updateCustomSkill).toHaveBeenCalledWith({
        id: "s1",
        req: {
          name: "my-helper-renamed",
          description: "改后描述",
          content: expect.stringContaining("完整正文"),
        },
      });
    });
  });

  it("展示平台 skills 每个 skill 的 description（manifest.skills 提供）", async () => {
    // 后端 build_skills_manifest 现在返回 skills 摘要（带 description），说明列
    // 应渲染每个技能真实描述，而非写死的通用文案。
    skillsApi.getPlatformSkillsManifest.mockResolvedValueOnce({
      version: "desc-version-012",
      files: [
        { path: "sillyspec-archive/SKILL.md", sha256: "a1" },
        { path: "sillyspec-archive/helper.md", sha256: "a2" },
      ],
      skills: [
        {
          name: "sillyspec-archive",
          description: "用于归档已验证完成的变更",
          file_count: 2,
        },
      ],
    });
    renderPage(<SkillsPage />);

    expect(await screen.findByText("sillyspec-archive")).toBeInTheDocument();
    // description 渲染到说明列（不再是写死的"只读 · 随部署更新…"）
    expect(
      await screen.findByText("用于归档已验证完成的变更"),
    ).toBeInTheDocument();
  });
});
