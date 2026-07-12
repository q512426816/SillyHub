// task-08（2026-07-12-team-main-agent-orchestration / FR-8）：
// changes/[cid]/page.tsx stage team toggle 渲染条件测试。
//
// 覆盖 v1 D-002 + task-08 扩展：
//   - brainstorm stage：不渲染 team toggle
//   - plan stage（pending_review=plan_review）：渲染 toggle（即将进 execute）
//   - execute stage：渲染 toggle（含「用团队执行」文案）
//   - verify stage：渲染 toggle（含「用团队验证」文案）
//   - human_test（pending_review=human_test）：渲染 toggle（verify 流转用）
//   - archived/quick/blocked：不渲染 toggle
//
// 只 mock 必要 lib，不测整个 page 业务（mission/team 三入口接通由 task-09）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// mock next/navigation（page.tsx Link 来自 next/link，不需 mock）
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// MarkdownText 用 next/dynamic ssr:false，jsdom 同步 render = null。
// 测的是 page 交互（team toggle），mock 成纯文本。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

const tasksApi = vi.hoisted(() => ({
  getTaskBoard: vi.fn(),
}));
vi.mock("@/lib/tasks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tasks")>("@/lib/tasks");
  return {
    ...actual,
    getTaskBoard: tasksApi.getTaskBoard,
  };
});

// page.tsx 从 @/lib/changes 引了 getAgentStatus 等多个具名导出；
// 一个 mock 同时替换 getChange/listReviews/executeChange/transitionChange/getAgentStatus。
const changesApi = vi.hoisted(() => ({
  getChange: vi.fn(),
  listReviews: vi.fn(),
  executeChange: vi.fn(),
  transitionChange: vi.fn(),
  getAgentStatus: vi.fn(),
}));
vi.mock("@/lib/changes", () => ({
  // 透传未 mock 的具名导出（运行时不被调用，仅满足 import 解析）
  approveChange: vi.fn(),
  rejectChange: vi.fn(),
  checkArchiveGate: vi.fn(),
  triggerDispatch: vi.fn(),
  proposalReview: vi.fn(),
  planReview: vi.fn(),
  humanTest: vi.fn(),
  archiveConfirm: vi.fn(),
  submitReview: vi.fn(),
  getChange: changesApi.getChange,
  listReviews: changesApi.listReviews,
  executeChange: changesApi.executeChange,
  transitionChange: changesApi.transitionChange,
  getAgentStatus: changesApi.getAgentStatus,
}));

// SillySpecStepProgress 内部用了 useAgentRunStream 等；mock 掉避免 SSE 链路
vi.mock("@/components/sillyspec-step-progress", () => ({
  SillySpecStepProgress: () => <div data-testid="step-progress" />,
}));

// AgentRunPanel 内部 SSE + UI，mock 掉避免复杂渲染
vi.mock("@/components/agent-run-panel", () => ({
  AgentRunPanel: () => <div data-testid="agent-run-panel" />,
}));

// ChangeSessionSection 内嵌 InteractiveSessionPanel，mock 掉
vi.mock("@/components/changes/change-session-section", () => ({
  ChangeSessionSection: () => <div data-testid="change-session" />,
}));

// ChangeFileTree mock
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: () => <div data-testid="change-file-tree" />,
}));

// AgentProviderSelect mock
vi.mock("@/components/AgentProviderSelect", () => ({
  AgentProviderSelect: () => <div data-testid="agent-provider-select" />,
}));

// dynamic import of page.tsx（避免 hoist 问题）
async function renderPage(changeOverrides: Record<string, unknown>) {
  const { default: ChangeDetailPage } = await import(
    "../page"
  );
  return render(
    <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />,
  );
}

function makeChange(overrides: Record<string, unknown> = {}) {
  return {
    change_key: "ch-key",
    title: "测试变更",
    current_stage: "execute",
    status: "in_progress",
    approval_status: "not_required",
    rejection_reason: null,
    approved_by: null,
    approved_at: null,
    change_type: "feature",
    location: "/path",
    affected_components: ["backend"],
    stages: {},
    pending_review: null,
    ...overrides,
  } as Record<string, unknown>;
}

describe("changes/[cid]/page.tsx task-08 team toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changesApi.getChange.mockResolvedValue(makeChange());
    changesApi.listReviews.mockResolvedValue([]);
    tasksApi.getTaskBoard.mockResolvedValue({ columns: [] });
    changesApi.getAgentStatus.mockResolvedValue({
      has_active_run: false,
      config_enabled: false,
      last_dispatch: null,
    });
  });

  it("execute stage 渲染 team toggle（含「用团队执行」文案）", async () => {
    changesApi.getChange.mockResolvedValue(makeChange({ current_stage: "execute" }));
    await renderPage({ current_stage: "execute" });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /用团队执行/ })).toBeInTheDocument(),
    );
    expect(screen.getByText(/用团队执行/)).toBeInTheDocument();
  });

  it("verify stage 渲染 team toggle（含「用团队验证」文案）", async () => {
    changesApi.getChange.mockResolvedValue(makeChange({ current_stage: "verify" }));
    await renderPage({ current_stage: "verify" });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /用团队执行/ })).toBeInTheDocument(),
    );
    // 文案随 stage 切「验证」
    expect(screen.getByText(/用团队验证/)).toBeInTheDocument();
  });

  it("pending_review=plan_review 渲染 team toggle（即将进 execute）", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ current_stage: "plan", pending_review: "plan_review" }),
    );
    await renderPage({ current_stage: "plan", pending_review: "plan_review" });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /用团队执行/ })).toBeInTheDocument(),
    );
  });

  it("pending_review=human_test 渲染 team toggle（verify 流转用）", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ current_stage: "verify", pending_review: "human_test" }),
    );
    await renderPage({ current_stage: "verify", pending_review: "human_test" });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /用团队执行/ })).toBeInTheDocument(),
    );
  });

  it("brainstorm stage 不渲染 team toggle", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ current_stage: "brainstorm" }),
    );
    await renderPage({ current_stage: "brainstorm" });
    await waitFor(() => expect(screen.getByText("测试变更")).toBeInTheDocument());
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("plan stage（无 plan_review pending）不渲染 team toggle", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ current_stage: "plan", pending_review: null }),
    );
    await renderPage({ current_stage: "plan", pending_review: null });
    await waitFor(() => expect(screen.getByText("测试变更")).toBeInTheDocument());
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("archived status 不渲染 team toggle", async () => {
    changesApi.getChange.mockResolvedValue(
      makeChange({ current_stage: "archive", status: "archived" }),
    );
    await renderPage({ current_stage: "archive", status: "archived" });
    await waitFor(() => expect(screen.getByText("测试变更")).toBeInTheDocument());
    expect(screen.queryByRole("switch", { name: /用团队/ })).not.toBeInTheDocument();
  });

  it("开启 team toggle 后渲染 StageTeamConfig worker 预设面板", async () => {
    changesApi.getChange.mockResolvedValue(makeChange({ current_stage: "execute" }));
    await renderPage({ current_stage: "execute" });
    const toggle = await screen.findByRole("switch", { name: /用团队执行/ });
    // 点击开启
    (toggle as HTMLButtonElement).click();
    // StageTeamConfig 出现「+ 添加 Worker」按钮
    await waitFor(() =>
      expect(screen.getByText("+ 添加 Worker")).toBeInTheDocument(),
    );
    // 含 stage worker 区头
    expect(screen.getByText(/Stage Worker 预设/)).toBeInTheDocument();
  });
});
