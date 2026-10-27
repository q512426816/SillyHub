// 2026-09-26-change-detail-restore-assets 的「防静默回滚」钉子；
// 2026-10-15-change-detail-redesign / task-07 按新结构（四 tab 容器）重写：
// 原钉子钉的是「aside/主栏直接挂载 + 双时间线共存」，本变更由设计明确取代
// （D-002 四 tab 分区 / D-005 两时间线合并为一条），故断言面迁移为「新结构的等价钉子」：
//   1. 页头徽章：thin 出身「轻量变更」、归档轻量出身「轻量变更 + 已归档」、历史 quick 不误标；
//   2. 头部变更描述单行截断（无描述零占位）；
//   3. tab 结构：在途四 tab / 归档三 tab（无「文件与对账」）+ 面板懒挂载（切 tab 才挂）；
//   4. 产出 tab：图谱在资产卡之前（原「资产卡在时间线之前」的同类顺序钉子）；
//   5. 两旧时间线卡 MUST NOT 挂载（D-005 取代方向反钉）；
//   6. 范围对账 archived 传参（经「文件与对账」面板透传）；
//   7. 页模块导出契约 isTerminalChange 在场（移动端消费面，D-011）。
//
// 卡片组件全部 stub（只验页面挂载/传参/顺序），组件内部由各自套件覆盖。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage, { isTerminalChange } from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
import type { ChangeRead } from "@/lib/changes";

const mocks = vi.hoisted(() => ({
  getChange: vi.fn(),
  listChangeSessions: vi.fn(),
  listQuicklogEntries: vi.fn(),
}));

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace }),
  useSearchParams: () => navMocks.searchParams,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/changes", () => ({
  getChange: mocks.getChange,
  submitStageReview: vi.fn(),
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline-in-page-tests")),
  getChangeAssets: vi.fn().mockRejectedValue(new Error("no-assets-in-page-tests")),
  getChangeUsage: vi.fn().mockRejectedValue(new Error("no-usage-in-page-tests")),
  getScopeAudit: vi.fn().mockRejectedValue(new Error("no-audit-in-page-tests")),
}));

vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));

vi.mock("@/lib/quicklog", () => ({
  listQuicklogEntries: mocks.listQuicklogEntries,
}));

// 自取数只读件 stub：挂载与顺序断言面（testid 在场即挂载），内部行为各自组件套件覆盖。
vi.mock("@/components/changes/detail/change-assets-card", () => ({
  ChangeAssetsCard: () => <div data-testid="change-assets-card" />,
}));
vi.mock("@/components/changes/detail/change-assets-graph", () => ({
  ChangeAssetsGraph: () => <div data-testid="change-assets-graph" />,
  DEFAULT_CANVAS_HEIGHT: 420,
}));
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: () => <div data-testid="change-file-tree" />,
}));
vi.mock("@/components/changes/scope-audit-command-card", () => ({
  ScopeAuditCommandCard: ({ archived }: { archived?: boolean; target?: unknown }) => (
    <div
      data-testid="scope-audit-command-card"
      data-archived={archived === undefined ? "unset" : String(archived)}
    />
  ),
}));
vi.mock("@/components/changes/detail/change-unified-timeline", () => ({
  ChangeUnifiedTimeline: () => <div data-testid="change-unified-timeline" />,
}));
vi.mock("@/components/changes/detail/change-task-checklist", () => ({
  ChangeTaskChecklist: () => <div data-testid="change-task-checklist" />,
}));
vi.mock("@/components/changes/detail/change-usage-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/changes/detail/change-usage-card")>();
  return actual; // 用量取数/格式化真实实现（信息栏压缩行断言依赖）
});

function makeChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-08-14-test-change",
    title: "测试变更",
    description: "描述一行",
    current_stage: "execute",
    pending_review: null,
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: ["frontend"],
    updated_at: "2026-08-14T10:00:00Z",
    created_at: "2026-08-14T09:00:00Z",
    stages: {},
    steps: [],
    ...over,
  } as unknown as ChangeRead;
}

async function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ChangeDetailPage params={{ id: "ws-1", cid: "ch-1" }} />
    </QueryClientProvider>,
  );
  await screen.findByText(/测试变更/);
}

beforeEach(() => {
  vi.clearAllMocks();
  navMocks.searchParams = new URLSearchParams();
  mocks.listChangeSessions.mockResolvedValue([]);
  mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("页头徽章与描述（钉子 1/2）", () => {
  it("thin 阶段：标题旁显示「轻量变更」徽章", async () => {
    mocks.getChange.mockResolvedValue(makeChange({ current_stage: "thin", is_thin: true } as never));
    await renderPage();
    // 「轻量变更」在页头状态胶囊与轻量流程条各出现一次（两处同源语义）
    expect(screen.getAllByText("轻量变更").length).toBeGreaterThan(0);
    expect(screen.getByText("测试变更")).toBeInTheDocument();
  });

  it("归档轻量出身（location=archive）→「轻量变更 + 已归档」双徽章", async () => {
    mocks.getChange.mockResolvedValue(
      makeChange({
        location: "archive",
        status: "archived",
        change_type: "quick",
        created_at: "2026-09-26T00:00:00+08:00",
      }),
    );
    await renderPage();
    expect(screen.getAllByText("轻量变更").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已归档").length).toBeGreaterThan(0);
  });

  it("2026-09-25 前历史 quick 归档仅「已归档」（不误标轻量）", async () => {
    mocks.getChange.mockResolvedValue(
      makeChange({
        location: "archive",
        status: "archived",
        change_type: "quick",
        created_at: "2026-08-01T00:00:00+08:00",
      }),
    );
    await renderPage();
    expect(screen.queryByText("轻量变更")).toBeNull();
  });

  it("头部显示变更描述（单行截断 + 悬浮全文）", async () => {
    mocks.getChange.mockResolvedValue(makeChange({ description: "这是一个很长的描述" }));
    await renderPage();
    expect(screen.getByTitle("这是一个很长的描述")).toHaveTextContent("这是一个很长的描述");
  });
});

describe("tab 结构与懒挂载（钉子 3/5）", () => {
  it("在途：四 tab，且只挂载「概览」面板（其余 tab 懒挂载）", async () => {
    mocks.getChange.mockResolvedValue(makeChange());
    await renderPage();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["概览", "产出", "过程", "文件与对账"]);
    expect(await screen.findByTestId("change-overview-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-panel")).toBeNull();
    expect(screen.queryByTestId("change-process-panel")).toBeNull();
    expect(screen.queryByTestId("change-files-panel")).toBeNull();
  });

  it("归档：四 tab 齐全；深链 ?tab=files 直达文件与对账面板（D-019@v1 不再钳制）", async () => {
    mocks.getChange.mockResolvedValue(
      makeChange({ location: "archive", status: "archived" }),
    );
    navMocks.searchParams = new URLSearchParams("tab=files");
    await renderPage();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "概览",
      "产出",
      "过程",
      "文件与对账",
    ]);
    expect(await screen.findByTestId("change-files-panel")).toBeInTheDocument();
  });

  it("两旧时间线卡 MUST NOT 挂载（D-005 取代方向反钉）", async () => {
    mocks.getChange.mockResolvedValue(
      makeChange({
        steps: [
          {
            name: "需求分析完成",
            stage: "brainstorm",
            status: "completed",
            output: null,
            completed_at: "2026-10-15T21:08:00Z",
            ordering: 1,
            wait_reason: null,
            kind: "step",
            event_type: null,
          },
        ],
      }),
    );
    navMocks.searchParams = new URLSearchParams("tab=process");
    await renderPage();
    expect(await screen.findByTestId("change-process-panel")).toBeInTheDocument();
    expect(screen.getByTestId("change-unified-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("change-step-timeline-card")).toBeNull();
    expect(screen.queryByTestId("change-timeline-card")).toBeNull();
  });
});

describe("产出 tab 顺序与文件与对账挂载（钉子 4/6）", () => {
  it("产出 tab：知识图谱分区位于资产卡之前（同类顺序钉子）", async () => {
    mocks.getChange.mockResolvedValue(makeChange());
    navMocks.searchParams = new URLSearchParams("tab=assets");
    await renderPage();
    const panel = await screen.findByTestId("change-assets-panel");
    const graph = screen.getByTestId("change-assets-graph");
    const card = screen.getByTestId("change-assets-card");
    expect(panel).toContainElement(graph);
    expect(
      graph.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("文件与对账 tab：范围对账卡收到 archived=false（非 unset）", async () => {
    mocks.getChange.mockResolvedValue(makeChange());
    navMocks.searchParams = new URLSearchParams("tab=files");
    await renderPage();
    const audit = await screen.findByTestId("scope-audit-command-card");
    expect(audit.getAttribute("data-archived")).toBe("false");
    expect(screen.getByTestId("change-file-tree")).toBeInTheDocument();
  });
});

describe("页模块导出契约（钉子 7，D-011/D-016）", () => {
  it("isTerminalChange 从页面模块导出且语义不变（移动端消费面）", () => {
    expect(typeof isTerminalChange).toBe("function");
    expect(isTerminalChange({ status: "archived", location: "active" })).toBe(true);
    expect(isTerminalChange({ status: "active", location: "archive" })).toBe(true);
    expect(isTerminalChange({ status: "active", location: "active" })).toBe(false);
    expect(isTerminalChange(null)).toBe(false);
  });
});
