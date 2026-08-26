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

interface CallInit {
  method?: string;
  json?: unknown;
}

/**
 * 组装内存态 skills 后端：列表 GET/POST/DELETE + 文件 GET/PUT/DELETE，
 * 写操作同步更新内存态（PUT 更新内容、建文件进清单；DELETE 出清单），
 * 供 invalidate 后 refetch 拿到一致视图（与真实后端行为对齐）。
 */
function setupApi({
  skills,
  contents = {},
}: {
  skills: SkillEntry[];
  contents?: Record<string, string>;
}) {
  const state = {
    skills: skills.map((s) => ({ ...s, files: [...s.files] })),
    contents: { ...contents },
  };
  apiFetchMock.mockImplementation(async (url: string, init?: CallInit) => {
    const method = init?.method ?? "GET";
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
    apiFetchMock.mockResolvedValueOnce({ skills: [] });

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
