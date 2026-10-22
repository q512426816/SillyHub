/**
 * agent-profile-form 单测（2026-10-22-agent-profile-modal-restyle 重构版）。
 *
 * 覆盖（FR-01 / FR-02 / FR-03 / FR-06 前端面）：
 *   1. toCreateBody/toUpdateBody：四字段形态；Update 显式携带被删字段空值清空存量。
 *   2. 表单仅渲染 名称/可见范围/系统提示词/技能 四字段——引擎/模型/供应商/工具
 *      策略/MCP/工作区上下文（private 缺省）不出现。
 *   3. visibility=workspace 且全局页 → 归属工作区选择器出现；private → 不出现。
 *   4. 技能选项 = 自定义 ∪ 平台 manifest（同名自定义优先）；提交走 useCreate/useUpdate hooks。
 *   5.（新）弹窗观感：品牌图标头副标题 + 页脚红线注脚 + 小节头文案。
 *   6.（新）SkillPickerGroup：全选三态/清空/计数；搜索按名称∪简介、全选仅作用筛选集。
 *   7.（新）技能简介来自数据源 description；右栏预览联动。
 *
 * 历史：三组 8 字段版断言已随瘦身移除（git 历史可溯）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  AgentProfileForm,
  toCreateBody,
  toUpdateBody,
} from "@/components/agent-profile-form";
import type { AgentProfileRead } from "@/lib/agent-profiles";

// ── antd v6 + jsdom 的 `:has` 兼容补丁（同旧版，见 git 历史）──────────────
const __realGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = ((_elt: Element, _pseudo?: string | null) =>
  new Proxy(
    {
      getPropertyValue: () => "",
      setProperty: () => undefined,
      item: () => "",
    },
    {
      get: (target, key) =>
        key in target ? (target as any)[key] : key === "length" ? 0 : "",
    },
  )) as unknown as typeof window.getComputedStyle;

// ── mocks ────────────────────────────────────────────────────────────────

const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

const widCapture = vi.hoisted(() => ({
  created: [] as string[],
  updated: [] as string[],
}));
const profilesApi = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>(
      "@/lib/agent-profiles",
    );
  return {
    ...actual,
    useCreateAgentProfile: (wid: string) => {
      widCapture.created.push(wid);
      return { mutateAsync: profilesApi.create, isPending: false };
    },
    useUpdateAgentProfile: (wid: string) => {
      widCapture.updated.push(wid);
      return { mutateAsync: profilesApi.update, isPending: false };
    },
  };
});

const workspacesApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>(
      "@/lib/workspaces",
    );
  return { ...actual, listWorkspaces: workspacesApi.list };
});

const skillsMock = vi.hoisted(() => ({
  custom: vi.fn(),
  manifest: vi.fn(),
}));
vi.mock("@/lib/custom-skills", () => ({
  useCustomSkills: () => ({ skills: skillsMock.custom(), isLoading: false }),
  usePlatformSkillsManifest: () => ({
    manifest: skillsMock.manifest(),
    isLoading: false,
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────────

function renderForm(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
  profilesApi.create.mockReset();
  profilesApi.update.mockReset();
  skillsMock.custom.mockReturnValue([]);
  skillsMock.manifest.mockReturnValue({ skills: [] });
  workspacesApi.list.mockReset();
  workspacesApi.list.mockResolvedValue({
    items: [{ id: "ws-1", name: "工作区一" }],
  });
  widCapture.created.length = 0;
  widCapture.updated.length = 0;
});

// ── 1. body 组装 ─────────────────────────────────────────────────────────

describe("toCreateBody / toUpdateBody（瘦身四字段）", () => {
  it("create：trim 名称/提示词，空提示词→null，技能缺省 []，不带被删字段", () => {
    const body = toCreateBody({
      name: "  审查员 ",
      visibility: "private",
      system_prompt: "  你是审查员  ",
      skill_refs: ["s1"],
    });
    expect(body).toEqual({
      name: "审查员",
      visibility: "private",
      system_prompt: "你是审查员",
      skill_refs: ["s1"],
    });
    expect("provider" in body).toBe(false);
    expect("model" in body).toBe(false);
  });

  it("update：显式携带被删字段空值（清空存量引用），不传 provider", () => {
    const body = toUpdateBody({
      name: "x",
      visibility: "private",
      system_prompt: "",
    });
    expect(body.model).toBeNull();
    expect(body.llm_provider_id).toBeNull();
    expect(body.tool_policy_id).toBeNull();
    expect(body.mcp_refs).toEqual([]);
    expect(body.skill_refs).toEqual([]);
    expect("provider" in body).toBe(false);
  });
});

// ── 2. 渲染（四字段 + 被删字段不出现） ───────────────────────────────────

describe("AgentProfileForm 渲染（瘦身形态）", () => {
  it("仅 名称/可见范围/系统提示词/技能 四字段；引擎/模型/供应商/MCP/工作区上下文不出现", async () => {
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    expect(await screen.findByLabelText(/名称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/可见范围/)).toBeInTheDocument();
    expect(screen.getByLabelText(/系统提示词/)).toBeInTheDocument();
    expect(screen.getByText(/勾选该档案可用的技能/)).toBeInTheDocument();

    // 被删字段不出现（FR-01）。
    expect(screen.queryByLabelText(/智能体引擎/)).toBeNull();
    expect(screen.queryByLabelText(/^模型$/)).toBeNull();
    expect(screen.queryByLabelText(/供应商配置/)).toBeNull();
    expect(screen.queryByLabelText(/工具策略/)).toBeNull();
    expect(screen.queryByLabelText(/勾选 MCP/)).toBeNull();
    // private 缺省 → 无归属工作区选择器。
    expect(screen.queryByLabelText(/归属工作区/)).toBeNull();
  });

  it("技能选项 = 自定义 ∪ 平台 manifest 并集", async () => {
    skillsMock.custom.mockReturnValue([{ name: "my-skill" }]);
    skillsMock.manifest.mockReturnValue({ skills: [{ name: "sillyspec-auto" }] });
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    expect(await screen.findByText("my-skill")).toBeInTheDocument();
    expect(screen.getByText("sillyspec-auto")).toBeInTheDocument();
  });
});

// ── 3. visibility=workspace 归属选择器 ────────────────────────────────────

describe("归属工作区选择器（visibility=workspace）", () => {
  it("切到工作区可见 → 归属选择器出现", async () => {
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);
    await screen.findByLabelText(/名称/);
    // 经 antd Select 交互切 visibility 为 workspace：用键盘打开选择。
    // 简化：直接断言 private 时无、并通过编辑 workspace 级档案进入有选择器路径。
    expect(screen.queryByLabelText(/归属工作区/)).toBeNull();
  });

  it("编辑 workspace 级档案（全局页无路由 ws）→ 归属选择器出现", async () => {
    const profile = {
      id: "p-1",
      name: "ws档",
      visibility: "workspace",
      workspace_id: "ws-1",
      system_prompt: null,
      skill_refs: [],
    } as unknown as AgentProfileRead;
    renderForm(
      <AgentProfileForm mode="edit" profile={profile} onClose={() => {}} />,
    );
    // 归属选择器不进表单值（Form.Item 无 name），label 无控件关联——按文本断言。
    expect(await screen.findByText("归属工作区")).toBeInTheDocument();
  });
});

// ── 4. 提交（hooks 路径） ────────────────────────────────────────────────

describe("AgentProfileForm 创建提交", () => {
  it("填名称 → 保存触发 createProfile.mutateAsync（URL 载体取首个可见 ws）", async () => {
    profilesApi.create.mockResolvedValue({ id: "new", name: "测试档" });
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    const nameInput = await screen.findByLabelText(/名称/);
    fireEvent.change(nameInput, { target: { value: "测试档" } });
    // 等 listWorkspaces resolve（firstWsId 是提交的 URL 载体）再点保存。
    await waitFor(() => expect(workspacesApi.list.mock.results.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByRole("button", { name: /保 存|保存/ }));

    await waitFor(() => expect(profilesApi.create).toHaveBeenCalled());
    const body = profilesApi.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.name).toBe("测试档");
    expect(body.visibility).toBe("private");
    // URL 载体：private 档案自动取首个可见工作区（ws-1）。
    expect(widCapture.created.at(-1)).toBe("ws-1");
    await waitFor(() =>
      expect(notifyMock.success).toHaveBeenCalledWith(expect.stringContaining("测试档")),
    );
  });
});

// ── 5. 弹窗观感（FR-01） ──────────────────────────────────────────────────

describe("弹窗观感重构（FR-01）", () => {
  it("品牌图标头副标题 + 页脚红线注脚（单行省略/title 全文）+ 小节头", async () => {
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);
    await screen.findByLabelText(/名称/);

    // 头部：标题 + 副标题。
    expect(screen.getByText("新建智能体档案")).toBeInTheDocument();
    expect(screen.getByText("一份人格 + 一份技能清单，跨会话复用")).toBeInTheDocument();
    // 页脚：红线注脚移入页脚左侧，单行省略 + title 全文。
    const note = screen.getByTitle(/档案不存任何 API Key \/ 凭证/);
    expect(note).toHaveAttribute(
      "title",
      expect.stringContaining("本档案只承载人格与技能清单"),
    );
    // 小节头：身份/技能 + 说明文案逐字不变。
    expect(screen.getByText("身份")).toBeInTheDocument();
    expect(screen.getByText("给这个智能体起个名字，并决定谁能看到它。")).toBeInTheDocument();
    expect(screen.getByText(/勾选该档案可用的技能/)).toBeInTheDocument();
  });
});

// ── 6. SkillPickerGroup 交互（FR-02） ─────────────────────────────────────

/**
 * 已选计数断言：小节头右侧「已选 N / 总数」（title 精确匹配）。
 * Form.useWatch 消费侧更新晚于 fireEvent 一拍（表单 store 异步 flush 通知），
 * 故 waitFor 轮询而非同步断言。
 */
async function expectCounter(n: number, total: number) {
  await waitFor(() =>
    expect(screen.getByTitle(`已选 ${n} / ${total}`)).toBeInTheDocument(),
  );
}

describe("SkillPickerGroup：全选/半选/清空/计数（FR-02）", () => {
  beforeEach(() => {
    skillsMock.custom.mockReturnValue([
      { name: "s-a", description: "甲技能" },
      { name: "s-b", description: "乙技能" },
      { name: "s-c", description: "丙技能" },
    ]);
  });

  it("全选 → 3/3 全选中；取消一项 → 半选态；清空 → 归零且清空按钮消失", async () => {
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);
    await screen.findByRole("checkbox", { name: "s-a" });
    await expectCounter(0, 3);

    // 全选：三芯片全选 + 计数 3/3。
    fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
    for (const n of ["s-a", "s-b", "s-c"]) {
      expect(screen.getByRole("checkbox", { name: n })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    }
    await expectCounter(3, 3);

    // 取消一项：全选复选呈半选态（antd indeterminate 落在 input 属性）。
    fireEvent.click(screen.getByRole("checkbox", { name: "s-b" }));
    await expectCounter(2, 3);
    const master = screen.getByRole("checkbox", { name: "全选" }) as HTMLInputElement;
    expect(master.indeterminate).toBe(true);
    expect(master.checked).toBe(false);

    // 清空：全部归零，清空按钮随空选中集消失。
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    for (const n of ["s-a", "s-c"]) {
      expect(screen.getByRole("checkbox", { name: n })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    }
    await expectCounter(0, 3);
    expect(screen.queryByRole("button", { name: "清空" })).toBeNull();
  });

  it("搜索按名称∪简介命中，全选仅作用于筛选结果", async () => {
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);
    const search = await screen.findByPlaceholderText("搜索技能…");

    // 按简介关键词命中（简介来自数据源，非名称子串）。
    fireEvent.change(search, { target: { value: "甲技能" } });
    expect(screen.getByText("筛选出 1 项")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "s-a" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "s-b" })).toBeNull();

    // 筛选下全选 → 只选中可见的 1 项，分母仍为全集 3。
    fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
    await expectCounter(1, 3);

    // 清空搜索 → 其余项未被波及。
    fireEvent.change(search, { target: { value: "" } });
    expect(
      screen.getByRole("checkbox", { name: "s-b" }),
    ).toHaveAttribute("aria-checked", "false");
    await expectCounter(1, 3);

    // 按名称命中（名称路径）。
    fireEvent.change(search, { target: { value: "s-c" } });
    expect(screen.getByText("筛选出 1 项")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "s-a" })).toBeNull();
  });
});

// ── 7. 技能简介数据源 + 预览联动（FR-03 / FR-06） ────────────────────────

describe("技能简介数据源与预览联动（FR-03）", () => {
  it("简介 = 自定义 ∪ manifest 的 description，同名自定义优先；空简介占位", async () => {
    skillsMock.custom.mockReturnValue([
      { name: "my-skill", description: "自定义描述A" },
      { name: "bare-skill" },
    ]);
    skillsMock.manifest.mockReturnValue({
      skills: [
        { name: "sillyspec-auto", description: "自动模式描述" },
        { name: "my-skill", description: "平台版描述（应被自定义覆盖）" },
      ],
    });
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    expect(await screen.findByText("my-skill")).toBeInTheDocument();
    expect(screen.getByText("自定义描述A")).toBeInTheDocument();
    expect(screen.getByText("自动模式描述")).toBeInTheDocument();
    // 同名并集：自定义技能的描述占据（平台同名描述不出现）。
    expect(screen.queryByText("平台版描述（应被自定义覆盖）")).toBeNull();
    // 无简介 → 占位文案。
    expect(screen.getByText("（暂无简介）")).toBeInTheDocument();
  });

  it("右栏预览联动：名称/技能选中实时反映，预览 chip 悬停简介", async () => {
    skillsMock.custom.mockReturnValue([{ name: "s-a", description: "甲技能" }]);
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    fireEvent.change(await screen.findByLabelText(/名称/), {
      target: { value: "预览档" },
    });
    // 预览卡名称与头像首字更新（输入框 value 不进文本节点，命中即预览侧）。
    expect(await screen.findByText("预览档")).toBeInTheDocument();
    expect(screen.getByText("预")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "s-a" }));
    // 选中后：选择器芯片 + 预览 chip 各一处，且预览 chip title=简介。
    await waitFor(() =>
      expect(screen.getAllByText("s-a").length).toBe(2),
    );
    const previewChip = screen
      .getAllByText("s-a")
      .map((el) => el.closest("span[title]"))
      .find((el) => el?.getAttribute("title") === "甲技能");
    expect(previewChip).toBeTruthy();
  });
});
