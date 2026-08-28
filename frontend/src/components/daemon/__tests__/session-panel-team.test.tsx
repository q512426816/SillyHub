// task-11（2026-08-22-team-session-unify / FR-03 / FR-07 / D-003 / D-004）：
// SessionPanel 会话内团队触发入口单测（page/dialog 双模式，design §5 Phase 3 +
// 原型 prototype-team-session-unify.html §01/§02）。
//
// 覆盖（task-11 剩余实现——popover 组件本体单测见 team-trigger-popover.test.tsx）：
//   1. 派团队按钮引擎门控（D-003 一期 Claude 专属）：claude 可用；codex 置灰 +
//      tooltip「团队需要 Claude 引擎」（dialog provider 态 + page session.provider
//      两个信息源）；
//   2. /team 前缀拦截（D-004 四路等价）：claude 会话提交 → 不发送、弹层打开 +
//      objective 预填去前缀文本 + 输入框清空；codex 会话不拦截（正常入队）；
//   3. TeamTaskBlock 挂载冒烟：listSessionTeamMissions 列表全部渲染（活跃在前）+
//      活跃 chip「团队进行中 · N 分身」+ chip 可关闭收回（块仍在）；
//   4. page 模式 /team 拦截（独立代码路径同断言）；
//   5. task-14（2026-08-25-team-subsession-governance / FR-08 / design §5.E）：
//      分身行（sub_session_id）点击 → WorkerSessionOverlay 浮层复用 SessionPanel
//      （dialog/attach 形态）打开该子会话（attach 轮询打到 sub_session_id）；
//      关闭浮层还原主控面板（团队列表 + 输入框不丢）；page/dialog 两渲染点等价；
//   6. task-07 Phase 5（2026-08-28-session-ppm-task-binding / FR-06 / D-004@v2）：
//      page 模式预会话 autoTeamOpen 一次性通道——挂载即自动开派团队弹层 +
//      objective 预填「分析项目 X 当前迭代风险并给出建议」（getProject 项目名，
//      失败空目标降级）+ defaultProjectId 项目/工作区预选；不传 prop 零回归。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/daemon 会话 API + 团队 client、
// @/lib/workspaces、@/lib/ppm/project、@/lib/workspace、page chrome 数据 hook）；
// 断言用正则/aria-label 避开 antd 中文按钮 autoLetterSpacing 拆分坑（团队触发行
// 本身为非 antd 原生按钮，不受影响）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import type { TeamMissionSummary } from "@/lib/daemon";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 interactive-session-panel.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层 ----- */

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
  // ql-20260828-009-4a13：chip × 真取消 + 更新指派前置取消。
  cancelTeamMission: vi.fn(),
  // ql-20260825-011：服务端排队三件套（GET/DELETE/retry）。
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
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
    cancelTeamMission: sessionApi.cancelTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

// page 模式 workspacesQuery（工作区名解析）+ popover 项目下拉/项目工作区数据源。
// task-07 Phase 5 追加 getProject：autoTeamOpen 预填 objective 的项目名解析源。
const workspaceApi = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  listProjectWorkspaces: vi.fn(),
  getProject: vi.fn(),
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
  return {
    ...actual,
    listProjects: workspaceApi.listProjects,
    getProject: workspaceApi.getProject,
  };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据。
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

const OBJECTIVE = "修掉登录页三处移动端问题并补回归用例";

/**
 * ql-20260826-010：团队任务块收编进头部 ActivityCatalog 下拉——先点「后台」
 * 触发按钮展开，再对块内容断言/交互。等待列表挂载后才返回。
 * ql-20260826-014：ensure 语义——下拉已开（containment 收起下 jsdom 纯 click
 * 不会误关）则不再点触发钮（避免把开着的目录点关）。
 */
async function openActivityCatalog() {
  if (screen.queryByLabelText("会话团队任务列表")) return;
  fireEvent.click(
    await screen.findByRole("button", { name: /^后台任务目录/ }),
  );
  await screen.findByLabelText("会话团队任务列表");
}

function makeMission(
  id: string,
  status: TeamMissionSummary["status"],
  workers: TeamMissionSummary["workers"],
): TeamMissionSummary {
  return {
    mission_id: id,
    status,
    objective: `目标-${id}`,
    scope_workspace_ids: [],
    budget_usd: null,
    workers,
  };
}

function makeWorker(runId: string, status: string, subSessionId?: string) {
  // task-14：sub_session_id 可选——子会话形态分身行（lib/daemon 手写类型暂未含
  // 新字段，返回值非字面量直赋不受 excess property check，与组件 WorkerRowView
  // intersect 同口径）。
  return {
    run_id: runId,
    role: "impl",
    status,
    objective: "分工目标",
    ...(subSessionId ? { sub_session_id: subSessionId } : {}),
  };
}

/** attach 详情（dialog 轮询 / page detailQuery 共用形状）。 */
function makeDetail(provider: string) {
  return {
    id: "sess-team",
    runtime_id: null,
    lease_id: null,
    provider,
    status: "active",
    agent_session_id: "ag-1",
    config: null,
    turn_count: 1,
    created_at: "t",
    last_active_at: null,
    ended_at: null,
    current_run_id: null,
    workspace_id: "ws-1",
    llm_provider_id: null,
    agent_profile_id: null,
    title: "团队会话",
    config_snapshot: null,
  };
}

function setupDialog(overrides: Record<string, unknown> = {}) {
  const props = {
    mode: "dialog" as const,
    sessionId: "sess-team",
    providers: ["claude"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<SessionPanel {...(props as any)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // ql-20260825-011：默认空队列（服务端排队三件套）。
  sessionApi.fetchSessionQueue.mockResolvedValue([]);
  sessionApi.deleteSessionQueueEntry.mockResolvedValue(undefined);
  sessionApi.retrySessionQueueEntry.mockResolvedValue({
    id: "entry-1",
    prompt: "",
    attachment_ids: [],
    agent_profile_id: null,
    llm_provider_id: null,
    status: "pending",
    error_msg: null,
    created_at: "2026-08-25T10:00:00Z",
  });
  // dialog attach 默认链路：prefetch 空 + fake SSE + 轮询 active。
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.getAgentSession.mockResolvedValue(makeDetail("claude"));
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.triggerSessionTeamMission.mockResolvedValue(
    makeMission("m-new", "planning", []),
  );
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  // task-07 Phase 5：项目名解析默认失败（各用例按需覆盖）→ 空目标降级。
  workspaceApi.getProject.mockRejectedValue(new Error("no project"));
});

/* ───────── 1. 派团队按钮引擎门控（dialog） ───────── */


/**
 * ql-20260827-020：派团队入口迁入 ＋ 功能菜单——先开菜单再取 menuitem
 *（fireEvent.click 不触发 document mousedown，菜单保持打开）。
 */
async function findTeamMenuItem(): Promise<HTMLButtonElement> {
  fireEvent.click(await screen.findByRole("button", { name: "更多功能" }));
  return (await screen.findByRole("menuitem", { name: /派团队/ })) as HTMLButtonElement;
}

describe("SessionPanel 派团队按钮（dialog 模式引擎门控，D-003）", () => {
  it("claude 会话：按钮可用，tooltip 为派团队说明", async () => {
    setupDialog();
    const btn = await findTeamMenuItem();
    expect(btn.disabled).toBe(false);
    expect(btn.title).not.toContain("团队需要 Claude 引擎");
  });

  it("codex 会话：按钮置灰 + tooltip「团队需要 Claude 引擎」", async () => {
    setupDialog({
      providers: ["codex"],
      defaultProvider: "codex",
      sessionId: null, // idle 新建态：引擎门控优先于会话存在性展示
    });
    const btn = await findTeamMenuItem();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("团队需要 Claude 引擎");
  });
});

/* ───────── 2. /team 前缀拦截（dialog，D-004） ───────── */

describe("SessionPanel /team 指令拦截（dialog 模式）", () => {
  /**
   * idle → createSession 转 active（避免 attach 轮询等待）：首条消息创建会话后，
   * 第二条输入 /team 指令验证拦截。
   */
  async function createClaudeSession() {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-team",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupDialog({ sessionId: null });
    const input = screen.getByPlaceholderText(/输入首条消息创建会话.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));
    return screen.getByPlaceholderText(
      /消息将排队|继续追问/,
    ) as HTMLTextAreaElement;
  }

  it("claude：/team 前缀不发送 → 弹层打开 + objective 预填去前缀文本 + 输入框清空", async () => {
    const input = await createClaudeSession();
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    // 弹层打开（原型 §02）：标题 + 目标预填。
    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    const objInput = screen.getByLabelText(/^目标/) as HTMLInputElement;
    expect(objInput.value).toBe(OBJECTIVE);
    // 不发送：无排队条目、无 inject、草稿已清空（文本转入弹层）。
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/排队消息/)).not.toBeInTheDocument();
    expect(input.value).toBe("");
  });

  it("裸 /team（无目标文本）也拦截：弹层打开、objective 留空", async () => {
    const input = await createClaudeSession();
    fireEvent.change(input, { target: { value: "/team" } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect((screen.getByLabelText(/^目标/) as HTMLInputElement).value).toBe("");
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
  });

  it("codex：不拦截 → 正常入队（D-003 一期 Claude 专属）", async () => {
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-codex",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupDialog({
      sessionId: null,
      providers: ["codex"],
      defaultProvider: "codex",
    });
    const input = screen.getByPlaceholderText(/输入首条消息创建会话.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalledTimes(1));

    const input2 = screen.getByPlaceholderText(
      /消息将排队|继续追问/,
    ) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    // 未拦截：ql-20260826-013 起 /team 前缀剥离后直达后端（忙轮服务端排队，
    // ql-20260825-011；原文会被 Claude Code 当 slash command 报 Unknown command），
    // 弹层不打开。
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-codex",
      OBJECTIVE,
      undefined,
    );
    expect(screen.queryByText("派团队做这件事")).not.toBeInTheDocument();
  });
});

/* ───────── 3. TeamTaskBlock 挂载冒烟 + 活跃 chip（dialog） ───────── */

describe("SessionPanel TeamTaskBlock 挂载与活跃 chip（dialog 模式）", () => {
  it("mission 列表全部渲染（活跃在前）+ chip × 真取消（ql-20260828-009-4a13）", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValueOnce([
      makeMission("m-done", "done", [makeWorker("w-3", "completed")]),
      makeMission("m-run", "running", [
        makeWorker("w-1", "running"),
        makeWorker("w-2", "completed"),
      ]),
    ]);
    // 取消成功后刷新：m-run 收敛 cancelled（终态 → chip 消失，任务块保留）。
    sessionApi.listSessionTeamMissions.mockResolvedValueOnce([
      makeMission("m-done", "done", [makeWorker("w-3", "completed")]),
      makeMission("m-run", "cancelled", []),
    ]);
    sessionApi.cancelTeamMission.mockResolvedValue(undefined);
    setupDialog();

    // ql-20260826-010：默认收起（点开前不渲染任务块——不挤占会话窗口）。
    expect(
      screen.queryByLabelText("会话团队任务列表"),
    ).not.toBeInTheDocument();

    // 点开头部「后台」下拉：两个任务块，活跃（running）排在前。
    await openActivityCatalog();
    const list = screen.getByLabelText("会话团队任务列表");
    const blocks = screen.getAllByLabelText("团队任务");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.textContent).toContain("运行中");
    expect(blocks[1]!.textContent).toContain("已完成");
    expect(list).toBeInTheDocument();

    // 活跃 chip：👥 团队进行中 · 2 分身（活跃 mission 的分身计数）。
    const chip = await screen.findByTestId("team-active-chip");
    expect(chip.textContent).toContain("团队进行中 · 2 分身");

    // ql-20260828-009-4a13：× 真取消——调 cancelTeamMission(活跃 mission id) +
    // 刷新后 mission 终态 → chip 消失（原「仅收起提示条」语义下线，任务块仍在）。
    const chipClose = screen.getByLabelText("取消团队任务");
    fireEvent.mouseDown(chipClose);
    fireEvent.click(chipClose);
    await waitFor(() =>
      expect(sessionApi.cancelTeamMission).toHaveBeenCalledWith("m-run"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("team-active-chip")).not.toBeInTheDocument(),
    );
  });

  it("chip 主体点击 → 打开弹层更新指派（hasActiveMission 提示 + 确认先取消再派）", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-run", "running", [makeWorker("w-1", "running")]),
    ]);
    sessionApi.cancelTeamMission.mockResolvedValue(undefined);
    sessionApi.triggerSessionTeamMission.mockResolvedValue({
      mission_id: "m-new",
    });
    // workspaceId 必传——缺省时弹层 scopeMode 落项目维度，空项目确认被校验拦。
    setupDialog({ workspaceId: "11111111-2222-3333-4444-555555555555" });

    const chip = await screen.findByTestId("team-active-chip");
    // 点击 chip 文本主体 → 弹层打开（含更新指派提示行）。
    fireEvent.click(screen.getByRole("button", { name: "团队进行中 · 1 分身" }));
    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect(
      screen.getByText(/已有进行中的团队任务：确认后将取消当前任务并按本次配置重新指派/),
    ).toBeInTheDocument();

    // 填目标确认 → 先 cancel(旧 mission) 再 trigger（更新指派语义），顺序断言。
    fireEvent.change(screen.getByLabelText(/^目标/), {
      target: { value: OBJECTIVE },
    });
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    await waitFor(() =>
      expect(sessionApi.cancelTeamMission).toHaveBeenCalledWith("m-run"),
    );
    await waitFor(() =>
      expect(sessionApi.triggerSessionTeamMission).toHaveBeenCalledTimes(1),
    );
    const cancelOrder = sessionApi.cancelTeamMission.mock.invocationCallOrder[0]!;
    const triggerOrder =
      sessionApi.triggerSessionTeamMission.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(triggerOrder);
  });

  it("无活跃 mission（全部终态）→ 不显示 chip", async () => {
    sessionApi.listSessionTeamMissions.mockResolvedValue([
      makeMission("m-done", "done", [makeWorker("w-1", "completed")]),
    ]);
    setupDialog();
    await openActivityCatalog();
    expect(screen.queryByTestId("team-active-chip")).not.toBeInTheDocument();
  });
});

/* ───────── 4. page 模式：引擎门控 + /team 拦截（独立代码路径） ───────── */

describe("SessionPanel page 模式团队入口", () => {
  function setupPage(provider: string) {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail(provider));
    sessionApi.listSessionRuns.mockResolvedValue([]);
    workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <SessionPanel
          mode="page"
          sessionId="sess-team"
          machines={[]}
          llmProviders={[]}
        />
      </QueryClientProvider>,
    );
  }

  it("claude 会话（session.provider）：按钮可用", async () => {
    setupPage("claude");
    const btn = await findTeamMenuItem();
    expect(btn.disabled).toBe(false);
  });

  it("codex 会话（session.provider）：按钮置灰 + tooltip「团队需要 Claude 引擎」", async () => {
    setupPage("codex");
    const btn = await findTeamMenuItem();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("团队需要 Claude 引擎");
  });

  it("/team 前缀拦截：弹层打开 + 不入队不 inject", async () => {
    setupPage("claude");
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect((screen.getByLabelText(/^目标/) as HTMLInputElement).value).toBe(
      OBJECTIVE,
    );
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/排队消息/)).not.toBeInTheDocument();
  });
});

/* ───────── 5. task-14：分身行点击 → 浮层复用 SessionPanel 打开子会话 ───────── */

describe("SessionPanel task-14 分身会话浮层（FR-08 / design §5.E）", () => {
  const SUB_SESSION_ID = "sub-worker-1";

  /**
   * 主控会话（sess-team）返回带 sub_session_id 分身行的活跃 mission；分身
   * 子会话（sub-worker-1）非 mission 锚定会话，列表恒空（后端按
   * AgentMission.session_id 直查）——嵌套浮层不会再渲染团队块，无递归嵌套。
   */
  function mockMissionsWithSubSession() {
    sessionApi.listSessionTeamMissions.mockImplementation(async (sid: string) =>
      sid === "sess-team"
        ? [
            makeMission("m-run", "running", [
              makeWorker("w-1", "running", SUB_SESSION_ID),
            ]),
          ]
        : [],
    );
  }

  /** 展开团队块并点击子会话形态分身行（触发 onOpenWorkerSession 上抛）。
   *  ql-20260826-010：块收编进头部下拉，先展开「后台」目录再进块。 */
  async function openWorkerSessionOverlay() {
    await openActivityCatalog();
    fireEvent.click(await screen.findByText("展开 ▾"));
    fireEvent.click(
      screen.getByRole("button", { name: "查看分身会话：实现" }),
    );
    // 浮层出现（role=dialog「分身会话」）+ 头部短 id 标识（#sub-work…）。
    const overlay = await screen.findByRole("dialog", { name: "分身会话" });
    expect(screen.getByText(`#${SUB_SESSION_ID.slice(0, 8)}`)).toBeInTheDocument();
    return overlay;
  }

  it("dialog 模式：浮层复用 SessionPanel（attach 到 sub_session_id）→ 关闭还原主控面板", async () => {
    mockMissionsWithSubSession();
    setupDialog();

    await openWorkerSessionOverlay();

    // 嵌套 SessionPanel 以分身子会话 attach：轮询 getAgentSession 打到子会话 id
    //（实时流与追问全走面板既有链路，constraints：零新建面板/零复制）。
    await waitFor(() =>
      expect(sessionApi.getAgentSession).toHaveBeenCalledWith(SUB_SESSION_ID),
    );

    // 关闭浮层：返回主控——浮层卸载、主控团队列表 + 输入框原样保留（state 不丢；
    // ql-20260826-010 关闭按钮点击经 document 收起过下拉，重展开核对列表仍在）。
    fireEvent.click(screen.getByRole("button", { name: "关闭分身会话" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "分身会话" })).not.toBeInTheDocument(),
    );
    await openActivityCatalog();
    expect(
      screen.getByPlaceholderText(/消息将排队|继续追问/),
    ).toBeInTheDocument();
  });

  it("page 模式：分身行点击同样打开浮层（两渲染点等价接线）→ 关闭还原", async () => {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail("claude"));
    sessionApi.listSessionRuns.mockResolvedValue([]);
    workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
    mockMissionsWithSubSession();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel
          mode="page"
          sessionId="sess-team"
          machines={[]}
          llmProviders={[]}
        />
      </QueryClientProvider>,
    );

    await openWorkerSessionOverlay();
    await waitFor(() =>
      expect(sessionApi.getAgentSession).toHaveBeenCalledWith(SUB_SESSION_ID),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭分身会话" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "分身会话" })).not.toBeInTheDocument(),
    );
    // 主控面板未卸载：团队列表（重展开下拉核对）+ 主输入仍在（流与输入状态不丢）。
    await openActivityCatalog();
    expect(screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/)).toBeInTheDocument();
  });
});

/* ───────── 6. task-07 Phase 5：page 模式预会话 autoTeamOpen 自动弹层（FR-06 / D-004@v2） ───────── */

/** 预会话形态：ppm_project 页面上下文 + 在线 claude runtime（悬浮宿主同款接线）。
 * ql-20260828-011-1ec7 提升为文件级——待生效 chip describe 复用。 */
function setupPre(
  autoTeamOpen?: boolean,
  pageContext: Record<string, string> = {
    page_key: "ppm_project",
    project_id: "p-1",
  },
) {
  const machines = [
    {
      id: "m-1",
      status: "online",
      hostname: "m1-host",
      display_alias: null,
      runtimes: [{ id: "rt-1", status: "online", provider: "claude" }],
    },
  ] as never[];
  sessionApi.listSessionRuns.mockResolvedValue([]);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([
    { id: "p-1", project_name: "网站重构项目", project_code: "P-1" },
  ]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([
    { workspace_id: "ws-a", name: "sillyspec", status: "active", type: "backend-code" },
  ]);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId={null}
        machines={machines}
        llmProviders={[]}
        preContext={{
          workspaceId: null,
          runtimeId: "rt-1",
          pageContext: pageContext as never,
        }}
        autoTeamOpen={autoTeamOpen}
      />
    </QueryClientProvider>,
  );
}

describe("SessionPanel page 模式 autoTeamOpen 自动开弹层（预会话）", () => {
  it("autoTeamOpen：预会话挂载即自动开弹层（无需点击）+ objective 预填项目名句式 + 项目预选", async () => {
    workspaceApi.getProject.mockResolvedValue({
      project_name: "网站重构项目",
      project_code: "P-1",
    });
    setupPre(true);

    // 弹层自动打开（全程零点击）。
    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    // objective 预填「分析项目 X 当前迭代风险并给出建议」句式（弹层内可修改）。
    const objInput = screen.getByLabelText(/^目标/) as HTMLInputElement;
    expect(objInput.value).toBe("分析项目 网站重构项目 当前迭代风险并给出建议");
    // defaultProjectId 从 ppm_project 页面上下文派生：项目预选 + 工作区自动预选
    //（预选后 anchor 胶囊同名展示，直接对 checkbox 断言避免文本多命中）。
    const select = (await screen.findByLabelText(
      /选择项目/,
    )) as HTMLSelectElement;
    expect(select.value).toBe("p-1");
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /勾选工作区 sillyspec/ }),
      ).toBeChecked(),
    );
  });

  it("不传 autoTeamOpen：预会话不自动开弹层（零回归）", async () => {
    setupPre(undefined);
    expect(
      await screen.findByTestId("session-pre-session-panel"),
    ).toBeInTheDocument();
    expect(screen.queryByText("派团队做这件事")).not.toBeInTheDocument();
  });

  it("项目名解析失败 → 空目标降级，弹层照开", async () => {
    workspaceApi.getProject.mockRejectedValue(new Error("project down"));
    setupPre(true);

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    const objInput = screen.getByLabelText(/^目标/) as HTMLInputElement;
    expect(objInput.value).toBe("");
  });
});

/* ───────── 7. ql-20260828-011-1ec7：预会话待生效 chip（配置反馈 + 放弃） ───────── */

describe("SessionPanel page 模式预会话待生效 chip（ql-20260828-011-1ec7）", () => {
  it("弹层确认 → 待生效 chip 出现（虚线样式语义：已配置待随首句生效）+ 输入框回填 /team", async () => {
    workspaceApi.getProject.mockResolvedValue({
      project_name: "网站重构项目",
      project_code: "P-1",
    });
    setupPre(true);

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    // 等 scope 自动预选完成（defaultProjectId → 关联工作区预勾选）再确认，
    // 否则项目维度「至少一个工作区」校验拦截 onTrigger。
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /勾选工作区 sillyspec/ }),
      ).toBeChecked(),
    );
    // 确认前无 chip。
    expect(screen.queryByTestId("team-pending-chip")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    );

    // 确认后：待生效 chip + 输入框回填 /team 前缀（预会话主输入框，唯一 textbox）。
    const chip = await screen.findByTestId("team-pending-chip");
    expect(chip.textContent).toContain("团队已配置 · 随首句创建生效");
    const input = (await screen.findByRole(
      "textbox",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toContain("/team"));
  });

  it("待生效 chip × → 放弃配置（chip 消失 + /team 回填清空）+ 首句不带 team_mission", async () => {
    workspaceApi.getProject.mockResolvedValue({
      project_name: "网站重构项目",
      project_code: "P-1",
    });
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-pre",
      run_id: "run-1",
      lease_id: "l",
      status: "active",
      stream_url: "",
    });
    setupPre(true);

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /勾选工作区 sillyspec/ }),
      ).toBeChecked(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    );
    expect(await screen.findByTestId("team-pending-chip")).toBeInTheDocument();

    // × 放弃：chip 消失，回填的 /team 输入一并清空。
    fireEvent.click(screen.getByLabelText("放弃团队配置"));
    await waitFor(() =>
      expect(screen.queryByTestId("team-pending-chip")).not.toBeInTheDocument(),
    );

    // 首句照发：createSession 不携带 team_mission（配置已放弃）。
    const input = (await screen.findByRole(
      "textbox",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe(""));
    fireEvent.change(input, { target: { value: "普通首句" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() =>
      expect(sessionApi.createSession).toHaveBeenCalledTimes(1),
    );
    const createArg = sessionApi.createSession.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(createArg.team_mission).toBeUndefined();
  });
});
