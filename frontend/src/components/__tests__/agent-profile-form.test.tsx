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
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  AgentProfileForm,
  toCreateBody,
  toUpdateBody,
} from "@/components/agent-profile-form";

// ── mocks ────────────────────────────────────────────────────────────────

const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/errors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

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
    useCreateAgentProfile: () => ({
      mutateAsync: profilesApi.create,
      isPending: false,
    }),
    useUpdateAgentProfile: () => ({
      mutateAsync: profilesApi.update,
      isPending: false,
    }),
    useWorkspaceToolPolicies: () => ({
      policies: profilesApi.policies(),
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
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

  it("保留有效 model/system_prompt/tool_policy_id", () => {
    const created = toCreateBody({
      name: "深度重构",
      visibility: "platform",
      provider: "codex",
      model: "gpt-5",
      system_prompt: "你是重构专家",
      tool_policy_id: "pol-1",
      mcp_refs: [],
      skill_refs: ["refactor"],
    });
    expect(created.model).toBe("gpt-5");
    expect(created.system_prompt).toBe("你是重构专家");
    expect(created.tool_policy_id).toBe("pol-1");
    expect(created.skill_refs).toEqual(["refactor"]);
  });

  it("toUpdateBody 同样空串→null + refs 缺省 []", () => {
    const updated = toUpdateBody({
      name: "x",
      visibility: "private",
      provider: "claude",
      model: undefined,
      system_prompt: undefined,
      tool_policy_id: undefined,
      mcp_refs: undefined,
      skill_refs: undefined,
    });
    expect(updated.model).toBeNull();
    expect(updated.mcp_refs).toEqual([]);
    expect(updated.skill_refs).toEqual([]);
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
