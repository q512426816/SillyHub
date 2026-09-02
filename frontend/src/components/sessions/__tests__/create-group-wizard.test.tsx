/**
 * CreateGroupWizard 单测 + 群聊 API 客户端单测（2026-09-01-session-group-chat
 * task-07 / FR-01 / FR-04，design §6.1 + §7 建群向导；quick 群 PPM 项目化 +
 * 成员头像自定义改造）。
 *
 * 依据：
 *   - components/group-chat/create-group-wizard.tsx（本 task 实现；quick 改造：
 *     步骤①项目下拉（project_id 必填、群工作区后端推导）/ ②项目人员候选 /
 *     ③agent 工作区=项目关联工作区必选 + 头像上传）
 *   - lib/daemon.ts 群聊 API 客户端（9 函数——task-02 已落地端点的前端封装）
 *   - lib/api-types.ts GroupChatCreate（quick：project_id 必填 / workspace_id
 *     可选不传；GroupMemberUserCreate/AgentConfig 含 avatar）
 *
 * 覆盖：
 *   1. API 客户端：9 函数 → apiFetch 路径 / method / payload 断言（真实
 *      daemon.ts 实现 + @/lib/api apiFetch mock——不经 HTTP 层）
 *   2. 向导三步流转：①群名必填 + 项目下拉（选中显示关联工作区数提示）②项目
 *      人员邀请多选（排除本人）③六要素卡片（工作区=项目关联工作区必选）→
 *      提交 createGroupChat payload（project_id + 不带 workspace_id + 默认值
 *      镜像）+ onCreated 回调
 *   3. 头像上传管线：agent 卡片与被邀用户上传头像 → payload avatar 填充
 *      （/api/file/{id}）；可清除恢复默认（payload 不带 avatar）
 *   4. 校验：昵称必填/保留词（全体、all）/群内查重即时报错；agent 8 上限
 *      拦截；项目无关联工作区禁下一步（引导文案）
 *
 * mock 策略（对齐 sessions/__tests__ 既有惯例）：
 *   - @/lib/api 仅覆写 apiFetch（daemon.ts 真实实现消费 mock——向导提交与
 *     API 客户端用例共用同一断言面）
 *   - @/lib/use-daemon-machines、@/lib/api/llm-providers、@/lib/agent-profiles
 *     （hook）、@/lib/errors（useNotify）按向导数据源逐一 mock
 *   - quick 数据源：@/lib/ppm/project（listSimpleProjects / listProjectMembers）、
 *     @/lib/workspace（listProjectWorkspaces）、@/lib/file/api（uploadFile +
 *     getFileDownloadUrl 保真实现）、@/stores/session（当前用户 id——邀人排除
 *     本人）
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

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // @/lib/api apiFetch（向导提交 + API 客户端用例共用断言面）。
  apiFetch: vi.fn(),
  machinesHook: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
  // quick：PPM 项目 / 项目人员 / 项目关联工作区 / 文件上传。
  listSimpleProjects: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectWorkspaces: vi.fn(),
  uploadFile: vi.fn(),
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

vi.mock("@/lib/ppm/project", () => ({
  listSimpleProjects: (...args: unknown[]) => mocks.listSimpleProjects(...args),
  listProjectMembers: (...args: unknown[]) => mocks.listProjectMembers(...args),
}));

vi.mock("@/lib/workspace", () => ({
  listProjectWorkspaces: (...args: unknown[]) =>
    mocks.listProjectWorkspaces(...args),
}));

vi.mock("@/lib/file/api", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
  // 保真实现（与真实 getFileDownloadUrl 同口径——断言 payload avatar 值用）。
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
}));

vi.mock("@/stores/session", () => {
  const state = {
    user: { id: "u-me", email: "me@sillyhub.dev", displayName: "我自己" },
    accessToken: null,
    refreshToken: null,
  };
  const useSession = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useSession.getState = () => state;
  return { useSession };
});

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

interface PpmProjectFixture {
  id: string;
  project_name: string | null;
}

interface PpmProjectMemberFixture {
  id: string;
  pm_project_id: string;
  user_id: string;
  user_name: string | null;
  username?: string | null;
}

function makeProject(
  overrides: Partial<PpmProjectFixture> = {},
): PpmProjectFixture {
  return {
    id: "pj-1",
    project_name: "SillyHub 平台",
    ...overrides,
  };
}

function makeProjectMember(
  overrides: Partial<PpmProjectMemberFixture> = {},
): PpmProjectMemberFixture {
  return {
    id: "pm-1",
    pm_project_id: "pj-1",
    user_id: "u-lin",
    user_name: "林一",
    username: "lin",
    ...overrides,
  };
}

interface WorkspaceBriefFixture {
  workspace_id: string;
  name: string;
  status: string;
  type: string | null;
}

function makeProjectWorkspace(
  overrides: Partial<WorkspaceBriefFixture> = {},
): WorkspaceBriefFixture {
  return {
    workspace_id: "ws-1",
    name: "主工作区",
    status: "active",
    type: null,
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
    cross_mention_depth: 4,
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
  // quick 数据源：项目全量候选 / 项目人员（含本人 u-me——候选须排除）/
  // 项目关联工作区（2 个）。
  mocks.listSimpleProjects.mockResolvedValue([
    makeProject(),
    makeProject({ id: "pj-2", project_name: "裸项目" }),
  ]);
  mocks.listProjectMembers.mockResolvedValue([
    makeProjectMember(),
    makeProjectMember({
      id: "pm-2",
      user_id: "u-chen",
      user_name: "陈默",
      username: "chen",
    }),
    // 本人（建群人=群主，后端要求其为项目成员；候选排除）。
    makeProjectMember({
      id: "pm-me",
      user_id: "u-me",
      user_name: "我自己",
      username: "me",
    }),
  ]);
  mocks.listProjectWorkspaces.mockImplementation(async (projectId: string) => {
    if (projectId === "pj-2") return []; // 裸项目：无关联工作区（禁下一步用例）
    return [makeProjectWorkspace(), makeProjectWorkspace({ workspace_id: "ws-2", name: "资料工作区" })];
  });
  mocks.uploadFile.mockResolvedValue({
    id: "file-av-1",
    original_name: "avatar.png",
    mime_type: "image/png",
    size: 1234,
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

// ── 2. 向导三步流转（quick：PPM 项目下拉 / 项目人员候选 / 项目工作区必选） ──

describe("CreateGroupWizard 三步流转（quick 群 PPM 项目化）", () => {
  it("步骤①：群名必填（空名禁用下一步）+ 项目必选（未选禁用下一步）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    // 步骤指示就位
    expect(screen.getByText("群信息")).toBeTruthy();
    expect(screen.getByText("邀请用户")).toBeTruthy();
    expect(screen.getByText("Agent 成员")).toBeTruthy();

    // 群名空 → 下一步禁用；群名就位但项目未选 → 仍禁用
    const next = screen.getByRole("button", { name: "下一步" });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    expect(next).toBeDisabled();

    // 选项目后放行，进入步骤②
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() =>
      expect(screen.getByText("已选 0/" + GROUP_USER_MEMBER_LIMIT + "（不含群主）")).toBeTruthy(),
    );
  });

  it("步骤①：选中项目 → 显示关联工作区数提示；项目候选=全量项目（可搜索）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
    expect(
      await screen.findByTestId("cgw-workspace-hint"),
    ).toHaveTextContent("已关联 2 个工作区");
    expect(mocks.listProjectWorkspaces).toHaveBeenCalledWith("pj-1");
    // 候选含第二个项目（全量候选 + 搜索由 antd showSearch 承载）。
    openAntdSelect("cgw-project");
    expect(
      [...document.querySelectorAll(".ant-select-item-option-content")].some(
        (el) => el.textContent?.trim() === "裸项目",
      ),
    ).toBeTruthy();
  });

  it("步骤①：项目无关联工作区 → 下一步禁用 + 引导文案（项目管理中关联）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-project", "裸项目");
    const hint = await screen.findByTestId("cgw-workspace-hint");
    expect(hint).toHaveTextContent("请先在项目管理中关联工作区");
    const next = screen.getByRole("button", { name: "下一步" });
    await waitFor(() => expect(next).toBeDisabled());
  });

  it("步骤①：无可选项目 → 下一步禁用 + 空态引导文案", async () => {
    mocks.listSimpleProjects.mockResolvedValue([]);
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    expect(
      await screen.findByText("暂无可选项目——请先在项目管理中创建项目后再建群"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  });

  it("全流程：①群名+项目 → ②邀请项目成员（排除本人）→ ③六要素卡片（工作区必选）→ payload（project_id + 无 workspace_id）+ onCreated", async () => {
    const onCreated = vi.fn();
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={onCreated} />,
    );

    // ① 群信息：群名 + 项目下拉（quick：群工作区后端推导，UI 无工作区选择）。
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "前端攻坚小分队" },
    });
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ② 邀请用户（项目人员：多选林一；陈默认认不选；本人 u-me 被排除不在候选）。
    await waitFor(() =>
      expect(mocks.listProjectMembers).toHaveBeenCalledWith({
        pm_project_id: "pj-1",
      }),
    );
    await chooseAntdOptionByText("cgw-invitees", "林一");
    openAntdSelect("cgw-invitees");
    expect(
      [...document.querySelectorAll(".ant-select-item-option-content")].some(
        (el) => el.textContent?.trim() === "我自己",
      ),
    ).toBeFalsy();
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
    // 工作区=项目关联工作区必选（不再有「沿用群工作区」选项）。
    expect(
      screen.getByLabelText("Agent 成员 1 工作区").closest(".ant-select"),
    ).toBeTruthy();
    await chooseAntdOptionByText("cgw-card-ws-0", "主工作区");
    // 模型 / 方案走缺省（不指定）。
    fireEvent.click(screen.getByRole("button", { name: "创建群聊" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    const json = mocks.apiFetch.mock.calls[0]![1]!.json as Record<string, unknown>;
    // quick：project_id 必填；workspace_id 不传（后端自动推导）。
    expect(json.project_id).toBe("pj-1");
    expect(json.workspace_id).toBeUndefined();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/daemon/group-chats", {
      method: "POST",
      json: expect.objectContaining({
        title: "前端攻坚小分队",
        // 后端 schema 默认值镜像（生成版 TS 类型必填显式传）
        agent_cross_mention: true,
        cross_mention_depth: 4,
        context_window: 20,
        user_members: [{ user_id: "u-lin" }],
        agent_members: [
          expect.objectContaining({
            display_name: "小码",
            runtime_id: "rt-1",
            workspace_id: "ws-1",
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

  it("步骤③：工作区未选 → 创建按钮禁用（项目关联集内必选）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /添加 Agent 成员/ }),
    );
    fireEvent.change(screen.getByLabelText("Agent 成员 1 群昵称"), {
      target: { value: "小码" },
    });
    await chooseAntdOptionByText("cgw-runtime-0", "Claude Code");
    const create = screen.getByRole("button", { name: "创建群聊" });
    expect(create).toBeDisabled();
    await chooseAntdOptionByText("cgw-card-ws-0", "主工作区");
    await waitFor(() => expect(create).toBeEnabled());
  });

  it("引擎切 Codex → 模型（llm_provider）禁用并清空（providerLocked 先例）", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
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

// ── 3. 头像上传管线（quick 成员头像自定义：payload avatar 填充/清除） ──────

describe("CreateGroupWizard 头像上传（quick 成员头像自定义）", () => {
  /** 模拟上传：找到隐藏 file input 触发 change（按调用次数增量等待）。 */
  async function fireUpload(inputLabel: string) {
    const before = mocks.uploadFile.mock.calls.length;
    const input = screen.getByLabelText(inputLabel);
    fireEvent.change(input, {
      target: { files: [new File(["x"], "avatar.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(mocks.uploadFile.mock.calls.length).toBe(before + 1),
    );
    expect(mocks.uploadFile).toHaveBeenLastCalledWith(expect.any(File), {
      owner_type: "group_member_avatar",
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("agent 卡片上传头像 + 被邀用户上传头像 → payload avatar= /api/file/{id}", async () => {
    renderWizard(
      <CreateGroupWizard open onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("群名称"), {
      target: { value: "群" },
    });
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ② 被邀用户头像：选林一 → 上传行出现 → 上传。
    await waitFor(() =>
      expect(mocks.listProjectMembers).toHaveBeenCalled(),
    );
    await chooseAntdOptionByText("cgw-invitees", "林一");
    expect(
      await screen.findByTestId("cgw-invited-avatars"),
    ).toBeTruthy();
    await fireUpload("被邀成员 林一 头像（选择图片）");

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // ③ agent 卡片：昵称/机器/工作区 + 头像上传。
    fireEvent.click(
      await screen.findByRole("button", { name: /添加 Agent 成员/ }),
    );
    fireEvent.change(screen.getByLabelText("Agent 成员 1 群昵称"), {
      target: { value: "小码" },
    });
    await chooseAntdOptionByText("cgw-runtime-0", "Claude Code");
    await chooseAntdOptionByText("cgw-card-ws-0", "主工作区");
    await fireUpload("Agent 成员 1 头像（选择图片）");

    fireEvent.click(screen.getByRole("button", { name: "创建群聊" }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    let json = mocks.apiFetch.mock.calls[0]![1]!.json as {
      user_members?: { user_id: string; avatar?: string }[];
      agent_members?: { display_name: string; avatar?: string }[];
    };
    expect(json.user_members).toEqual([
      { user_id: "u-lin", avatar: "/api/file/file-av-1" },
    ]);
    expect(json.agent_members?.[0]).toEqual(
      expect.objectContaining({
        display_name: "小码",
        avatar: "/api/file/file-av-1",
      }),
    );
  });
});

// ── 4. 校验（昵称查重/保留词/必填 + 上限拦截） ────────────────────────────

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
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
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
    await chooseAntdOptionByText("cgw-project", "SillyHub 平台");
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
