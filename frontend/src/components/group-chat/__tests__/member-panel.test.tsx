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
 *   6. 邀请/添加入口回调（onInviteUser/onAddAgent props 暴露）。
 *
 * mock 策略（对齐 sessions/__tests__/create-group-wizard.test.tsx 惯例）：
 *   - @/lib/api 仅覆写 apiFetch（真实 daemon.ts 群客户端消费 mock——断言路径
 *     /method/payload）；
 *   - 数据源 hook/查询（use-daemon-machines / llm-providers / agent-profiles /
 *     workspaces / errors.useNotify）逐一 mock；
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

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  machinesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
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

vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
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
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupChatRead> = {}): GroupChatRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
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

// ── 6. 邀请/添加入口（props 回调暴露，向导复用归 task-07/08） ─────────────

describe("MemberPanel 邀请/添加入口回调", () => {
  it("「+ 添加」/「+ 邀请」触发 onAddAgent/onInviteUser；未传回调不渲染入口", () => {
    const onAddAgent = vi.fn();
    const onInviteUser = vi.fn();
    const { rerender } = renderPanel(
      <MemberPanel
        group={makeGroup()}
        currentUserId="u-me"
        onAddAgent={onAddAgent}
        onInviteUser={onInviteUser}
      />,
    );

    fireEvent.click(screen.getByTestId("member-panel-add-agent"));
    expect(onAddAgent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("member-panel-invite-user"));
    expect(onInviteUser).toHaveBeenCalledTimes(1);

    // 未传回调 → 入口不渲染。
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemberPanel group={makeGroup()} currentUserId="u-me" />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("member-panel-add-agent")).toBeNull();
    expect(screen.queryByTestId("member-panel-invite-user")).toBeNull();
  });
});
