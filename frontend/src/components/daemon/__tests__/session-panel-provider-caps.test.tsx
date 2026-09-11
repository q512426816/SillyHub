// provider-abstraction task-11（2026-09-03-agent-provider-abstraction / FR-06 /
// D-002@v1）：provider 门控收敛查表后的**行为不变**断言（纯重构验收）。
//
// session-panel.tsx 内原散落的引擎字面量门控（=== / !== "claude"）已收敛为
// getProviderCaps(provider).multimodal / .subagent 查表；本文件对每个收敛门控
// 点做 **claude 态 vs codex 态** 两态渲染对照——断言与改造前硬编码逐一相等：
//   1. 附件门控（multimodal）：dialog（provider state）/ page（session.provider）
//      / page 预会话（runtime provider）三个信息源；codex 态禁用 + 「当前引擎
//      不支持附件」，claude 态可用（dialog idle 首句门控保留 title
//      「发送首条消息创建会话后可添加附件」）；
//   2. 团队派工门控（subagent）：同三信息源；codex 态置灰 +
//      「团队需要 Claude 引擎」，claude 态可用；
//   3. /team 前缀拦截（subagent）：claude 态拦截弹层（不发送），codex 态
//      原样发送（inject 收到含 /team 前缀的原始文本）。
//
// mock 结构沿用 session-panel-team.test.tsx（lib/daemon 会话 API + workspaces
// /ppm 数据源 + page chrome hook），断言口径同源（menuitem / placeholder 正则，
// 避开 antd 中文 autoLetterSpacing 拆分坑）。
//
// 2026-09-11-session-provider-switch-codex-pi task-07（FR-03 / D-002@v1）：补
// 错误卡「切换供应商」按钮门禁矩阵——page 模式失败轮（logs 建 turn + runs 快照
// 回补 errorDetail）上点 RunErrorItem 主操作，断言 timelineOnSwitchProvider 的
// PROVIDER_SWITCH_ENGINES 白名单行为：claude/codex/pi 放行（定位配置条打开供应
// 商下拉 config-dd-provider）；cursor/未知 provider 弹引擎中性文案「当前引擎不
// 支持会话级供应商切换」；provider 空（null 前置语义）不拦截。toast 走 useNotify
// （App.useApp 上下文，测试环境无 antd App 包裹）——partial mock useNotify 断言
// warning（先例 session-panel-pre-session.test.tsx）。

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import { getProviderCaps } from "@/lib/provider-caps";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 session-panel-team.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（同 team 测试） ----- */

const sessionApi = vi.hoisted(() => ({
  // 会话用量条（session-usage-bar）自取数：必须 resolve（裸 vi.fn() 返回
  // undefined 会被组件 .then 同步崩）；null = 按无数据不渲染。
  getSessionUsage: vi.fn().mockResolvedValue(null),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  // 任务执行面板挂载即取数（task-10 惰性闸门移除）：runs/tasks 都必须 resolve
  //（裸 vi.fn() 返回 undefined 会被面板 .then 同步崩）。
  listSessionRuns: vi.fn().mockResolvedValue([]),
  listSessionTasks: vi.fn().mockResolvedValue([]),  // 任务执行面板快照（task-10 补 mock 防真实 fetch）
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  cancelTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
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
    listSessionTasks: sessionApi.listSessionTasks,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    cancelTeamMission: sessionApi.cancelTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

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

// task-07：门禁矩阵的「弹警告」断言出口——useNotify 走 App.useApp 上下文，
// 测试环境无 antd App 包裹，partial mock 成可断言 vi.fn（errMessage 等其余导出
// 保留真实，先例 session-panel-pre-session.test.tsx）。
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return { ...actual, useNotify: () => notifyMock };
});

/* ----- fixture ----- */

const OBJECTIVE = "收敛门控两态对照目标文本";

/** attach 详情（dialog 轮询 / page detailQuery 共用形状，同 team 测试）。 */
function makeDetail(provider: string | null) {
  return {
    id: "sess-caps",
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
    title: "门控对照会话",
    config_snapshot: null,
  };
}

/**
 * ql-20260827-020：📎 / 派团队入口均在 ＋ 功能菜单——先开菜单再取 menuitem
 *（fireEvent.click 不触发 document mousedown，菜单保持打开）。
 */
async function openPlusMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "更多功能" }));
}

/** 取「附件」菜单项（＋ 菜单内）。 */
async function findAttachmentItem(): Promise<HTMLButtonElement> {
  return (await screen.findByRole("menuitem", { name: /^附件/ })) as HTMLButtonElement;
}

/** 取「派团队」菜单项（＋ 菜单内）。 */
async function findTeamItem(): Promise<HTMLButtonElement> {
  return (await screen.findByRole("menuitem", { name: /^派团队/ })) as HTMLButtonElement;
}

function setupDialog(overrides: Record<string, unknown> = {}) {
  const props = {
    mode: "dialog" as const,
    sessionId: "sess-caps",
    providers: ["claude"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel {...(props as any)} />
    </QueryClientProvider>,
  );
}

function setupPage(provider: string) {
  sessionApi.getAgentSession.mockResolvedValue(makeDetail(provider));
  sessionApi.listSessionRuns.mockResolvedValue([]);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel mode="page" sessionId="sess-caps" machines={[]} llmProviders={[]} />
    </QueryClientProvider>,
  );
}

/** page 预会话（同 team 测试 setupPre 简化版）：runtime provider 即引擎信息源。 */
function setupPre(provider: "claude" | "codex") {
  const machines = [
    {
      id: "m-1",
      status: "online",
      hostname: "m1-host",
      display_alias: null,
      runtimes: [{ id: "rt-1", status: "online", provider }],
    },
  ] as never[];
  sessionApi.listSessionRuns.mockResolvedValue([]);
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
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
        preContext={{ workspaceId: null, runtimeId: "rt-1" }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.getAgentSession.mockResolvedValue(makeDetail("claude"));
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.triggerSessionTeamMission.mockResolvedValue({
    mission_id: "m-caps",
    status: "planning",
    objective: null,
    scope_workspace_ids: [],
    budget_usd: null,
    workers: [],
  });
  sessionApi.injectSession.mockResolvedValue({
    session_id: "sess-caps",
    run_id: "run-2",
    status: "active",
  });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  workspaceApi.getProject.mockRejectedValue(new Error("no project"));
});

/* ───────── 0. 查表真值前置（两态对照依赖的表值快照） ───────── */

describe("ProviderCaps 表值（两态对照的前置事实，task-02 镜像）", () => {
  it("claude：multimodal / subagent 均支持；codex：均不支持——与原硬编码门控逐一相等", () => {
    // 原 session-panel 硬编码：=== "claude"（门控开）↔ caps true；
    // !== "claude"（门控关）↔ caps false。空/未知引擎全 false 默认拒绝。
    expect(getProviderCaps("claude").multimodal).toBe(true);
    expect(getProviderCaps("claude").subagent).toBe(true);
    expect(getProviderCaps("codex").multimodal).toBe(false);
    expect(getProviderCaps("codex").subagent).toBe(false);
    expect(getProviderCaps("").multimodal).toBe(false);
    expect(getProviderCaps("").subagent).toBe(false);
  });

  // 2026-09-09-askuser-pi-cursor task-12（FR-06）：dialog string 枚举键两态对照
  // ——native 走平台 dialog 管道（渲染 AskUserDialogCard）、marker 走纯前端
  // 标记协议（AskUserMarkerCard，不经后端管道）；未知 provider 回退 'none'
  //（R-09）。pi permission_dialog 同波随 Wave A 桥接翻真。
  it("dialog 键两态对照：pi=native / cursor=marker；claude/codex=native；未知回退 none；pi permission_dialog=true", () => {
    expect(getProviderCaps("pi").dialog).toBe("native");
    expect(getProviderCaps("cursor").dialog).toBe("marker");
    expect(getProviderCaps("claude").dialog).toBe("native");
    expect(getProviderCaps("codex").dialog).toBe("native");
    expect(getProviderCaps("").dialog).toBe("none");
    expect(getProviderCaps("pi").permission_dialog).toBe(true);
  });
});

/* ───────── 1. dialog 模式（provider state 信息源） ───────── */

describe("dialog 模式门控两态对照（task-11 收敛点：attachmentsDisabled / title / teamEngineOk / 拦截）", () => {
  it("附件门控 multimodal：claude idle 态 title 走「首条消息」分支（caps.multimodal && !sessionId）", async () => {
    setupDialog({ sessionId: null });
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(true);
    expect(clip.title).toBe("发送首条消息创建会话后可添加附件");
  });

  it("附件门控 multimodal：codex 态禁用 + 默认 title「当前引擎不支持附件」（原 !== claude → title undefined）", async () => {
    setupDialog({ sessionId: null, providers: ["codex"], defaultProvider: "codex" });
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(true);
    expect(clip.title).toBe("当前引擎不支持附件");
  });

  it("附件门控 multimodal：claude attach 态可用（title 为添加说明，非禁用原因）", async () => {
    setupDialog();
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(false);
    expect(clip.title).not.toBe("当前引擎不支持附件");
  });

  it("团队门控 subagent：claude 态（attach 活跃会话）菜单项可用——引擎门控不再叠加禁用", async () => {
    setupDialog();
    await openPlusMenu();
    const team = await findTeamItem();
    expect(team.disabled).toBe(false);
    expect(team.title).not.toBe("团队需要 Claude 引擎");
  });

  it("团队门控 subagent：codex 态置灰 + title「团队需要 Claude 引擎」（引擎门控优先于会话存在性展示）", async () => {
    setupDialog({ sessionId: null, providers: ["codex"], defaultProvider: "codex" });
    await openPlusMenu();
    const team = await findTeamItem();
    expect(team.disabled).toBe(true);
    expect(team.title).toBe("团队需要 Claude 引擎");
  });

  it("/team 拦截 subagent：claude attach 态拦截——弹层打开 + 不发送 + 输入清空", async () => {
    setupDialog();
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect((screen.getByLabelText(/^目标/) as HTMLInputElement).value).toBe(OBJECTIVE);
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("/team 拦截 subagent：codex attach 态不拦截——原样发送（inject 收到含前缀原文）", async () => {
    setupDialog({ providers: ["codex"], defaultProvider: "codex" });
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() =>
      expect(sessionApi.injectSession).toHaveBeenCalledTimes(1),
    );
    // dialog 追问路径 inject 不带第三参（page 模式才带附件 options）。
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-caps",
      `/team ${OBJECTIVE}`,
    );
    expect(screen.queryByText("派团队做这件事")).not.toBeInTheDocument();
  });
});

/* ───────── 2. page 模式（session.provider 信息源） ───────── */

describe("page 模式门控两态对照（task-11 收敛点：attachmentsDisabled / teamEngineOk / 拦截）", () => {
  it("附件门控 multimodal：claude 会话（session.provider）附件入口可用", async () => {
    setupPage("claude");
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(false);
  });

  it("附件门控 multimodal：codex 会话（session.provider）附件入口禁用 + 默认 title", async () => {
    setupPage("codex");
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(true);
    expect(clip.title).toBe("当前引擎不支持附件");
  });

  it("团队门控 subagent：claude 会话（session.provider）菜单项可用", async () => {
    setupPage("claude");
    await openPlusMenu();
    expect((await findTeamItem()).disabled).toBe(false);
  });

  it("团队门控 subagent：codex 会话（session.provider）菜单项置灰 + 「团队需要 Claude 引擎」", async () => {
    setupPage("codex");
    await openPlusMenu();
    const team = await findTeamItem();
    expect(team.disabled).toBe(true);
    expect(team.title).toBe("团队需要 Claude 引擎");
  });

  it("/team 拦截 subagent：claude 会话拦截——弹层打开 + 不 inject", async () => {
    setupPage("claude");
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    expect(await screen.findByText("派团队做这件事")).toBeInTheDocument();
    expect(sessionApi.injectSession).not.toHaveBeenCalled();
  });

  it("/team 拦截 subagent：codex 会话不拦截——原样发送（inject 收到含前缀原文）", async () => {
    setupPage("codex");
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `/team ${OBJECTIVE}` } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-caps",
      `/team ${OBJECTIVE}`,
      expect.anything(),
    );
    expect(screen.queryByText("派团队做这件事")).not.toBeInTheDocument();
  });
});

/* ───────── 3. page 预会话（runtime provider 信息源） ───────── */

describe("page 预会话门控两态对照（task-11 收敛点：preAttachmentsDisabled / preTeamEngineOk）", () => {
  it("claude runtime：附件 + 派团队入口均可用（首句建会话语义，无会话门控叠加）", async () => {
    setupPre("claude");
    await openPlusMenu();
    expect((await findAttachmentItem()).disabled).toBe(false);
    expect((await findTeamItem()).disabled).toBe(false);
  });

  it("codex runtime：附件禁用 + 「当前引擎不支持附件」；派团队置灰 + 「团队需要 Claude 引擎」", async () => {
    setupPre("codex");
    await openPlusMenu();
    const clip = await findAttachmentItem();
    expect(clip.disabled).toBe(true);
    expect(clip.title).toBe("当前引擎不支持附件");
    const team = await findTeamItem();
    expect(team.disabled).toBe(true);
    expect(team.title).toBe("团队需要 Claude 引擎");
  });
});

/* ───────── 4. 错误卡「切换供应商」门禁矩阵（task-07 / FR-03 / D-002@v1） ─────────
   page 模式失败轮：logs（logsToTurns 建轮）+ listSessionRuns 快照（failed +
   error_detail）→ enrichDisplayTurns 回补 errorDetail → RunErrorItem 渲染主操作
   「切换供应商」。点击经 timelineOnSwitchProvider 门禁（PROVIDER_SWITCH_ENGINES
   白名单 + session?.provider && 前置）：放行 = 递增 providerOpenSignal 定位配置
   条（SessionConfigBar 打开 config-dd-provider）；锁定 = 引擎中性警告文案。 */

describe("错误卡「切换供应商」门禁矩阵（task-07 / FR-03 / D-002@v1）", () => {
  beforeAll(() => {
    // jsdom 未实现 scrollIntoView——放行路径会滚动定位配置条（configBarWrapRef），
    // 挂 stub 防崩（不改 src，测试侧垫片）。
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterAll(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  /** page 模式挂载：provider 引擎会话 + 一条失败轮（错误卡可见）。 */
  function setupFailedPage(provider: string | null) {
    sessionApi.getAgentSession.mockResolvedValue(makeDetail(provider));
    sessionApi.getAgentSessionLogs.mockResolvedValue([
      {
        id: "log-1",
        run_id: "run-fail-1",
        timestamp: "2026-09-11T10:00:00Z",
        channel: "user_input",
        content_redacted: "帮我看下报错",
      },
    ]);
    // runs 快照：failed + error_detail（buildErrorLogItem）→ 失败轮错误卡。
    sessionApi.listSessionRuns.mockResolvedValue([
      {
        id: "run-fail-1",
        created_at: "2026-09-11T10:00:00Z",
        status: "failed",
        error_detail: {
          type: "timeout",
          code: null,
          message: "上游超时",
          retryable: true,
          hint: null,
          raw: null,
        },
      },
    ]);
    workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <SessionPanel mode="page" sessionId="sess-caps" machines={[]} llmProviders={[]} />
      </QueryClientProvider>,
    );
  }

  it("claude/codex/pi 放行：点错误卡「切换供应商」→ 定位配置条打开供应商下拉（config-dd-provider）", async () => {
    for (const provider of ["claude", "codex", "pi"] as const) {
      cleanup();
      setupFailedPage(provider);
      // 失败轮错误卡（logs + runs 快照异步到达）
      expect(await screen.findByText("运行失败")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "切换供应商" }),
      );
      expect(await screen.findByTestId("config-dd-provider")).toBeInTheDocument();
      expect(notifyMock.warning).not.toHaveBeenCalled();
    }
  });

  it("cursor/未知 provider 锁定：点错误卡 → 弹「当前引擎不支持会话级供应商切换」，不开下拉", async () => {
    for (const provider of ["cursor", "gemini-x"] as const) {
      cleanup();
      setupFailedPage(provider);
      fireEvent.click(
        await screen.findByRole("button", { name: "切换供应商" }),
      );
      await waitFor(() =>
        expect(notifyMock.warning).toHaveBeenCalledWith(
          "当前引擎不支持会话级供应商切换",
        ),
      );
      expect(screen.queryByTestId("config-dd-provider")).not.toBeInTheDocument();
    }
  });

  it("provider 空（未下发）不拦截：null 前置语义——点错误卡照常定位配置条开下拉", async () => {
    // provider null：门禁的 session?.provider && 前置直接放行；配置条引擎随
    // session.provider ?? null 为 null（provisional 同构）→ 不锁。
    setupFailedPage(null);
    fireEvent.click(await screen.findByRole("button", { name: "切换供应商" }));
    expect(await screen.findByTestId("config-dd-provider")).toBeInTheDocument();
    expect(notifyMock.warning).not.toHaveBeenCalled();
  });
});
