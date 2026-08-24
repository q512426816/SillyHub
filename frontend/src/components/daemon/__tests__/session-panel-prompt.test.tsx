// ql-20260824-004：/sessions 页（SessionPanel page 模式）live 发送占位轮 prompt
// 前导换行回归。
//
// 缺陷（61a1b709 引入，仅 page 模式 sendFromQueue / handleSend 两处；dialog 模式
// submitFollowup 原样传 prompt 不受影响）：displayPrompt 拼接 `${markerLines}\n
// ${prompt}` 在无附件（markerLines 空串）时产出 "\n正文"；TurnTimeline 用户气泡
// whitespace-pre-wrap 原样渲染 → 用户文字上方出现空行。后端落库口径无此前缀
// （仅附件存在时拼标记行，service.py inject），SSE user_input 又被忽略不回填
// （session-panel.tsx onLog 分支）——空行只在 live 占位轮存在，刷新重挂载后
// 消失，故以 page 模式组件级断言锚定。
//
// 覆盖：
//   - joinAttachmentMarkers 纯函数三态（无附件 / 标记+正文 / 仅标记）
//   - page 模式组件级：追问发送后气泡原始 textContent 不以换行开头

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import { joinAttachmentMarkers } from "../runtime-session-helpers";
import type {
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（骨架平移 session-panel-pre-session.test.tsx，page 模式） ----- */

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

// page 模式 chrome（SessionConfigBar）数据 hook：无网络，空数据。
vi.mock("@/lib/errors", () => ({
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

/** 真会话详情（active 空闲，sessionId 匹配挂载参）。 */
function makeDetail() {
  return {
    id: "sess-1",
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
    title: "回归会话",
    config_snapshot: null,
  };
}

function setupPage() {
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
  sessionApi.injectSession.mockResolvedValue({
    session_id: "sess-1", run_id: "run-2", status: "active",
  });
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-1"
        machines={[makeMachine()]}
        llmProviders={[]}
      />
    </QueryClientProvider>,
  );
}

describe("joinAttachmentMarkers（ql-20260824-004）", () => {
  it("无附件：原样返回正文，不拼前导换行（回归锚点——旧拼接产出 \\n正文）", () => {
    expect(joinAttachmentMarkers("", "hello")).toBe("hello");
    expect(joinAttachmentMarkers("", "")).toBe("");
  });

  it("有附件：标记行 + 单换行 + 正文（对齐 backend inject 落库口径）", () => {
    const marker = "[附件:01234567-89ab-cdef-0123-456789abcdef|image|a.png]";
    expect(joinAttachmentMarkers(marker, "看图")).toBe(`${marker}\n看图`);
  });

  it("仅有附件无正文：只返回标记行（看图说话，空文本场景）", () => {
    const marker = "[附件:01234567-89ab-cdef-0123-456789abcdef|file|a.txt]";
    expect(joinAttachmentMarkers(marker, "")).toBe(marker);
  });
});

describe("SessionPanel（page 模式）占位轮气泡无前导空行（ql-20260824-004）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无附件追问：占位轮气泡 textContent 以正文开头（不渲染出上方空行）", async () => {
    const { container } = setupPage();

    // detailQuery 就绪 → active 空闲输入框（继续追问 placeholder）
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.click(screen.getByTitle("发送"));

    // 队列立即投递（active 无 currentRun），page 模式 sendFromQueue 建占位轮
    // （第三参为附件 opts 展开产物，无附件 = 空对象，不在此断言形状）
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession.mock.calls[0]?.slice(0, 2)).toEqual(["sess-1", "second"]);

    // 占位轮气泡（whitespace-pre-wrap 文本节点）已渲染，且正文前无换行——
    // 旧代码此处为 "\nsecond"（气泡内文字上方空一行）。
    const bubbles = container.querySelectorAll(".whitespace-pre-wrap");
    expect(bubbles.length).toBeGreaterThan(0);
    const texts = [...bubbles].map((b) => b.textContent ?? "");
    expect(texts).toContain("second");
    for (const t of texts) {
      expect(t.startsWith("\n")).toBe(false);
    }
  });
});
