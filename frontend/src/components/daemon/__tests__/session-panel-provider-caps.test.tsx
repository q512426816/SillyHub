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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  listSessionRuns: vi.fn(),
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

/* ----- fixture ----- */

const OBJECTIVE = "收敛门控两态对照目标文本";

/** attach 详情（dialog 轮询 / page detailQuery 共用形状，同 team 测试）。 */
function makeDetail(provider: string) {
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
