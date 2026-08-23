// task-04（2026-08-23-platform-agent-log-ingest / FR-04 / D-006）：
// AgentLogCard「本地 Agent 日志」卡片单测（design §3.4 + 原型
// prototype-agent-log-panel.html 三态）。
//
// 覆盖：
//   1. 列表渲染字段：harness 徽标（codex brand / zcode info 青双分支）/
//      originator 标签 / session 短码（uuid 前 8…后 4）/ 大小人性化 /
//      相对时间活跃 + 15 分钟内绿点 / 调用次数 / 最近命令 code / log_path；
//   2. 空态文案（虚线框引导 sillyspec run 自动上报）；
//   3. 折叠交互：>3 条默认 3 条 + 「展开全部 N 条」/「收起」；
//   4. 复制回调：navigator.clipboard.writeText 收到完整 session_id /
//      log_path，900ms「已复制 ✓」瞬时反馈后还原；
//   5. error 静默返回 null（design §4：增强信息不干扰会话主体验）。
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

beforeEach(() => {
  // jsdom 无剪贴板：mock writeText（复制回调断言对象）。
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

/* ───────────────── 1. 列表渲染字段 ───────────────── */

describe("AgentLogCard 列表渲染", () => {
  it("渲染 harness 徽标 / originator / session 短码 / 大小 / 活跃时间 / 调用次数 / 最近命令 / log_path", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: twoHarnessItems() });
    setupCard();

    // 查询参数：workspaceId 透传给 listAgentLogs（findByText 等数据落地后首断言）。
    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalledWith("ws-1"));

    // harness 徽标：codex（brand 阶）+ zcode（info 青分支；zcode 同名 originator 共 2 处）。
    expect(await screen.findByText("codex")).toBeInTheDocument();
    expect(screen.getAllByText("zcode")).toHaveLength(2);
    // originator：daemon 来源标签。
    expect(screen.getByText("sillyhub-daemon")).toBeInTheDocument();

    // session 短码：uuid 前 8 + … + 后 4（原型 sess 8f14e45f…5a9c）。
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

    expect(await screen.findByText("codex")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /复制 session_id/ })).toHaveLength(0);
    // 大小 / 时间 null → 「—」。
    expect(screen.getByText("— · —")).toBeInTheDocument();
    expect(screen.getByText("调用 — 次")).toBeInTheDocument();
    expect(screen.queryAllByLabelText("最近活跃")).toHaveLength(0);
  });
});

/* ───────────────── 2. 空态 ───────────────── */

describe("AgentLogCard 空态", () => {
  it("无上报：虚线框引导文案（sillyspec run 自动上报）", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({ items: [] });
    setupCard();

    expect(
      await screen.findByText("尚未收到该工作区的 agent 日志上报"),
    ).toBeInTheDocument();
    expect(screen.getByText("sillyspec run")).toBeInTheDocument();
  });
});

/* ───────────────── 3. 折叠 / 展开 ───────────────── */

describe("AgentLogCard 折叠交互", () => {
  it("默认 3 条，超出折叠，「展开全部 N 条」/「收起」切换", async () => {
    agentLogsApi.listAgentLogs.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) =>
        makeItem({ id: `log-${i + 1}`, session_id: `sess-0000000${i + 1}-0000-0000-0000-00000000000${i}` }),
      ),
    });
    setupCard();

    const list = await screen.findByTestId("agent-log-entries");
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
    await screen.findByText("codex");

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

/* ───────────────── 5. error 静默隐藏 ───────────────── */

describe("AgentLogCard error 态", () => {
  it("查询失败返回 null（卡片隐藏，不干扰会话主体验）", async () => {
    agentLogsApi.listAgentLogs.mockRejectedValue(new Error("network down"));
    const { container } = setupCard();

    await waitFor(() => expect(agentLogsApi.listAgentLogs).toHaveBeenCalled());
    // 先经历 pending（「加载中…」）再落 error → 整卡卸载。
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
