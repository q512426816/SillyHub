// task-01（2026-09-13-session-group-ux-fixes / FR-1 / D-001）：预会话草稿按
// 入口隔离的回归锚点。
//
// 背景：预会话（sessionId=null）草稿原固定键 __pre__ 跨工作区/跨机器入口共享，
// 任一入口未发送内容必然带入下一入口（用户实测「a 会话内容带到 b 会话」的
// 根因定位，design 背景 1）。真会话草稿按 sessionId 隔离（七宿主 key 重挂载），
// 理论正确——本文件同时锁定其切换时序行为（design R-01：若用户复现真会话
// 串台，凭此基线再定位，不在本 task 范围内改真会话系统）。
//
// 覆盖（task-01 acceptance）：
//   1. turn-state 纯函数三分支：真会话键（preScope 被忽略）/ 预会话 + preScope
//      入口键 __pre__:<scope> / 均无回落共享键 __pre__（旧调用点兼容）。
//   2. page 真会话切换时序锁定：A 输入 → 切 B → B 显示自有草稿、A 的键不被
//      B 的写入污染（含 B 有既有草稿的换装断言）。
//   3. page 预会话两入口隔离：不同 preScope 键互不可见；同 scope 重进恢复；
//      workspaceId null 用 '-' 分量组装。
//   4. dialog 预会话 workspaceId 维度 scope（无 runtime 维度；未传回落 '-'）。
//
// mock 骨架平移 session-panel-pre-session.test.tsx（page 段）与
// session-panel-dialog.test.tsx（dialog 段）；草稿落键断言直接读 localStorage
// （键组装是本变更的被测行为本体）。门闩时序：draftHydratedRef 经 rAF 放行，
// 输入前先 nextFrame() 等一帧，否则写入被门闩拦截（组件内 ql-20260825-011 设计）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  SessionPanel, type SessionPanelProps, type SessionPreContext,
} from "../session-panel";
import { readSessionDraft, writeSessionDraft } from "../session-panel/turn-state";
import { useMentionSources } from "@/lib/session-mention-sources";
import type {
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

// @ 联想数据源 hook mock——textarea 首次聚焦才挂载数据桥，change 不聚焦零影响；
// dialog 测试无 QueryClientProvider，真实 hook 会因缺 QueryClient 抛错，必须 mock。
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

/* ----- mock 网络层（page/dialog 两模式共享的面取并集） ----- */

const sessionApi = vi.hoisted(() => ({
  // 会话用量条（session-usage-bar）自取数：必须 resolve（裸 vi.fn() 返回
  // undefined 会被组件 .then 同步崩）；null = 按无数据不渲染。
  getSessionUsage: vi.fn().mockResolvedValue(null),
  listScheduledMessages: vi.fn().mockResolvedValue([]),
  fetchSessionQueue: vi.fn().mockResolvedValue([]),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
  listSessionRuns: vi.fn().mockResolvedValue([]),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
    listScheduledMessages: sessionApi.listScheduledMessages,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
    listSessionRuns: sessionApi.listSessionRuns,
    listSessionTasks: sessionApi.listSessionTasks,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
  };
});

// page 模式 workspacesQuery（工作区名解析）+ 弹层项目下拉两数据源。
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

// 弹层 probe 数据源（POST /api/workspaces/probe）：默认空响应（fail-safe）。
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// useNotify mock（测试环境无 antd App 包裹，先例 config-bar.test 注释）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return {
    ...actual,
    useNotify: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  };
});

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

/* ----- fixture（平移 session-panel-pre-session.test.tsx） ----- */

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

function makeMachine(overrides: Partial<DaemonMachineRead> = {}): DaemonMachineRead {
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

/** 真会话详情（active 空闲；id 由 setupPage 按挂载 sessionId 覆写）。 */
function makeDetail() {
  return {
    id: "sess-x",
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
    title: "草稿隔离会话",
    config_snapshot: null,
  };
}

/** 草稿 localStorage 键（直读断言用；组装逻辑本体在 turn-state.sessionDraftLsKey）。 */
const DRAFT_KEY = (k: string) => `sillyhub.sessions.draft.${k}`;

/** 等一帧：草稿门闩 draftHydratedRef 经 rAF 放行——先于帧输入会因门闩未开丢写。 */
async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** page 模式挂载（rerenderWith 切换 sessionId；preContext 全程不变）。 */
function setupPage(
  overrides: {
    sessionId?: string | null;
    preContext?: SessionPreContext | null;
  } = {},
) {
  sessionApi.getAgentSession.mockImplementation(async (id: string) => ({
    ...makeDetail(),
    id,
  }));
  sessionApi.getAgentSessionLogs.mockResolvedValue([]);
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  apiFetchMock.mockResolvedValue([]);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (sid: string | null, preCtx: SessionPreContext | null) => (
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId={sid}
        machines={[makeMachine()]}
        llmProviders={[]}
        preContext={preCtx ?? undefined}
      />
    </QueryClientProvider>
  );
  const preContext = overrides.preContext ?? null;
  const result = render(view(overrides.sessionId ?? null, preContext));
  return {
    ...result,
    rerenderWith: (sid: string | null) => result.rerender(view(sid, preContext)),
  };
}

/** dialog 模式挂载（idle：sessionId=null；workspaceId 经 overrides 传入）。 */
function setupDialog(overrides: Partial<Omit<SessionPanelProps, "mode" | "sessionId">> = {}) {
  const props: Omit<SessionPanelProps, "mode" | "sessionId"> = {
    providers: ["claude"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<SessionPanel mode="dialog" sessionId={null} {...props} />);
}

beforeEach(() => {
  // 联想数据源默认空快照（不聚焦零影响；dialog 段防缺 QueryClient 抛错）。
  mentionSourcesMock.mockReturnValue({
    skills: [],
    changes: [],
    quicklogs: [],
    ppmTasks: [],
    ppmProblems: [],
    atEnabled: true,
  });
  // 草稿键跨测试隔离（本文件断言的本体就是 localStorage 键分布）。
  window.localStorage.clear();
});

/* ───────── 1. turn-state 纯函数：键组装三分支（D-001） ───────── */

describe("turn-state 草稿键组装（task-01 / D-001 三分支）", () => {
  it("真会话：键按 sessionId 组装，preScope 被忽略（真会话隔离零回归）", () => {
    writeSessionDraft("sess-1", "真会话草稿", "ws-1:rt-claude");
    expect(window.localStorage.getItem(DRAFT_KEY("sess-1"))).toBe("真会话草稿");
    // preScope 不渗入任何 __pre__ 系键（真会话下传 scope 不改变落键）。
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-1:rt-claude"))).toBeNull();
    expect(readSessionDraft("sess-1", "ws-9:rt-x")).toBe("真会话草稿");
  });

  it("预会话 + preScope：入口隔离键 __pre__:<scope>，不同 scope 互不可见", () => {
    writeSessionDraft(null, "入口一草稿", "ws-1:rt-claude");
    writeSessionDraft(null, "入口二草稿", "-:rt-claude"); // workspaceId null → '-'
    expect(readSessionDraft(null, "ws-1:rt-claude")).toBe("入口一草稿");
    expect(readSessionDraft(null, "-:rt-claude")).toBe("入口二草稿");
    // 键格式直读锁定（page 组装口径 "<workspaceId|'-'>:<runtimeId>"，消费兼容锚点）。
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-1:rt-claude"))).toBe(
      "入口一草稿",
    );
  });

  it("预会话无 preScope：回落共享键 __pre__（未传参旧调用点行为兼容）", () => {
    writeSessionDraft(null, "共享草稿");
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__"))).toBe("共享草稿");
    expect(readSessionDraft(null)).toBe("共享草稿");
  });
});

/* ───────── 2. page 真会话切换时序锁定（design R-01 基线） ───────── */

describe("page 真会话草稿切换时序（R-01 基线锁定）", () => {
  it("A 输入草稿 → 切 B：B 显示自有草稿，A 的键不被 B 的写入污染", async () => {
    // 预置 B 的既有草稿（切换后应原样换装显示，而非 A 的内容）。
    window.localStorage.setItem(DRAFT_KEY("sess-b"), "B 的旧草稿");
    const { rerenderWith } = setupPage({ sessionId: "sess-a" });

    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    await nextFrame(); // 门闩放行后再输入，写入才生效
    fireEvent.change(input, { target: { value: "A 的未发送草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("sess-a"))).toBe("A 的未发送草稿"),
    );

    // 切到 B：输入框换装 B 自有草稿（不显示 A 的内容）。切会话后 detailQuery
    // 重新加载会重挂输入区——重新查询节点，不复用切换前的 DOM 引用。
    rerenderWith("sess-b");
    const inputB = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(inputB.value).toBe("B 的旧草稿"));
    // A 的键原样保留（未被切换时的回读/B 的后续输入冲掉）。
    expect(window.localStorage.getItem(DRAFT_KEY("sess-a"))).toBe("A 的未发送草稿");

    // B 输入新内容只写 B 的键——A 键仍不被污染。
    await nextFrame();
    fireEvent.change(inputB, { target: { value: "B 的新草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("sess-b"))).toBe("B 的新草稿"),
    );
    expect(window.localStorage.getItem(DRAFT_KEY("sess-a"))).toBe("A 的未发送草稿");
  });
});

/* ───────── 3. page 预会话两入口隔离（task-01 核心） ───────── */

describe("page 预会话草稿入口隔离（task-01 / D-001）", () => {
  it("入口一输入 → 换入口二（宿主重挂载）：二看不到一的草稿，一键原样保留", async () => {
    const first = setupPage({
      preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" },
    });
    const input1 = screen.getByPlaceholderText(
      /发送第一句话开始对话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    await nextFrame();
    fireEvent.change(input1, { target: { value: "入口一的未发送草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-1:rt-claude"))).toBe(
        "入口一的未发送草稿",
      ),
    );
    // 固定 __pre__ 共享键不再被写（隔离生效的直接证据——旧行为落此键）。
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__"))).toBeNull();
    first.unmount();

    // 入口二（不同工作区 + 不同 runtime）全新挂载：回读自己的键 → 空。
    setupPage({
      preContext: { workspaceId: "ws-2", runtimeId: "rt-codex" },
    });
    const input2 = (await screen.findByPlaceholderText(
      /发送第一句话开始对话/,
    )) as HTMLTextAreaElement;
    expect(input2.value).toBe("");
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-1:rt-claude"))).toBe(
      "入口一的未发送草稿",
    );
  });

  it("同一入口重进：草稿恢复到输入框", async () => {
    window.localStorage.setItem(DRAFT_KEY("__pre__:ws-1:rt-claude"), "重进应恢复");
    setupPage({ preContext: { workspaceId: "ws-1", runtimeId: "rt-claude" } });
    const input = (await screen.findByPlaceholderText(
      /发送第一句话开始对话/,
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("重进应恢复"));
  });

  it("workspaceId null 的入口：scope 用 '-' 分量组装（与具名工作区入口隔离）", async () => {
    setupPage({ preContext: { workspaceId: null, runtimeId: "rt-claude" } });
    const input = screen.getByPlaceholderText(
      /发送第一句话开始对话/,
    ) as HTMLTextAreaElement;
    await nextFrame();
    fireEvent.change(input, { target: { value: "非工作区入口草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("__pre__:-:rt-claude"))).toBe(
        "非工作区入口草稿",
      ),
    );
  });
});

/* ───────── 4. dialog 预会话 workspaceId 维度 scope（无 runtime 维度） ───────── */

describe("dialog 预会话草稿 scope（task-01 / D-001）", () => {
  it("idle + workspaceId：草稿落 __pre__:<workspaceId>；不同 workspaceId 互不可见", async () => {
    const first = setupDialog({ workspaceId: "ws-d1" });
    const input1 = screen.getByPlaceholderText(
      /输入首条消息创建会话.*\/ 唤起技能 · @ 关联变更/,
    ) as HTMLTextAreaElement;
    await nextFrame();
    fireEvent.change(input1, { target: { value: "dialog 一的草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-d1"))).toBe(
        "dialog 一的草稿",
      ),
    );
    first.unmount();

    // 另一 workspaceId 的 dialog：看不到一的草稿，一键原样保留。
    setupDialog({ workspaceId: "ws-d2" });
    const input2 = (await screen.findByPlaceholderText(
      /输入首条消息创建会话/,
    )) as HTMLTextAreaElement;
    expect(input2.value).toBe("");
    expect(window.localStorage.getItem(DRAFT_KEY("__pre__:ws-d1"))).toBe(
      "dialog 一的草稿",
    );
  });

  it("idle 未传 workspaceId：回落 '-' 维度键（同一消费方内部共享）", async () => {
    setupDialog();
    const input = screen.getByPlaceholderText(
      /输入首条消息创建会话/,
    ) as HTMLTextAreaElement;
    await nextFrame();
    fireEvent.change(input, { target: { value: "无工作区 dialog 草稿" } });
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY("__pre__:-"))).toBe(
        "无工作区 dialog 草稿",
      ),
    );
  });

  it("同 workspaceId 重开 dialog：草稿恢复到输入框", async () => {
    window.localStorage.setItem(DRAFT_KEY("__pre__:ws-d1"), "dialog 重进恢复");
    setupDialog({ workspaceId: "ws-d1" });
    const input = (await screen.findByPlaceholderText(
      /输入首条消息创建会话/,
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("dialog 重进恢复"));
  });
});
