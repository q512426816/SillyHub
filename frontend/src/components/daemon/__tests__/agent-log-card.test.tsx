// task-04（2026-08-23-platform-agent-log-ingest / FR-04 / D-006）+
// ql-20260823-002-6a1a（改会话流内展示）：
// AgentLogCard「本地 Agent 日志」会话流条目单测。
//
// 覆盖：
//   1. 折叠默认态：只渲染一行摘要（标题 + N 个 + 最新 X 前），明细不渲染；
//   2. 展开交互：点头部摘要 → 明细列表（harness 徽标双分支 / originator /
//      session 短码 / 大小人性化 / 相对时间 + 绿点 / 调用次数 / 最近命令 /
//      log_path）；再点收起；
//   3. 条数折叠：>3 条默认 3 条 + 「展开全部 N 条」/「收起」；
//   4. 复制回调：navigator.clipboard.writeText 收到完整 session_id /
//      log_path，900ms「已复制 ✓」瞬时反馈后还原；
//   5. 静默隐藏：error / 空列表 / loading 一律返回 null（会话流内不出现
//      占位块，design §4：增强信息不干扰会话主体验）。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/agent-logs 的 listAgentLogs）
// 与 navigator.clipboard；断言用 aria-label / data-testid 避开样式细节。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentLogCard } from "../agent-log-card";
import type { AgentLogListItem } from "@/lib/agent-logs";

/* ----- mock 网络层 ----- */

const agentLogsApi = vi.hoisted(() => ({ listAgentLogs: vi.fn() }));

vi.mock("@/lib/agent-logs", () => ({
  listAgentLogs: agentLogsApi.listAgentLogs,
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

function setupCard(workspaceId = "ws-1") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentLogCard workspaceId={workspaceId} />
    </QueryClientProvider>,
  );
}

/** 等数据落地并展开明细（默认折叠：先等摘要出现，再点开）。 */
async function openEntries() {
  const toggle = await screen.findByTestId("agent-log-toggle");
  fireEvent.click(toggle);
  await screen.findByTestId("agent-log-entries");
}

beforeEach(() => {
  // jsdom 无剪贴板：mock writeText（复制回调断言对象）。
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

/* ───────────────── 1. 折叠默认态（会话流一行摘要） ───────────────── */

describe("AgentLogCard 会话流条目（折叠默认态）", () => {
  it("默认只渲染摘要行（标题 + N 个 + 最新相对时间），明细不出现", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: twoHarnessItems() });
    setupCard();

    // 查询参数：workspaceId 透传给 listAgentLogs。
    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalledWith("ws-1"));

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
