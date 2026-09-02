/**
 * MemberPanel 单测（2026-09-01-session-group-chat task-09 / FR-14 / FR-15，
 * design §7 成员面板 + §4.5 热切换）。
 *
 * 依据：
 *   - components/group-chat/member-panel.tsx（本 task 实现）
 *   - tasks/task-09.md acceptance：分组渲染（用户/agent）、在线绿点判定、
 *     热切换弹窗提交（updateGroupMember 调用参数）、机器变更二次确认出现、
 *     重置记忆 confirm+调用、群主移除按钮权限
 *   - prototype-group-chat.html .members-panel/.agent-card/.ac-kv/.online-dot
 *
 * 覆盖：
 *   1. 分组渲染——Agent 成员六要素卡片（机器/工作区/引擎/模型/方案 +
 *      shadow_status 徽标）+ 用户成员行（群主标识/@昵称）；
 *   2. 在线态——online_member_ids 命中用户 id 绿点 / 未命中灰点；
 *   3. 热切换弹窗——仅模型变更直接提交 updateGroupMember（只送变更字段）；
 *      机器变更先出现记忆重置警示 + Modal.confirm 二次确认，确认后提交
 *      runtime_id；未修改任何项应用按钮禁用；
 *   4. 重置记忆——Modal.confirm 确认后 resetGroupMemberMemory；
 *   5. 群主权限——非群主无「切换配置/重置记忆/移除」按钮；群主可移除非群主
 *      用户成员（confirm 后 DELETE），群主自身行无移除按钮；
 *   6. 邀请用户 / 添加 Agent 内建入口（群聊体验对齐 quick）——群主可见按钮；
 *      邀请对话框 = 项目人员多选（排除已在群）逐个 POST members（user 体含
 *      display_name 默认用户名）；添加 Agent 对话框 = 六要素表单 POST members
 *      （agent 体）；非群主无按钮；
 *   7. 团队能力开关（quick 群成员团队能力）——展示（claude 可切 / codex 禁用）；
 *      群主切换走「重建影子会话并重置独立记忆」Modal.confirm → PATCH
 *      team_enabled；取消不提交；非群主只读。
 *   8. 影子会话面板（quick 2026-09-02：SessionPanel dialog 本体替换自研查看器）
 *      ——agent 卡整卡点击 → Drawer 内挂 SessionPanel（mode=dialog /
 *      sessionId=影子 id / 成员引擎 providers）；普通成员也可打开；未建影子无
 *      点击语义；卡内按钮不透传。
 *
 * mock 策略（对齐 sessions/__tests__/create-group-wizard.test.tsx 惯例）：
 *   - @/lib/api 仅覆写 apiFetch（真实 daemon.ts 群客户端消费 mock——断言路径
 *     /method/payload）；
 *   - 数据源 hook/查询（use-daemon-machines / llm-providers / agent-profiles /
 *     workspaces / ppm/project（listProjectMembers——member-panel 校验器复用链上
 *     的建群向导也 import 该模块）/ workspace（listProjectWorkspaces）/ errors.
 *     useNotify）逐一 mock；
 *   - antd Select 经 id 锚定 + mousedown 打开；Modal.confirm spy 模拟确认
 *     （workspace-config-card.test 同款）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Modal } from "antd";

import { MemberPanel } from "@/components/group-chat/member-panel";
import type { GroupChatRead, GroupMemberRead} from "@/lib/daemon";
import type { DaemonMachineRead, DaemonRuntimeRead } from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";
import type { ProjectMember } from "@/lib/ppm/types";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  machinesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
  // quick 邀请/添加 Agent：项目人员 + 项目关联工作区数据源。
  listProjectMembers: vi.fn(),
  listProjectWorkspaces: vi.fn(),
  // 建群向导校验器复用链（member-panel import 向导模块）连带 import。
  listSimpleProjects: vi.fn(),
  // quick 成员头像：上传管线 mock（fetchFileBlob 供头像渲染链路）。
  uploadFile: vi.fn(),
  // 影子会话面板（2026-09-02）：SessionPanel 本体 mock——只断言挂载 props，
  // 面板内部数据链路由 session-panel 自身测试覆盖。
  sessionPanel: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) =>
      (mocks.apiFetch as (...a: unknown[]) => unknown)(...args),
  };
});

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

vi.mock("@/lib/agent-profiles", () => ({
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/ppm/project", () => ({
  listProjectMembers: (...args: unknown[]) => mocks.listProjectMembers(...args),
  listSimpleProjects: (...args: unknown[]) => mocks.listSimpleProjects(...args),
}));

vi.mock("@/lib/workspace", () => ({
  listProjectWorkspaces: (...args: unknown[]) =>
    mocks.listProjectWorkspaces(...args),
}));

vi.mock("@/lib/file/api", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
}));

vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

// 影子会话面板本体 mock（quick 2026-09-02）：member-panel 只负责以 dialog 模式
// 挂载 SessionPanel 并传影子 sessionId，面板内部（logs 预取/SSE/追问）不在本
// 套件推理面。
vi.mock("@/components/daemon/session-panel", () => ({
  SessionPanel: (props: Record<string, unknown>) => {
    mocks.sessionPanel(props);
    return (
      <div
        data-testid="session-panel-mock"
        data-session-id={String(props.sessionId)}
      />
    );
  },
}));

// ── antd Select 触发助手（create-group-wizard.test 同款，经 id 锚定） ──────

function openAntdSelect(selectId: string) {
  const anchor = document.getElementById(selectId);
  if (!anchor) throw new Error(`element #${selectId} not found`);
  const root = anchor.classList.contains("ant-select")
    ? anchor
    : (anchor.closest(".ant-select") as HTMLElement | null);
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  const clickZone =
    (root.querySelector(".ant-select-content") as HTMLElement | null) ??
    (root.querySelector(".ant-select-selector") as HTMLElement | null);
  if (!clickZone) throw new Error(`select click zone for #${selectId} not found`);
  fireEvent.mouseDown(clickZone);
}

async function chooseAntdOptionByText(selectId: string, optionText: string) {
  openAntdSelect(selectId);
  const option = await waitFor(() => {
    const hit = [
      ...document.querySelectorAll(".ant-select-item-option-content"),
    ].find((el) => el.textContent?.trim() === optionText);
    if (!hit) throw new Error(`option "${optionText}" not found`);
    return hit as HTMLElement;
  });
  const optionRow = option.closest(".ant-select-item-option") as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  await act(async () => {
    await Promise.resolve();
  });
}

/** Modal.confirm spy：模拟用户点「确认」（调 onOk；workspace-config-card 同款）。 */
function spyConfirmOk() {
  return vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
    opts.onOk?.(undefined as never);
    return { destroy: () => {} } as never;
  });
}

/** Modal.confirm spy：仅捕获不确认（点「取消」）。 */
function spyConfirmCancel() {
  return vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
    opts.onCancel?.(undefined as never);
    return { destroy: () => {} } as never;
  });
}

// ── 固件构造 ─────────────────────────────────────────────────────────────

function makeRuntime(
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
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

function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
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
    runtime_count: 2,
    online_runtime_count: 2,
    runtimes: [
      makeRuntime({ id: "rt-1", provider: "claude" }),
      makeRuntime({ id: "rt-2", provider: "codex" }),
    ],
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

/** 项目关联工作区（AddAgentMemberModal 工作区候选；lib/workspace WorkspaceBrief）。 */
function makeProjectWorkspace() {
  return { workspace_id: "ws-1", name: "主工作区" };
}

/** 项目人员（InviteUsersModal 候选；lib/ppm/types ProjectMember 形状裁剪）。 */
function makeProjectMember(
  userId: string,
  userName: string,
): ProjectMember {
  return {
    id: `pm-${userId}`,
    pm_project_id: "pj-1",
    user_id: userId,
    user_name: userName,
    username: null,
    depart_id: null,
    phone: null,
    role_id: null,
    role_name: null,
    depart_name: null,
    create_name: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function agentMember(
  overrides: Partial<GroupMemberRead> = {},
): GroupMemberRead {
  return {
    id: "mem-1",
    member_type: "agent",
    display_name: "小码",
    user_id: null,
    runtime_id: "rt-1",
    workspace_id: null,
    provider: "claude",
    llm_provider_id: null,
    agent_profile_id: "ap-1",
    config_snapshot: {
      machine_name: "本机-Mac",
      engine: "claude",
      runtime_id: "rt-1",
      profile_name: "资深前端工程师",
    },
    invited_by: "u-me",
    joined_at: "2026-09-01T00:00:00Z",
    removed_at: null,
    shadow_session_id: null,
    shadow_status: "active",
    team_enabled: false,
    ...overrides,
  };
}

function userMember(overrides: Partial<GroupMemberRead> = {}): GroupMemberRead {
  return {
    id: "mem-3",
    member_type: "user",
    display_name: "林一",
    user_id: "u-lin",
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
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupChatRead> = {}): GroupChatRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    project_id: "pj-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [
      agentMember(),
      agentMember({
        id: "mem-2",
        display_name: "小测",
        runtime_id: "rt-2",
        provider: "codex",
        agent_profile_id: null,
        config_snapshot: {
          machine_name: "构建机-Win",
          engine: "codex",
          runtime_id: "rt-2",
        },
        shadow_status: "none",
      }),
      // 群主本人（user_id = created_by）。
      userMember({
        id: "mem-owner",
        display_name: "鲸落",
        user_id: "u-me",
      }),
      userMember(),
      userMember({
        id: "mem-4",
        display_name: "陈默",
        user_id: "u-chen",
      }),
    ],
    ...overrides,
  };
}

function renderPanel(
  ui: React.ReactElement,
): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
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
    items: [makeWorkspace(), makeWorkspace({ id: "ws-2", name: "副工作区" })],
    total: 2,
    limit: 100,
    offset: 0,
  });
  mocks.listProviders.mockResolvedValue([
    { id: "lp-1", name: "GLM 供应商" },
  ]);
  mocks.profilesHook.mockReturnValue({
    profiles: [
      { id: "ap-1", name: "资深前端工程师", provider: "claude" },
      { id: "ap-2", name: "测试工程师", provider: "codex" },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  // quick 邀请/添加 Agent 数据源：项目人员（含已在群 u-me/u-lin/u-chen + 候选
  // 苏七/赵九）与项目关联工作区。
  mocks.listProjectMembers.mockResolvedValue([
    makeProjectMember("u-me", "我自己"),
    makeProjectMember("u-lin", "林一"),
    makeProjectMember("u-chen", "陈默"),
    makeProjectMember("u-su", "苏七"),
    makeProjectMember("u-zhao", "赵九"),
  ]);
  mocks.listProjectWorkspaces.mockResolvedValue([makeProjectWorkspace()]);
  mocks.listSimpleProjects.mockResolvedValue([]);
  // 变更操作默认成功（返回成员摘要形态即可——面板只读 display_name）。
  mocks.apiFetch.mockResolvedValue(agentMember());
});

afterEach(() => {
  cleanup();
});

/** 打开指定 agent 成员卡片的「切换配置」热切换弹窗。 */
async function openSwitchModal(cardTestId: string) {
  fireEvent.click(
    within(screen.getByTestId(cardTestId)).getByRole("button", {
      name: "切换配置",
    }),
  );
  await screen.findByText(/的 Agent 配置/);
}

// ── 1. 分组渲染 ──────────────────────────────────────────────────────────

describe("MemberPanel 分组渲染（task-09 / FR-14）", () => {
  it("Agent 成员区：六要素卡片（机器/工作区/引擎/模型/方案）+ 影子状态徽标", async () => {
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" />,
    );

    expect(screen.getByText("Agent 成员（2）")).toBeTruthy();
    expect(screen.getByText("用户成员（3）")).toBeTruthy();

    const card = screen.getByTestId("agent-member-card-mem-1");
    expect(card.textContent).toContain("小码");
    expect(card.textContent).toContain("在线"); // shadow_status=active
    // 六要素键值（config_snapshot 容错取键 + 缺省兜底）。
    expect(card.textContent).toContain("本机-Mac");
    expect(card.textContent).toContain("rt-1"); // runtime 短码
    // 工作区：workspace_id null → 群工作区解析（工作区名查询异步就位后覆写短码回退）。
    await waitFor(() => expect(card.textContent).toContain("主工作区"));
    expect(card.textContent).toContain("（群工作区）");
    expect(card.textContent).toContain("Claude Code");
    expect(card.textContent).toContain("未指定（本机默认）"); // snapshot 无 model
    expect(card.textContent).toContain("资深前端工程师");

    // 第二张卡：codex 引擎 + shadow_status=none（未建）。
    const card2 = screen.getByTestId("agent-member-card-mem-2");
    expect(card2.textContent).toContain("小测");
    expect(card2.textContent).toContain("Codex");
    expect(card2.textContent).toContain("未建");
  });

  it("用户成员区：昵称 + @提及词 + 群主标识", () => {
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" />,
    );

    const ownerRow = screen.getByTestId("user-member-row-mem-owner");
    expect(ownerRow.textContent).toContain("鲸落");
    expect(ownerRow.textContent).toContain("群主");
    const linRow = screen.getByTestId("user-member-row-mem-3");
    expect(linRow.textContent).toContain("@林一");
    expect(linRow.textContent).not.toContain("群主");
  });

  it("已移除成员（removed_at 非空）不进分区渲染", () => {
    const group = makeGroup();
    group.members = [
      userMember({ id: "mem-removed", display_name: "已退出", removed_at: "2026-09-01T01:00:00Z" }),
      agentMember(),
    ];
    renderPanel(<MemberPanel group={group} currentUserId="u-me" />);

    expect(screen.queryByText("已退出")).toBeNull();
    expect(screen.getByText("用户成员（0）")).toBeTruthy();
    expect(screen.getByText("Agent 成员（1）")).toBeTruthy();
  });
});

// ── 2. 在线绿点（presence → online_member_ids） ──────────────────────────

describe("MemberPanel 在线绿点判定（design §5.4）", () => {
  it("online_member_ids 命中用户 id → 绿点；未命中 → 灰点", () => {
    renderPanel(
      <MemberPanel
        group={makeGroup()}
        onlineMemberIds={["u-me", "u-lin"]}
        currentUserId="u-me"
      />,
    );

    const onlineDot = screen.getByLabelText("林一 在线");
    expect(onlineDot.className).toContain("bg-success");
    const offlineDot = screen.getByLabelText("陈默 离线");
    expect(offlineDot.className).toContain("bg-muted-foreground");
    // 群主在线（u-me 命中）。
    expect(screen.getByLabelText("鲸落 在线")).toBeTruthy();
  });

  it("缺省 online_member_ids（presence 未接通前）→ 全灰点", () => {
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" />,
    );

    expect(screen.getByLabelText("林一 离线")).toBeTruthy();
    expect(screen.getByLabelText("鲸落 离线")).toBeTruthy();
  });
});

// ── 2b. 运行中徽标（群聊运行态可见 quick，2026-09-02） ────────────────────

describe("MemberPanel 运行中徽标（群聊运行态可见 quick）", () => {
  it("runningMemberIds 命中 → agent 卡「运行中」动态徽标；未命中成员不渲染", () => {
    renderPanel(
      <MemberPanel
        group={makeGroup()}
        currentUserId="u-me"
        runningMemberIds={new Set(["mem-1"])}
      />,
    );

    const card = screen.getByTestId("agent-member-card-mem-1");
    const badge = within(card).getByTestId("member-running-badge-mem-1");
    expect(badge.textContent).toContain("运行中");
    // 徽标与 shadow_status 徽标并存（在线 + 运行中）。
    expect(card.textContent).toContain("在线");
    // 未运行 agent（小测 mem-2）与用户成员无徽标。
    expect(screen.queryByTestId("member-running-badge-mem-2")).toBeNull();
  });

  it("缺省 runningMemberIds（无运行态数据源）→ 无徽标", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    expect(screen.queryByTestId("member-running-badge-mem-1")).toBeNull();
  });
});

// ── 3. 热切换弹窗（design §4.5 + 原型 switchModal） ──────────────────────

describe("MemberPanel 热切换弹窗（task-09 / FR-14）", () => {
  it("打开弹窗：五下拉就位 + 未修改时应用禁用", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);

    await openSwitchModal("agent-member-card-mem-1");
    expect(
      screen.getByText("切换「小码」的 Agent 配置"),
    ).toBeTruthy();

    const apply = screen.getByRole("button", { name: "应用（下轮生效）" });
    expect(apply).toBeDisabled();
  });

  it("仅模型变更：无二次确认，直接提交 updateGroupMember（只送变更字段）", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    await openSwitchModal("agent-member-card-mem-1");
    // 模型：不指定 → GLM 供应商（小码 llm_provider_id=null）。
    await chooseAntdOptionByText("mp-switch-model", "GLM 供应商");
    fireEvent.click(screen.getByRole("button", { name: "应用（下轮生效）" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-1",
      { method: "PATCH", json: { llm_provider_id: "lp-1" } },
    );
    // 模型/方案变更不触发记忆重置确认（design §4.5）。
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("机器变更：弹窗内即时警示 + Modal.confirm 二次确认（独立记忆重置），确认后提交 runtime_id", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    await openSwitchModal("agent-member-card-mem-1");
    // 机器：rt-1（Claude Code）→ rt-2（Codex）。
    await chooseAntdOptionByText("mp-switch-runtime", "Codex");
    // 即时警示条出现（原型 callout 语义）。
    expect(
      await screen.findByTestId("mp-switch-memory-warn"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "应用（下轮生效）" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("重置独立记忆"),
      }),
    );
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-1",
      { method: "PATCH", json: { runtime_id: "rt-2" } },
    );
    confirmSpy.mockRestore();
  });

  it("机器变更二次确认点「取消」：不提交 updateGroupMember", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmCancel();

    await openSwitchModal("agent-member-card-mem-1");
    await chooseAntdOptionByText("mp-switch-runtime", "Codex");
    fireEvent.click(screen.getByRole("button", { name: "应用（下轮生效）" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("成功后回调 onRefresh（消费方 invalidate 群列表 + 群详情）", async () => {
    const onRefresh = vi.fn();
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" onRefresh={onRefresh} />,
    );
    const confirmSpy = spyConfirmOk();

    await openSwitchModal("agent-member-card-mem-1");
    await chooseAntdOptionByText("mp-switch-model", "GLM 供应商");
    fireEvent.click(screen.getByRole("button", { name: "应用（下轮生效）" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });
});

// ── 4. 重置记忆 ──────────────────────────────────────────────────────────

describe("MemberPanel 重置记忆（design §6.1 reset-memory）", () => {
  it("Modal.confirm 确认 → resetGroupMemberMemory POST 端点", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    fireEvent.click(
      within(screen.getByTestId("agent-member-card-mem-1")).getByRole("button", {
        name: "重置记忆",
      }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("重置「小码」的独立记忆"),
      }),
    );
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-1/reset-memory",
      { method: "POST" },
    );
    confirmSpy.mockRestore();
  });

  it("确认前取消 → 不调用端点", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmCancel();

    fireEvent.click(
      within(screen.getByTestId("agent-member-card-mem-1")).getByRole("button", {
        name: "重置记忆",
      }),
    );

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

// ── 5. 群主权限（design §5.3：变更操作 = 群主） ───────────────────────────

describe("MemberPanel 群主权限（task-09 acceptance）", () => {
  it("非群主：无「切换配置/重置记忆/移除」按钮（只读面板）", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-lin" />);

    expect(
      screen.queryByRole("button", { name: "切换配置" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "重置记忆" })).toBeNull();
    expect(screen.queryByRole("button", { name: "移除 林一" })).toBeNull();
  });

  it("群主：用户成员行移除按钮（群主自身行无）→ confirm → DELETE 成员端点", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    // 群主自身行无移除按钮。
    expect(
      screen.queryByRole("button", { name: "移除 鲸落" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除 林一" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("移除「林一」"),
      }),
    );
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-3",
      { method: "DELETE" },
    );
    confirmSpy.mockRestore();
  });

  it("群主：agent 成员卡片也提供移除（confirm → DELETE，design §8 member.removed）", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    fireEvent.click(screen.getByRole("button", { name: "移除 小码" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-1",
      { method: "DELETE" },
    );
    confirmSpy.mockRestore();
  });
});

// ── 6. 邀请用户 / 添加 Agent 内建入口（群聊体验对齐 quick，2026-09-02）─────

describe("MemberPanel 邀请用户对话框（quick 内建入口）", () => {
  it("群主点「+ 邀请用户」→ 项目人员多选（排除已在群）→ 逐个 POST members（user 体 display_name 默认用户名）→ onRefresh", async () => {
    const onRefresh = vi.fn();
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByTestId("member-panel-invite-user"));
    expect(await screen.findByText("邀请用户入群")).toBeTruthy();
    // 候选排除已在群成员（u-me 群主 / u-lin 林一 / u-chen 陈默）。
    await waitFor(() =>
      expect(mocks.listProjectMembers).toHaveBeenCalledWith({
        pm_project_id: "pj-1",
      }),
    );
    openAntdSelect("mp-invite-users");
    const optionTexts = [
      ...document.querySelectorAll(".ant-select-item-option-content"),
    ].map((el) => el.textContent?.trim());
    expect(optionTexts).toContain("苏七");
    expect(optionTexts).toContain("赵九");
    expect(optionTexts).not.toContain("林一");
    expect(optionTexts).not.toContain("陈默");
    expect(optionTexts).not.toContain("我自己");

    // 多选两位提交（苏七 + 赵九）→ 串行两个 POST（payload user 体含昵称）。
    await chooseAntdOptionByText("mp-invite-users", "苏七");
    await chooseAntdOptionByText("mp-invite-users", "赵九");
    fireEvent.click(screen.getByRole("button", { name: "邀请（2）" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/daemon/group-chats/g-1/members",
      {
        method: "POST",
        json: { user: { user_id: "u-su", display_name: "苏七" } },
      },
    );
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/daemon/group-chats/g-1/members",
      {
        method: "POST",
        json: { user: { user_id: "u-zhao", display_name: "赵九" } },
      },
    );
    // 成功后刷新 + 关闭对话框。
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("邀请用户入群")).toBeNull(),
    );
  });
});

describe("MemberPanel 添加 Agent 对话框（quick 内建入口，六要素表单）", () => {
  it("群主点「+ 添加 Agent」→ 六要素提交 POST members（agent 体）→ onRefresh", async () => {
    const onRefresh = vi.fn();
    renderPanel(
      <MemberPanel group={makeGroup()} currentUserId="u-me" onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByTestId("member-panel-add-agent"));
    expect(await screen.findByText("添加 Agent 成员")).toBeTruthy();

    // 未填必填项 → 添加按钮禁用。
    const submit = screen.getByRole("button", { name: "添 加" });
    expect(submit).toBeDisabled();

    // 六要素：昵称 / 机器 / 工作区（项目关联）必选；引擎默认 Claude Code。
    fireEvent.change(screen.getByLabelText("Agent 成员群昵称"), {
      target: { value: "小新" },
    });
    await chooseAntdOptionByText("mp-add-agent-runtime", "Claude Code");
    await chooseAntdOptionByText("mp-add-agent-workspace", "主工作区");
    // 模型（llm 供应商）+ 方案可选填。
    await chooseAntdOptionByText("mp-add-agent-model", "GLM 供应商");
    await chooseAntdOptionByText("mp-add-agent-profile", "资深前端工程师");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members",
      {
        method: "POST",
        json: {
          agent: {
            display_name: "小新",
            runtime_id: "rt-1",
            workspace_id: "ws-1",
            provider: "claude",
            llm_provider_id: "lp-1",
            agent_profile_id: "ap-1",
            team_enabled: false,
          },
        },
      },
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("添加 Agent 成员")).toBeNull(),
    );
  });

  it("昵称与在群成员重复 → 即时校验错误 + 提交禁用（向导 validateMemberDisplayName 复用）", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);

    fireEvent.click(screen.getByTestId("member-panel-add-agent"));
    expect(await screen.findByText("添加 Agent 成员")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Agent 成员群昵称"), {
      target: { value: "小码" },
    });

    expect(
      (await screen.findByTestId("mp-add-agent-name-error")).textContent,
    ).toContain("重复");
    expect(screen.getByRole("button", { name: "添 加" })).toBeDisabled();
  });
});

// ── 6b. 非群主入口权限 ────────────────────────────────────────────────────

describe("MemberPanel 邀请/添加入口权限（quick）", () => {
  it("非群主：无「+ 邀请用户」「+ 添加 Agent」按钮", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-lin" />);
    expect(screen.queryByTestId("member-panel-invite-user")).toBeNull();
    expect(screen.queryByTestId("member-panel-add-agent")).toBeNull();
  });
});

// ── quick：成员头像（渲染 + 换头像/恢复默认） ──────────────────────────────

describe("MemberPanel 成员头像（quick 群成员头像自定义）", () => {
  it("头像渲染：avatar 有值 → 图片（blob）；无值 → 首字回退", async () => {
    const group = makeGroup();
    // mem-1（agent 小码）带头像；mem-2（agent 小测）无头像。
    (group.members![0] as Record<string, unknown>).avatar =
      "/api/file/f-av-1";
    renderPanel(
      <MemberPanel group={group} currentUserId="u-me" onlineMemberIds={["u-lin"]} />,
    );

    const card = screen.getByTestId("agent-member-card-mem-1");
    await waitFor(() => {
      expect(
        card.querySelector('[data-testid="group-member-avatar-img"] img'),
      ).toBeTruthy();
    });
    const card2 = screen.getByTestId("agent-member-card-mem-2");
    expect(
      card2.querySelector('[data-testid="group-member-avatar-initial"]'),
    ).toBeTruthy();
    expect(card2.querySelector("img")).toBeNull();
  });

  it("群主给 agent 成员换头像：上传 → PATCH members/{mid} avatar=url；恢复默认 → avatar 空串", async () => {
    const group = makeGroup();
    // 已有自定义头像（恢复默认按钮的渲染前提）。
    (group.members![0] as Record<string, unknown>).avatar =
      "/api/file/f-av-0";
    renderPanel(
      <MemberPanel group={group} currentUserId="u-me" />,
    );
    const card = await screen.findByTestId("agent-member-card-mem-1");

    // 上传头像（隐藏 file input → uploadFile → PATCH avatar=/api/file/{id}）。
    const uploadInput = within(card).getByLabelText(
      "Agent 成员 小码 头像（选择图片）",
    );
    mocks.uploadFile.mockResolvedValue({
      id: "file-av-9",
      original_name: "a.png",
      mime_type: "image/png",
      size: 10,
    });
    fireEvent.change(uploadInput, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/daemon/group-chats/g-1/members/mem-1",
        { method: "PATCH", json: { avatar: "/api/file/file-av-9" } },
      ),
    );

    // 恢复默认 → avatar=""（后端 None=不改、空串=清除）。
    mocks.apiFetch.mockClear();
    fireEvent.click(
      within(card).getByLabelText("Agent 成员 小码 头像恢复默认"),
    );
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/daemon/group-chats/g-1/members/mem-1",
        { method: "PATCH", json: { avatar: "" } },
      ),
    );
  });

  it("用户成员：群主或本人可换头像（非群主非本人无入口）", async () => {
    // 非群主视角（currentUserId=u-lin）：本人行（林一）有换头像入口，
    // 陈默行（非本人非群主）无入口；群主行（鲸落）非群主视角也无入口。
    const group = makeGroup();
    renderPanel(
      <MemberPanel group={group} currentUserId="u-lin" />,
    );
    const ownRow = await screen.findByTestId("user-member-row-mem-3");
    expect(
      within(ownRow).queryByLabelText("用户成员 林一 头像上传"),
    ).toBeTruthy();
    const otherRow = screen.getByTestId("user-member-row-mem-4");
    expect(
      within(otherRow).queryByLabelText("用户成员 陈默 头像上传"),
    ).toBeNull();
    const ownerRow = screen.getByTestId("user-member-row-mem-owner");
    expect(
      within(ownerRow).queryByLabelText("用户成员 鲸落 头像上传"),
    ).toBeNull();
  });
});

// ── 6. 团队能力开关（quick 群成员团队能力） ────────────────────────────────

describe("MemberPanel 团队能力开关（quick 群成员团队能力）", () => {
  it("展示：claude 成员开关可切换；codex 成员禁用（仅 Claude 引擎）", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);

    // 两张 agent 卡各有一份「团队能力」行——within 卡片作用域断言。
    const claudeCard = screen.getByTestId("agent-member-card-mem-1");
    const claudeSwitch = within(claudeCard).getByTestId(
      "team-switch-mem-1",
    ) as HTMLInputElement;
    expect(claudeSwitch).not.toBeDisabled();
    expect(claudeSwitch.getAttribute("aria-checked")).toBe("false");
    expect(claudeCard.textContent).toContain("未开启");

    // codex 成员（小测 mem-2）：开关禁用。
    const codexCard = screen.getByTestId("agent-member-card-mem-2");
    const codexSwitch = within(codexCard).getByTestId(
      "team-switch-mem-2",
    ) as HTMLInputElement;
    expect(codexSwitch).toBeDisabled();
  });

  it("群主切换 → Modal.confirm「重建影子会话并重置独立记忆」确认 → PATCH team_enabled", async () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmOk();

    fireEvent.click(screen.getByTestId("team-switch-mem-1"));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("开启「小码」的团队能力"),
        content: expect.stringContaining("重建其影子会话并重置独立记忆"),
      }),
    );
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/mem-1",
      { method: "PATCH", json: { team_enabled: true } },
    );
    confirmSpy.mockRestore();
  });

  it("确认弹窗点「取消」：不提交 PATCH", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-me" />);
    const confirmSpy = spyConfirmCancel();

    fireEvent.click(screen.getByTestId("team-switch-mem-1"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("非群主：开关禁用（只读展示）", () => {
    renderPanel(<MemberPanel group={makeGroup()} currentUserId="u-lin" />);
    const sw = screen.getByTestId("team-switch-mem-1") as HTMLInputElement;
    expect(sw).toBeDisabled();
  });

  it("已开启成员：开关 aria-checked=true + 文案「可派分身并行干活」", () => {
    const group = makeGroup();
    group.members = [agentMember({ team_enabled: true })];
    renderPanel(<MemberPanel group={group} currentUserId="u-me" />);

    const card = screen.getByTestId("agent-member-card-mem-1");
    const sw = within(card).getByTestId(
      "team-switch-mem-1",
    ) as HTMLInputElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(
      within(card).getByText("已开启 · 可派分身并行干活"),
    ).toBeTruthy();
  });
});

// ── 8. 影子会话面板入口（群聊体验 quick，2026-09-02：SessionPanel dialog 本体）──

describe("MemberPanel 影子会话面板（quick）", () => {
  it("agent 卡整卡点击（有影子会话）→ Drawer 内挂 SessionPanel mode=dialog（sessionId=影子 id）", async () => {
    const group = makeGroup();
    group.members = [
      agentMember({ shadow_session_id: "shadow-1", shadow_status: "active" }),
    ];
    renderPanel(<MemberPanel group={group} currentUserId="u-me" />);

    // 卡片本身可点（非按钮命中——点卡片标题文本区域）。
    const card = screen.getByTestId("agent-member-card-mem-1");
    expect(card.getAttribute("title")).toContain("影子会话面板");
    fireEvent.click(within(card).getByText("小码"));

    // Drawer 标题 + SessionPanel 以 page 模式挂载（2026-09-02 版式统一：与
    // /sessions 全页同一渲染分支；machines/llmProviders 页面级数据注入——
    // machines 取 useDaemonMachines 固件，llmProviders 取 listProviders 固件）。
    expect(await screen.findByText("小码 · 影子会话")).toBeTruthy();
    await waitFor(() => expect(mocks.sessionPanel).toHaveBeenCalled());
    const props = mocks.sessionPanel.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(props).toMatchObject({
      mode: "page",
      sessionId: "shadow-1",
    });
    expect(Array.isArray(props["machines"])).toBe(true);
    expect(Array.isArray(props["llmProviders"])).toBe(true);
  });

  it("普通成员也可打开面板（影子 logs 读端点已放行；写操作后端强校验群主）", async () => {
    const group = makeGroup();
    group.members = [
      agentMember({ shadow_session_id: "shadow-1", shadow_status: "active" }),
    ];
    // 普通成员（非群主）视角：currentUserId=u-lin。
    renderPanel(<MemberPanel group={group} currentUserId="u-lin" />);
    fireEvent.click(
      within(screen.getByTestId("agent-member-card-mem-1")).getByText("小码"),
    );
    expect(await screen.findByText("小码 · 影子会话")).toBeTruthy();
    await waitFor(() => expect(mocks.sessionPanel).toHaveBeenCalled());
  });

  it("未建影子（shadow_session_id null）→ 无点击打开语义（title 无提示）", () => {
    const group = makeGroup();
    group.members = [agentMember({ shadow_session_id: null })];
    renderPanel(<MemberPanel group={group} currentUserId="u-me" />);
    const card = screen.getByTestId("agent-member-card-mem-1");
    expect(card.getAttribute("title")).toBeNull();
  });

  it("卡内按钮点击不透传开 Drawer（防误触）", () => {
    const group = makeGroup();
    group.members = [
      agentMember({ shadow_session_id: "shadow-1", shadow_status: "active" }),
    ];
    renderPanel(<MemberPanel group={group} currentUserId="u-me" />);
    // 点「切换配置」按钮 → 只开热切换弹窗，不开影子面板。
    fireEvent.click(
      within(screen.getByTestId("agent-member-card-mem-1")).getByRole("button", {
        name: "切换配置",
      }),
    );
    expect(screen.getByText(/的 Agent 配置/)).toBeTruthy();
    expect(mocks.sessionPanel).not.toHaveBeenCalled();
  });
});
