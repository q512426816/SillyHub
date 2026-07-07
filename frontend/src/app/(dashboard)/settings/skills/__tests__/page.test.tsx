/**
 * 2026-07-07-skills-mcp-management-ui task-08：/settings/skills 页单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-07-skills-mcp-management-ui/design.md（§5.3 + D-007）
 *   - tasks/task-08.md（验收 A-D）
 *
 * 覆盖:
 *   1. 平台 skills 只读列表展示 manifest（version + 文件名 + 文件数）（AC-A）
 *   2. 自定义 skills 表格展示 list 数据（AC-B）
 *   3. admin 可见「新增技能」「编辑」「删除」按钮；非 admin 只读（AC-D）
 *   4. 点击「新增技能」打开弹窗，填写后调 createCustomSkill（AC-B/C）
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
    expect(await screen.findByText("平台 SillySpec 技能")).toBeInTheDocument();
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

  it("展示自定义 skills 表格行（admin 可见 编辑/删除）", async () => {
    renderPage(<SkillsPage />);

    expect(await screen.findByText("自定义技能")).toBeInTheDocument();
    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    expect(await screen.findByText("一个辅助技能")).toBeInTheDocument();
    // admin 可见 编辑 + 删除 + 新增
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
    expect(screen.getByText("新增技能")).toBeInTheDocument();
  });

  it("非 admin：无 新增/编辑/删除 按钮，行内显示只读", async () => {
    session.user = { id: "u2", is_platform_admin: false, permissions: [] };
    renderPage(<SkillsPage />);

    expect(await screen.findByText("my-helper")).toBeInTheDocument();
    // 非 admin 无新增按钮
    await waitFor(() => {
      expect(screen.queryByText("新增技能")).not.toBeInTheDocument();
    });
    // 行内无编辑/删除，只有「只读」字样
    expect(screen.queryByText("编辑")).not.toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
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
    // 填表
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "new-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "新技能描述" },
    });
    fireEvent.change(screen.getByPlaceholderText(/技能标题/), {
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
});
