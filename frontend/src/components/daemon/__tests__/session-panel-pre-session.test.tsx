// task-03（2026-08-23-sessions-workspace-hub / FR-03）：SessionPanel（page 模式）
// 预会话态单测——sessionId=null 渲染与真会话同构的空态（D-101，用户硬约束
// "不要独立页面"），会话作用域副作用 effect 全部 null 守卫（R-01），首句发送才
// createSession 原地接管（D-102），失败保留输入可重试（R-02），上下文行完全
// 只读（D-104）。
//
// 覆盖（TaskCard acceptance）：
//   1. D-101 同构渲染：面板头 / 时间线容器 / 输入区均在，仅内容空 + 多上下文行；
//   2. R-01 专项：sessionId=null 时 detailQuery（getAgentSession）/ SSE 建流 /
//      历史预取 / dialogs 恢复 / 队列投递 / team missions 逐项零调用；
//   3. D-102 首句创建：createSession 参数含 runtime_id + prompt（+可选
//      workspace_id / change_id 条件展开，不带 provider）；成功清空输入 +
//      onPreSessionCreated 上报 + 父层切 sessionId 后状态机自然接管；
//   4. R-02 失败保留输入 + 内联错误 + 原地重试成功；
//   5. 门控派生：无 preContext / 机器离线 → 输入禁用。
//
// task-13（2026-08-24-session-team-mission-context / FR-05 / FR-06 / D-009@v2 /
// D-010@v1）追加：
//   6. 预会话团队触发行解禁——门控三态（claude+在线可点开弹层 / 非 claude 禁 /
//      离线禁），tooltip 按未满足原因更新；
//   7. 弹层确认（preSession 实例）→ payload 暂存 state + 关弹层 + objective
//      回填输入框；首句 createSession 请求体携带 team_mission 块（含主 agent
//      选择器落定的 orchestrator_workspace_id）且绝不调 triggerSessionTeamMission；
//   8. 创建失败保留输入与暂存可重试（R-02 延伸）；成功后暂存清空（再发不带）。
//
// task-11（2026-08-25-session-spec-binding / FR-06）追加：
//   9. quickId 预会话——首句 createSession 请求体双向断言（带 quickId 含
//      quicklog_id、缺省不含，零回归）+ 锁定行快速修复标题渲染（mock
//      getQuicklogDetail）与解析失败回退 ql_id 短码（D-001 不校验存在性）。
//
// mock 风格照抄 session-panel-team.test.tsx（page 模式 QueryClientProvider +
// 仅 mock 网络层；断言用 aria-label / 正则避开 antd 中文按钮拆分坑）。task-13
// 追加 mock @/lib/api apiFetch（弹层 probe 数据源，fail-safe 默认空响应）；
// task-11 追加 mock @/lib/quicklog getQuicklogDetail（标题解析数据源）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel, type SessionPreContext } from "../session-panel";
import { useMentionSources } from "@/lib/session-mention-sources";
import type {
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import type { ChangeSummary } from "@/lib/changes";
import type { QuicklogEntryListItem } from "@/lib/quicklog";

// task-05（2026-08-26-session-input-mention / FR-05 / FR-06）：@ 联想数据源
// hook mock——SessionInputBar 的数据桥在 textarea 首次聚焦才挂载（组件内注释），
// 既有用例 fireEvent.change 不聚焦故零影响；发送组装用例聚焦后消费本 mock
// 快照（真实 hook 走 react-query，mock 掉避免打真网络，先例
// session-input-bar-mention.test.tsx）。
vi.mock("@/lib/session-mention-sources", () => ({
  useMentionSources: vi.fn(),
}));

const mentionSourcesMock = vi.mocked(useMentionSources);

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 session-panel-dialog.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（lib/daemon 会话 API 全量，R-01 断言数据源） ----- */

const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionRuns: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
  };
});

// page 模式 workspacesQuery（工作区名解析，预会话上下文行数据源）。
const workspaceApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  listProjectWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, listWorkspaces: workspaceApi.listWorkspaces };
});

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: workspaceApi.listProjects };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});

// task-11（FR-06）：快速修复标题解析数据源（preQuicklogQuery 单条 detail）。
const quicklogApi = vi.hoisted(() => ({
  getQuicklogDetail: vi.fn(),
}));

vi.mock("@/lib/quicklog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quicklog")>(
    "@/lib/quicklog",
  );
  return { ...actual, getQuicklogDetail: quicklogApi.getQuicklogDetail };
});

// task-13：弹层 probe 数据源（POST /api/workspaces/probe，组件内 module-level
// 直调）——网络边界即 apiFetch；默认空响应（meta 不渲染，fail-safe 同线上）。
// ApiError 等其余导出走 actual（R-02 失败用例构造依赖）。
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据（转真会话态
// 后 SessionConfigBar 挂载用）。
vi.mock("@/lib/errors", () => ({
  // ql-20260823-008：配置条 provisional 暂存 toast 走 useNotify（App.useApp
  // 上下文）——测试环境无 antd App 包裹，mock 成 noop（先例 config-bar.test 注释）。
  useNotify: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({ items: [] }),
}));
vi.mock("@/lib/agent-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent-profiles")>(
    "@/lib/agent-profiles",
  );
  return { ...actual, useMineAgentProfiles: () => ({ profiles: [] }) };
});
vi.mock("@/lib/api/llm-providers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/llm-providers")>(
    "@/lib/api/llm-providers",
  );
  return { ...actual, listProviders: vi.fn().mockResolvedValue([]) };
});

/* ----- fixture ----- */

function makeRuntime(
  id: string,
  provider: string,
  overrides: Partial<DaemonRuntimeRead> = {},
): DaemonRuntimeRead {
  return {
    id,
    display_alias: null,
    name: "DESKTOP-1",
    provider,
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
    hostname: "DESKTOP-1",
    display_alias: "机器一",
    os: "Windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-08-23T04:00:00Z",
    version: "1.0.0",
    build_id: null,
    started_at: null,
    created_at: "2026-08-01T00:00:00Z",
    runtime_count: 2,
    online_runtime_count: 2,
    runtimes: [makeRuntime("rt-claude", "claude"), makeRuntime("rt-codex", "codex")],
    ...overrides,
  };
}

/** 真会话详情（转真会话态后 detailQuery 数据，形状对齐 session-panel-team.test）。 */
function makeDetail() {
  return {
    id: "sess-pre-1",
    runtime_id: "rt-claude",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: "ag-1",
    config: null,
    turn_count: 1,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: null,
    llm_provider_id: null,
    agent_profile_id: null,
    title: "预会话转正",
    config_snapshot: null,
  };
}

/** 快速修复详情（task-11 / FR-06：preQuicklogQuery 数据，关键字段对齐 QuicklogEntryRead）。 */
function makeQuicklogDetail(
  overrides: Partial<{ ql_id: string; title: string }> = {},
) {
  return {
    ql_id: "ql-20260825-001-x1",
    title: "修复登录跳转",
    status: "completed",
    status_note: null,
    timestamp: "2026-08-25T10:00:00Z",
    placeholder: false,
    author_raw: "qinyi",
    author_name: "qinyi",
    owner_name: null,
    linked_changes: [],
    ...overrides,
  };
}

/* ----- task-05（FR-05/FR-06）：@ 联想数据源 fixture（形态对齐 task-03
   session-input-bar-mention.test.tsx 的 ChangeSummary / QuicklogEntryListItem） ----- */

function makeMentionChange(): ChangeSummary {
  return {
    id: "chg-mention-1",
    change_key: "2026-08-26-mention-demo",
    title: "联想演示变更",
    status: "active",
    location: "worktree",
    change_type: null,
    affected_components: [],
    owner_id: null,
    updated_at: "2026-08-26T00:00:00Z",
  };
}

function makeMentionQuick(): QuicklogEntryListItem {
  return {
    ql_id: "ql-20260826-099",
    title: "联想演示修复",
    status: "completed",
    placeholder: false,
    author_raw: "qinyi",
    linked_changes: [],
    files: [],
    affected_modules: [],
    source: "file",
  };
}

function setupPre(
  overrides: {
    sessionId?: string | null;
    preContext?: SessionPreContext | null;
    machines?: DaemonMachineRead[];
    onPreSessionCreated?: (_resp: { session_id: string; run_id: string }) => void;
    /** workspacesQuery 返回（上下文行工作区名解析数据源）。 */
    workspacesItems?: { id: string; name: string }[];
  } = {},
) {
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  workspaceApi.listWorkspaces.mockResolvedValue({
    items: overrides.workspacesItems ?? [],
  });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  // task-11（FR-06）：标题解析默认成功响应（用例按需覆盖为失败/别名）。
  quicklogApi.getQuicklogDetail.mockResolvedValue(makeQuicklogDetail());
  // task-13：probe 默认空响应（用例按需覆盖为具体探测项）。
  apiFetchMock.mockResolvedValue([]);

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const machines = overrides.machines ?? [makeMachine()];
  const view = (
    sid: string | null,
    preCtx: SessionPreContext | null | undefined,
  ) => (
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId={sid}
        machines={machines}
        llmProviders={[]}
        preContext={preCtx ?? undefined}
        onPreSessionCreated={overrides.onPreSessionCreated}
      />
    </QueryClientProvider>
  );
  const preContext: SessionPreContext | null =
    overrides.preContext === undefined
      ? { workspaceId: null, runtimeId: "rt-claude" }
      : overrides.preContext;
  const result = render(view(overrides.sessionId ?? null, preContext));
  return { ...result, rerenderWith: (sid: string | null) => result.rerender(view(sid, preContext)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // task-05：联想数据源默认快照（变更 + 快速修复各一条，形态对齐
  // ChangeSummary / QuicklogEntryListItem；用例按需覆盖）。
  // task-06（2026-08-28-session-ppm-task-binding）：PPM 两分组补空数组占位
  //（useMentionSources 返回面扩展的旧 mock 顺手补字段，CLAUDE.md 惯例）。
  mentionSourcesMock.mockReturnValue({
    skills: [],
    changes: [makeMentionChange()],
    quicklogs: [makeMentionQuick()],
    ppmTasks: [],
    ppmProblems: [],
    atEnabled: true,
  });
});

/* ───────── 1. D-101 同构渲染 + D-104 上下文行只读 ───────── */


/** ql-20260827-020：派团队入口迁入 ＋ 功能菜单——先开菜单再取 menuitem。
 *  （fireEvent.click 不触发 document mousedown，菜单保持打开可直接取项。） */
function getTeamMenuItem(): HTMLButtonElement {
  fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
  return screen.getByRole("menuitem", { name: /派团队/ }) as HTMLButtonElement;
}

describe("SessionPanel 预会话态渲染（D-101 同构空态）", () => {
  it("面板头 / 时间线容器 / 输入区均在：新会话标题 + 空时间线提示 + 可输入，仅多上下文行", () => {
    setupPre();

    // 面板头：新会话标题 + 同构 chrome（打断按钮存在且禁用；title 为预会话
    // 引导文案，按 role name 断言避开 title 语义混淆）。
    expect(screen.getByText("新会话")).toBeInTheDocument();
    const interruptBtn = screen.getByRole("button", {
      name: /打断本轮/,
    }) as HTMLButtonElement;
    expect(interruptBtn.disabled).toBe(true);

    // 时间线容器（与 TurnTimeline 同容器语义）+ 空态文案。
    expect(screen.getByTestId("turn-timeline-scroll")).toBeInTheDocument();
    // 空时间线提示文案（面板主体，非 placeholder——不带联想提示）。
    expect(screen.getByText(/发送第一句话开始对话/)).toBeInTheDocument();

    // 输入区：完整输入可用（机器在线 + preContext 就位）。
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
  });

  it("上下文行渲染 preContext：工作区不指定文案 / 机器别名 / 引擎名，且完全只读（D-104 无任何可交互元素）", () => {
    setupPre();
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("不指定（非工作区）");
    expect(ctx.textContent).toContain("机器一");
    expect(ctx.textContent).toContain("Claude Code");
    expect(ctx.textContent).toContain("上下文已锁定");
    // D-104：锁定行无任何可交互元素（无 button / link / input）。
    expect(within(ctx).queryAllByRole("button")).toHaveLength(0);
    expect(within(ctx).queryAllByRole("link")).toHaveLength(0);
    expect(within(ctx).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("workspaceId 命中时上下文行显示工作区名（workspacesQuery 解析）", async () => {
    setupPre({
      preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" },
      workspacesItems: [{ id: "ws-1", name: "前端重构" }],
    });

    const ctx = await screen.findByTestId("pre-session-context");
    await waitFor(() => expect(ctx.textContent).toContain("前端重构"));
  });

  it("无 preContext（空门户态兜底）：上下文行降级占位 + 输入禁用引导文案", () => {
    setupPre({ preContext: null });
    const input = screen.getByPlaceholderText(
      /请先选择机器与智能体/,
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).toContain("不指定（非工作区）");
    expect(ctx.textContent).toContain("—");
  });

  it("preContext 目标机器离线：输入禁用 + 离线占位文案", () => {
    setupPre({
      machines: [makeMachine({ status: "offline", online_runtime_count: 0 })],
    });
    const input = screen.getByPlaceholderText(
      /机器离线，输入不可用/,
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });
});

/* ───────── 2. R-01 专项：sessionId=null 副作用零调用 ───────── */

describe("SessionPanel 预会话态 null 守卫（R-01 专项）", () => {
  it("sessionId=null 时 getAgentSession / 建流 / 历史预取 / dialogs 恢复 / 队列投递 / team missions 逐项零调用", async () => {
    setupPre();
    // 等待一轮 microtask/effect flush（守卫失效时各 effect 会在此窗口发起请求）。
    await act(async () => {
      await Promise.resolve();
    });

    expect(sessionApi.getAgentSession).not.toHaveBeenCalled(); // detailQuery 轮询
    expect(sessionApi.streamSession).not.toHaveBeenCalled(); // SSE 建流
    expect(sessionApi.getAgentSessionLogs).not.toHaveBeenCalled(); // 历史预取
    expect(sessionApi.listSessionRuns).not.toHaveBeenCalled(); // runs 快照
    expect(sessionApi.fetchPendingDialogs).not.toHaveBeenCalled(); // dialogs 恢复
    expect(sessionApi.fetchSessionDialogHistory).not.toHaveBeenCalled();
    expect(sessionApi.listSessionTeamMissions).not.toHaveBeenCalled(); // team 轮询
    expect(sessionApi.injectSession).not.toHaveBeenCalled(); // 队列投递
    expect(sessionApi.createSession).not.toHaveBeenCalled(); // 未发送不创建
  });
});

/* ───────── 3. D-102 首句创建链路 ───────── */

describe("SessionPanel 预会话首句创建（D-102）", () => {
  it("首句发送 → createSession 含 runtime_id + prompt + manual_approval/ask_user_only（不带 provider），成功清空输入并上报 onPreSessionCreated", async () => {
    const onPreSessionCreated = vi.fn();
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-1",
      run_id: "run-pre-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({ onPreSessionCreated });

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "帮我核对文档" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith({
      runtime_id: "rt-claude",
      prompt: "帮我核对文档",
      manual_approval: true,
      ask_user_only: true,
    });
    // 成功后才清空输入（R-02 反例守护）。
    await waitFor(() => expect(input.value).toBe(""));
    // 上报父层（resp 完整对象）——父层切 sessionId 的接线依据。
    await waitFor(() =>
      expect(onPreSessionCreated).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: "sess-pre-1", run_id: "run-pre-1" }),
      ),
    );

    // 面板仍处预会话态（父层未切 sessionId）→ SSE 不建流（接线归 task-06）。
    expect(sessionApi.streamSession).not.toHaveBeenCalled();
  });

  it("preContext 带 workspaceId + changeId → createSession 条件展开双传（X-13 语义）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-2",
      run_id: "run-pre-2",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    const onPreSessionCreated = vi.fn();
    setupPre({
      preContext: { workspaceId: "ws-1", changeId: "chg-1", runtimeId: "rt-codex" },
      onPreSessionCreated,
    });

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "变更入口首句" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-codex",
        prompt: "变更入口首句",
        workspace_id: "ws-1",
        change_id: "chg-1",
        manual_approval: true,
        ask_user_only: true,
      }),
    );
    // task-11（FR-06 零回归）：不带 quickId → 请求体不含 quicklog_id。
    const arg = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.quicklog_id).toBeUndefined();
    // 上报父层（resp 完整对象）——父层切 sessionId 的接线依据。
    await waitFor(() =>
      expect(onPreSessionCreated).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: "sess-pre-2", run_id: "run-pre-2" }),
      ),
    );
  });

  it("preContext 带 workspaceId + quickId → createSession 上送 quicklog_id（task-11 / FR-06）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-q1",
      run_id: "run-pre-q1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({
      preContext: {
        workspaceId: "ws-1",
        quickId: "ql-20260825-001-x1",
        runtimeId: "rt-codex",
      },
    });

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "快速修复入口首句" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-codex",
        prompt: "快速修复入口首句",
        workspace_id: "ws-1",
        quicklog_id: "ql-20260825-001-x1",
        manual_approval: true,
        ask_user_only: true,
      }),
    );
    // 不带 changeId → 请求体不含 change_id（quicklog 入口独立，缺省零回归）。
    const arg = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.change_id).toBeUndefined();
    // 标题解析 query 已按双传契约发起（单条 detail，对齐变更解析单条语义）。
    expect(quicklogApi.getQuicklogDetail).toHaveBeenCalledWith(
      "ws-1",
      "ql-20260825-001-x1",
    );
  });

  it("成功后父层切 sessionId → 状态机自然接管（detailQuery / SSE 建流随依赖激活）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-1",
      run_id: "run-pre-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    const { rerenderWith } = setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "首句" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());

    // 模拟父层（门户，task-06）按 onPreSessionCreated 切换 sessionId。
    rerenderWith("sess-pre-1");
    await waitFor(() =>
      expect(sessionApi.getAgentSession).toHaveBeenCalledWith("sess-pre-1"),
    );
    await waitFor(() =>
      expect(sessionApi.streamSession).toHaveBeenCalledWith(
        "sess-pre-1",
        expect.any(Object),
        // ql-20260827-018：第三参 cursor/initialSync 建流选项。
        expect.any(Object),
      ),
    );
    // 真会话面板头接管（标题来自 detailQuery）。
    await waitFor(() => expect(screen.getByText("预会话转正")).toBeInTheDocument());
  });
});

/* ───────── 4. R-02 失败保留输入 + 重试 ───────── */

describe("SessionPanel 预会话首句创建失败（R-02）", () => {
  it("失败：输入保留 + 内联错误可见 + 不建流；原地重发成功后错误清除", async () => {
    const { ApiError } = await import("@/lib/api");
    sessionApi.createSession
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: "DAEMON_UNAVAILABLE",
          message: "daemon 暂不可用",
          request_id: null,
          details: null,
        }),
      )
      .mockResolvedValueOnce({
        session_id: "sess-pre-3",
        run_id: "run-pre-3",
        lease_id: "l",
        status: "active",
        stream_url: "",
      });
    setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "会失败的首句" } });
    fireEvent.click(screen.getByTitle("发送"));

    // R-02：失败保留输入（dialog idle 先清后建失败即丢——此处有意改造）。
    await waitFor(() =>
      expect(screen.getByLabelText("创建会话错误")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("创建会话错误").textContent).toContain(
      "daemon 暂不可用",
    );
    expect(input.value).toBe("会失败的首句");
    expect(sessionApi.streamSession).not.toHaveBeenCalled();

    // 原地重试（输入未丢，直接再点发送）→ 第二次成功。
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByLabelText("创建会话错误")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("空文本不发首句（后端 prompt 首句约束）", async () => {
    setupPre();
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    // task-14（FR-08）：纯空文本发送按钮禁点，title/aria 提示与后端 422 文案一致
    const sendBtn = screen.getByTitle("消息内容不能为空") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(sessionApi.createSession).not.toHaveBeenCalled();
  });
});

/* ───────── 6. ql-20260823-008：配置条/团队行同构挂载（provisional 暂存） ───────── */

describe("SessionPanel 预会话配置条与团队行（ql-20260823-008 完全一致）", () => {
  it("配置控件条渲染：供应商/档案可选（task-09 起配置条仅两块，机器/智能体块不再渲染）；派团队按钮解禁可点（task-13，门控三态见下方专项）", () => {
    setupPre();

    // 配置条在（aria-label 同真会话）
    expect(screen.getByLabelText("会话配置控件条")).toBeInTheDocument();
    // task-09：机器/智能体展示块已移除（换机器/引擎需开新会话，块内无可执行
    // 目标）；D-104 锁定语义由预会话上下文行承担。
    expect(screen.queryByRole("button", { name: /^配置-机器/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^配置-智能体/ })).not.toBeInTheDocument();
    // 供应商/档案可选（未锁）
    const providerCtrl = screen.getByRole("button", {
      name: "配置-供应商 本机默认",
    }) as HTMLButtonElement;
    const profileCtrl = screen.getByRole("button", {
      name: "配置-档案 未指定",
    }) as HTMLButtonElement;
    expect(providerCtrl.disabled).toBe(false);
    expect(profileCtrl.disabled).toBe(false);
    // task-13（FR-05）：派团队按钮解禁——默认 preContext（claude + 在线）可点，
    // 与真会话门控同构；tooltip 提示首句创建会话即预建团队任务。
    const teamBtn = getTeamMenuItem();
    expect(teamBtn.disabled).toBe(false);
    expect(teamBtn.title).toBe("派团队：首句创建会话时预建团队任务");
  });

  it("选供应商 → 暂存不 inject；首句 createSession 携带 llm_provider_id", async () => {
    const { listProviders } = await import("@/lib/api/llm-providers");
    vi.mocked(listProviders).mockResolvedValue([
      { id: "prov-1", name: "智谱 GLM" },
    ] as never);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-new",
      run_id: "run-1",
      lease_id: null,
      status: "pending",
      stream_url: "/x",
    });
    setupPre();

    // 点开供应商下拉选「智谱 GLM」→ 暂存（injectSession 零调用，控件显示新值）
    fireEvent.click(screen.getByRole("button", { name: "配置-供应商 本机默认" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "选择 智谱 GLM" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "配置-供应商 智谱 GLM" }),
      ).toBeInTheDocument(),
    );
    expect(sessionApi.injectSession).not.toHaveBeenCalled();

    // 首句发送 → createSession 带暂存供应商
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "带供应商开聊" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-claude",
        prompt: "带供应商开聊",
        llm_provider_id: "prov-1",
      }),
    );
  });

  it("不选供应商/档案 → createSession 不带两字段（默认不指定语义保持）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre-new",
      run_id: "run-1",
      lease_id: null,
      status: "pending",
      stream_url: "/x",
    });
    setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "直接开聊" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    const arg = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.llm_provider_id).toBeUndefined();
    expect(arg.agent_profile_id).toBeUndefined();
  });
});

/* ───────── 7. task-13（FR-05）：预会话团队触发行门控三态 ───────── */

describe("SessionPanel 预会话派团队门控（task-13 解禁）", () => {
  it("claude 引擎 + 所选机器在线：按钮可点，点击打开 preSession 弹层（主 agent 选择器 + 确认文案）", async () => {
    setupPre();

    const teamBtn = getTeamMenuItem();
    expect(teamBtn.disabled).toBe(false);
    expect(teamBtn.title).toBe("派团队：首句创建会话时预建团队任务");

    // 点击打开弹层——task-12 preSession 实例形态（选择器 + 确认按钮文案）。
    fireEvent.click(teamBtn);
    expect(
      await screen.findByRole("dialog", { name: "派团队配置" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("主 agent（项目经理）")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    ).toBeInTheDocument();
  });

  it("非 claude 引擎（codex）：按钮禁用 + tooltip「团队需要 Claude 引擎」", () => {
    setupPre({ preContext: { workspaceId: null, runtimeId: "rt-codex" } });

    const teamBtn = getTeamMenuItem();
    expect(teamBtn.disabled).toBe(true);
    expect(teamBtn.title).toBe("团队需要 Claude 引擎");
  });

  it("所选机器离线：按钮禁用 + tooltip「所选机器离线」", () => {
    setupPre({
      machines: [makeMachine({ status: "offline", online_runtime_count: 0 })],
    });

    const teamBtn = getTeamMenuItem();
    expect(teamBtn.disabled).toBe(true);
    expect(teamBtn.title).toBe("所选机器离线，无法派团队");
  });

  it("无 preContext（空门户态）：按钮禁用 + tooltip「请先选择机器与智能体」", () => {
    setupPre({ preContext: null });

    const teamBtn = getTeamMenuItem();
    expect(teamBtn.disabled).toBe(true);
    expect(teamBtn.title).toBe("请先选择机器与智能体");
  });
});

/* ───────── 8. task-13（FR-05/FR-06）：确认暂存 + team_mission 随首句上送 ───────── */

describe("SessionPanel 预会话弹层确认 → 暂存 + 首句携带 team_mission（task-13）", () => {
  /** 打开弹层并确认（目标回填输入框后返回输入框元素）。
   *  ql-20260826-010：回填前置 /team 指令（首句带团队指令语义直送 create）。 */
  async function confirmPopoverWith(objective: string) {
    fireEvent.click(getTeamMenuItem());
    const objectiveInput = await screen.findByLabelText(
      "目标（可选，随下条消息发出）",
    );
    fireEvent.change(objectiveInput, { target: { value: objective } });
    fireEvent.click(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    );
    // 弹层关闭 + 「/team <objective>」回填输入框（暂存待首句上送）。
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "派团队配置" }),
      ).not.toBeInTheDocument(),
    );
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe(`/team ${objective}`));
    return input;
  }

  it("确认后 payload 暂存：弹层关闭 + objective 回填输入框；首句 createSession 请求体携带 team_mission（默认当前会话 orchestrator_workspace_id=null），不调 triggerSessionTeamMission", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-team-1",
      run_id: "run-team-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({
      preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" },
      workspacesItems: [{ id: "ws-1", name: "前端重构" }],
    });

    const input = await confirmPopoverWith("重构登录页");

    // 首句发送 → createSession 携带 team_mission 块（含 orchestrator_workspace_id）。
    // ql-20260826-013：回填前置 /team 但首句上送剥前缀文本（原文会被 Claude
    // Code 当 slash command 报 Unknown command）；mission objective 仍是弹层
    // payload 纯文本。
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(1),
    );
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-claude",
        prompt: "重构登录页",
        workspace_id: "ws-1",
        team_mission: {
          objective: "重构登录页",
          budget_usd: null,
          orchestrator_workspace_id: null,
        },
      }),
    );
    // 预会话确认绝不调 triggerSessionTeamMission（无会话可挂 mission，卡约束）。
    expect(sessionApi.triggerSessionTeamMission).not.toHaveBeenCalled();
    // 弹层 probe 数据源不变（POST /api/workspaces/probe，task-12 组件内实现）。
    expect(apiFetchMock).toHaveBeenCalledWith("/api/workspaces/probe", {
      method: "POST",
      json: { workspace_ids: ["ws-1"] },
    });
  });

  it("主 agent 选择器钉工作区（probe 在线可选）：确认 payload.orchestrator_workspace_id=工作区 id 随首句上送", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-team-2",
      run_id: "run-team-2",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({
      preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" },
      workspacesItems: [{ id: "ws-1", name: "前端重构" }],
    });
    // setupPre 内部把 probe 复位为空响应——弹层打开前覆盖为在线探测项
    //（弹层挂载即 probe，时序在覆盖之后）。
    apiFetchMock.mockResolvedValue([
      {
        workspace_id: "ws-1",
        git_mode: "git",
        daemon_name: "机器一",
        daemon_online: true,
      },
    ]);

    // 打开弹层，等主 agent 选择器出现可选工作区项（probe 在线）后选中。
    fireEvent.click(getTeamMenuItem());
    const selector = await screen.findByLabelText("主 agent（项目经理）");
    await screen.findByText("前端重构 · 机器一（该工作区设备与智能体）");
    fireEvent.change(selector, { target: { value: "ws-1" } });
    fireEvent.change(await screen.findByLabelText("目标（可选，随下条消息发出）"), {
      target: { value: "重构登录页" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    );
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("/team 重构登录页"));

    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(1),
    );
    const arg = sessionApi.createSession.mock.calls[0]![0] as {
      team_mission?: { orchestrator_workspace_id?: string | null };
    };
    expect(arg.team_mission?.orchestrator_workspace_id).toBe("ws-1");
  });

  it("失败保留输入与暂存可原地重试（R-02 延伸）；成功后暂存清空——再发一句不带 team_mission", async () => {
    const { ApiError } = await import("@/lib/api");
    sessionApi.createSession
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: "DAEMON_UNAVAILABLE",
          message: "daemon 暂不可用",
          request_id: null,
          details: null,
        }),
      )
      .mockResolvedValueOnce({
        session_id: "sess-team-3",
        run_id: "run-team-3",
        lease_id: "l",
        status: "active",
        stream_url: "",
      })
      .mockResolvedValueOnce({
        session_id: "sess-team-4",
        run_id: "run-team-4",
        lease_id: "l",
        status: "active",
        stream_url: "",
      });
    setupPre({
      preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" },
      workspacesItems: [{ id: "ws-1", name: "前端重构" }],
    });

    const input = await confirmPopoverWith("重构登录页");

    // 首句 → 失败：错误可见 + 输入保留（暂存同保留，重试仍携带）。
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(screen.getByLabelText("创建会话错误")).toBeInTheDocument(),
    );
    expect(input.value).toBe("/team 重构登录页");
    const first = sessionApi.createSession.mock.calls[0]![0] as {
      team_mission?: unknown;
    };
    expect(first.team_mission).toBeDefined();

    // 原地重试（输入与暂存均未丢）→ 第二次成功仍携带同一 team_mission 块。
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(2),
    );
    const second = sessionApi.createSession.mock.calls[1]![0] as {
      team_mission?: unknown;
    };
    expect(second.team_mission).toEqual({
      objective: "重构登录页",
      budget_usd: null,
      orchestrator_workspace_id: null,
    });

    // 成功清空暂存：面板仍预会话（父层未切 sessionId）→ 再发一句不带 team_mission。
    fireEvent.change(input, { target: { value: "第二句追问" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(3),
    );
    const third = sessionApi.createSession.mock.calls[2]![0] as {
      team_mission?: unknown;
    };
    expect(third.team_mission).toBeUndefined();
  });

  it("未确认弹层（无暂存）：首句 createSession 不带 team_mission 字段（既有语义保持）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-team-5",
      run_id: "run-team-5",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "普通首句" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(1),
    );
    const arg = sessionApi.createSession.mock.calls[0]![0] as {
      team_mission?: unknown;
    };
    expect(arg.team_mission).toBeUndefined();
  });
});

/* ───────── 9. task-11（FR-06）：quickId 锁定行快速修复标题解析 ───────── */

describe("SessionPanel 预会话快速修复上下文行（task-11 / FR-06）", () => {
  it("quickId 存在：锁定行渲染快速修复标题（getQuicklogDetail 解析，chip 对齐变更行形态且只读）", async () => {
    setupPre({
      preContext: {
        workspaceId: "ws-1",
        quickId: "ql-20260825-001-x1",
        runtimeId: "rt-claude",
      },
    });

    const ctx = await screen.findByTestId("pre-session-context");
    // 标题来自 getQuicklogDetail 解析（非 ql_id 短码直显）。
    await waitFor(() => expect(ctx.textContent).toContain("修复登录跳转"));
    expect(quicklogApi.getQuicklogDetail).toHaveBeenCalledWith(
      "ws-1",
      "ql-20260825-001-x1",
    );
    // D-104：快速修复 chip 同样纯文本（锁定行无任何可交互元素）。
    expect(within(ctx).queryAllByRole("button")).toHaveLength(0);
    expect(within(ctx).queryAllByRole("link")).toHaveLength(0);
  });

  it("标题解析失败：静默回退 ql_id 短码展示不报错（D-001 条目行允许后到，不校验存在性）", async () => {
    quicklogApi.getQuicklogDetail.mockRejectedValue(new Error("not found"));
    setupPre({
      preContext: {
        workspaceId: "ws-1",
        quickId: "ql-20260824-009-z9",
        runtimeId: "rt-claude",
      },
    });

    const ctx = await screen.findByTestId("pre-session-context");
    await waitFor(() => expect(ctx.textContent).toContain("ql-20260824-009-z9"));
    // 解析失败不冒泡为创建会话错误（标题解析与首句创建互不影响）。
    expect(screen.queryByLabelText("创建会话错误")).not.toBeInTheDocument();
  });

  it("无 quickId：锁定行不渲染快速修复条目、标题解析零调用（缺省零回归）", () => {
    setupPre({ preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" } });

    const ctx = screen.getByTestId("pre-session-context");
    expect(ctx.textContent).not.toContain("修复登录跳转");
    expect(quicklogApi.getQuicklogDetail).not.toHaveBeenCalled();
  });
});

/* ───────── 10. task-05（2026-08-28-session-ppm-task-binding / FR-04）：
   ppmItem 首句上送 + 锁定行 PPM 徽标 ───────── */

describe("SessionPanel 预会话 PPM 条目绑定（task-05 / FR-04）", () => {
  it("ppmItem 存在：首句 createSession 成对上送 ppm_item_kind/ppm_item_id（与 change_id/quicklog_id 并列）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-ppm-1",
      run_id: "run-ppm-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({
      preContext: {
        workspaceId: "ws-1",
        runtimeId: "rt-claude",
        ppmItem: { kind: "plan_task", id: "task-1", title: "排行榜接口性能优化" },
      },
    });

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "任务入口首句" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_id: "rt-claude",
        prompt: "任务入口首句",
        workspace_id: "ws-1",
        ppm_item_kind: "plan_task",
        ppm_item_id: "task-1",
        manual_approval: true,
        ask_user_only: true,
      }),
    );
    // change/quick 缺省不进请求体（入口独立，零回归）。
    const arg = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.change_id).toBeUndefined();
    expect(arg.quicklog_id).toBeUndefined();
  });

  it("ppmItem 缺省：请求体不含 ppm_item_kind/ppm_item_id（零回归）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-ppm-2",
      run_id: "run-ppm-2",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "普通首句" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    const arg = sessionApi.createSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.ppm_item_kind).toBeUndefined();
    expect(arg.ppm_item_id).toBeUndefined();
  });

  it("锁定行渲染 PPM 徽标：中文名 + 条目标题（problem kind 同构，纯文本 D-104）", () => {
    setupPre({
      preContext: {
        workspaceId: "ws-1",
        runtimeId: "rt-claude",
        ppmItem: { kind: "plan_task", id: "task-1", title: "排行榜接口性能优化" },
      },
    });

    const chip = screen.getByTestId("pre-session-ppm-chip");
    expect(chip.textContent).toContain("PPM 任务");
    expect(chip.textContent).toContain("排行榜接口性能优化");
    // D-104：锁定行无任何可交互元素（chip 纯文本）。
    const ctx = screen.getByTestId("pre-session-context");
    expect(within(ctx).queryAllByRole("button")).toHaveLength(0);
    expect(within(ctx).queryAllByRole("link")).toHaveLength(0);
  });

  it("标题缺失回退 id 短码；problem kind 显示「PPM 问题」", () => {
    setupPre({
      preContext: {
        workspaceId: null,
        runtimeId: "rt-claude",
        ppmItem: { kind: "problem", id: "0123456789abcdef", title: null },
      },
    });

    const chip = screen.getByTestId("pre-session-ppm-chip");
    expect(chip.textContent).toContain("PPM 问题");
    expect(chip.textContent).toContain("#01234567");
  });

  it("ppmItem 缺省：锁定行不渲染 PPM 徽标（缺省零回归）", () => {
    setupPre();
    expect(
      screen.queryByTestId("pre-session-ppm-chip"),
    ).not.toBeInTheDocument();
  });
});

/* ───────── task-05：@ 联想发送组装（FR-05 create / FR-06 inject 绑定） ───────── */

describe("SessionPanel @ 联想发送组装（task-05）", () => {
  /** 聚焦并键入触发串（光标随文本末尾），返回输入框元素。 */
  const focusAndType = (input: HTMLTextAreaElement, text: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: text, selectionStart: text.length, selectionEnd: text.length },
    });
  };

  it("预会话 @ 变更选中 → 首句 createSession 带 change_id（@ 选中优先于入口 changeId），不带 quicklog_id", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-m1",
      run_id: "run-m1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre({
      preContext: { workspaceId: "ws-1", changeId: "chg-entry", runtimeId: "rt-claude" },
    });

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    focusAndType(input, "@2026-08-26-mention-demo");
    // 浮层命中唯一变更条目；Enter 选中回填（task-03 契约，回填名 = change_key）。
    expect(screen.getByTestId("session-mention-popover")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("@2026-08-26-mention-demo ");
    fireEvent.change(input, { target: { value: `${input.value}推进这个变更` } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        // @ 选中的结构化 id（change.id）覆盖入口锁定值（用户显式最新选择优先）。
        change_id: "chg-mention-1",
      }),
    );
    // 无快速修复选中 → quicklog_id 缺省不进请求体。
    const payload = sessionApi.createSession.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.quicklog_id).toBeUndefined();
  });

  it("预会话 @ 快速修复选中 → 首句 createSession 带 quicklog_id；成功后输入与选中一并清空", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-m2",
      run_id: "run-m2",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre();

    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    focusAndType(input, "@ql-20260826-099");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("@ql-20260826-099 ");
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ quicklog_id: "ql-20260826-099" }),
    );
    // 发送成功 → 输入清空（既有断言）且 @ 选中随 clearAttachments 同时机收敛。
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("真会话空闲追问 @ 变更选中 → injectSession 带 bind_change_key；无选中再发 options 收敛为空对象（缺省零回归）", async () => {
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-pre-1",
      run_id: "run-inj-1",
      status: "active",
    });
    setupPre({ sessionId: "sess-pre-1" });

    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    focusAndType(input, "@2026-08-26-mention-demo");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: `${input.value}推进这个变更` } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    // 空闲路径（sendFromQueue）：options 恰为唯一绑定字段（无附件/无页面上下文）。
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-pre-1",
      "@2026-08-26-mention-demo 推进这个变更",
      { bind_change_key: "2026-08-26-mention-demo" },
    );

    // 发送成功清空选中后普通追问：第三参展开为空对象（与缺省形态逐字段一致）。
    fireEvent.change(input, { target: { value: "普通追问" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(2));
    expect(sessionApi.injectSession).toHaveBeenNthCalledWith(
      2,
      "sess-pre-1",
      "普通追问",
      {},
    );
  });

  it("真会话忙轮 @ 快速修复选中 → injectSession 带 bind_quick_id（排队路径绑定不丢，R-10）", async () => {
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-pre-1",
      run_id: null,
      status: "queued",
      queued: true,
    });
    // 先空态挂载再覆盖 detail 并切真会话（setupPre 渲染期会消费默认
    // getAgentSession 响应——忙轮覆盖须在 rerender 前就位）。
    const { rerenderWith } = setupPre();
    sessionApi.getAgentSession.mockResolvedValue({
      ...makeDetail(),
      current_run_id: "run-busy",
    });
    rerenderWith("sess-pre-1");

    // detail.current_run_id 回填 currentRunId → running（忙轮）placeholder。
    const input = (await screen.findByPlaceholderText(
      /消息将排队/,
    )) as HTMLTextAreaElement;
    focusAndType(input, "@ql-20260826-099");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: `${input.value}跟进` } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    // 忙轮路径（sendToServerQueue）：绑定字段直达后端排队请求。
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-pre-1", "@ql-20260826-099 跟进", {
      bind_quick_id: "ql-20260826-099",
    });
  });
});
