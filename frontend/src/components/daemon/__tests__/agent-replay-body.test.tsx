// task-11（2026-09-19-tool-report-session-replay / FR-01 / FR-02 / FR-04 /
// D-001@v1 / D-002@v1 / D-007@v1，design Phase 3.2-3.5）：
// AgentReplayBody（tool_report 纯日志会话主体 = TurnTimeline 回放时间线）单测。
//
// 覆盖：
//   1. 正常态：主日志 parsed → TurnTimeline 时间线（真人用户气泡 / reply 正文 /
//      系统事件中性行「全部」视图可见「对话」视图不渲染）+ 顶部说明行 / 累计
//      用量 / 视图切换控件；
//   2. 主/子分类（D-002 / R-04）：最新主日志为正文（readAgentLogMessages 收
//      主 entry id），更早主日志 + 子代理归入「工作会话（N）」折叠条（收起
//      一行摘要 / 展开列表 / 角色猜测 + 短码 + 大小时间）；
//   3. 不可用三态（FR-04）：daemon 离线（404 no-bound-daemon / 504）居中提示 /
//      格式不支持（409 二进制 task-13 文案 / status=unsupported 原文回落）/
//      文件缺失（404 not_found）；元数据保留可见、不弹错框（无 role=alert）；
//   4. 触顶「加载更早」：truncated 显示按钮 → 点击带 beforeSeq=当前最小 seq →
//      更早段前插 → truncated=false 到头按钮消失；
//   5. focusEntryId 直读分支（工作会话入口）+ 面包屑「← 返回主会话」返回主
//      日志 + 折叠条条目点击进入；
//   6. total_usage 显示与老 daemon 缺字段不渲染（不显 0 不伪造）；
//   7. 列表态：空列表沿用现状空态文案 / 加载失败红条 + 重新加载。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/agent-logs 三函数）；断言用
// aria-label / data-testid 避开样式细节；MarkdownText 桩（jsdom 下
// next/dynamic 渲染 null 的既有惯例，见 agent-log-card.test.tsx）。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentReplayBody } from "../agent-replay-body";
import type {
  AgentLogListItem,
  AgentLogMessagesResponse,
} from "@/lib/agent-logs";
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

/* ----- fixture ----- */

function makeItem(overrides: Partial<AgentLogListItem> = {}): AgentLogListItem {
  return {
    id: "log-1",
    workspace_id: "ws-1",
    log_path: "C:/Users/qinyi/.zcode/cli/rollout/model-io-sess_c35fa872.jsonl",
    harness: "zcode",
    format: "zcode-model-io-jsonl",
    session_id: "model-io-sess_c35fa872",
    originator: "sillyhub-daemon",
    detected_via: null,
    agent_cwd: null,
    exists: true,
    size_bytes: 13631488, // 13.0 MB
    mtime_ms: null,
    first_seen_at: "2026-09-19T02:00:00Z",
    last_seen_at: "2026-09-19T02:27:00Z",
    invocations: 118,
    last_command: null,
    scan_run_id: null,
    pushed_at: null,
    agent_session_id: null,
    state: "ended",
    state_derived_at: null,
    state_evidence: null,
    last_event_at: null,
    created_at: "2026-09-19T02:00:00Z",
    updated_at: "2026-09-19T02:27:00Z",
    ...overrides,
  };
}

/** 主日志（最新）+ 更早主日志 + 两条子代理（乱序给列表，验证分类排序）。 */
function sessionItems(): AgentLogListItem[] {
  return [
    makeItem({
      id: "log-sub-verify",
      log_path:
        "C:/Users/qinyi/.zcode/cli/rollout/subagent_agent_d017b02b.jsonl",
      session_id: "subagent_agent_d017b02b",
      first_seen_at: "2026-09-19T02:27:00Z",
      last_seen_at: "2026-09-19T02:40:00Z",
      size_bytes: 10813440, // 10.3 MB
      invocations: 25,
      last_command: "verify --done --change demo",
    }),
    makeItem({ id: "log-main-old", first_seen_at: "2026-09-19T01:00:00Z" }),
    makeItem({ id: "log-main" }),
    makeItem({
      id: "log-sub-exec",
      log_path:
        "C:/Users/qinyi/.zcode/cli/rollout/subagent_agent_e302546e.jsonl",
      session_id: "subagent_agent_e302546e",
      first_seen_at: "2026-09-19T00:38:00Z",
      last_seen_at: "2026-09-19T00:52:00Z",
      size_bytes: 4928307, // 4.7 MB
      invocations: 9,
      last_command: "execute --wave 2",
    }),
  ];
}

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
 * 回放 fixture（实证样本形态）：真人提问 + thinking + 工具配对 + 回复 +
 * 系统事件伪用户消息（task-notification，sender=system_event）。
 */
const REPLAY_MESSAGES: AgentLogMessageItem[] = [
  makeMsg({
    seq: 201,
    kind: "user_input",
    text: "本次变更为什么跑那么久啊，资源消耗合理吗？",
    sender: "human",
    ts: "2026-09-19T02:15:00Z",
  }),
  makeMsg({
    seq: 202,
    kind: "thinking",
    text: "先核对资源消耗数据，再对照平台 token 口径",
    ts: "2026-09-19T02:15:05Z",
  }),
  makeMsg({
    seq: 203,
    kind: "tool_use",
    tool_name: "Bash",
    tool_use_id: "tu-bash-1",
    tool_input: JSON.stringify({
      tool: "Bash",
      args: { command: 'pnpm test -- agent-log-turns' },
    }),
    ts: "2026-09-19T02:15:10Z",
  }),
  makeMsg({
    seq: 204,
    kind: "tool_result",
    tool_use_id: "tu-bash-1",
    tool_result: "Tests 12 passed",
    is_error: false,
    ts: "2026-09-19T02:15:12Z",
  }),
  makeMsg({
    seq: 205,
    kind: "reply",
    text: "资源消耗集中在 verify 阶段，属正常范围。",
    ts: "2026-09-19T02:16:00Z",
  }),
  makeMsg({
    seq: 206,
    kind: "user_input",
    text: "系统事件：子代理 verify 完成通知（task-notification，非用户消息）",
    sender: "system_event",
    ts: "2026-09-19T02:26:00Z",
  }),
];

const TOTAL_USAGE = {
  input_tokens: 63700000,
  output_tokens: 53400,
  cache_read_tokens: 62500000,
  cache_write_tokens: 4200,
};

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, { code, message, request_id: null, details: null });
}

function setup(sessionId = "sess-1", focusEntryId?: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentReplayBody sessionId={sessionId} focusEntryId={focusEntryId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  agentLogsApi.listAgentLogs.mockReset();
  agentLogsApi.readAgentLogContent.mockReset();
  agentLogsApi.readAgentLogMessages.mockReset();
});

/* ───────────────── 1. 正常态：TurnTimeline 时间线渲染 ───────────────── */

describe("AgentReplayBody 正常态（主日志 parsed → 时间线）", () => {
  it("主日志为正文：说明行 + 真人用户气泡 + 回复正文 + 视图切换；系统事件中性行仅「全部」视图可见", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: sessionItems() });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES, { total_usage: TOTAL_USAGE }),
    );
    setup();

    // 主日志直读（最新 first_seen_at 的无前缀条目 = log-main）。
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenCalledWith("log-main"),
    );

    // 顶部说明行（原型 .topbar）+ 累计用量（daemon 返回，千分位）。
    expect(
      screen.getByText("🧾 由 SillySpec CLI 自动上报创建 · 内容从本机日志实时读取"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("累计 in 63,700,000 · out 53,400 · 缓存命中 62,500,000"),
    ).toBeInTheDocument();

    // TurnTimeline 挂载 + 真人用户气泡 + 回复正文（MarkdownText 桩）。
    expect(screen.getByTestId("turn-timeline-scroll")).toBeInTheDocument();
    expect(
      screen.getByText("本次变更为什么跑那么久啊，资源消耗合理吗？"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("markdown-text").textContent).toBe(
      "资源消耗集中在 verify 阶段，属正常范围。",
    );

    // 「对话」视图：系统事件可见（回带④双视图）；思考 / 工具仍不渲染（仅全部视图）。
    expect(
      screen.getByText(/子代理 verify 完成通知/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/先核对资源消耗数据/)).not.toBeInTheDocument();

    // 切「全部」：系统事件中性行仍可见（task-10 system_event 渲染分支，双视图不双画——
    // 对话视图块 viewMode 门控退场、全部视图走 TurnDetailsList）。
    fireEvent.click(screen.getByTestId("agent-replay-tab-all"));
    expect(
      screen.getByText(/子代理 verify 完成通知/),
    ).toBeInTheDocument();
  });

  it("listAgentLogs 收 sessionId（会话关联口径，沿用 30s 轮询配置）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: sessionItems() });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES),
    );
    setup("sess-replay-1");
    await waitFor(() =>
      expect(agentLogsApi.listAgentLogs).toHaveBeenCalledWith("sess-replay-1"),
    );
    expect(await screen.findByTestId("turn-timeline-scroll")).toBeInTheDocument();
  });
});

/* ───────────────── 2. 主/子分类与工作会话折叠条（D-002 / R-04） ─────────── */

describe("主/子分类与工作会话折叠条", () => {
  it("最新主日志为正文，更早主日志 + 子代理归入「工作会话（3）」折叠条（默认收起一行摘要）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: sessionItems() });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES),
    );
    setup();
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenCalledWith("log-main"),
    );

    // 折叠条默认收起：一行摘要 + 计数，列表不渲染。
    const toggle = screen.getByTestId("agent-replay-worker-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("工作会话（3）")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-replay-worker-list")).not.toBeInTheDocument();
  });

  it("展开折叠条：3 个条目（角色猜测 plan/execute/verify 词表 + 兜底 harness 名）+ 短码 + 大小时间", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: sessionItems() });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES),
    );
    setup();
    await screen.findByTestId("agent-replay-worker-toggle");
    fireEvent.click(screen.getByTestId("agent-replay-worker-toggle"));

    const list = await screen.findByTestId("agent-replay-worker-list");
    const items = screen.getAllByTestId("agent-replay-worker-item");
    expect(items).toHaveLength(3);

    // 排序：first_seen_at 新→旧（verify 子代理 02:27 > 更早主日志 01:00 > exec 子代理 00:38）。
    expect(items[0]?.getAttribute("data-entry-id")).toBe("log-sub-verify");
    expect(items[1]?.getAttribute("data-entry-id")).toBe("log-main-old");
    expect(items[2]?.getAttribute("data-entry-id")).toBe("log-sub-exec");

    // 角色猜测：last_command 含 verify/execute 词标注；更早主日志无命中回落 harness 名。
    expect(list.textContent).toContain("verify");
    expect(list.textContent).toContain("execute");
    expect(list.textContent).toContain("zcode");

    // 子代理短码（log_path 文件名）+ 大小人性化。
    expect(list.textContent).toContain("subagent_agent_d017b02b");
    expect(list.textContent).toContain("10.3 MB");

    // 条目点击 → 直读该日志回放（readAgentLogMessages 换 entry）。
    fireEvent.click(items[0] as HTMLElement);
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenLastCalledWith(
        "log-sub-verify",
      ),
    );
  });
});

/* ───────────────── 3. 不可用三态（FR-04 / D-007） ───────────────── */

describe("不可用三态提示行（元数据保留、不弹错框）", () => {
  it("daemon 离线（404 no-bound-daemon / 504 超时）：居中提示 + 元数据保留；不拉原文、无 role=alert", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({
      items: [makeItem()],
    });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      apiError(
        404,
        "HTTP_404_AGENT_LOG_NO_BOUND_DAEMON",
        "未找到可读取该日志的机器（会话未激活且工作区未绑定守护进程），无法在线查看内容。",
      ),
    );
    setup();
    const box = await screen.findByTestId("agent-replay-unavailable");
    expect(box.getAttribute("data-kind")).toBe("offline");
    expect(
      screen.getByText(
        "机器离线，无法读取日志内容——回放内容存于上报机器本地，守护进程在线后可查看。",
      ),
    ).toBeInTheDocument();
    // 元数据保留可见（harness / 短码 / 大小 / 调用数）。
    const meta = screen.getByTestId("agent-replay-meta");
    expect(meta.textContent).toContain("zcode");
    expect(meta.textContent).toContain("13.0 MB");
    expect(meta.textContent).toContain("调用 118 次");
    // 静默：不弹错框、不拉原文端点。
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(agentLogsApi.readAgentLogContent).not.toHaveBeenCalled();
  });

  it("504（RPC 超时）同样归离线态", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      apiError(504, "agent_log_gateway_timeout", "机器离线或 RPC 超时"),
    );
    setup();
    expect(await screen.findByTestId("agent-replay-unavailable")).toHaveAttribute(
      "data-kind",
      "offline",
    );
  });

  it("格式不支持 · 409 二进制（task-13 文案口径逐字）：死胡同说明，不拉原文", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      apiError(
        409,
        "HTTP_409_AGENT_LOG_BINARY_FORMAT",
        "该日志格式为二进制，暂不支持在线查看。",
      ),
    );
    setup();
    const box = await screen.findByTestId("agent-replay-unavailable");
    expect(box.getAttribute("data-kind")).toBe("binary");
    expect(
      screen.getByText(
        "该日志格式（cursor IDE 聊天库）暂不支持对话化回放，仅保留元数据与活性信息",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-replay-meta").textContent).toContain("zcode");
    expect(agentLogsApi.readAgentLogContent).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("格式不支持 · status=unsupported（200）：黄条原因 + 原文尾部回落（语义逐字沿用）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      statusMessagesResponse("unsupported"),
    );
    agentLogsApi.readAgentLogContent.mockResolvedValue({
      content: '{"role":"user"}',
      truncated: false,
      size_bytes: 100,
    });
    setup();
    const box = await screen.findByTestId("agent-replay-unavailable");
    expect(box.getAttribute("data-kind")).toBe("unsupported");
    expect(
      screen.getByText("该格式暂不支持对话化解析，已回落原文尾部查看（最多 256KB）"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogContent).toHaveBeenCalledWith("log-1"),
    );
    expect(
      (await screen.findByTestId("agent-replay-raw-pre")).textContent,
    ).toContain('{"role":"user"}');
  });

  it("文件缺失（404 not_found）：中文提示 + 元数据保留", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockRejectedValue(
      apiError(
        404,
        "HTTP_404_AGENT_LOG_FILE_NOT_FOUND",
        "日志文件在目标机器上不存在（可能已被清理或移动）。",
      ),
    );
    setup();
    const box = await screen.findByTestId("agent-replay-unavailable");
    expect(box.getAttribute("data-kind")).toBe("missing");
    expect(
      screen.getByText("日志文件已不存在（可能已被本机清理）"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-replay-meta").textContent).toContain("zcode");
  });
});

/* ───────────────── 4. 触顶「加载更早」（beforeSeq 前插） ───────────────── */

describe("触顶加载更早", () => {
  it("truncated 显示按钮 → 点击带 beforeSeq=当前最小 seq → 更早段前插 → 到头按钮消失", async () => {
    const page1: AgentLogMessageItem[] = [
      makeMsg({ seq: 201, kind: "user_input", text: "第二个问题", sender: "human" }),
      makeMsg({ seq: 202, kind: "reply", text: "第二段回答" }),
      makeMsg({ seq: 205, kind: "user_input", text: "第三个问题", sender: "human" }),
      makeMsg({ seq: 206, kind: "reply", text: "第三段回答" }),
    ];
    const page2: AgentLogMessageItem[] = [
      makeMsg({ seq: 195, kind: "user_input", text: "第一个问题", sender: "human" }),
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
    setup();

    // 截断说明 + 按钮。
    const btn = await screen.findByTestId("agent-replay-load-earlier");
    expect(btn.textContent).toBe("加载更早");
    expect(screen.getByText("已加载 4 段（共 10 段）")).toBeInTheDocument();

    fireEvent.click(btn);
    // 携带当前最小 seq（201）。
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenLastCalledWith(
        "log-1",
        201,
      ),
    );

    // 更早段前插：第一个问题出现在第二个问题之前（正文 DOM 顺序）。
    const stream = await screen.findByTestId("turn-timeline-scroll");
    await waitFor(() =>
      expect(stream.textContent).toContain("第一个问题"),
    );
    expect(stream.textContent?.indexOf("第一个问题")).toBeLessThan(
      stream.textContent?.indexOf("第二个问题") ?? -1,
    );
    // truncated=false 到头：按钮与截断说明消失，不再发起。
    await waitFor(() =>
      expect(
        screen.queryByTestId("agent-replay-load-earlier"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument();
  });
});

/* ───────────────── 5. focusEntryId 直读分支（工作会话入口） ───────────────── */

describe("focusEntryId 直读与返回主会话", () => {
  it("focusEntryId 传入直读该 entry；面包屑「← 返回主会话」点击回主日志", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: sessionItems() });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES),
    );
    setup("sess-1", "log-sub-verify");

    // 直读分支：messages 收 focusEntryId 而非主日志 id。
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenCalledWith(
        "log-sub-verify",
      ),
    );
    // 面包屑：返回按钮 + 工作会话标识（角色猜测 + 短码）。
    const focusBar = await screen.findByTestId("agent-replay-focus-bar");
    expect(focusBar.textContent).toContain("verify");
    expect(focusBar.textContent).toContain("subagent_agent_d017b02b");

    // 返回主会话：messages 换主日志 id，面包屑消失。
    fireEvent.click(screen.getByTestId("agent-replay-back-main"));
    await waitFor(() =>
      expect(agentLogsApi.readAgentLogMessages).toHaveBeenLastCalledWith(
        "log-main",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("agent-replay-focus-bar"),
      ).not.toBeInTheDocument(),
    );
    // 主体回到主日志内容。
    await waitFor(() =>
      expect(
        screen.getByText("本次变更为什么跑那么久啊，资源消耗合理吗？"),
      ).toBeInTheDocument(),
    );
  });
});

/* ───────────────── 6. total_usage 显示与缺省（老 daemon） ───────────────── */

describe("累计用量 total_usage", () => {
  it("老 daemon 缺字段 / null：不渲染用量（不显 0 不伪造）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES),
    );
    setup();
    await screen.findByTestId("turn-timeline-scroll");
    expect(
      screen.queryByTestId("agent-replay-total-usage"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/累计 in/)).not.toBeInTheDocument();
  });

  it("total_usage: null（新 schema 显式空）同样不渲染", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse(REPLAY_MESSAGES, { total_usage: null }),
    );
    setup();
    await screen.findByTestId("turn-timeline-scroll");
    expect(
      screen.queryByTestId("agent-replay-total-usage"),
    ).not.toBeInTheDocument();
  });
});

/* ───────────────── 7. 列表态（空 / 失败，沿袭原 AgentLogSessionBody 文案） ───── */

describe("列表态", () => {
  it("空列表：沿用现状空态文案", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [] });
    setup();
    expect(
      await screen.findByText("暂无日志上报，等待 SillySpec CLI 下次上报…"),
    ).toBeInTheDocument();
    // 不渲染折叠条与时间线。
    expect(
      screen.queryByTestId("agent-replay-worker-strip"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("turn-timeline-scroll")).not.toBeInTheDocument();
  });

  it("列表加载失败：中文红条 + 重新加载入口（现状语义）", async () => {
    agentLogsApi.listAgentLogs.mockRejectedValue(new Error("boom"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "加载本地 Agent 日志失败：boom",
    );
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  });

  it("parsed 但无可展示内容：显式空态（不落入 TurnTimeline 内置空态文案）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [makeItem()] });
    agentLogsApi.readAgentLogMessages.mockResolvedValue(
      parsedMessagesResponse([]),
    );
    setup();
    expect(
      await screen.findByText("解析成功，但没有可展示的对话内容"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("turn-timeline-scroll")).not.toBeInTheDocument();
    expect(screen.queryByText("没有在线守护进程")).not.toBeInTheDocument();
  });
});
