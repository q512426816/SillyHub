// task-04（2026-08-23-platform-agent-log-ingest / FR-04 / D-006）+
// ql-20260823-002-6a1a（改会话流内展示）+ task-07（2026-08-23-agent-
// activity-sessions：sessionId 驱动会话化 + AgentLogSessionBody + 查看内容）+
// task-05（2026-08-23-agent-log-conversation-view：查看内容对话化升级）：
// AgentLogCard「本地 Agent 日志」会话流条目 + AgentLogSessionBody 会话主体单测。
//
// 覆盖：
//   1. 折叠默认态：只渲染一行摘要（标题 + N 个 + 最新 X 前），明细不渲染；
//      listAgentLogs 收到 sessionId（session_id 关联，非 workspace 语义）；
//   2. 展开交互：点头部摘要 → 明细列表（harness 徽标双分支 / originator /
//      session 短码 / 大小人性化 / 相对时间 + 绿点 / 调用次数 / 最近命令 /
//      log_path）；再点收起；
//   3. 条数折叠：>3 条默认 3 条 + 「展开全部 N 条」/「收起」；
//   4. 复制回调：navigator.clipboard.writeText 收到完整 session_id /
//      log_path，900ms「已复制 ✓」瞬时反馈后还原；
//   5. 静默隐藏（AgentLogCard）：error / 空列表 / loading 一律返回 null；
//   6. 查看内容（task-05 新交互）：展开先 readAgentLogMessages——parsed 直构
//      对话流（用户气泡 / MarkdownText 正文 / 思考折叠 / 工具卡输入与结果 /
//      tool_use_id 配对 + 失配「结果未记录」）；「对话 / 原文」tab（原文懒调
//      readAgentLogContent）；truncated「加载更早」带 before_seq 前插；
//      unsupported / parse_error / too_large / ApiError（HTTP 失败）/ 422 老
//      daemon 全部静默回落原文 <pre> + 黄条原因（无 role=alert 红条）；仅
//      原文端点自身失败保留红条中文文案（现状语义）；
//   7. AgentLogSessionBody（tool_report 会话主体）：说明行 + 全量条目
//      （不折叠成 3 条）+ 空态 / error 态中文提示；
//   8. 会话列表徽标：origin=tool_report 条目 🧾「本地 Agent」徽标 + 引擎位
//      显示 harness（chat 条目无徽标、显示引擎名）。
//
// 旧 workspace 挂载移除（D-004）：AgentLogCard 已无 workspaceId prop——类型
// 层由 pnpm typecheck 保证（本文件改写后全部传 sessionId）；运行时由用例 1
// 的「listAgentLogs(sessionId)」透传断言兜底。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/agent-logs 的三个函数、
// SessionListPanel 数据源三件套）与 navigator.clipboard；断言用 aria-label /
// data-testid 避开样式细节。
//
// MarkdownText 桩：next/dynamic 在 jsdom 下渲染 null（既有惯例，见
// file-preview.test.tsx 注释），reply 正文断言经桩 data-testid 定位。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  AgentLogCard,
  AgentLogSessionBody,
} from "../agent-log-card";
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import type {
  AgentLogListItem,
  AgentLogMessagesResponse,
} from "@/lib/agent-logs";
import type {
  AgentSessionConfigSnapshot,
  AgentSessionRead,
} from "@/lib/daemon";
import { ApiError } from "@/lib/api";

/* ----- mock 网络层 ----- */

const agentLogsApi = vi.hoisted(() => ({
  listAgentLogs: vi.fn(),
  readAgentLogContent: vi.fn(),
  readAgentLogMessages: vi.fn(),
}));

vi.mock("@/lib/agent-logs", () => ({
  listAgentLogs: agentLogsApi.listAgentLogs,
  readAgentLogContent: agentLogsApi.readAgentLogContent,
  readAgentLogMessages: agentLogsApi.readAgentLogMessages,
}));

// MarkdownText → 纯文本桩（jsdom 下 next/dynamic 渲染 null 的既有惯例）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// 列表徽标用例数据源三件套（SessionListPanel 顶部 useQuery / useDaemonMachines）。
const sessionListApi = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => {
  // AGENT_SESSIONS_TREE_FETCH_LIMIT 是运行时常量（列表拉取上限），一并透传。
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return { ...actual, listAgentSessions: sessionListApi.listAgentSessions };
});

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: sessionListApi.listWorkspaces,
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: vi.fn().mockReturnValue({ items: [] }),
}));

/* ----- fixture ----- */

const CODEX_SESSION_ID = "8f14e45f-eaeb-4b3e-9b7c-1a2b3c4d5a9c";
const CODEX_LOG_PATH =
  "C:/Users/qinyi/.codex/sessions/2026/08/23/rollout-2026-08-23.jsonl";
const ZCODE_SESSION_ID = "model-io-sess_c3-abcdef0123456789";

function makeItem(overrides: Partial<AgentLogListItem> = {}): AgentLogListItem {
  return {
    id: "log-1",
    workspace_id: "ws-1",
    log_path: CODEX_LOG_PATH,
    harness: "codex",
    format: "codex-rollout-jsonl",
    session_id: CODEX_SESSION_ID,
    originator: "sillyhub-daemon",
    detected_via: null,
    agent_cwd: null,
    exists: true,
    size_bytes: 2516582, // 2.4 MB
    mtime_ms: null,
    first_seen_at: "2026-08-23T05:00:00Z",
    last_seen_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    invocations: 12,
    last_command: "execute --wave 1",
    scan_run_id: null,
    pushed_at: null,
    created_at: "2026-08-23T05:00:00Z",
    updated_at: "2026-08-23T05:00:00Z",
    ...overrides,
  };
}

/** 双 harness fixture：codex（brand 阶 + daemon 来源 + 活跃绿点）+ zcode（info 青）。 */
function twoHarnessItems(): AgentLogListItem[] {
  return [
    makeItem(),
    makeItem({
      id: "log-2",
      harness: "zcode",
      originator: "zcode",
      format: "zcode-model-io-jsonl",
      session_id: ZCODE_SESSION_ID,
      size_bytes: 881664, // 861.0 KB
      last_seen_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      invocations: 31,
      last_command: "verify",
      log_path: "C:/Users/qinyi/.zcode/cli/rollout/model-io-sess_c3.jsonl",
    }),
  ];
}

function setupCard(sessionId = "sess-1") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentLogCard sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

function setupSessionBody(sessionId = "sess-1") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentLogSessionBody sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

/** 等数据落地并展开明细（默认折叠：先等摘要出现，再点开）。 */
async function openEntries() {
  const toggle = await screen.findByTestId("agent-log-toggle");
  fireEvent.click(toggle);
  await screen.findByTestId("agent-log-entries");
}

/* ----- 查看内容 · messages 端点 fixture（task-05） ----- */

type AgentLogMessageItem = NonNullable<
  AgentLogMessagesResponse["messages"]
>[number];

/** 归一化消息单条构造（可选字段 null 兜底，与 api-types 生成 schema 对齐）。 */
function makeMsg(
  overrides: Partial<AgentLogMessageItem> &
    Pick<AgentLogMessageItem, "seq" | "kind">,
): AgentLogMessageItem {
  return {
    text: null,
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    tool_result: null,
    is_error: null,
    ts: null,
    ...overrides,
  };
}

function parsedMessagesResponse(
  messages: AgentLogMessageItem[],
  overrides: Partial<AgentLogMessagesResponse> = {},
): AgentLogMessagesResponse {
  return {
    status: "parsed",
    messages,
    truncated: false,
    total_segments: messages.length,
    skipped_lines: 0,
    ...overrides,
  };
}

function statusMessagesResponse(
  status: Exclude<AgentLogMessagesResponse["status"], "parsed">,
): AgentLogMessagesResponse {
  return {
    status,
    messages: [],
    truncated: false,
    total_segments: 0,
    skipped_lines: 0,
  };
}

/**
 * 对话化 fixture（seq 3-10）：user 气泡 / 长 thinking（折叠摘要 60 字符外有
 * 尾巴，供折叠断言）/ Grep 配对成功（含结果）/ Bash 配对失配（无同 id
 * result →「结果未记录」）/ Read 配对成功且 is_error（失败红）/ reply 正文。
 */
const CONV_MESSAGES: AgentLogMessageItem[] = [
  makeMsg({
    seq: 3,
    kind: "user_input",
    text: "调查 quick_id 缺失问题",
    ts: "2026-08-23T12:30:00Z",
  }),
  makeMsg({
    seq: 4,
    kind: "thinking",
    text: "先确认后端 schema 是否预留字段，再查 CLI 调用点上下文，最后核对 openapi 生成链路，避免类型落后形成债",
    ts: "2026-08-23T12:30:05Z",
  }),
  makeMsg({
    seq: 5,
    kind: "tool_use",
    tool_name: "Grep",
    tool_use_id: "tu-grep-1",
    tool_input: JSON.stringify({
      pattern: "quick_id|change_key",
      path: "backend/app",
    }),
    ts: "2026-08-23T12:30:10Z",
  }),
  makeMsg({
    seq: 6,
    kind: "tool_result",
    tool_use_id: "tu-grep-1",
    tool_result: "schema.py:276: quick_id: str | None",
    is_error: false,
    ts: "2026-08-23T12:30:12Z",
  }),
  makeMsg({
    seq: 7,
    kind: "tool_use",
    tool_name: "Bash",
    tool_use_id: "tu-bash-2",
    tool_input: JSON.stringify({
      command: 'psql -c "select 1"',
      description: "查 tool_report 会话",
    }),
    ts: "2026-08-23T12:31:00Z",
  }),
  makeMsg({
    seq: 8,
    kind: "reply",
    text: "后端 schema 已预留字段，但 CLI 侧从未填充。",
    ts: "2026-08-23T12:32:00Z",
  }),
  makeMsg({
    seq: 9,
    kind: "tool_use",
    tool_name: "Read",
    tool_use_id: "tu-read-3",
    tool_input: JSON.stringify({ file_path: "/tmp/x.json" }),
  }),
  makeMsg({
    seq: 10,
    kind: "tool_result",
    tool_use_id: "tu-read-3",
    tool_result: "File not found: /tmp/x.json",
    is_error: true,
  }),
];

beforeEach(() => {
  agentLogsApi.listAgentLogs.mockReset();
  agentLogsApi.readAgentLogContent.mockReset();
  agentLogsApi.readAgentLogMessages.mockReset();
  sessionListApi.listAgentSessions.mockReset();
  sessionListApi.listWorkspaces.mockReset();
  // jsdom 无剪贴板：mock writeText（复制回调断言对象）。
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

/* ───────────────── 1. 折叠默认态（会话流一行摘要，sessionId 驱动） ─────── */

describe("AgentLogCard 会话流条目（折叠默认态）", () => {
  it("默认只渲染摘要行（标题 + N 个 + 最新相对时间），明细不出现", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: twoHarnessItems() });
    setupCard();

    // 查询参数：sessionId 透传给 listAgentLogs（session_id 关联本会话）。
    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalledWith("sess-1"));

    // 摘要：标题 + 2 个 + 最新 N 分钟前（首条即最新，列表 last_seen_at 新→旧）。
    const toggle = await screen.findByTestId("agent-log-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("本地 Agent 日志")).toBeInTheDocument();
    expect(screen.getByText(/2 个 · 最新 \d+ 分钟前/)).toBeInTheDocument();

    // 明细未渲染（折叠态）。
    expect(screen.queryByTestId("agent-log-entries")).not.toBeInTheDocument();
    expect(screen.queryByText("codex")).not.toBeInTheDocument();
  });
});

/* ───────────────── 2. 展开明细 ───────────────── */

describe("AgentLogCard 展开明细", () => {
  it("点摘要展开：harness 徽标 / originator / session 短码 / 大小 / 活跃时间 / 调用次数 / 最近命令 / log_path；再点收起", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: twoHarnessItems() });
    setupCard();
    await openEntries();

    // harness 徽标：codex（brand 阶）+ zcode（info 青分支；zcode 同名 originator 共 2 处）。
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getAllByText("zcode")).toHaveLength(2);
    // originator：daemon 来源标签。
    expect(screen.getByText("sillyhub-daemon")).toBeInTheDocument();

    // session 短码：uuid 前 8 + … + 后 4。
    const sessBtn = screen.getByRole("button", {
      name: `复制 session_id：${CODEX_SESSION_ID}`,
    }) as HTMLButtonElement;
    expect(sessBtn.textContent).toBe(`sess ${CODEX_SESSION_ID.slice(0, 8)}…${CODEX_SESSION_ID.slice(-4)}`);
    // 非 uuid id 截前 16。
    const zcodeBtn = screen.getByRole("button", {
      name: `复制 session_id：${ZCODE_SESSION_ID}`,
    }) as HTMLButtonElement;
    expect(zcodeBtn.textContent).toBe(`sess ${ZCODE_SESSION_ID.slice(0, 16)}…`);

    // 右侧大小 + 相对时间（3 分钟内活跃，zh-cn fromNow）+ 活跃绿点（仅 15 分钟内条目）。
    expect(screen.getByText(/2\.4 MB · \d+ 分钟前活跃/)).toBeInTheDocument();
    expect(screen.getByText(/861\.0 KB · \d+ 小时前活跃/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("最近活跃")).toHaveLength(1);

    // 第二行：调用次数 + 最近命令 code + format。
    expect(screen.getByText("调用 12 次")).toBeInTheDocument();
    expect(screen.getByText("调用 31 次")).toBeInTheDocument();
    expect(screen.getByText("execute --wave 1")).toBeInTheDocument();
    expect(screen.getByText("verify")).toBeInTheDocument();
    expect(screen.getByText("codex-rollout-jsonl")).toBeInTheDocument();

    // log_path：截断展示 + title 全文。
    const pathBtn = screen.getByRole("button", {
      name: `复制日志路径：${CODEX_LOG_PATH}`,
    }) as HTMLButtonElement;
    expect(pathBtn.title).toBe(CODEX_LOG_PATH);

    // 每行末「查看内容」按钮（task-07 新增，两行各一）。
    expect(screen.getAllByTestId("agent-log-content-toggle")).toHaveLength(2);

    // 再点头部摘要收起：明细卸载、aria-expanded 回 false。
    fireEvent.click(screen.getByTestId("agent-log-toggle"));
    expect(screen.queryByTestId("agent-log-entries")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-log-toggle").getAttribute("aria-expanded")).toBe("false");
  });

  it("可选字段 null 安全：session_id / originator / 命令 / 大小 / 时间缺失不阻塞渲染", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({
      items: [
        makeItem({
          session_id: null,
          originator: null,
          size_bytes: null,
          last_seen_at: null,
          invocations: null,
          last_command: null,
          format: null,
        }),
      ],
    });
    setupCard();
    await openEntries();

    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /复制 session_id/ })).toHaveLength(0);
    // 大小 / 时间 null → 「—」。
    expect(screen.getByText("— · —")).toBeInTheDocument();
    expect(screen.getByText("调用 — 次")).toBeInTheDocument();
    expect(screen.queryAllByLabelText("最近活跃")).toHaveLength(0);
  });
});

/* ───────────────── 3. 条数折叠（展开全部） ───────────────── */

describe("AgentLogCard 条数折叠", () => {
  it("展开后默认 3 条，超出折叠，「展开全部 N 条」/「收起」切换", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `log-${i + 1}`, session_id: `sess-0000000${i + 1}-0000-0000-0000-00000000000${i}` }),
      ),
    });
    setupCard();
    await openEntries();

    const list = screen.getByTestId("agent-log-entries");
    expect(list.children).toHaveLength(3);

    // 展开全部 5 条。
    fireEvent.click(screen.getByRole("button", { name: "展开全部 5 条" }));
    expect(screen.getByTestId("agent-log-entries").children).toHaveLength(5);

    // 收起回到 3 条。
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.getByTestId("agent-log-entries").children).toHaveLength(3);
  });
});

/* ───────────────── 4. 复制回调 ───────────────── */

describe("AgentLogCard 复制交互", () => {
  it("session 短码 / log_path 点击复制完整值 + 「已复制 ✓」900ms 瞬时反馈", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    setupCard();
    await openEntries();

    // session_id：复制完整 uuid（非短码）。
    fireEvent.click(
      screen.getByRole("button", { name: `复制 session_id：${CODEX_SESSION_ID}` }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODEX_SESSION_ID);
    expect(screen.getByText("已复制 ✓")).toBeInTheDocument();

    // 900ms 后还原文案（瞬时反馈自恢复）。
    await waitFor(
      () => expect(screen.queryByText("已复制 ✓")).not.toBeInTheDocument(),
      { timeout: 2500 },
    );

    // log_path：复制完整路径。
    fireEvent.click(
      screen.getByRole("button", { name: `复制日志路径：${CODEX_LOG_PATH}` }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODEX_LOG_PATH);
    expect(screen.getByText("已复制 ✓")).toBeInTheDocument();
  });
});

/* ───────────────── 5. 静默隐藏（error / 空 / loading） ───────────────── */

describe("AgentLogCard 静默隐藏", () => {
  it("查询失败返回 null（条目隐藏，不干扰会话主体验）", async () => {
    agentLogsApi.listAgentLogs.mockRejectedValue(new Error("network down"));
    const { container } = setupCard();

    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("空列表返回 null（会话流内不出现占位块）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [] });
    const { container } = setupCard();

    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByTestId("agent-log-toggle")).not.toBeInTheDocument();
  });
});

/* ───────── 6. 查看内容（messages 优先 + 静默回落原文，task-05 新交互） ──────── */

describe("查看内容交互（条目行尾按钮）", () => {
  it("回落态成功：先调 messages 判定回落，再 <pre> 尾部文本 + truncated 注明；收起后清态", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      statusMessagesResponse("unsupported"),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue({
      content: 'tail line\n{"role":"assistant"}',
      truncated: true,
      size_bytes: 300000,
    });
    setupCard();
    await openEntries();

    // 点「查看内容 ▾」→ messages 端点收到 entry id，判定回落后再拉原文。
    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenCalledWith("log-1"),
    );
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogContent).toHaveBeenCalledWith("log-1"),
    );

    const panel = await screen.findByTestId("agent-log-content-panel");
    expect(screen.getByText("已截断至末尾 256KB")).toBeInTheDocument();
    expect(panel.textContent).toContain('{"role":"assistant"}');

    // 收起：面板卸载。
    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    expect(screen.queryByTestId("agent-log-content-panel")).not.toBeInTheDocument();
  });

  it("非截断原文无截断提示（parse_error 回落通道）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      statusMessagesResponse("parse_error"),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue({
      content: "small log",
      truncated: false,
      size_bytes: 100,
    });
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await screen.findByTestId("agent-log-content-panel");
    expect(screen.queryByText("已截断至末尾 256KB")).not.toBeInTheDocument();
    expect(screen.getByText("small log")).toBeInTheDocument();
  });

  it("原文端点自身失败：保留红条中文文案（现状语义）；收起重开重新拉取可恢复", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      new ApiError(504, {
        code: "agent_log_gateway_timeout",
        message: "机器离线或 RPC 超时",
        request_id: null,
        details: null,
      }),
    );
    agentLogsApi.readAgentLogContent.mockRejectedValue(
      new ApiError(409, {
        code: "binary_log_format",
        message: "该日志格式为二进制，暂不支持在线查看",
        request_id: null,
        details: null,
      }),
    );
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    // 红条仅保留给「原文端点自身失败」（约束：messages 失败本身静默回落）。
    expect(
      await screen.findByText("内容读取失败：该日志格式为二进制，暂不支持在线查看"),
    ).toBeInTheDocument();
    // 静默回落意图仍可见（黄条注明 messages 失败原因）。
    expect(
      (await screen.findByTestId("agent-log-fallback-note")).textContent,
    ).toContain("机器离线或 RPC 超时");

    // 收起清态 → mock 换 parsed 成功 → 重开重新拉取展示对话流（恢复）。
    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    expect(screen.queryByTestId("agent-log-content-panel")).not.toBeInTheDocument();
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(CONV_MESSAGES),
    );
    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await screen.findByTestId("agent-log-conversation-stream");
    expect(screen.getByText("调查 quick_id 缺失问题")).toBeInTheDocument();
    expect(screen.queryByText(/内容读取失败/)).not.toBeInTheDocument();
  });
});

/* ───────── 6a. 查看内容 · 对话化渲染（parsed，task-05 新增） ───────── */

describe("查看内容 · 对话化渲染（status=parsed）", () => {
  it("parsed：用户气泡 / MarkdownText 正文 / 思考折叠可展开 / 工具卡输入与结果；DOM 无 system 提示词", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(CONV_MESSAGES),
    );
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenCalledWith("log-1"),
    );
    await screen.findByTestId("agent-log-conversation-stream");

    // 用户气泡（brand 用户回合）。
    expect(screen.getByText("调查 quick_id 缺失问题")).toBeInTheDocument();

    // reply 正文经 MarkdownText。
    const md = await screen.findByTestId("markdown-text");
    expect(md.textContent).toBe("后端 schema 已预留字段，但 CLI 侧从未填充。");

    // 思考默认折叠：正文尾巴（60 字符摘要之外）不可见，点「思考过程」展开。
    expect(screen.queryByText(/避免类型落后形成债/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /思考过程/ }));
    expect(screen.getByText(/避免类型落后形成债/)).toBeInTheDocument();

    // 工具卡：Grep 配对成功——入参 pattern + 结果并入卡片（命中 + 结果行）。
    expect(screen.getByText("quick_id|change_key")).toBeInTheDocument();
    expect(screen.getByText(/schema\.py:276/)).toBeInTheDocument();

    // 对话视图无 system 提示词 / system-reminder（R-04：daemon 已剥，前端不渲染）。
    expect(screen.queryByText(/system-reminder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/You are an? agent/i)).not.toBeInTheDocument();
  });

  it("tool_use_id 显式配对；失配渲染「结果未记录」中性徽章（不出现执行中/待审批）；is_error 着失败红", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(CONV_MESSAGES),
    );
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await screen.findByTestId("agent-log-conversation-stream");

    // 配对成功（tu-grep-1）：结果并入卡片。
    expect(screen.getByText(/schema\.py:276/)).toBeInTheDocument();
    // 配对成功且 is_error（tu-read-3）：失败红徽标。
    expect(screen.getByText("失败")).toBeInTheDocument();

    // 配对失配（tu-bash-2 无同 id result）：中性徽章 + 输入参数仍可见。
    expect(screen.getByText("结果未记录")).toBeInTheDocument();
    expect(screen.getByText(/psql -c/)).toBeInTheDocument();

    // 禁止「执行中 ⏳」假运行语义（含 ToolCallPreview 待审批 pending 态文案）。
    expect(screen.queryByText(/执行中|待审批/)).not.toBeInTheDocument();
  });
});

/* ───────── 6b. 查看内容 · 静默回落四通道（task-05 新增） ───────── */

describe("查看内容 · 静默回落（status≠parsed / ApiError / 422）", () => {
  const CONTENT_OK = {
    content: '{"type":"session_meta","payload":{"cwd":"/Users/qinyi"}}',
    truncated: false,
    size_bytes: 100,
  };

  it.each([
    ["unsupported", "暂不支持对话化解析"],
    ["parse_error", "解析失败"],
    ["too_large", "超出对话化解析预算"],
  ] as const)(
    "status=%s：黄条原因 + 原文 <pre>，无 role=alert 红条、无对话 tab",
    async (status, phrase) => {
      agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
      agentLogsApi.readAgentLogMessages.mockResolvedValue(
        statusMessagesResponse(status),
      );
      agentLogsApi.readAgentLogContent.mockResolvedValue(CONTENT_OK);
      setupCard();
      await openEntries();

      fireEvent.click(screen.getByTestId("agent-log-content-toggle"));

      const note = await screen.findByTestId("agent-log-fallback-note");
      expect(note.textContent).toContain(phrase);
      expect(note.textContent).toContain("已回落原文尾部查看");
      const pre = await screen.findByTestId("agent-log-raw-pre");
      expect(pre.textContent).toContain("session_meta");

      // 静默：不弹错误框；回落态无「对话」tab。
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("对话")).not.toBeInTheDocument();
    },
  );

  it("ApiError（HTTP 非 200，如 504 离线）：静默回落原文，黄条含后端原因", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      new ApiError(504, {
        code: "agent_log_gateway_timeout",
        message: "机器离线或 RPC 超时",
        request_id: null,
        details: null,
      }),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue(CONTENT_OK);
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));

    const note = await screen.findByTestId("agent-log-fallback-note");
    expect(note.textContent).toContain("机器离线或 RPC 超时");
    expect(note.textContent).toContain("已回落原文尾部查看");
    expect((await screen.findByTestId("agent-log-raw-pre")).textContent).toContain(
      "session_meta",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("422 老 daemon（method-not-found）：静默回落原文，黄条注明 daemon 未升级", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      new ApiError(422, {
        code: "agent_log_unsupported",
        message: "当前 daemon 版本不支持该操作",
        request_id: null,
        details: null,
      }),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue(CONTENT_OK);
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));

    const note = await screen.findByTestId("agent-log-fallback-note");
    expect(note.textContent).toContain("daemon 未升级");
    expect((await screen.findByTestId("agent-log-raw-pre")).textContent).toContain(
      "session_meta",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/* ───────── 6c. 查看内容 · 加载更早（truncated 窗口前插，task-05 新增） ─────── */

describe("查看内容 · 加载更早", () => {
  it("truncated 显示按钮 → 点击带 before_seq=最小 seq → 更早段前插 → truncated=false 按钮消失", async () => {
    const page1: AgentLogMessageItem[] = [
      makeMsg({ seq: 201, kind: "user_input", text: "第二个问题" }),
      makeMsg({ seq: 202, kind: "reply", text: "第二段回答" }),
      makeMsg({ seq: 205, kind: "user_input", text: "第三个问题" }),
      makeMsg({ seq: 206, kind: "reply", text: "第三段回答" }),
    ];
    const page2: AgentLogMessageItem[] = [
      makeMsg({ seq: 195, kind: "user_input", text: "第一个问题" }),
      makeMsg({ seq: 196, kind: "reply", text: "第一段回答" }),
    ];
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages
      .mockResolvedValueOnce(
        parsedMessagesResponse(page1, { truncated: true, total_segments: 10 }),
      )
      .mockResolvedValueOnce(
        parsedMessagesResponse(page2, { truncated: false, total_segments: 10 }),
      );
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));
    await screen.findByTestId("agent-log-conversation-stream");

    // 截断说明（共 N 段）+「加载更早」按钮。
    expect(screen.getByText(/仅展示最近 4 段（共 10 段）/)).toBeInTheDocument();
    const btn = screen.getByTestId("agent-log-load-earlier");
    expect(btn.textContent).toBe("加载更早");

    fireEvent.click(btn);
    // 携带当前最小 seq（201）。
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenLastCalledWith(
        "log-1",
        201,
      ),
    );

    // 更早段前插：第一个问题渲染在第三个问题之前；按钮与截断说明消失。
    const stream = await waitFor(() => {
      const s = screen.getByTestId("agent-log-conversation-stream");
      expect(s.textContent).toContain("第一个问题");
      return s;
    });
    expect(stream.textContent?.indexOf("第一个问题")).toBeLessThan(
      stream.textContent?.indexOf("第三个问题") ?? -1,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("agent-log-load-earlier")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/仅展示最近/)).not.toBeInTheDocument();
  });
});

/* ───────── 6d. 查看内容 · 对话/原文 tab 切换（task-05 新增） ───────── */

describe("查看内容 · 对话/原文 tab 切换（parsed 态）", () => {
  it("默认对话；切「原文」懒调 content + 截断注明；切回对话不重复拉取；system 提示词只在原文出现", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(CONV_MESSAGES),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue({
      content: 'You are SillySpec CLI agent…\n{"role":"user"}',
      truncated: true,
      size_bytes: 300000,
    });
    setupCard();
    await openEntries();

    fireEvent.click(screen.getByTestId("agent-log-content-toggle"));

    // 默认对话 tab：流可见、原文未拉。
    await screen.findByTestId("agent-log-conversation-stream");
    expect(agentLogsApi.readAgentLogContent).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-log-raw-pre")).not.toBeInTheDocument();

    // 切「原文」：懒加载 content（恰好一次）+ 截断注明 + system 提示词原文可见。
    fireEvent.click(screen.getByTestId("agent-log-tab-raw"));
    await screen.findByTestId("agent-log-raw-pre");
    expect(agentLogsApi.readAgentLogContent).toHaveBeenCalledTimes(1);
    expect(agentLogsApi.readAgentLogContent).toHaveBeenCalledWith("log-1");
    expect(screen.getByText("已截断至末尾 256KB")).toBeInTheDocument();
    expect(screen.getByText(/You are SillySpec CLI agent/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-log-conversation-stream"),
    ).not.toBeInTheDocument();

    // 切回「对话」：流回归，原文不重复拉，system 提示词不进对话视图。
    fireEvent.click(screen.getByTestId("agent-log-tab-conversation"));
    await screen.findByTestId("agent-log-conversation-stream");
    expect(agentLogsApi.readAgentLogContent).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/You are SillySpec CLI agent/),
    ).not.toBeInTheDocument();
  });
});

/* ───────────────── 7. AgentLogSessionBody（tool_report 会话主体） ───────── */

describe("AgentLogSessionBody 会话主体", () => {
  it("说明行 + 全量条目气泡流（5 条不折叠）+ 每条查看内容入口", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `log-${i + 1}`, session_id: `sess-0000000${i + 1}-0000-0000-0000-00000000000${i}` }),
      ),
    });
    setupSessionBody();

    // 查询参数：sessionId 透传。
    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalledWith("sess-1"));

    // 说明行（原型 .head .sub）+ 刷新按钮。
    expect(
      screen.getByText("由 SillySpec CLI 自动上报创建 · 点下方输入框即可继续对话"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();

    // 全量 5 条（主体不折叠成 3 条）。
    const list = await screen.findByTestId("agent-log-session-entries");
    expect(list.children).toHaveLength(5);
    // 每条行尾查看内容按钮。
    expect(screen.getAllByTestId("agent-log-content-toggle")).toHaveLength(5);
  });

  it("空列表显式空态提示（主体不静默隐藏）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [] });
    setupSessionBody();

    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalled());
    expect(await screen.findByText("暂无日志上报，等待 SillySpec CLI 下次上报…")).toBeInTheDocument();
  });

  it("加载失败：中文错误 + 重新加载入口", async () => {
    agentLogsApi.listAgentLogs.mockRejectedValue(new Error("boom"));
    setupSessionBody();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "加载本地 Agent 日志失败：boom",
    );
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  });
});

/* ───────────────── 8. 会话列表 🧾 徽标（SessionListPanel 集成） ─────────── */

/** 会话 fixture（AgentSessionRead 全字段；origin 区分 tool_report / chat）。 */
function makeSession(
  overrides: Partial<AgentSessionRead> = {},
): AgentSessionRead {
  return {
    id: "sess-tool-report",
    runtime_id: null,
    lease_id: null,
    provider: "claude",
    status: "pending",
    agent_session_id: null,
    config: null,
    turn_count: 0,
    parent_session_id: null,
    tree_depth: 0,
    created_at: "2026-08-23T05:00:00Z",
    last_active_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    ended_at: null,
    change_id: null,
    user_id: null,
    workspace_id: "ws-1",
    title: "zcode · agent-log-ingest",
    deleted_at: null,
    current_run_id: null,
    terminating_at: null,
    agent_profile_id: null,
    llm_provider_id: null,
    // harness 是后端写入快照的新键（AgentSessionConfigSnapshot 暂未收编，
    // 同组件侧本地窄化语义，见 session-list-panel.tsx 注释）。
    config_snapshot: { harness: "zcode", machine_name: "PC-WORK" } as AgentSessionConfigSnapshot,
    owner_name: "qinyi",
    origin: "tool_report",
    ...overrides,
  };
}

describe("会话列表 tool_report 徽标", () => {
  it("origin=tool_report：FileText「本地 Agent」徽标 + 引擎位显示 harness；chat 条目无徽标显引擎名", async () => {
    sessionListApi.listAgentSessions.mockResolvedValue({
      items: [
        makeSession(),
        makeSession({
          id: "sess-chat",
          status: "active",
          title: "把 verify 的结论摘出来看",
          turn_count: 3,
          config_snapshot: { engine: "claude" },
          origin: "chat",
        }),
      ],
      total: 2,
    });
    sessionListApi.listWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "multi-agent-platform" }],
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <SessionListPanel />
      </QueryClientProvider>,
    );

    // ql-20260824-001 起分组默认折叠 + tool_report 落「本地 Agent」小节
    //（默认收起）：先展开组与小节再断言条目徽标。
    const groupHead = await screen.findByRole("button", {
      name: "工作区分组 multi-agent-platform",
    });
    fireEvent.click(groupHead);
    await waitFor(() =>
      expect(groupHead).toHaveAttribute("aria-expanded", "true"),
    );
    const toolHead = screen.getByRole("button", { name: "本地 Agent 小节" });
    fireEvent.click(toolHead);
    await waitFor(() =>
      expect(toolHead).toHaveAttribute("aria-expanded", "true"),
    );

    // tool_report 徽标：仅 1 个（chat 条目无）。
    const badges = await screen.findAllByTestId("tool-report-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toBe("本地 Agent");

    // title 直接用后端 title（含派生 harness 前缀，无需前端特判）。
    expect(screen.getByText("zcode · agent-log-ingest")).toBeInTheDocument();

    // 引擎位：tool_report 条目显示 harness（zcode），chat 条目显示引擎名（Claude）。
    expect(screen.getByText("zcode")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });
});
