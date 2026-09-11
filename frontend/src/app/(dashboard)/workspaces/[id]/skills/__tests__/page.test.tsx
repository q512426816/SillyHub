/**
 * task-10 / 变更 2026-07-07-skills-mcp-management-ui：workspace 详情 Skills 子页单测。
 * 2026-08-26-workspace-skill-edit task-06 增补：双栏完整文件编辑交互用例
 * （原「只读——无编辑/删除/上传按钮」用例随 D-006 只读约束被推翻而重写）。
 *
 * 依据:
 *   - backend/app/modules/workspace/skills_view_service.py（读写契约）
 *   - backend/app/modules/workspace/router.py（GET/POST/DELETE skills + GET/PUT/DELETE files）
 *   - .sillyspec/changes/2026-08-26-workspace-skill-edit/design.md §5 Wave2/§7
 *
 * 覆盖:
 *   1. 渲染 skill 卡片（名 + 文件数徽标），默认选中第一个并展开其文件树
 *   2. 点击 skill 切换展开；点击文件加载内容进编辑器（GET file）
 *   3. 空状态 / 错误态
 *   4. 可编辑入口：新建 Skill 按钮 + 工具行（删除文件在未选文件时禁用）
 *   5. 编辑保存：未保存标记 → PUT 请求体 → 成功 toast → 标记消失；重置
 *   6. 保存失败：notify.error 中文透传
 *   7. 新建 Skill 对话框：非法名中文报错不发请求；合法名 POST body + 选中新 skill 的 SKILL.md
 *   8. 删除 Skill：confirm 明示目录级不可恢复；取消不发请求；确认后 DELETE + 列表移除
 *   9. SKILL.md 删除文件按钮禁用；普通文件可删（confirm + DELETE）
 *   10. 新建文件：非法/已存在中文报错；合法名 PUT 空内容 + 选中新文件
 *   11.（bridges task-05）平台技能库区块：挂载带 workspace_id 拉 library、
 *       git 开关 POST/DELETE 均带 workspace_id（只影响当前工作区维度）
 *   12.（bridges task-05）收编弹窗：差集拉取、invalid 灰显不可选、勾选 adopt
 *       POST names、逐名结果中文（已收编/重名 409）、差集刷新；空态/加载/错误态；
 *       adopt 整体失败 notify.error
 *
 * mock 模式照 MCP page.test.tsx（apiFetch mock + useNotify mock + vi.hoisted）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// apiFetch mock：拦截真实网络，按 URL+method 分发（setupApi 组装内存态后端）。
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// useNotify mock（双栏改造新增依赖：保存/删除成功失败通知，不依赖 antd 运行时）
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

interface SkillEntry {
  name: string;
  files: string[];
}

/** 平台技能库 LibraryView（bridges task-05；字段口径同后端 schema.py）。 */
interface LibraryMock {
  sources: Array<Record<string, unknown>>;
  skills: Array<{
    skill_key: string;
    name: string;
    description?: string;
    source: "sillyspec" | "custom" | "git";
    enabled: boolean;
    source_id?: string | null;
  }>;
}

/** 可收编候选（字段口径同后端 AdoptableSkill）。 */
interface AdoptableMock {
  name: string;
  description: string;
  normalized_name: string;
  valid: boolean;
  invalid_reason?: string | null;
  has_extra_files: boolean;
}

interface CallInit {
  method?: string;
  json?: unknown;
  query?: Record<string, unknown>;
}

/**
 * 组装内存态 skills 后端：列表 GET/POST/DELETE + 文件 GET/PUT/DELETE +
 * （bridges task-05）技能库 library（带 workspace_id 并集视角）与收编
 * adoptable/adopt，写操作同步更新内存态（PUT 更新内容、建文件进清单；
 * DELETE 出清单；adopt 成功名移出差集——与真实后端行为对齐），
 * 供 invalidate 后 refetch 拿到一致视图。
 */
function setupApi({
  skills,
  contents = {},
  library = { sources: [], skills: [] },
  adoptable = [],
  conflictNames = [],
}: {
  skills: SkillEntry[];
  contents?: Record<string, string>;
  library?: LibraryMock;
  adoptable?: AdoptableMock[];
  conflictNames?: string[];
}) {
  const state = {
    skills: skills.map((s) => ({ ...s, files: [...s.files] })),
    contents: { ...contents },
    library,
    adoptable: adoptable.map((a) => ({ ...a })),
    conflictNames: [...conflictNames],
  };
  apiFetchMock.mockImplementation(async (url: string, init?: CallInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/skills/library") {
      return state.library;
    }
    if (url === "/api/workspaces/ws-1/skills/adoptable") {
      return { skills: state.adoptable };
    }
    if (url === "/api/workspaces/ws-1/skills/adopt" && method === "POST") {
      const body = init?.json as { names: string[] };
      const results = body.names.map((name) => {
        const hit = state.adoptable.find((a) => a.name === name);
        if (!hit) {
          return {
            name,
            status: "missing",
            normalized_name: null,
            skill_id: null,
            reason: "目录或 SKILL.md 不存在",
          };
        }
        if (!hit.valid) {
          return {
            name,
            status: "invalid",
            normalized_name: null,
            skill_id: null,
            reason: hit.invalid_reason ?? "名称非法",
          };
        }
        if (state.conflictNames.includes(name)) {
          return {
            name,
            status: "conflict",
            normalized_name: hit.normalized_name,
            skill_id: null,
            reason: "已存在同名自定义技能",
          };
        }
        state.adoptable = state.adoptable.filter((a) => a.name !== name);
        return {
          name,
          status: "adopted",
          normalized_name: hit.normalized_name,
          skill_id: `sk-${name}`,
          reason: null,
        };
      });
      return { results };
    }
    if (url === "/api/workspaces/ws-1/skills") {
      if (method === "POST") {
        const body = init?.json as { name: string; description: string };
        state.skills = [
          ...state.skills,
          { name: body.name, files: ["SKILL.md"] },
        ];
        state.contents[`${body.name}/SKILL.md`] =
          `---\nname: ${body.name}\ndescription: ${body.description}\n---\n`;
        return { skills: state.skills };
      }
      return { skills: state.skills };
    }
    const skillDel = url.match(/^\/api\/workspaces\/ws-1\/skills\/([^/]+)$/);
    if (skillDel && method === "DELETE") {
      const name = decodeURIComponent(skillDel[1]!);
      state.skills = state.skills.filter((s) => s.name !== name);
      return { deleted: true };
    }
    const fileMatch = url.match(
      /^\/api\/workspaces\/ws-1\/skills\/([^/]+)\/files\/(.+)$/,
    );
    if (fileMatch) {
      const skill = decodeURIComponent(fileMatch[1]!);
      const path = fileMatch[2]!.split("/").map(decodeURIComponent).join("/");
      const key = `${skill}/${path}`;
      if (method === "PUT") {
        const body = init?.json as { content: string };
        state.contents[key] = body.content;
        state.skills = state.skills.map((s) =>
          s.name === skill
            ? { ...s, files: [...new Set([...s.files, path])] }
            : s,
        );
        return { path, size: body.content.length };
      }
      if (method === "DELETE") {
        state.skills = state.skills.map((s) =>
          s.name === skill
            ? { ...s, files: s.files.filter((f) => f !== path) }
            : s,
        );
        return { deleted: true };
      }
      const content = state.contents[key];
      if (content === undefined) {
        throw new ApiError(404, {
          code: "not_found",
          message: "文件不存在",
          request_id: null,
          details: null,
        });
      }
      return { path, content, size: content.length };
    }
    throw new Error(`setupApi：未预期的 apiFetch 调用 ${method} ${url}`);
  });
  return state;
}

/** 取指定 method 的调用（断言 PUT/POST/DELETE 请求体用）。 */
function callsOf(method: string) {
  return apiFetchMock.mock.calls.filter(
    (c) => (c[1] as CallInit | undefined)?.method === method,
  );
}

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

/** 打开页面并等列表出现（多数用例的公共前置）。 */
async function renderWithList(
  skills: SkillEntry[],
  contents: Record<string, string> = {},
) {
  setupApi({ skills, contents });
  renderPage(<SkillsPage params={{ id: "ws-1" }} />);
  await waitFor(() => {
    expect(screen.getByText(skills[0]!.name)).toBeInTheDocument();
  });
}

/** 点击左栏文件树中的文件并等编辑器内容就绪（findByText 兜默认选中的异步时序）。 */
async function openFile(treeLabel: string, expectedContent: string) {
  fireEvent.click(await screen.findByText(treeLabel));
  const textarea = (await screen.findByRole(
    "textbox",
  )) as HTMLTextAreaElement;
  await waitFor(() => {
    expect(textarea.value).toBe(expectedContent);
  });
  return textarea;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  notifyMock.success.mockClear();
  notifyMock.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("workspace skills 子页 · 列表与文件树（task-10 基线 + task-06 双栏）", () => {
  it("渲染 skill 卡片（名 + 文件数徽标），默认选中第一个并展开其文件树", async () => {
    await renderWithList(
      [
        { name: "deploy-helper", files: ["SKILL.md", "scripts/run.sh"] },
        { name: "doc-gen", files: ["SKILL.md"] },
      ],
      { "deploy-helper/SKILL.md": "# deploy" },
    );

    expect(screen.getByText("doc-gen")).toBeInTheDocument();
    // 文件数徽标
    expect(screen.getByText("2 个文件")).toBeInTheDocument();
    expect(screen.getByText("1 个文件")).toBeInTheDocument();
    // 默认选中第一个 skill：其文件树展开（第二个未展开 → SKILL.md 只出现一次）
    await waitFor(() => {
      expect(screen.getByText("scripts/run.sh")).toBeInTheDocument();
    });
    expect(screen.getAllByText("SKILL.md")).toHaveLength(1);
    // 未选文件 → 右栏空态
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
    // URL 正确
    expect(apiFetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1/skills");
  });

  it("点击其它 skill 切换展开；点击文件加载内容进编辑器", async () => {
    await renderWithList(
      [
        { name: "deploy-helper", files: ["SKILL.md"] },
        { name: "doc-gen", files: ["SKILL.md"] },
      ],
      { "doc-gen/SKILL.md": "---\nname: doc-gen\n---\n正文" },
    );

    // 切换到第二个 skill：其文件树展开、第一个收起
    fireEvent.click(screen.getByText("doc-gen"));
    expect(screen.getAllByText("SKILL.md")).toHaveLength(1);

    // 点击文件 → GET 文件内容 → textarea 显示
    const textarea = await openFile("SKILL.md", "---\nname: doc-gen\n---\n正文");
    expect(textarea).toBeInTheDocument();
    expect(
      screen.getByText("doc-gen / SKILL.md"),
    ).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/skills/doc-gen/files/SKILL.md",
    );
  });

  it("空状态展示", async () => {
    // bridges task-05：页面挂载即发 library 请求（平台技能库区块）→ 单次
    // mock 会被任一挂载查询消费，改按 URL 路由保证确定性（断言不变）。
    apiFetchMock.mockImplementation(async (url: string) =>
      url === "/api/workspaces/ws-1/skills"
        ? { skills: [] }
        : { sources: [], skills: [] },
    );

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("暂无自定义 skill")).toBeInTheDocument();
    });
    // 空态下仍可新建 Skill
    expect(
      screen.getByRole("button", { name: "＋ 新建 Skill" }),
    ).toBeInTheDocument();
  });

  it("错误态展示", async () => {
    // 同上：按 URL 路由，仅 workspace skills 列表失败（断言不变）。
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces/ws-1/skills") {
        throw new ApiError(500, {
          code: "internal_error",
          message: "加载失败",
          request_id: null,
          details: null,
        });
      }
      return { sources: [], skills: [] };
    });

    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
  });

  it("可编辑入口——页头新建 Skill 按钮 + 左栏工具行（替换旧只读用例）", async () => {
    await renderWithList([
      { name: "deploy-helper", files: ["SKILL.md"] },
    ]);

    expect(
      screen.getByRole("button", { name: "＋ 新建 Skill" }),
    ).toBeInTheDocument();
    // 默认选中第一个 skill：新建文件/删除 Skill 可用；未选文件 → 删除文件禁用
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "＋ 新建文件" }),
      ).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "删除 Skill" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除文件" })).toBeDisabled();
  });
});

describe("workspace skills 子页 · 编辑与保存（task-06）", () => {
  const SKILLS = [
    { name: "deploy-helper", files: ["SKILL.md", "reference.md"] },
  ];

  it("编辑 → 未保存标记 → 保存（PUT 请求体）→ 成功 toast → 标记消失", async () => {
    await renderWithList(SKILLS, { "deploy-helper/reference.md": "旧内容" });

    const textarea = await openFile("reference.md", "旧内容");
    // 未修改时保存禁用
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "新内容" } });
    expect(screen.getByText("● 未保存")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(callsOf("PUT")).toHaveLength(1);
    });
    const putCall = callsOf("PUT")[0]!;
    expect(putCall[0]).toBe(
      "/api/workspaces/ws-1/skills/deploy-helper/files/reference.md",
    );
    expect(putCall[1]).toMatchObject({ json: { content: "新内容" } });
    // 成功 toast（design §5.7 固定文案）
    expect(notifyMock.success).toHaveBeenCalledWith(
      "已保存（下次同步对新会话生效）",
    );
    // invalidate 后重取内容与编辑器一致 → 未保存标记消失
    await waitFor(() => {
      expect(screen.queryByText("● 未保存")).not.toBeInTheDocument();
    });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "新内容",
    );
  });

  it("重置：恢复已加载内容并清除未保存标记", async () => {
    await renderWithList(SKILLS, { "deploy-helper/reference.md": "旧内容" });

    const textarea = await openFile("reference.md", "旧内容");
    fireEvent.change(textarea, { target: { value: "改了" } });
    expect(screen.getByText("● 未保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(textarea.value).toBe("旧内容");
    expect(screen.queryByText("● 未保存")).not.toBeInTheDocument();
  });

  it("保存失败：notify.error 中文透传 ApiError message", async () => {
    await renderWithList(SKILLS, { "deploy-helper/reference.md": "旧内容" });
    const textarea = await openFile("reference.md", "旧内容");
    fireEvent.change(textarea, { target: { value: "超限内容" } });

    // 下一次 apiFetch 调用（即 PUT）失败：413 中文报错
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(413, {
        code: "payload_too_large",
        message: "文件内容超过 512KB 上限",
        request_id: null,
        details: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(notifyMock.error).toHaveBeenCalledTimes(1);
    });
    const [err, fallback] = notifyMock.error.mock.calls[0]!;
    expect((err as ApiError).message).toBe("文件内容超过 512KB 上限");
    expect(fallback).toBe("保存失败");
    // 失败后编辑内容保留，未保存标记仍在
    expect(screen.getByText("● 未保存")).toBeInTheDocument();
    expect(textarea.value).toBe("超限内容");
  });
});

describe("workspace skills 子页 · 新建 Skill（task-06）", () => {
  it("非法名 → 中文报错不发请求；合法名 → POST body 正确 + 选中新 skill 的 SKILL.md", async () => {
    await renderWithList([{ name: "doc-gen", files: ["SKILL.md"] }]);

    fireEvent.click(screen.getByRole("button", { name: "＋ 新建 Skill" }));
    const nameInput = screen.getByPlaceholderText("my-skill");

    // 非法名（中文）：中文报错，不发 POST
    fireEvent.change(nameInput, { target: { value: "我的skill" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(
      screen.getByText("skill 名仅允许字母/数字/点/下划线/连字符"),
    ).toBeInTheDocument();
    expect(callsOf("POST")).toHaveLength(0);

    // 合法名 + 描述 → POST body 正确
    fireEvent.change(nameInput, { target: { value: "my-skill" } });
    fireEvent.change(screen.getByPlaceholderText("这个 skill 做什么"), {
      target: { value: "做点事" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(callsOf("POST")).toHaveLength(1);
    });
    const postCall = callsOf("POST")[0]!;
    expect(postCall[0]).toBe("/api/workspaces/ws-1/skills");
    expect(postCall[1]).toMatchObject({
      json: { name: "my-skill", description: "做点事" },
    });

    // 对话框关闭；列表刷新出现新 skill；自动选中其 SKILL.md 并加载内容
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("my-skill"),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("my-skill / SKILL.md")).toBeInTheDocument();
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toContain("name: my-skill");
    });
  });
});

describe("workspace skills 子页 · 删除（task-06）", () => {
  it("删除 Skill：confirm 明示目录级不可恢复；取消不发请求；确认后 DELETE + 列表移除", async () => {
    await renderWithList([
      { name: "deploy-helper", files: ["SKILL.md", "reference.md", "notes.md"] },
    ]);

    // 取消：不发 DELETE（先等默认选中完成，删除 Skill 按钮可用）
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "删除 Skill" }),
      ).toBeEnabled();
    });
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirmMock);
    fireEvent.click(screen.getByRole("button", { name: "删除 Skill" }));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]![0]).toContain("deploy-helper");
    expect(confirmMock.mock.calls[0]![0]).toContain("3 个文件");
    expect(confirmMock.mock.calls[0]![0]).toContain("不可恢复");
    expect(callsOf("DELETE")).toHaveLength(0);

    // 确认：DELETE 正确 URL，列表移除
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    fireEvent.click(screen.getByRole("button", { name: "删除 Skill" }));
    await waitFor(() => {
      expect(callsOf("DELETE")).toHaveLength(1);
    });
    expect(callsOf("DELETE")[0]![0]).toBe(
      "/api/workspaces/ws-1/skills/deploy-helper",
    );
    await waitFor(() => {
      expect(screen.queryByText("deploy-helper")).not.toBeInTheDocument();
    });
    expect(notifyMock.success).toHaveBeenCalledWith(
      '已删除 skill "deploy-helper"',
    );
  });

  it("SKILL.md 删除文件按钮禁用；普通文件 confirm 后 DELETE", async () => {
    await renderWithList(
      [{ name: "deploy-helper", files: ["SKILL.md", "reference.md"] }],
      {
        "deploy-helper/SKILL.md": "# 入口",
        "deploy-helper/reference.md": "参考资料",
      },
    );

    // 选中 SKILL.md → 删除文件禁用（入口保护，design R-05）
    await openFile("SKILL.md", "# 入口");
    expect(screen.getByRole("button", { name: "删除文件" })).toBeDisabled();

    // 切到普通文件 → 可删
    await openFile("reference.md", "参考资料");
    expect(screen.getByRole("button", { name: "删除文件" })).toBeEnabled();

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    fireEvent.click(screen.getByRole("button", { name: "删除文件" }));
    await waitFor(() => {
      expect(callsOf("DELETE")).toHaveLength(1);
    });
    expect(callsOf("DELETE")[0]![0]).toBe(
      "/api/workspaces/ws-1/skills/deploy-helper/files/reference.md",
    );
    // 列表刷新后文件树移除该文件，右栏回到空态
    await waitFor(() => {
      expect(screen.queryByText("reference.md")).not.toBeInTheDocument();
    });
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
  });
});

describe("workspace skills 子页 · 新建文件（task-06）", () => {
  it("非法路径/已存在 → 中文报错不发请求；合法名 → PUT 空内容 + 选中新文件", async () => {
    await renderWithList(
      [{ name: "deploy-helper", files: ["SKILL.md", "reference.md"] }],
      { "deploy-helper/SKILL.md": "# 入口" },
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "＋ 新建文件" }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ 新建文件" }));
    const pathInput = screen.getByPlaceholderText("reference.md 或 scripts/run.sh");

    // 非法名（中文）→ 中文报错，不发 PUT
    fireEvent.change(pathInput, { target: { value: "脚本.md" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(
      screen.getByText("文件名仅允许字母/数字/点/下划线/连字符"),
    ).toBeInTheDocument();
    expect(callsOf("PUT")).toHaveLength(0);

    // 已存在 → 报错（前端拦截，避免 PUT 覆盖既有文件内容；经异步拒绝，waitFor 断言）
    fireEvent.change(pathInput, { target: { value: "SKILL.md" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(screen.getByText("该文件已存在，请换一个名字")).toBeInTheDocument();
    });
    expect(callsOf("PUT")).toHaveLength(0);

    // 合法名 → PUT 空内容（PUT 即创建，design §7.3）→ 文件树出现 + 编辑器选中
    fireEvent.change(pathInput, { target: { value: "notes.md" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(callsOf("PUT")).toHaveLength(1);
    });
    const putCall = callsOf("PUT")[0]!;
    expect(putCall[0]).toBe(
      "/api/workspaces/ws-1/skills/deploy-helper/files/notes.md",
    );
    expect(putCall[1]).toMatchObject({ json: { content: "" } });
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("reference.md 或 scripts/run.sh"),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("deploy-helper / notes.md")).toBeInTheDocument();
    });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("workspace skills 子页 · 平台技能库区块（bridges task-05，桥①）", () => {
  const GIT_SOURCE = {
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
  };

  function makeLibrary(gitEnabled: boolean): LibraryMock {
    return {
      sources: [GIT_SOURCE],
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
          skill_key: "src-1:deploy-helper",
          name: "deploy-helper",
          description: "部署辅助",
          source: "git",
          enabled: gitEnabled,
          source_id: "src-1",
        },
      ],
    };
  }

  it("挂载即带 workspace_id 拉取 library；只渲染 git 组；开关 POST 带 workspace_id", async () => {
    setupApi({
      skills: [{ name: "doc-gen", files: ["SKILL.md"] }],
      library: makeLibrary(false),
    });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    // 等 git 行渲染（library 数据就绪；卡片骨架加载态即有 testid，不能作就绪信号）
    await screen.findByText("deploy-helper");
    expect(screen.getByTestId("workspace-library-list")).toBeInTheDocument();
    // 拉取带 workspace 维度参数（只影响当前工作区，acceptance 可断言项）
    expect(apiFetchMock).toHaveBeenCalledWith("/api/skills/library", {
      query: { workspace_id: "ws-1" },
    });
    // 只渲染 git 组：个人恒启用源（组头/行/徽标）不出现
    expect(screen.queryByText("系统自带（sillyspec）")).not.toBeInTheDocument();
    expect(screen.queryByText("我的自定义技能")).not.toBeInTheDocument();
    expect(screen.queryByText("sillyspec-archive")).not.toBeInTheDocument();
    expect(screen.queryByText("my-helper")).not.toBeInTheDocument();
    expect(screen.queryByText("恒启用")).not.toBeInTheDocument();
    // git 行 + 源组头 + 计数（只算 git）
    expect(screen.getByText("git 技能源")).toBeInTheDocument();
    expect(screen.getByText("1 个技能")).toBeInTheDocument();

    // 打开开关 → POST enable（skill_key 冒号 %3A）+ workspace 维度 query
    fireEvent.click(
      screen.getByRole("switch", { name: "启用技能 deploy-helper" }),
    );
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/skills/src-1%3Adeploy-helper/enable",
        {
          method: "POST",
          json: { enabled: true },
          query: { workspace_id: "ws-1" },
        },
      );
    });
  });

  it("关闭已启用开关 → DELETE 带 workspace_id（工作区维度停用）", async () => {
    setupApi({
      skills: [{ name: "doc-gen", files: ["SKILL.md"] }],
      library: makeLibrary(true),
    });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);

    const sw = await screen.findByRole("switch", {
      name: "启用技能 deploy-helper",
    });
    expect(sw.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sw);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/skills/src-1%3Adeploy-helper/enable",
        { method: "DELETE", query: { workspace_id: "ws-1" } },
      );
    });
  });
});

describe("workspace skills 子页 · 收编为个人技能（bridges task-05，桥④）", () => {
  const ADOPTABLE: AdoptableMock[] = [
    {
      name: "deploy-helper",
      description: "部署辅助",
      normalized_name: "deploy-helper",
      valid: true,
      invalid_reason: null,
      has_extra_files: false,
    },
    {
      name: "我的技能",
      description: "中文名非法",
      normalized_name: "",
      valid: false,
      invalid_reason: "名称仅允许字母/数字/点/下划线/连字符",
      has_extra_files: false,
    },
    {
      name: "multi-file",
      description: "带辅助文件",
      normalized_name: "multi-file",
      valid: true,
      invalid_reason: null,
      has_extra_files: true,
    },
  ];

  /** 打开页面 + 收编弹窗，等差集列表就绪。 */
  async function openAdoptDialog() {
    fireEvent.click(screen.getByRole("button", { name: "查看可收编技能…" }));
    await screen.findByTestId("adoptable-list");
  }

  it("勾选 adopt：POST names 原样数组 + 逐名结果中文（已收编/重名 409）+ 差集刷新", async () => {
    setupApi({
      skills: [{ name: "doc-gen", files: ["SKILL.md"] }],
      adoptable: ADOPTABLE,
      conflictNames: ["multi-file"],
    });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("doc-gen")).toBeInTheDocument();
    });

    await openAdoptDialog();
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/skills/adoptable",
    );

    // invalid 灰显不可选（checkbox disabled）+ 原因 tag
    const invalidBox = screen.getByRole("checkbox", { name: "收编 我的技能" });
    expect(invalidBox).toBeDisabled();
    expect(screen.getByText("名称非法")).toBeInTheDocument();
    // 含辅助文件标记（CustomSkill 单文件模型提示）
    expect(screen.getByText("含辅助文件")).toBeInTheDocument();
    // 未勾选时收编按钮禁用
    expect(screen.getByRole("button", { name: "收编" })).toBeDisabled();

    // 勾选两个合法项 → 按钮计数
    fireEvent.click(
      screen.getByRole("checkbox", { name: "收编 deploy-helper" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "收编 multi-file" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "收编（2 个）" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/skills/adopt",
        { method: "POST", json: { names: ["deploy-helper", "multi-file"] } },
      );
    });

    // 逐名结果中文反馈：成功 + 重名 409
    await screen.findByTestId("adopt-result-deploy-helper");
    expect(screen.getByText("已收编")).toBeInTheDocument();
    expect(
      screen.getByText("重名：个人技能库已有同名技能"),
    ).toBeInTheDocument();
    expect(notifyMock.success).toHaveBeenCalledWith("收编完成：成功 1 个");

    // 「继续收编」回到列表：差集已刷新（adopted 移除、conflict/invalid 保留）
    fireEvent.click(
      screen.getByRole("button", { name: "继续收编（已刷新差集）" }),
    );
    await screen.findByTestId("adoptable-list");
    expect(
      screen.queryByTestId("adoptable-item-deploy-helper"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("adoptable-item-multi-file")).toBeInTheDocument();
    expect(screen.getByTestId("adoptable-item-我的技能")).toBeInTheDocument();
  });

  it("空差集 → 弹窗空态", async () => {
    setupApi({ skills: [{ name: "doc-gen", files: ["SKILL.md"] }] });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("doc-gen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "查看可收编技能…" }));
    await waitFor(() => {
      expect(screen.getByText("无可收编技能")).toBeInTheDocument();
    });
  });

  it("加载中 → 就绪过渡；adoptable 失败 → ErrorBanner + 重试", async () => {
    // 挂起 adoptable 响应：先断言加载态，再放行验证空态过渡。
    let release!: (v: { skills: AdoptableMock[] }) => void;
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces/ws-1/skills/adoptable") {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (url === "/api/workspaces/ws-1/skills") {
        return { skills: [{ name: "doc-gen", files: ["SKILL.md"] }] };
      }
      return { sources: [], skills: [] };
    });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("doc-gen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "查看可收编技能…" }));
    await waitFor(() => {
      expect(screen.getByText("加载可收编技能...")).toBeInTheDocument();
    });
    release({ skills: [] });
    await waitFor(() => {
      expect(screen.getByText("无可收编技能")).toBeInTheDocument();
    });

    // 错误态：adoptable 拒绝 → ErrorBanner（role=alert）+ 重试按钮
    cleanup();
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces/ws-1/skills/adoptable") {
        throw new ApiError(500, {
          code: "internal_error",
          message: "加载候选失败",
          request_id: null,
          details: null,
        });
      }
      if (url === "/api/workspaces/ws-1/skills") {
        return { skills: [{ name: "doc-gen", files: ["SKILL.md"] }] };
      }
      return { sources: [], skills: [] };
    });
    const { unmount } = renderPage(<SkillsPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("doc-gen")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "查看可收编技能…" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载候选失败");
    expect(
      screen.getByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
    unmount();
  });

  it("adopt 整体请求失败 → notify.error 中文兜底", async () => {
    setupApi({
      skills: [{ name: "doc-gen", files: ["SKILL.md"] }],
      adoptable: [ADOPTABLE[0]!],
    });
    const base = apiFetchMock.getMockImplementation();
    apiFetchMock.mockImplementation(async (url: string, init?: CallInit) => {
      if (url === "/api/workspaces/ws-1/skills/adopt") {
        throw new ApiError(500, {
          code: "internal_error",
          message: "服务繁忙",
          request_id: null,
          details: null,
        });
      }
      return base!(url, init);
    });
    renderPage(<SkillsPage params={{ id: "ws-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("doc-gen")).toBeInTheDocument();
    });

    await openAdoptDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "收编 deploy-helper" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "收编（1 个）" }));

    await waitFor(() => {
      expect(notifyMock.error).toHaveBeenCalledTimes(1);
    });
    const [err, fallback] = notifyMock.error.mock.calls[0]!;
    expect((err as ApiError).message).toBe("服务繁忙");
    expect(fallback).toBe("收编失败");
    // 弹窗停留列表态（结果区不出现），可重试
    expect(screen.getByTestId("adoptable-list")).toBeInTheDocument();
  });
});
