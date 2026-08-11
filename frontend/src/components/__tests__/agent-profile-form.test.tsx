/**
 * AgentProfileForm 单测（task-12，变更 2026-08-02-agent-profile-layer）。
 *
 * 依据：
 *   - design.md §11 + D-011（表单三组：身份 / 大脑 / 工具能力）
 *   - prototype-agent-profile.html 画面① v2
 *   - design §10 红线：不存密钥（UI 不含凭证字段）
 *
 * 覆盖：
 *   1. toCreateBody / toUpdateBody：trim + 空串→null + 默认空数组（请求体正确性）
 *   2. 渲染：三组小标题齐 / MCP 服务器名作为勾选项出现 / 技能选项出现
 *   3. create 模式：填名称 + 选供应商 → 保存触发 createProfile.mutateAsync 且 body 含必填字段
 */
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  AgentProfileForm,
  toCreateBody,
  toUpdateBody,
} from "@/components/agent-profile-form";
import type { AgentProfileRead } from "@/lib/agent-profiles";

// ── antd v6 + jsdom 的 `:has` 兼容补丁（仅本文件） ─────────────────────────
// antd v6 Form style 含 `:has(> .ant-switch:only-child, > .ant-rate:only-child)` 规则。
// jsdom 的 cssom 在 getComputedStyle 时对每条规则做 DOM 匹配，其 `:has` 模拟会把
// 候选元素的 tag+className 拼成选择器再查询；当候选元素带 tailwind 任意值类
// （表单左栏 `max-h-[68vh]`，未引号转义）时生成 `div.max-h-[68vh] >.ant-switch...`，
// 属非法 CSS 选择器 → nwsapi 抛 SyntaxError 并作为 uncaught error 使测试失败。
// 真实浏览器用原生 CSS 引擎匹配 `:has`（不拼 DOM 类名），不受影响——这是 jsdom
// 特有缺陷（与 setup.ts 的 matchMedia/ResizeObserver polyfill 同类环境适配）。
// 处理：stub window.getComputedStyle 阻断 jsdom cascade（含 getComputedStyle(el, pseudo)
// 的 "Not implemented" 噪音），返回空样式表；antd 滚动检测只读 overflow/scrollbar 等，
// 空值等价于 jsdom 默认。仅本测试文件生效。
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

/** 记录 useCreate/useUpdateAgentProfile 收到的 effectiveWsId（断言 sourcing/归属，D-006）。 */
const widCapture = vi.hoisted(() => ({
  created: [] as string[],
  updated: [] as string[],
}));
const profilesApi = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  policies: vi.fn(),
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
    useWorkspaceToolPolicies: () => ({
      policies: profilesApi.policies(),
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
});

// listWorkspaces（D-006「工作区上下文」选择器数据源；workspace-switcher 同源）。
const workspacesApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>(
      "@/lib/workspaces",
    );
  return { ...actual, listWorkspaces: workspacesApi.list };
});

const mcpMock = vi.hoisted(() => ({ servers: vi.fn() }));
vi.mock("@/lib/workspace-skills-view", () => ({
  useWorkspaceMcpConfig: () => ({ mcpServers: mcpMock.servers(), isLoading: false }),
}));

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
  profilesApi.policies.mockReturnValue([]);
  mcpMock.servers.mockReturnValue({});
  skillsMock.custom.mockReturnValue([]);
  skillsMock.manifest.mockReturnValue({ skills: [] });
  workspacesApi.list.mockReset();
  workspacesApi.list.mockResolvedValue({ items: [] });
  widCapture.created.length = 0;
  widCapture.updated.length = 0;
});

// ── 1. body 组装（纯逻辑，最关键：请求体正确性） ──────────────────────────

describe("toCreateBody / toUpdateBody", () => {
  it("trim 名称/模型/提示词，空串模型/提示词/策略 → null，refs 缺省 []", () => {
    const created = toCreateBody({
      name: "  代码审查助手  ",
      visibility: "workspace",
      provider: "claude",
      model: "  ",
      system_prompt: "",
      tool_policy_id: "",
      mcp_refs: ["github"],
      skill_refs: undefined,
    });
    expect(created.name).toBe("代码审查助手");
    expect(created.visibility).toBe("workspace");
    expect(created.provider).toBe("claude");
    expect(created.model).toBeNull();
    expect(created.system_prompt).toBeNull();
    expect(created.tool_policy_id).toBeNull();
    expect(created.mcp_refs).toEqual(["github"]);
    expect(created.skill_refs).toEqual([]);
  });

  it("保留有效 model/system_prompt/tool_policy_id + llm_provider_id 透传", () => {
    const created = toCreateBody({
      name: "深度重构",
      visibility: "platform",
      provider: "codex",
      model: "gpt-5",
      system_prompt: "你是重构专家",
      tool_policy_id: "pol-1",
      llm_provider_id: "prov-1", // task-10：绑定供应商 id 透传到 Create body
      mcp_refs: [],
      skill_refs: ["refactor"],
    });
    expect(created.model).toBe("gpt-5");
    expect(created.system_prompt).toBe("你是重构专家");
    expect(created.tool_policy_id).toBe("pol-1");
    expect(created.llm_provider_id).toBe("prov-1"); // task-10
    expect(created.skill_refs).toEqual(["refactor"]);
  });

  it("toUpdateBody 同样空串→null + refs 缺省 [] + llm_provider_id 透传/显式 null 解绑", () => {
    const updated = toUpdateBody({
      name: "x",
      visibility: "private",
      provider: "claude",
      model: undefined,
      system_prompt: undefined,
      tool_policy_id: undefined,
      llm_provider_id: "prov-2", // task-10：更新绑定
      mcp_refs: undefined,
      skill_refs: undefined,
    });
    expect(updated.model).toBeNull();
    expect(updated.llm_provider_id).toBe("prov-2"); // task-10：透传
    expect(updated.mcp_refs).toEqual([]);
    expect(updated.skill_refs).toEqual([]);

    // task-10：显式 null = 解绑（exclude_unset 语义，design §7/§4.6）
    const unbound = toUpdateBody({
      name: "x",
      visibility: "private",
      provider: "claude",
      llm_provider_id: null,
    });
    expect(unbound.llm_provider_id).toBeNull();
  });
});

// ── 2. 渲染（三组 + MCP/技能选项） ───────────────────────────────────────

describe("AgentProfileForm 渲染", () => {
  it("三组小标题齐（身份/大脑/工具能力）+ 红线提示不存凭证", () => {
    renderForm(
      <AgentProfileForm
        mode="create"
        workspaceId="ws-1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/身份/)).toBeInTheDocument();
    expect(screen.getByText(/大脑/)).toBeInTheDocument();
    expect(screen.getByText(/工具能力/)).toBeInTheDocument();
    // design §10 红线文案
    expect(screen.getByText(/不存任何 API Key/i)).toBeInTheDocument();
  });

  it("MCP 服务器名作为勾选项出现（来自 useWorkspaceMcpConfig）", () => {
    mcpMock.servers.mockReturnValue({
      github: { command: "x" },
      db: { command: "y" },
    });
    renderForm(
      <AgentProfileForm
        mode="create"
        workspaceId="ws-1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("db")).toBeInTheDocument();
  });

  it("技能选项出现（自定义 skill + 平台 manifest skill 并集）", () => {
    skillsMock.custom.mockReturnValue([{ name: "my-helper" }]);
    skillsMock.manifest.mockReturnValue({
      skills: [{ name: "sillyspec-archive", description: "", file_count: 1 }],
    });
    renderForm(
      <AgentProfileForm
        mode="create"
        workspaceId="ws-1"
        onClose={() => {}}
      />,
    );
    // Checkbox.Group 的 label 文本
    expect(screen.getByText("my-helper")).toBeInTheDocument();
    expect(screen.getByText("sillyspec-archive")).toBeInTheDocument();
  });
});

// ── 3. create 提交链路 ───────────────────────────────────────────────────

describe("AgentProfileForm 创建提交", () => {
  it("填名称 + 默认供应商 → 保存触发 createProfile.mutateAsync", async () => {
    profilesApi.create.mockResolvedValue({ id: "p1", name: "代码审查助手" });
    renderForm(
      <AgentProfileForm
        mode="create"
        workspaceId="ws-1"
        onClose={() => {}}
      />,
    );

    // 名称必填，填入；供应商默认 claude（初值）。
    const nameInput = screen.getByPlaceholderText("例如 代码审查助手");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "代码审查助手" } });
    });

    // 点保存按钮（Modal footer 内文本「保存」；antd 两字按钮自动加字间距 → 「保 存」，
    // 用正则容忍，见 FRONTEND_PAGE_STYLE.md §5）。
    const saveBtn = screen.getByRole("button", { name: /保\s*存/ });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(profilesApi.create).toHaveBeenCalledTimes(1);
    });
    const firstCall = profilesApi.create.mock.calls[0];
    expect(firstCall).toBeDefined();
    const body = firstCall![0];
    expect(body.name).toBe("代码审查助手");
    expect(body.provider).toBe("claude");
    expect(body.visibility).toBe("private");
    expect(notifyMock.success).toHaveBeenCalled();
  });
});

// ── 4. 双栏实时预览（D-003 / design §12 验收 4） ──────────────────────────

/**
 * antd v6 Select 选某选项（下拉 portal 到 body；选项用 selector 限定避免误中卡片/预览文本）。
 * 与 card-grid 测试同款 helper。两字中文按钮断言一律 `\s*` 兼容（FRONTEND_PAGE_STYLE §5）。
 */
async function chooseAntdOption(placeholderText: string, optionText: string) {
  const anchor = screen.getByText(placeholderText);
  const selectWrapper = anchor.closest(".ant-select");
  if (!selectWrapper)
    throw new Error(`ant-select for "${placeholderText}" not found`);
  const clickZone =
    selectWrapper.querySelector(".ant-select-content") ??
    selectWrapper.querySelector(".ant-select-selector");
  if (!clickZone)
    throw new Error(
      `ant-select click zone not found under "${placeholderText}"`,
    );
  fireEvent.mouseDown(clickZone as HTMLElement);
  const option = await screen.findByText(optionText, {
    selector: ".ant-select-item-option-content",
  });
  const optionRow = option.closest(".ant-select-item-option") as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AgentProfileForm 双栏实时预览（D-003 / design §12 验收 4）", () => {
  it("左填右实时：名称/提示词/模型输入 → 右栏预览同步更新", async () => {
    renderForm(
      <AgentProfileForm mode="create" workspaceId="ws-1" onClose={() => {}} />,
    );
    // 右栏预览头
    expect(screen.getByText(/▼ 实时预览/)).toBeInTheDocument();
    // 预览容器（sticky 内卡片）——左栏 textarea 的 value 也是文本节点，需限定到预览区
    const preview = screen.getByText(/▼ 实时预览/).closest("div.sticky") as HTMLElement;
    // 默认：未命名档案 / claude（provider 初值）
    expect(within(preview).getByText("未命名档案")).toBeInTheDocument();

    // 输入名称 → 预览名同步（Input value 非文本节点，screen.getByText 只命中预览）
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如 代码审查助手"), {
        target: { value: "代码审查助手" },
      });
    });
    expect(within(preview).getByText("代码审查助手")).toBeInTheDocument();

    // 输入系统提示词 → 预览摘要同步
    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText(/例如：你是资深代码审查员/),
        { target: { value: "你是重构专家" } },
      );
    });
    expect(within(preview).getByText("你是重构专家")).toBeInTheDocument();

    // 输入模型 → 预览 mono 行「claude / gpt-5」同步
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/例如 claude-sonnet-4/), {
        target: { value: "gpt-5" },
      });
    });
    expect(within(preview).getByText("claude / gpt-5")).toBeInTheDocument();
  });

  it("8 字段齐全（身份/大脑/能力 label，design §12 验收 4）", () => {
    mcpMock.servers.mockReturnValue({ github: { command: "x" } });
    renderForm(
      <AgentProfileForm mode="create" workspaceId="ws-1" onClose={() => {}} />,
    );
    // ① 身份
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("可见范围")).toBeInTheDocument();
    // ② 大脑（task-07：第一层改名「智能体引擎」+ 第二层「供应商配置」联动）
    expect(screen.getByText("智能体引擎")).toBeInTheDocument();
    expect(
      screen.getByText("供应商配置（可选，不绑定用默认）"),
    ).toBeInTheDocument();
    expect(screen.getByText("模型")).toBeInTheDocument();
    expect(
      screen.getByText("系统提示词（agent 人格，与 spec 任务上下文叠加）"),
    ).toBeInTheDocument();
    // ③ 工具能力
    expect(
      screen.getByText("工具策略（引用现有 ToolPolicy）"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("勾选 MCP（引用该工作区 .mcp.json 的 server，不存凭证）"),
    ).toBeInTheDocument();
    expect(screen.getByText("勾选技能（引用当前用户的技能池）")).toBeInTheDocument();
  });
});

// ── 5. 工作区上下文选择器（D-006 / design §12 验收 4） ────────────────────

describe("工作区上下文选择器（D-006）", () => {
  it("全局页 create：选择器必选 + 未选禁用保存 + 选定后 ③能力加载 + createProfile 用所选 ws", async () => {
    workspacesApi.list.mockResolvedValue({
      items: [
        { id: "ws-a", name: "前端组" },
        { id: "ws-b", name: "后端组" },
      ],
    });
    profilesApi.policies.mockReturnValue([{ id: "pol-1", name: "默认策略" }]);
    mcpMock.servers.mockReturnValue({ github: { command: "x" } });
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    // 选择器出现 + 必选占位
    expect(screen.getByText("工作区上下文")).toBeInTheDocument();
    expect(screen.getByText("请选择工作区上下文")).toBeInTheDocument();
    // 未选 → ③能力区提示 + 保存禁用（acceptance：未选时禁用保存）
    expect(
      screen.getByText(/请先选择上方「工作区上下文」/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保\s*存/ })).toBeDisabled();

    // 选定「前端组」→ effectiveWsId=ws-a（createProfile 收到的 wid）
    await chooseAntdOption("请选择工作区上下文", "前端组");
    await waitFor(() => {
      expect(widCapture.created.at(-1)).toBe("ws-a");
    });
    // 保存启用
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /保\s*存/ })).toBeEnabled();
    });
    // ③能力区按 ws-a 加载：MCP 勾选项 + 工具策略 Select 挂载（提示消失）
    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/请先选择上方「工作区上下文」/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("不指定（用默认）")).toBeInTheDocument();
  });

  it("全局页 edit 无归属 ws（private）→「参考工作区」选择器自动取首个可见 ws 作 sourcing", async () => {
    workspacesApi.list.mockResolvedValue({
      items: [
        { id: "ws-a", name: "前端组" },
        { id: "ws-b", name: "后端组" },
      ],
    });
    mcpMock.servers.mockReturnValue({ github: { command: "x" } });
    renderForm(
      <AgentProfileForm
        mode="edit"
        profile={
          {
            id: "p1",
            name: "个人档",
            visibility: "private",
            provider: "claude",
            model: null,
            system_prompt: "只读不改",
            tool_policy_id: null,
            mcp_refs: [],
            skill_refs: [],
            owner_user_id: "u1",
            workspace_id: null,
            version: 1,
            is_system_default: false,
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          } as unknown as AgentProfileRead
        }
        onClose={() => {}}
      />,
    );
    // 参考工作区 label（sourcing 语义，非归属）
    expect(screen.getByText(/参考工作区/)).toBeInTheDocument();
    // 自动取首个可见 ws 作 sourcing → updateProfile 收到 ws-a
    await waitFor(() => {
      expect(widCapture.updated.at(-1)).toBe("ws-a");
    });
    await waitFor(() => {
      expect(screen.getByText("github")).toBeInTheDocument();
    });
  });

  it("全局页 create 选定上下文后保存 → createProfile body 正确", async () => {
    workspacesApi.list.mockResolvedValue({
      items: [{ id: "ws-a", name: "前端组" }],
    });
    profilesApi.create.mockResolvedValue({ id: "p1", name: "审查" });
    renderForm(<AgentProfileForm mode="create" onClose={() => {}} />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如 代码审查助手"), {
        target: { value: "审查" },
      });
    });
    await chooseAntdOption("请选择工作区上下文", "前端组");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /保\s*存/ })).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    });
    await waitFor(() => {
      expect(profilesApi.create).toHaveBeenCalledTimes(1);
    });
    const body = profilesApi.create.mock.calls[0]![0];
    expect(body.name).toBe("审查");
    expect(body.visibility).toBe("private");
  });

  it("ws 内页（传 workspaceId）→ 不渲染选择器（路由 ws 已知），createProfile 用路由 ws", () => {
    renderForm(
      <AgentProfileForm mode="create" workspaceId="ws-1" onClose={() => {}} />,
    );
    expect(screen.queryByText("工作区上下文")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/请先选择上方「工作区上下文」/),
    ).not.toBeInTheDocument();
    expect(widCapture.created.at(-1)).toBe("ws-1");
  });

  it("visibility 切换：选「工作区」→ 保存 body.visibility=workspace（验收 4 语义）", async () => {
    profilesApi.create.mockResolvedValue({ id: "p1", name: "审查" });
    renderForm(
      <AgentProfileForm mode="create" workspaceId="ws-1" onClose={() => {}} />,
    );
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("例如 代码审查助手"), {
        target: { value: "审查" },
      });
    });
    await chooseAntdOption("个人（仅创建者可用）", "工作区（本工作区成员可用）");
    // 预览 Tag 切到「工作区」（VISIBILITY_LABEL.workspace），确认 state 已提交
    await waitFor(() => {
      expect(screen.getByText("工作区")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    });
    await waitFor(() => {
      expect(profilesApi.create).toHaveBeenCalledTimes(1);
    });
    expect(profilesApi.create.mock.calls[0]![0].visibility).toBe("workspace");
  });
});
