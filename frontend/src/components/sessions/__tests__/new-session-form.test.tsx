/**
 * NewSessionForm 单测（2026-08-14-sessions-portal task-12 / FR-01 / D-005 / D-010 / D-013）。
 *
 * 依据：
 *   - components/sessions/new-session-form.tsx（本 task 实现）
 *   - tasks/task-12.md acceptance：四选择器联动规则逐条生效、请求体含 runtime_id
 *     与所选可选 id、未选项不进请求体
 *
 * 覆盖：
 *   1. 默认机器三级回退（D-005）：localStorage 上次选择 → 最近会话的在线机器
 *      → 最新心跳
 *   2. 切机器重置智能体（回落新机器默认 Claude）
 *   3. engine≠claude 供应商锁定（Select disabled + 不进请求体）
 *   4. Codex 下档案选项标注「人格暂不支持」（仍可选，D-013 不做引擎过滤）
 *   5. 开始会话 createSession 参数（runtime_id/manual_approval/ask_user_only、
 *      可选 id 仅在选中时携带）+ onCreated 回调
 *   6. 必选缺失（无智能体 / 无消息）→ 开始会话按钮禁用
 *
 * mock 策略：直接 mock 组件消费的 hook/函数模块（useDaemonMachines /
 * useMineAgentProfiles / listProviders / createSession），@/lib/api 保留真实
 * （ApiError instanceof 用）。
 *
 * antd Select 触发：jsdom 下需 mouseDown 打开下拉再点选项（选项 portal 到
 * document.body）；Select 用 id 锚定（#nsf-provider / #nsf-profile）。
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
import type * as React from "react";

import {
  NEW_SESSION_MACHINE_LS_KEY,
  NewSessionForm,
} from "@/components/sessions/new-session-form";
import type {
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import { __setBindingMap } from "@/components/sessions/workspace-session-picker";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  machinesHook: vi.fn(),
  profilesHook: vi.fn(),
  listProviders: vi.fn(),
  createSession: vi.fn(),
  machinesRefetch: vi.fn(),
  listWorkspaces: vi.fn(),
  fetchMyBindings: vi.fn(),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/agent-profiles", () => ({
  NO_PROFILE_VALUE: "",
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

// 组件只消费 createSession（类型导入编译期擦除），局部 mock 不加载真实 daemon.ts。
vi.mock("@/lib/daemon", async (importOriginal) => {
  // ql-20260815-001：组件新增消费 PROVIDER_META（引擎显示名），真实常量无副作用，
  // importOriginal 保留真值只 mock createSession 网络函数。
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    createSession: (...args: unknown[]) => mocks.createSession(...args),
  };
});

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/workspace-binding", () => ({
  fetchMyBindings: (...args: unknown[]) => mocks.fetchMyBindings(...args),
}));

vi.mock("@/components/sessions/workspace-session-picker", () => {
  // 模拟绑定映射：workspace-id → daemon-id（测试中可按需调整）
  const bindingMap: Record<string, string | null> = {};
  return {
    __setBindingMap: (m: Record<string, string | null>) => Object.assign(bindingMap, m),
    WorkspaceSessionPicker: ({ value, onChange, disabled }: { value: string | null; onChange: (wsId: string | null, boundMachineId: string | null) => void; disabled?: boolean }) => (
      <select
        data-testid="workspace-picker"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value || null;
          const bound = v ? (bindingMap[v] ?? null) : null;
          onChange(v, bound);
        }}
      >
        <option value="">不使用工作区（默认）</option>
        <option value="mock-ws-1">Mock Workspace</option>
      </select>
    ),
  };
});

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
  };
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
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [makeRuntime({ id: "rt-m1-claude" })],
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<AgentSessionRead> = {},
): AgentSessionRead {
  return {
    id: "s-1",
    runtime_id: "rt-m1-claude",
    lease_id: null,
    provider: "claude",
    status: "ended",
    agent_session_id: null,
    config: null,
    agent_profile_id: null,
    llm_provider_id: null,
    config_snapshot: null,
    turn_count: 1,
    created_at: "2026-08-14T10:00:00Z",
    last_active_at: "2026-08-14T10:05:00Z",
    ended_at: null,
    title: null,
    deleted_at: null,
    current_run_id: null,
    ...overrides,
  } as AgentSessionRead;
}

const RESPONSE = {
  session_id: "sess-new",
  run_id: "run-new",
  lease_id: "lease-new",
  status: "pending",
  stream_url: "/api/daemon/sessions/sess-new/stream",
};

/** 设置 useDaemonMachines 返回（默认成功空集）。 */
function setMachines(
  r: Partial<{
    items: DaemonMachineRead[];
    sessions: AgentSessionRead[];
    isLoading: boolean;
    isError: boolean;
    error: { message: string } | null;
  }> = {},
) {
  mocks.machinesHook.mockReturnValue({
    items: [],
    total: 0,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mocks.machinesRefetch,
    ...r,
  });
}

function setProfiles(profiles: { id: string; name: string }[] = []) {
  mocks.profilesHook.mockReturnValue({
    profiles,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderForm(ui: React.ReactElement) {
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

/**
 * 触发 antd Select（v5/v6 DOM 兼容）选某选项。
 * Select 经 id 锚定（id 可能落在根 div 或内部 input，两者都兜住）。
 */
async function chooseAntdOption(selectId: string, optionText: string) {
  const anchor = document.getElementById(selectId);
  if (!anchor) throw new Error(`element #${selectId} not found`);
  const root = (
    anchor.classList.contains("ant-select")
      ? anchor
      : (anchor.closest(".ant-select") as HTMLElement | null)
  );
  if (!root) throw new Error(`.ant-select for #${selectId} not found`);
  const clickZone =
    (root.querySelector(".ant-select-content") as HTMLElement | null) ??
    (root.querySelector(".ant-select-selector") as HTMLElement | null);
  if (!clickZone)
    throw new Error(`select click zone for #${selectId} not found`);
  fireEvent.mouseDown(clickZone);
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

/** 选工作区：mock 的 workspace-picker 是原生 <select>，直接 change。 */
async function pickWorkspace(optionValue: string) {
  const sel = document.querySelector('[data-testid="workspace-picker"]') as HTMLSelectElement;
  if (!sel) throw new Error("workspace-picker not found");
  fireEvent.change(sel, { target: { value: optionValue } });
  await act(async () => { await Promise.resolve(); });
}

/** 当前选中态智能体（aria-pressed=true 的芯片）。 */
function pressedAgent(): HTMLElement | null {
  return document.querySelector('[aria-label^="选择智能体"][aria-pressed="true"]');
}

/** 当前选中态机器。 */
function pressedMachine(): HTMLElement | null {
  return document.querySelector('[aria-label^="选择机器"][aria-pressed="true"]');
}

function inputPrompt(text: string) {
  const ta = screen.getByLabelText("会话消息输入");
  act(() => {
    fireEvent.change(ta, { target: { value: text } });
  });
}

beforeEach(() => {
  mocks.machinesHook.mockReset();
  mocks.profilesHook
    .mockReset()
    .mockReturnValue({
      profiles: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  mocks.listProviders.mockReset().mockResolvedValue([]);
  mocks.createSession.mockReset().mockResolvedValue(RESPONSE);
  mocks.machinesRefetch.mockReset();
  mocks.listWorkspaces.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.fetchMyBindings.mockReset().mockResolvedValue([]);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ── 1. 默认机器三级回退（D-005） ─────────────────────────────────────────

describe("NewSessionForm 默认机器三级回退（D-005）", () => {
  it("第一级：localStorage 上次选择且在线 → 直接选中", async () => {
    window.localStorage.setItem(NEW_SESSION_MACHINE_LS_KEY, "m-2");
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          last_heartbeat_at: "2026-08-15T09:00:00Z",
        }),
        makeMachine({
          id: "m-2",
          hostname: "machine-2",
          last_heartbeat_at: "2026-08-15T07:00:00Z",
        }),
      ],
      // 最近会话指向 m-1，但 localStorage（m-2）优先级更高
      sessions: [makeSession({ runtime_id: "rt-m1-claude" })],
    });
    renderForm(<NewSessionForm />);
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-2",
      );
    });
  });

  it("第二级：无 localStorage → 最近会话所在的在线机器", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          last_heartbeat_at: "2026-08-15T09:00:00Z", // 心跳更新，但第三级才用
          runtimes: [makeRuntime({ id: "rt-m1-claude" })],
        }),
        makeMachine({
          id: "m-2",
          hostname: "machine-2",
          last_heartbeat_at: "2026-08-15T07:00:00Z",
          runtimes: [makeRuntime({ id: "rt-m2-claude" })],
        }),
      ],
      sessions: [
        makeSession({
          id: "s-old",
          runtime_id: "rt-m1-claude",
          last_active_at: "2026-08-14T10:00:00Z",
        }),
        makeSession({
          id: "s-new",
          runtime_id: "rt-m2-claude",
          last_active_at: "2026-08-15T08:00:00Z", // 最近 → m-2
        }),
      ],
    });
    renderForm(<NewSessionForm />);
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-2",
      );
    });
  });

  it("第三级：无历史会话 → 最新心跳的在线机器；离线机器不参与回退", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-off",
          hostname: "machine-offline",
          status: "offline",
          last_heartbeat_at: "2026-08-15T23:00:00Z", // 心跳最新但离线
          runtimes: [makeRuntime({ id: "rt-off" })],
        }),
        makeMachine({
          id: "m-a",
          hostname: "machine-a",
          last_heartbeat_at: "2026-08-15T08:00:00Z",
        }),
        makeMachine({
          id: "m-b",
          hostname: "machine-b",
          last_heartbeat_at: "2026-08-15T09:30:00Z", // 在线中最新心跳
        }),
      ],
    });
    renderForm(<NewSessionForm />);
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-b",
      );
    });
  });
});

// ── 2. 智能体联动（D-010） ───────────────────────────────────────────────

describe("NewSessionForm 智能体联动（D-010）", () => {
  const machineA = makeMachine({
    id: "m-a",
    hostname: "machine-a",
    runtimes: [
      makeRuntime({ id: "rt-a-claude", provider: "claude", name: "Claude Code" }),
      makeRuntime({ id: "rt-a-codex", provider: "codex", name: "Codex" }),
    ],
    runtime_count: 2,
  });
  const machineB = makeMachine({
    id: "m-b",
    hostname: "machine-b",
    runtimes: [
      makeRuntime({ id: "rt-b-claude", provider: "claude", name: "Claude Code" }),
    ],
  });

  it("默认选 Claude Code；不支持的 provider 置灰标「暂不支持会话」", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-a",
          hostname: "machine-a",
          runtimes: [
            makeRuntime({ id: "rt-gemini", provider: "gemini", name: "Gemini" }),
            makeRuntime({ id: "rt-a-claude", provider: "claude", name: "Claude Code" }),
          ],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      );
    });
    // gemini 在线但不支持会话 → 置灰 + 标注
    const gemini = screen.getByRole("button", { name: /选择智能体 Gemini/ });
    expect(gemini).toBeDisabled();
    expect(screen.getByText("暂不支持会话")).toBeInTheDocument();
  });

  it("智能体标签显示引擎名而非机器名（name=主机名/别名场景，ql-20260815-001）", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-a",
          hostname: "DESKTOP-2BN7FDC",
          runtimes: [
            // name 默认=机器主机名（线上真实形态）——不得显示为主标签
            makeRuntime({
              id: "rt-hostname",
              provider: "claude",
              name: "DESKTOP-2BN7FDC",
            }),
            makeRuntime({
              id: "rt-alias",
              provider: "codex",
              name: "DESKTOP-2BN7FDC",
              display_alias: "工作机",
            }),
          ],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      // 无别名：纯引擎名，不含主机名
      expect(
        screen.getByRole("button", { name: "选择智能体 Claude Code" }),
      ).toBeInTheDocument();
    });
    // 有别名：别名 · 引擎名（保留个性化且引擎可辨）
    expect(
      screen.getByRole("button", { name: "选择智能体 工作机 · Codex" }),
    ).toBeInTheDocument();
    // 智能体列表区域内不出现机器主机名（机器选择区显示主机名属合法）
    const agentList = document.querySelector('[aria-label="智能体列表"]');
    expect(agentList).not.toBeNull();
    expect(agentList?.textContent).not.toContain("DESKTOP-2BN7FDC");
  });

  it("切机器重置智能体：A 机器手选 Codex → 切 B 机器回落默认 Claude", async () => {
    setMachines({ items: [machineA, machineB] });
    renderForm(<NewSessionForm />);

    // 默认机器 = 最新心跳（machineA 08:00 vs machineB 默认 08:00 固件）
    // 固件中 machineA.last_heartbeat_at 为 08:00、machineB 相同 → 排序稳定取其一；
    // 显式点击 machineA 消除歧义。
    fireEvent.click(screen.getByRole("button", { name: "选择机器 machine-a" }));
    await waitFor(() => {
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      );
    });

    // 手选 Codex
    fireEvent.click(screen.getByRole("button", { name: "选择智能体 Codex" }));
    await waitFor(() => {
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Codex",
      );
    });

    // 切机器 B → 智能体重置为 B 的默认 Claude
    fireEvent.click(screen.getByRole("button", { name: "选择机器 machine-b" }));
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-b",
      );
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      );
    });
    // A 机器的 Codex 芯片已不在 DOM（渲染的是 B 的 runtimes）
    expect(
      screen.queryByRole("button", { name: /选择智能体 Codex/ }),
    ).not.toBeInTheDocument();
  });
});

// ── 3. 供应商联动（engine≠claude 锁定，D-010） ───────────────────────────

describe("NewSessionForm 供应商锁定（engine≠claude）", () => {
  const machine = makeMachine({
    id: "m-a",
    hostname: "machine-a",
    runtimes: [
      makeRuntime({ id: "rt-claude", provider: "claude", name: "Claude Code" }),
      makeRuntime({ id: "rt-codex", provider: "codex", name: "Codex" }),
    ],
    runtime_count: 2,
  });

  it("Claude 下可选供应商；切 Codex 后 Select 锁定且提交不带 llm_provider_id", async () => {
    mocks.listProviders.mockResolvedValue([
      { id: "prov-1", name: "智谱 GLM" },
    ]);
    setMachines({ items: [machine] });
    setProfiles([]);
    renderForm(<NewSessionForm />);

    // Claude 默认选中 → 选供应商
    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      ),
    );
    await chooseAntdOption("nsf-provider", "智谱 GLM");

    // 切 Codex → 供应商锁定
    fireEvent.click(screen.getByRole("button", { name: "选择智能体 Codex" }));
    await waitFor(() => {
      const anchor = document.getElementById("nsf-provider");
      const root = anchor?.closest(".ant-select");
      expect(root).toBeTruthy();
      expect(root?.classList.contains("ant-select-disabled")).toBe(true);
    });
    // 锁定提示文案
    expect(
      screen.getByText(/Codex 引擎暂不支持会话级供应商/),
    ).toBeInTheDocument();

    // 提交：请求体不含 llm_provider_id（此前选过也要被锁定压掉）
    inputPrompt("你好");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-codex",
      prompt: "你好",
      manual_approval: true,
      ask_user_only: true,
    });
  });
});

// ── 4. 档案标注（D-013：不做引擎过滤 + Codex 标注） ──────────────────────

describe("NewSessionForm 档案（D-013）", () => {
  const machine = makeMachine({
    id: "m-a",
    hostname: "machine-a",
    runtimes: [
      makeRuntime({ id: "rt-claude", provider: "claude", name: "Claude Code" }),
      makeRuntime({ id: "rt-codex", provider: "codex", name: "Codex" }),
    ],
    runtime_count: 2,
  });

  it("Codex 智能体下档案选项标注「人格暂不支持」，仍可选且提交带 agent_profile_id", async () => {
    setMachines({ items: [machine] });
    setProfiles([{ id: "prof-1", name: "代码审查助手" }]);
    renderForm(<NewSessionForm />);

    fireEvent.click(screen.getByRole("button", { name: "选择智能体 Codex" }));
    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Codex",
      ),
    );

    // 下拉选项带标注（不因引擎过滤掉）
    await chooseAntdOption("nsf-profile", "代码审查助手（人格暂不支持）");

    inputPrompt("开始干活");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-codex",
      prompt: "开始干活",
      manual_approval: true,
      ask_user_only: true,
      agent_profile_id: "prof-1",
    });
  });

  it("Claude 智能体下档案选项无标注，正常可选", async () => {
    setMachines({ items: [machine] });
    setProfiles([{ id: "prof-1", name: "代码审查助手" }]);
    renderForm(<NewSessionForm />);

    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      ),
    );
    await chooseAntdOption("nsf-profile", "代码审查助手");
    expect(screen.queryByText(/人格暂不支持/)).not.toBeInTheDocument();
  });
});

// ── 5. 提交参数与回调 ───────────────────────────────────────────────────

describe("NewSessionForm 开始会话提交", () => {
  it("全部选中：runtime_id/可选 id/manual_approval/ask_user_only 正确 + onCreated 回调 + 记住机器", async () => {
    mocks.listProviders.mockResolvedValue([{ id: "prov-1", name: "智谱 GLM" }]);
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    setProfiles([{ id: "prof-1", name: "审查员" }]);
    const onCreated = vi.fn();
    renderForm(<NewSessionForm onCreated={onCreated} />);

    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      ),
    );
    await chooseAntdOption("nsf-provider", "智谱 GLM");
    await chooseAntdOption("nsf-profile", "审查员");
    inputPrompt("  帮我审查这段代码  ");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // prompt 去首尾空白
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-claude",
      prompt: "帮我审查这段代码",
      manual_approval: true,
      ask_user_only: true,
      llm_provider_id: "prov-1",
      agent_profile_id: "prof-1",
    });
    expect(onCreated).toHaveBeenCalledWith(RESPONSE, {
      machineId: "m-1",
      agentId: "rt-claude",
      providerId: "prov-1",
      profileId: "prof-1",
      prompt: "帮我审查这段代码",
      workspaceId: null,
    });
    // D-005：成功后记住机器选择
    expect(window.localStorage.getItem(NEW_SESSION_MACHINE_LS_KEY)).toBe("m-1");
  });

  it("未选项不进请求体（不选供应商/档案）", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      ),
    );
    inputPrompt("你好");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-claude",
      prompt: "你好",
      manual_approval: true,
      ask_user_only: true,
    });
  });

  it("创建失败 → 内联错误提示，不回调 onCreated", async () => {
    mocks.createSession.mockRejectedValue(new Error("boom"));
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    const onCreated = vi.fn();
    renderForm(<NewSessionForm onCreated={onCreated} />);

    await waitFor(() =>
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      ),
    );
    inputPrompt("你好");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("创建会话错误")).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
    // 失败不记住机器
    expect(window.localStorage.getItem(NEW_SESSION_MACHINE_LS_KEY)).toBeNull();
  });
});

// ── 6. 必选缺失 → 按钮禁用 ─────────────────────────────────────────────

describe("NewSessionForm 必选缺失禁用按钮", () => {
  it("无消息 → 按钮禁用；无可用智能体（全部离线）→ 按钮禁用", async () => {
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-off-claude", status: "offline" })],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-1",
      );
    });

    const startBtn = screen.getByRole("button", { name: /开始会话/ });
    // 智能体全离线 → 无默认智能体 → 禁用
    expect(startBtn).toBeDisabled();

    // 换可用智能体但无消息 → 仍禁用（重渲染数据）
    mocks.machinesHook.mockReturnValue({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
      total: 1,
      sessions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: mocks.machinesRefetch,
    });
    renderForm(<NewSessionForm />);
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /开始会话/ })[1],
      ).toBeDisabled(),
    );
  });
});

// ── 7. 工作区选择器联动 ─────────────────────────────────────────────────

describe("NewSessionForm 工作区选择器联动", () => {
  it("⓪ 工作区标签存在（不与 ①②③④ 冲突）", async () => {
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    mocks.fetchMyBindings.mockResolvedValue([]);
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(screen.getByText(/⓪ 工作区/)).toBeInTheDocument();
      expect(screen.getByText(/① 守护进程/)).toBeInTheDocument();
    });
  });

  it("选工作区且绑定机器在线 → 机器自动切换到绑定机器", async () => {
    const machineA = makeMachine({
      id: "m-a",
      hostname: "machine-a",
      runtimes: [makeRuntime({ id: "rt-a-claude", provider: "claude", name: "Claude Code" })],
    });
    const machineB = makeMachine({
      id: "m-b",
      hostname: "machine-b",
      runtimes: [makeRuntime({ id: "rt-b-claude", provider: "claude", name: "Claude Code" })],
    });
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    // ws-1 绑定到 m-b
    mocks.fetchMyBindings.mockResolvedValue([
      { workspace_id: "ws-1", daemon_id: "m-b" },
    ]);
    __setBindingMap({ "mock-ws-1": "m-b" });
    setMachines({ items: [machineA, machineB] });

    renderForm(<NewSessionForm />);

    // 初始默认选 m-a（心跳较新或首项）
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-a",
      );
    });

    // 选工作区 ws-1 → 机器自动切到 m-b
    await pickWorkspace("mock-ws-1");
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-b",
      );
    });
  });

  it("选工作区无绑定 → 机器不动", async () => {
    const machineA = makeMachine({
      id: "m-a",
      hostname: "machine-a",
      runtimes: [makeRuntime({ id: "rt-a-claude", provider: "claude", name: "Claude Code" })],
    });
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    mocks.fetchMyBindings.mockResolvedValue([]);
    setMachines({ items: [machineA] });

    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-a",
      );
    });

    // 选工作区 ws-1 但无绑定 → 机器不变
    await pickWorkspace("mock-ws-1");
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-a",
      );
    });
  });

  it("改回「不使用工作区」→ 仅清 workspaceId 不动机器", async () => {
    const machineA = makeMachine({
      id: "m-a",
      hostname: "machine-a",
      runtimes: [makeRuntime({ id: "rt-a-claude", provider: "claude", name: "Claude Code" })],
    });
    const machineB = makeMachine({
      id: "m-b",
      hostname: "machine-b",
      runtimes: [makeRuntime({ id: "rt-b-claude", provider: "claude", name: "Claude Code" })],
    });
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    mocks.fetchMyBindings.mockResolvedValue([
      { workspace_id: "ws-1", daemon_id: "m-b" },
    ]);
    __setBindingMap({ "mock-ws-1": "m-b" });
    setMachines({ items: [machineA, machineB] });

    renderForm(<NewSessionForm />);

    // 选工作区 → 机器切到 m-b
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-a",
      );
    });
    await pickWorkspace("mock-ws-1");
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-b",
      );
    });

    // 改回「不使用工作区」→ 机器仍在 m-b（仅清 workspaceId）
    await pickWorkspace("");
    await waitFor(() => {
      expect(pressedMachine()?.getAttribute("aria-label")).toBe(
        "选择机器 machine-b",
      );
    });
  });

  it("提交含 workspace_id：选中工作区后 createSession 请求体含 workspace_id", async () => {
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    mocks.fetchMyBindings.mockResolvedValue([]);
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      );
    });

    // 选工作区
    await pickWorkspace("mock-ws-1");
    await waitFor(() => {
      expect(screen.getByText(/会话将在该项目目录中运行/)).toBeInTheDocument();
    });

    // 输入消息并提交
    inputPrompt("测试工作区");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));

    const callArgs = mocks.createSession.mock.calls[0]![0]!;
    expect(callArgs.workspace_id).toBe("mock-ws-1");
    expect(callArgs.runtime_id).toBe("rt-claude");
    expect(callArgs.prompt).toBe("测试工作区");
  });

  it("不选工作区零回归：不选时请求体不含 workspace_id 字段", async () => {
    mocks.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "前端项目", slug: "fe", status: "active", type: "backend" }],
      total: 1,
    });
    mocks.fetchMyBindings.mockResolvedValue([]);
    setMachines({
      items: [
        makeMachine({
          id: "m-1",
          hostname: "machine-1",
          runtimes: [makeRuntime({ id: "rt-claude", name: "Claude Code" })],
        }),
      ],
    });
    renderForm(<NewSessionForm />);

    await waitFor(() => {
      expect(pressedAgent()?.getAttribute("aria-label")).toBe(
        "选择智能体 Claude Code",
      );
    });

    // 不选工作区，直接提交
    inputPrompt("普通会话");
    fireEvent.click(screen.getByRole("button", { name: /开始会话/ }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));

    const callArgs = mocks.createSession.mock.calls[0]![0]!;
    expect(callArgs).not.toHaveProperty("workspace_id");
    expect(callArgs.runtime_id).toBe("rt-claude");
  });
});
