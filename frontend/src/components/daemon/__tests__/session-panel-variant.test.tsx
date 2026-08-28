// task-14（2026-08-26-mobile-workspace-page / FR-07 / FR-11 / R-01）：
// SessionPanel variant 变体单测——「不传 variant = desktop」回归锚 + mobile 渲染层
// 差异断言（design §5.4 SessionPanel 移动适配 / §7 variant 定义 / §10 R-01）。
//
// 覆盖：
//   1. 回归锚（FR-11 桌面零回归）：不传 variant（sessions 页/悬浮宿主等既有调用点
//      形态）时面板根/头部 className 与改前字面量**逐字一致**（字面量硬编码在本
//      文件，防源文件漂移自证）、#id 复制/后台目录等桌面 chrome 原位、无 ⋯ 菜单；
//      显式 variant="desktop" 与不传渲染一致（默认值归一）；
//   2. variant="mobile" 布局类生效：根容器满宽贴屏（去 rounded/border）+ 头部
//      padding 收敛 + data-variant 标记 + 会话主体外包横向滚动容器（表格等横向
//      内容不撑破竖屏视口）；
//   3. mobile 次要 chrome 收纳：#id 复制/后台目录移入 ⋯ 菜单（头部原位不存在、
//      点开「更多操作」后出现），核心操作（视图切换/打断）原位保留；
//   4. 逻辑零分叉（design §5.4）：variant 只影响渲染层——SSE 建流（streamSession）
//      入参与 variant 无关、发消息链路（injectSession）mobile 下照常可用；
//   5. 预会话空态（sessionId=null）mobile 根容器类同样生效（第四宿主预会话路径）。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（模板同 session-panel-team.test.tsx）；
// 断言用 aria-label/role 避开 antd 中文按钮 autoLetterSpacing 拆分坑。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionPanel } from "../session-panel";
import type { TeamMissionSummary } from "@/lib/daemon";

// MarkdownText 用 next/dynamic + ssr:false，jsdom 同步 render 处于 loading(null)——
// mock 成纯文本渲染（同 session-panel-team.test.tsx）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ----- mock 网络层（同 session-panel-team.test.tsx 模板） ----- */

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
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
  };
});

// page 模式 workspacesQuery（工作区名解析）+ TeamTriggerPopover 项目下拉数据源。
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

/* ----- 回归锚字面量（task-14 改动前的 desktop 原文，硬编码防源文件漂移自证） ----- */

const ROOT_CLS_DESKTOP =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card";
const HEADER_CLS_DESKTOP =
  "flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2";
const ROOT_CLS_MOBILE =
  "flex h-full min-h-0 w-full flex-col overflow-hidden bg-card";
const HEADER_CLS_MOBILE =
  "flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2";

/* ----- fixture ----- */

/** attach 详情（page detailQuery；provider=claude 使发消息/团队链路可用）。 */
function makeDetail() {
  return {
    id: "sess-variant",
    runtime_id: null,
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
    workspace_id: "ws-1",
    llm_provider_id: null,
    agent_profile_id: null,
    title: "变体会话",
    config_snapshot: null,
  };
}

/**
 * 历史日志（logsToTurns 按 run_id 分组产 1 个完成轮）——驱动头部视图切换
 * tablist 渲染（turnState.turns.length > 0 条件）与「核心操作原位保留」断言。
 */
function makeHistoryLogs() {
  return [
    {
      id: "log-1",
      run_id: "run-1",
      timestamp: "2026-08-26T10:00:00Z",
      channel: "user_input",
      content_redacted: "第一句",
    },
    {
      id: "log-2",
      run_id: "run-1",
      timestamp: "2026-08-26T10:00:01Z",
      channel: "stdout",
      content_redacted: "答复正文",
    },
  ];
}

function makeMission(): TeamMissionSummary {
  return {
    mission_id: "m-run",
    status: "running",
    objective: "目标-变体",
    scope_workspace_ids: [],
    budget_usd: null,
    workers: [
      { run_id: "w-1", role: "impl", status: "running", objective: "分工目标" },
    ],
  };
}

/** page 模式挂载（variant 缺省 = 既有调用点形态；传则显式声明）。 */
function setupPage(variant?: "desktop" | "mobile") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        mode="page"
        sessionId="sess-variant"
        machines={[]}
        llmProviders={[]}
        {...(variant ? { variant } : {})}
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
    created_at: "2026-08-26T10:00:00Z",
  });
  sessionApi.getAgentSession.mockResolvedValue(makeDetail());
  sessionApi.getAgentSessionLogs.mockResolvedValue(makeHistoryLogs());
  sessionApi.listSessionRuns.mockResolvedValue([]);
  sessionApi.streamSession.mockImplementation(() => ({
    close: vi.fn(),
    getLastEventId: () => null,
  }));
  sessionApi.fetchPendingDialogs.mockResolvedValue([]);
  sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
  sessionApi.listSessionTeamMissions.mockResolvedValue([]);
  sessionApi.injectSession.mockResolvedValue({ run_id: "run-new", queued: false });
  workspaceApi.listWorkspaces.mockResolvedValue({ items: [] });
  workspaceApi.listProjects.mockResolvedValue([]);
  workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
});

/* ───────── 1. 回归锚：不传 variant = desktop（FR-11 桌面零回归） ───────── */

describe("SessionPanel variant 回归锚（不传 variant 与 desktop 一致）", () => {
  it("不传 variant：根/头部 className 与改前字面量逐字一致，桌面 chrome 原位、无 ⋯ 菜单", async () => {
    // 有活跃 mission → 后台目录（ActivityCatalog）触发钮渲染，可断言其头部原位。
    sessionApi.listSessionTeamMissions.mockResolvedValue([makeMission()]);
    setupPage();

    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    expect(panel.getAttribute("data-variant")).toBe("desktop");
    // 回归锚：根容器类逐字一致（改前原文）。
    expect(panel.className).toBe(ROOT_CLS_DESKTOP);
    const header = panel.querySelector("header") as HTMLElement;
    expect(header.className).toBe(HEADER_CLS_DESKTOP);

    // 桌面 chrome 原位：#id 复制、后台目录、视图切换、打断均在头部。
    expect(within(header).getByLabelText("复制会话 ID")).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: /^后台任务目录/ }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("tablist", { name: "消息显示范围" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: /^打断本轮$/ }),
    ).toBeInTheDocument();
    // 无 mobile ⋯ 菜单。
    expect(screen.queryByLabelText("更多操作")).not.toBeInTheDocument();
    // 会话主体直挂面板根（无外包层——改前 DOM 结构）。
    const scroll = panel.querySelector("[data-testid='turn-timeline-scroll']");
    expect(scroll?.parentElement).toBe(panel);
  });

  it("显式 variant='desktop'：与不传渲染一致（分发函数默认值归一）", async () => {
    setupPage("desktop");
    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    expect(panel.getAttribute("data-variant")).toBe("desktop");
    expect(panel.className).toBe(ROOT_CLS_DESKTOP);
    const header = panel.querySelector("header") as HTMLElement;
    expect(header.className).toBe(HEADER_CLS_DESKTOP);
  });
});

/* ───────── 2. variant="mobile" 渲染层差异（design §5.4） ───────── */

describe("SessionPanel variant='mobile' 布局类与收纳", () => {
  it("布局类生效：根容器满宽贴屏（无 rounded/border）+ 头部 padding 收敛 + data-variant", async () => {
    setupPage("mobile");

    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    expect(panel.getAttribute("data-variant")).toBe("mobile");
    expect(panel.className).toBe(ROOT_CLS_MOBILE);
    expect(panel.className).not.toContain("rounded-lg");
    expect(panel.className).not.toContain("border-border");
    const header = panel.querySelector("header") as HTMLElement;
    expect(header.className).toBe(HEADER_CLS_MOBILE);
  });

  it("会话主体外包横向滚动容器（表格横向内容不撑破竖屏视口，desktop 无外包层）", async () => {
    setupPage("mobile");
    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    const scroll = panel.querySelector("[data-testid='turn-timeline-scroll']");
    // 外包层 = 滚动容器父级：携带 markdown 表格横向滚动 + 外层横向锁类。
    const wrap = scroll?.parentElement as HTMLElement;
    expect(wrap).not.toBe(panel);
    expect(wrap.className).toContain("min-h-0 flex-1");
    expect(wrap.className).toContain(
      "[&_.wmde-markdown_table]:!overflow-x-auto",
    );
    expect(wrap.className).toContain(
      "[&_[data-testid='turn-timeline-scroll']]:overflow-x-hidden",
    );
  });

  it("次要 chrome 收纳：#id 复制/后台目录进 ⋯ 菜单，核心操作（视图切换/打断）原位保留", async () => {
    // 有活跃 mission → 后台目录触发钮存在（mobile 下应只出现在 ⋯ 菜单内）。
    sessionApi.listSessionTeamMissions.mockResolvedValue([makeMission()]);
    setupPage("mobile");

    const panel = (await screen.findByLabelText("会话面板")) as HTMLElement;
    const header = panel.querySelector("header") as HTMLElement;

    // 核心操作原位：视图切换 tablist + 打断按钮（行为与 desktop 同路径）。
    expect(
      within(header).getByRole("tablist", { name: "消息显示范围" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: /^打断本轮$/ }),
    ).toBeInTheDocument();

    // 收纳生效：#id 复制 / 后台目录不在头部原位。
    expect(within(header).queryByLabelText("复制会话 ID")).not.toBeInTheDocument();
    expect(
      within(header).queryByRole("button", { name: /^后台任务目录/ }),
    ).not.toBeInTheDocument();

    // 点开 ⋯ 菜单：#id 复制 + 后台目录在菜单内可用（纯渲染层搬迁）。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    const menu = await screen.findByTestId("session-mobile-more-menu");
    expect(within(menu).getByLabelText("复制会话 ID")).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: /^后台任务目录/ }),
    ).toBeInTheDocument();
  });

  it("逻辑零分叉：SSE 建流入参与 variant 无关，发消息（injectSession）mobile 下照常可用", async () => {
    setupPage("mobile");

    // SSE 建流：streamSession(sessionId, handlers, options)——与 desktop 同参
    // （共用同一条代码路径）。第三参为 ql-20260827-018 cursor/initialSync 建流选项。
    await waitFor(() =>
      expect(sessionApi.streamSession).toHaveBeenCalledWith(
        "sess-variant",
        expect.any(Object),
        expect.any(Object),
      ),
    );

    // 发消息：输入 + 发送 → sendFromQueue → injectSession（空闲直发占位轮链路）。
    const input = (await screen.findByPlaceholderText(
      /继续追问/,
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalled());
    expect(sessionApi.injectSession).toHaveBeenCalledWith(
      "sess-variant",
      "你好",
      expect.anything(),
    );
  });
});

/* ───────── 3. 预会话空态（sessionId=null）mobile 根容器类 ───────── */

describe("SessionPanel variant='mobile' 预会话空态", () => {
  it("根容器类同样生效（第四宿主预会话路径：/m 列表页 preContext 态）", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <SessionPanel
          mode="page"
          sessionId={null}
          machines={[]}
          llmProviders={[]}
          variant="mobile"
          preContext={{ workspaceId: null, runtimeId: "rt-1" }}
        />
      </QueryClientProvider>,
    );

    const panel = (await screen.findByTestId(
      "session-pre-session-panel",
    )) as HTMLElement;
    expect(panel.getAttribute("data-variant")).toBe("mobile");
    expect(panel.className).toBe(ROOT_CLS_MOBILE);
    const header = panel.querySelector("header") as HTMLElement;
    expect(header.className).toBe(HEADER_CLS_MOBILE);
  });
});
