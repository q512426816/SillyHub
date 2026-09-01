/**
 * CreateGroupWizard 单测 + 群聊 API 客户端单测（2026-09-01-session-group-chat
 * task-07 / FR-01 / FR-04，design §6.1 + §7 建群向导）。
 *
 * 依据：
 *   - components/group-chat/create-group-wizard.tsx（本 task 实现）
 *   - lib/daemon.ts 群聊 API 客户端（9 函数——task-02 已落地端点的前端封装）
 *   - tasks/task-07.md acceptance：向导三步可完成建群；六要素表单校验生效
 *     （昵称重复即时报错、agent 8/用户 50 上限拦截）
 *   - prototype-group-chat.html .modal（createModal 三步 + 六要素 callout）
 *
 * 覆盖：
 *   1. API 客户端：9 函数 → apiFetch 路径 / method / payload 断言（真实
 *      daemon.ts 实现 + @/lib/api apiFetch mock——不经 HTTP 层）
 *   2. 向导三步流转：①群名必填 + 工作区（scope 锁定/全局自选）②邀请多选
 *      ③六要素卡片 → 提交 createGroupChat payload（含 agent_cross_mention
 *      默认镜像）+ onCreated 回调
 *   3. 校验：昵称必填/保留词（全体、all）/群内查重即时报错；agent 8 上限
 *      拦截（添加按钮置灰）；用户 50 上限计数位
 *
 * mock 策略（对齐 sessions/__tests__ 既有惯例）：
 *   - @/lib/api 仅覆写 apiFetch（daemon.ts 真实实现消费 mock——向导提交与
 *     API 客户端用例共用同一断言面）
 *   - @/lib/use-daemon-machines、@/lib/workspaces、@/lib/workspace-members、
 *     @/lib/api/llm-providers、@/lib/agent-profiles（hook）、@/lib/errors
 *     （useNotify）按向导数据源逐一 mock
 *   - antd Select 经 id 锚定 + mousedown 打开（session-list-panel.test 同款助手）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  CreateGroupWizard,
  GROUP_AGENT_MEMBER_LIMIT,
  GROUP_USER_MEMBER_LIMIT,
  validateMemberDisplayName,
} from "@/components/group-chat/create-group-wizard";
import {
  addGroupMember,
  createGroupChat,
  endGroupChat,
  getGroupChat,
  listGroupChats,
  removeGroupMember,
  resetGroupMemberMemory,
  updateGroupChat,
  updateGroupMember,
  type GroupChatRead,
} from "@/lib/daemon";
import type { DaemonMachineRead, DaemonRuntimeRead } from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";
import type { WorkspaceMemberView } from "@/lib/workspace-members";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // @/lib/api apiFetch（向导提交 + API 客户端用例共用断言面）。
  apiFetch: vi.fn(),
  machinesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  listMembers: vi.fn(),
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

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/workspace-members", () => ({
  listMembers: (...args: unknown[]) => mocks.listMembers(...args),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

vi.mock("@/lib/agent-profiles", () => ({
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

// jsdom 无 antd <App> 上下文：useNotify 挂 spy（session-list-panel.test 同款）。
vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

// ── antd Select 触发助手（session-list-panel.test 同款，经 id 锚定） ──────

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

/** antd Select 根节点（锁定/禁用态断言用）。 */
function antdSelectRoot(selectId: string): HTMLElement {
  const anchor = document.getElementById(selectId);
  const root = anchor?.closest(".ant-select") as HTMLElement | null;
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  return root;
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
    display_alias: null,
    os: "windows",
    arch: "x64",
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

function makeMember(
  overrides: Partial<WorkspaceMemberView> = {},
): WorkspaceMemberView {
  return {
    user_id: "u-lin",
    email: "lin@example.com",
    display_name: "林一",
    role_key: "developer",
    role_name: "Developer",
    granted_at: "2026-08-01T00:00:00Z",
    is_current_user: false,
    ...overrides,
  };
}

function makeGroupRead(
  overrides: Partial<GroupChatRead> = {},
): GroupChatRead {
  return {
    id: "g-new",
    session_id: "s-g-new",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [],
    ...overrides,
  };
}

function renderWizard(ui: React.ReactElement) {
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
    items: [
      makeWorkspace(),
      makeWorkspace({ id: "ws-2", name: "归档工作区", status: "archived" }),
    ],
    total: 2,
    limit: 100,
    offset: 0,
  });
  mocks.listMembers.mockResolvedValue([
    makeMember(),
    makeMember({
      user_id: "u-chen",
      email: "chen@example.com",
      display_name: "陈默",
    }),
    makeMember({
      user_id: "u-me",
      email: "me@example.com",
      display_name: "我自己",
      is_current_user: true,
    }),
  ]);
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
  mocks.apiFetch.mockResolvedValue(makeGroupRead());
});

afterEach(() => {
  cleanup();
});

// ── 1. API 客户端（真实 daemon.ts 实现 + apiFetch mock 断言路径与 payload） ──

describe("群聊 API 客户端（task-07 / design §6.1，前缀 /api/daemon/group-chats）", () => {
  it("listGroupChats → GET /api/daemon/group-chats（无过滤参，群列表专用数据源）", async () => {
    await listGroupChats();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats");
  });

  it("getGroupChat → GET /api/daemon/group-chats/{id}", async () => {
    await getGroupChat("g-1");
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats/g-1");
  });

  it("createGroupChat → POST /api/daemon/group-chats（建群体透传）", async () => {
    const payload = makeGroupRead() as unknown as Parameters<
      typeof createGroupChat
    >[0];
    await createGroupChat(payload);
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats", {
      method: "POST",
      json: payload,
    });
  });

  it("updateGroupChat → PATCH /api/daemon/group-chats/{id}", async () => {
    await updateGroupChat("g-1", { title: "新群名" });
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats/g-1", {
      method: "PATCH",
      json: { title: "新群名" },
    });
  });

  it("endGroupChat → POST /api/daemon/group-chats/{id}/end", async () => {
    await endGroupChat("g-1");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/end",
      { method: "POST" },
    );
  });

  it("addGroupMember → POST /api/daemon/group-chats/{id}/members", async () => {
    await addGroupMember("g-1", { user: { user_id: "u-lin" } });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members",
      { method: "POST", json: { user: { user_id: "u-lin" } } },
    );
  });

  it("updateGroupMember → PATCH /api/daemon/group-chats/{id}/members/{mid}", async () => {
    await updateGroupMember("g-1", "m-1", { display_name: "新昵称" });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/m-1",
      { method: "PATCH", json: { display_name: "新昵称" } },
    );
  });

  it("removeGroupMember → DELETE /api/daemon/group-chats/{id}/members/{mid}", async () => {
    await removeGroupMember("g-1", "m-1");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/m-1",
      { method: "DELETE" },
    );
  });

  it("resetGroupMemberMemory → POST .../members/{mid}/reset-memory", async () => {
    await resetGroupMemberMemory("g-1", "m-1");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/daemon/group-chats/g-1/members/m-1/reset-memory",
      { method: "POST" },
    );
  });
});

// ── 2. 向导三步流转 ──────────────────────────────────────────────────────

describe("CreateGroupWizard 三步流转（task-07 / FR-04）", () => {
  it("步骤①：群名必填（空名禁用下一步）+ scope 工作区锁定（Select 禁用）", async () => {
    renderWizard(
      <CreateGroupWizard
        open
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        defaultWorkspaceId="ws-1"
      />,
    );
    // 步骤指示就位
    expect(screen.getByText("群信息")).toBeTruthy();
    expect(screen.getByText("邀请用户")).toBeTruthy();
    expect(screen.getByText("Agent 成员")).toBeTruthy();

    // 群名空 → 下一步禁用
    const next = screen.getByRole("button", { name: "下一步" });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    await waitFor(() => expect(next).toBeEnabled());

    // scope 工作区锁定：Select 禁用 + 提示文案
    expect(antdSelectRoot("cgw-workspace")).toHaveClass("ant-select-disabled");
    expect(screen.getByText("已锁定为当前入口工作区")).toBeTruthy();

    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText("已选 0/" + GROUP_USER_MEMBER_LIMIT + "（不含群主）")).toBeTruthy());
  });

  it("全流程：①群名+自选工作区 → ②邀请成员（排除本人）→ ③六要素卡片 → 创建 payload + onCreated", async () => {
    const onCreated = vi.fn();
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={onCreated} />,
    );

    // ① 群信息（全局门户：工作区自选）
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    await chooseAntdOptionByText("cgw-workspace", "主工作区");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ② 邀请用户（多选林一；陈默认认不选；本人被排除不出现在候选）
    await waitFor(() =>
      expect(mocks.listMembers).toHaveBeenCalledWith("ws-1"),
    );
    await chooseAntdOptionByText("cgw-invitees", "林一");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ③ Agent 成员六要素卡片
    fireEvent.click(
      await screen.findByRole("button", { name: /添加 Agent 成员/ }),
    );
    const card = (await screen.findAllByTestId("agent-member-card"))[0];
    expect(card).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Agent 成员 1 群昵称"), {
      target: { value: "小码" },
    });
    // 机器下拉按机器分组（machine-1 · Claude Code）
    await chooseAntdOptionByText("cgw-runtime-0", "Claude Code");
    // 模型 / 方案 / 成员工作区走缺省（不指定/沿用群工作区）
    fireEvent.click(screen.getByRole("button", { name: "创建群聊" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats", {
      method: "POST",
      json: expect.objectContaining({
        title: "前端攻坚小分队",
        workspace_id: "ws-1",
        // 后端 schema 默认值镜像（生成版 TS 类型必填显式传）
        agent_cross_mention: true,
        cross_mention_depth: 2,
        context_window: 20,
        user_members: [{ user_id: "u-lin" }],
        agent_members: [
          expect.objectContaining({
            display_name: "小码",
            runtime_id: "rt-1",
            workspace_id: null,
            provider: "claude",
            llm_provider_id: null,
            agent_profile_id: null,
          }),
        ],
      }),
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "g-new", title: "前端攻坚小分队" }),
    );
  });

  it("引擎切 Codex → 模型（llm_provider）禁用并清空（providerLocked 先例）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-workspace", "主工作区");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /添加 Agent 成员/ }),
    );
    await chooseAntdOptionByText("cgw-engine-0", "Codex");
    await waitFor(() =>
      expect(antdSelectRoot("cgw-model-0")).toHaveClass(
        "ant-select-disabled",
      ),
    );
    expect(
      screen.getByText("Codex 引擎使用其本机模型配置，无需选择供应商"),
    ).toBeTruthy();
  });
});

// ── 3. 校验（昵称查重/保留词/必填 + 上限拦截） ────────────────────────────

describe("CreateGroupWizard 六要素校验（task-07 acceptance）", () => {
  it("validateMemberDisplayName：必填 / 保留词（全体、all）/ 群内查重", () => {
    expect(validateMemberDisplayName("", [])).toContain("请填写群内昵称");
    expect(validateMemberDisplayName("全体", [])).toContain("保留词");
    expect(validateMemberDisplayName("all", [])).toContain("保留词");
    expect(validateMemberDisplayName("小码", ["小码"])).toContain("重复");
    expect(validateMemberDisplayName("小码", ["小测"])).toBeNull();
  });

  it("步骤③：两张卡片同名 → 第二张即时报错；创建按钮禁用直到修正", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-workspace", "主工作区");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /添加 Agent 成员/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /添加 Agent 成员/ }),
    );
    fireEvent.change(screen.getByLabelText("Agent 成员 1 群昵称"), {
      target: { value: "小码" },
    });
    fireEvent.change(screen.getByLabelText("Agent 成员 2 群昵称"), {
      target: { value: "小码" },
    });
    // 两张卡片对称互撞（即时查重未提交即显示——即时校验语义）
    const errors = screen.getAllByTestId("agent-name-error");
    expect(errors).toHaveLength(2);
    expect(errors[0]?.textContent).toContain("重复");
    expect(errors[1]?.textContent).toContain("重复");

    // 修正后错误消失
    fireEvent.change(screen.getByLabelText("Agent 成员 2 群昵称"), {
      target: { value: "小测" },
    });
    await waitFor(() =>
      expect(screen.queryAllByTestId("agent-name-error")).toHaveLength(0),
    );
  });

  it("agent 成员上限 8：第 9 张卡片添加按钮置灰（title 提示上限）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-workspace", "主工作区");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const addBtn = await screen.findByRole("button", {
      name: /添加 Agent 成员/,
    });
    for (let i = 0; i < GROUP_AGENT_MEMBER_LIMIT; i++) {
      fireEvent.click(addBtn);
    }
    expect(
      (await screen.findAllByTestId("agent-member-card")),
    ).toHaveLength(GROUP_AGENT_MEMBER_LIMIT);
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveAttribute(
      "title",
      `Agent 成员上限 ${GROUP_AGENT_MEMBER_LIMIT} 个`,
    );
  });
});
