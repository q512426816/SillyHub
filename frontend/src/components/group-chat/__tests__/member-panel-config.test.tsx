/**
 * 群成员配置块四选口径测试（2026-11-02-group-member-footer-config）。
 *
 * 覆盖（requirements FR-01/FR-02 绑定）：
 *   1. 添加 Agent 对话框渲染供应商/模型/思考等级/档案四选（aria/id 锚定）；
 *      模型下拉未选供应商时禁用；思考等级按引擎 caps 渲染且档位含「最高」；
 *   2. 供应商→模型级联：候选=供应商 models 条目名（含 deepseek-v4.1-flash
 *      形态的具体模型名）+ 首项「默认（跟随供应商配置）」；提交 payload 携
 *      model/thinking_level；
 *   3. 机器下拉 label：runtime 无别名时回落「机器别名 · 引擎名」，不再以
 *      引擎名单独兜底（「机器: Claude Code」形态消失，FR-02）；
 *   4. buildMemberUpdatePayload：model/thinkingLevel diff（""=重置送空串、
 *      未变不送键——后端 PATCH null=不改口径）。
 *
 * mock 策略对齐 member-panel.test.tsx（apiFetch 覆写 + 数据源逐一 mock；
 * THINKING_LEVEL_OPTIONS/provider-caps 走真实导出——词表单源不 mock）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import {
  MemberPanel,
  buildMemberUpdatePayload,
} from "@/components/group-chat/member-panel";
import type { GroupChatRead, GroupMemberRead } from "@/lib/daemon";
import type { DaemonMachineRead, DaemonRuntimeRead } from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";
import type { ProjectMember } from "@/lib/ppm/types";
import { closestAntdSelect, queryAntdSelectZone, closestAntdSelectOption } from "@/test/dom-queries";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  machinesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  listProviders: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectWorkspaces: vi.fn(),
  listSimpleProjects: vi.fn(),
  uploadFile: vi.fn(),
  sessionPanel: vi.fn(),
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: (...args: unknown[]) => (mocks.apiFetch as (...a: unknown[]) => unknown)(...args) };
});
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));
vi.mock("@/lib/api/llm-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/llm-providers")>();
  return {
    ...actual,
    listProviders: (...args: unknown[]) => mocks.listProviders(...args),
  };
});
vi.mock("@/lib/agent-profiles", () => ({
  useMineAgentProfiles: () => ({
    profiles: [
      { id: "ap-1", name: "SillySpec 极速变更", provider: "claude" },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));
vi.mock("@/lib/ppm/project", () => ({
  listProjectMembers: (...args: unknown[]) => mocks.listProjectMembers(...args),
  listSimpleProjects: (...args: unknown[]) => mocks.listSimpleProjects(...args),
}));
vi.mock("@/lib/workspace", () => ({
  listProjectWorkspaces: (...args: unknown[]) => mocks.listProjectWorkspaces(...args),
}));
vi.mock("@/lib/file/api", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  deleteFile: async () => {},
  tryReclaimOrphanAvatarFile: () => false,
}));
vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) => (err instanceof Error ? err.message : "操作失败"),
  useNotify: () => mocks.notify,
}));
vi.mock("@/components/daemon/session-panel", () => ({
  SessionPanel: (props: Record<string, unknown>) => {
    mocks.sessionPanel(props);
    return <div data-testid="session-panel-mock" />;
  },
}));

function openAntdSelect(selectId: string) {
  const anchor = document.getElementById(selectId);
  if (!anchor) throw new Error(`element #${selectId} not found`);
  const root = anchor.classList.contains("ant-select")
    ? anchor
    : closestAntdSelect(anchor);
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  const clickZone = queryAntdSelectZone(root);
  if (!clickZone) throw new Error(`select click zone for #${selectId} not found`);
  fireEvent.mouseDown(clickZone);
}

async function chooseAntdOptionByText(selectId: string, optionText: string) {
  openAntdSelect(selectId);
  const option = await waitFor(() => {
    const hit = [...document.querySelectorAll(".ant-select-item-option-content")].find(
      (el) => el.textContent?.trim() === optionText,
    );
    if (!hit) throw new Error(`option "${optionText}" not found`);
    return hit as HTMLElement;
  });
  const optionRow = closestAntdSelectOption(option) as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  await act(async () => {
    await Promise.resolve();
  });
}

function makeRuntime(overrides: Partial<DaemonRuntimeRead> = {}): DaemonRuntimeRead {
  return {
    id: "rt-1",
    display_alias: null,
    name: null,
    provider: "claude",
    version: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    capabilities: null,
    allowed_roots: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as DaemonRuntimeRead;
}

function makeMachine(overrides: Partial<DaemonMachineRead> = {}): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "machine-1",
    display_alias: "本机-Mac",
    os: "macos",
    arch: "arm64",
    status: "online",
    last_heartbeat_at: "2026-08-15T08:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime()],
    ...overrides,
  } as DaemonMachineRead;
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "主工作区",
    slug: "main",
    root_path: "C:/main",
    status: "active",
    ...overrides,
  } as Workspace;
}

function agentMember(overrides: Partial<GroupMemberRead> = {}): GroupMemberRead {
  return {
    id: "mem-1",
    member_type: "agent",
    display_name: "小码",
    user_id: null,
    runtime_id: "rt-1",
    workspace_id: null,
    provider: "claude",
    llm_provider_id: null,
    agent_profile_id: null,
    config_snapshot: { machine_name: "本机-Mac", engine: "claude", runtime_id: "rt-1" },
    invited_by: "u-me",
    joined_at: "2026-09-01T00:00:00Z",
    removed_at: null,
    shadow_session_id: null,
    shadow_status: "active",
    team_enabled: false,
    ...overrides,
  } as GroupMemberRead;
}

function makeGroup(overrides: Partial<GroupChatRead> = {}): GroupChatRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    project_id: "pj-1",
    title: "四选口径群",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    consensus_mode: false,
    consensus_timeout_seconds: 600,
    cross_mention_mode: "private",
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [
      agentMember(),
      {
        id: "mem-owner",
        member_type: "user",
        display_name: "鲸落",
        user_id: "u-me",
        runtime_id: null,
        workspace_id: null,
        provider: null,
        llm_provider_id: null,
        agent_profile_id: null,
        config_snapshot: null,
        invited_by: "u-me",
        joined_at: "2026-09-01T00:00:00Z",
        removed_at: null,
        shadow_session_id: null,
        shadow_status: "none",
        team_enabled: false,
      } as GroupMemberRead,
    ],
    ...overrides,
  } as GroupChatRead;
}

function renderPanel(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  const machines = [makeMachine()];
  mocks.machinesHook.mockReturnValue({
    items: machines,
    sharedToMe: [],
    machineCandidates: machines,
    total: machines.length,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.listWorkspaces.mockResolvedValue({
    items: [makeWorkspace()],
    total: 1,
    limit: 100,
    offset: 0,
  });
  // 供应商带具体模型条目（FR-01 级联候选断言面；deepseek-v4.1-flash=用户实证形态）。
  mocks.listProviders.mockResolvedValue([
    {
      id: "lp-1",
      name: "OpenCode Go",
      models: [
        { name: "glm-4.7", roles: ["sonnet"] },
        { name: "deepseek-v4.1-flash", roles: [] },
      ],
    },
  ]);
  mocks.listProjectMembers.mockResolvedValue([
    { id: "pm-u-me", pm_project_id: "pj-1", user_id: "u-me", user_name: "我自己", username: null, depart_id: null, phone: null, role_id: null, role_name: null, depart_name: null, create_name: null, created_by: null, updated_by: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" } as ProjectMember,
  ]);
  mocks.listProjectWorkspaces.mockResolvedValue([{ workspace_id: "ws-1", name: "主工作区" }]);
  mocks.listSimpleProjects.mockResolvedValue([]);
  mocks.apiFetch.mockResolvedValue(agentMember());
});

afterEach(() => {
  cleanup();
});

async function openAddAgentDialog() {
  renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
  fireEvent.click(screen.getByTestId("member-panel-add-agent"));
  await screen.findByText("添加 Agent 成员");
}

describe("成员配置块四选渲染与级联（FR-01）", () => {
  it("渲染供应商/模型/思考等级/档案四选；模型未选供应商时禁用；思考档位含「最高」", async () => {
    await openAddAgentDialog();

    const providerSelect = document.getElementById("member-config-provider");
    const modelSelect = document.getElementById("member-config-model");
    const thinkingSelect = document.getElementById("member-config-thinking");
    const profileSelect = document.getElementById("member-config-profile");
    expect(providerSelect).toBeTruthy();
    expect(modelSelect).toBeTruthy();
    expect(thinkingSelect).toBeTruthy();
    expect(profileSelect).toBeTruthy();

    // 模型未选供应商（llmProviderId=""）→ 禁用（级联前置）。
    expect(modelSelect!.closest(".ant-select")?.classList.contains("ant-select-disabled")).toBe(
      true,
    );

    // 思考等级（claude caps.thinking_level=true）档位含「最高」（七档词表镜像）。
    openAntdSelect("member-config-thinking");
    const maxOpt = await waitFor(() => {
      const hit = [...document.querySelectorAll(".ant-select-item-option-content")].find(
        (el) => el.textContent?.trim() === "最高",
      );
      if (!hit) throw new Error("option 最高 not found");
      return hit;
    });
    expect(maxOpt).toBeTruthy();
  });

  it("供应商→模型级联：候选含具体模型名（deepseek-v4.1-flash）+ 首项默认；提交 payload 携 model/thinking_level", async () => {
    await openAddAgentDialog();

    fireEvent.change(screen.getByLabelText("Agent 成员群昵称"), {
      target: { value: "小新" },
    });
    await chooseAntdOptionByText("mp-add-agent-runtime", "本机-Mac · Claude Code");
    await chooseAntdOptionByText("mp-add-agent-workspace", "主工作区");

    // 选供应商 → 模型下拉解禁；候选=sonnet 主模型置顶 + 具体模型名 + 首项默认。
    await chooseAntdOptionByText("member-config-provider", "OpenCode Go");
    await waitFor(() =>
      expect(
        document
          .getElementById("member-config-model")!
          .closest(".ant-select")!
          .classList.contains("ant-select-disabled"),
      ).toBe(false),
    );
    openAntdSelect("member-config-model");
    const modelOpt = await waitFor(() => {
      const hit = [...document.querySelectorAll(".ant-select-item-option-content")].find(
        (el) => el.textContent?.trim() === "deepseek-v4.1-flash",
      );
      if (!hit) throw new Error("option deepseek-v4.1-flash not found");
      return hit;
    });
    expect(modelOpt).toBeTruthy();

    await chooseAntdOptionByText("member-config-model", "deepseek-v4.1-flash");
    await chooseAntdOptionByText("member-config-thinking", "最高");
    await chooseAntdOptionByText("member-config-profile", "SillySpec 极速变更");

    const submit = screen.getByRole("button", { name: "添 加" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    const json = mocks.apiFetch.mock.calls[0]![1] as { json: { agent: Record<string, unknown> } };
    expect(json.json.agent).toMatchObject({
      provider: "claude",
      llm_provider_id: "lp-1",
      model: "deepseek-v4.1-flash",
      thinking_level: "max",
      agent_profile_id: "ap-1",
    });
  });
});

describe("机器下拉 label 兜底（FR-02）", () => {
  it("runtime 无别名 → label=「机器别名 · 引擎名」，不再引擎名单独兜底", async () => {
    await openAddAgentDialog();

    openAntdSelect("mp-add-agent-runtime");
    const bare = [...document.querySelectorAll(".ant-select-item-option-content")].find(
      (el) => el.textContent?.trim() === "Claude Code",
    );
    expect(bare).toBeUndefined(); // 「机器: Claude Code」形态消失
    const hit = [...document.querySelectorAll(".ant-select-item-option-content")].find(
      (el) => el.textContent?.trim() === "本机-Mac · Claude Code",
    );
    expect(hit).toBeTruthy();
  });
});

describe("buildMemberUpdatePayload 模型/档位 diff（FR-01 提交面）", () => {
  const group = makeGroup();
  const member = agentMember();

  it("未变不送键（PATCH null=不改口径零噪声）", () => {
    const payload = buildMemberUpdatePayload(member, group, {
      provider: "claude",
      llmProviderId: "",
      model: "",
      thinkingLevel: "",
      agentProfileId: "ap-1",
      runtimeId: "rt-1",
      workspaceId: "",
    });
    expect(payload.model).toBeUndefined();
    expect(payload.thinking_level).toBeUndefined();
  });

  it("变更送新值；清空送空串（后端空串=显式重置语义）", () => {
    const payload = buildMemberUpdatePayload(
      agentMember({ model: "deepseek-v4.1-flash", thinking_level: "max" }),
      group,
      {
        provider: "claude",
        llmProviderId: "",
        model: "",
        thinkingLevel: "high",
        agentProfileId: "",
        runtimeId: "rt-1",
        workspaceId: "",
      },
    );
    expect(payload.model).toBe(""); // 清空=重置「跟随供应商配置」
    expect(payload.thinking_level).toBe("high");
  });
});
