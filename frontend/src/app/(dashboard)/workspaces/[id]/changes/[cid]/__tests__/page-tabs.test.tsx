// 2026-10-15-change-detail-redesign / task-07（FR-02 / FR-03 / FR-15 / D-013@v1）：
// tab 驱动与 thin 页面级断言（避免与 page-restore-assets 重复：后者的钉子面是
// 徽章/懒挂载/顺序/导出契约；本文件只覆盖「URL 驱动 + 切换回调 + thin 不特判」）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangeDetailPage from "@/app/(dashboard)/workspaces/[id]/changes/[cid]/page";
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
  getChangeTimeline: vi.fn().mockRejectedValue(new Error("no-timeline")),
  getChangeAssets: vi.fn().mockRejectedValue(new Error("no-assets")),
  getChangeUsage: vi.fn().mockRejectedValue(new Error("no-usage")),
  getScopeAudit: vi.fn().mockRejectedValue(new Error("no-audit")),
}));
vi.mock("@/lib/daemon", () => ({
  listChangeSessions: mocks.listChangeSessions,
}));
vi.mock("@/lib/quicklog", () => ({ listQuicklogEntries: mocks.listQuicklogEntries }));

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
  ScopeAuditCommandCard: () => <div data-testid="scope-audit-command-card" />,
}));
vi.mock("@/components/changes/detail/change-unified-timeline", () => ({
  ChangeUnifiedTimeline: () => <div data-testid="change-unified-timeline" />,
}));
vi.mock("@/components/changes/detail/change-task-checklist", () => ({
  ChangeTaskChecklist: () => <div data-testid="change-task-checklist" />,
}));

function makeChange(over: Partial<ChangeRead> = {}): ChangeRead {
  return {
    id: "ch-1",
    change_key: "2026-08-14-test-change",
    title: "测试变更",
    description: null,
    current_stage: "execute",
    pending_review: null,
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: [],
    updated_at: "2026-08-14T10:00:00Z",
    created_at: "2026-08-14T09:00:00Z",
    stages: {},
    steps: [],
    ...over,
  } as unknown as ChangeRead;
}

async function renderAt(search: string, change: ChangeRead) {
  navMocks.searchParams = new URLSearchParams(search);
  mocks.getChange.mockResolvedValue(change);
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
  mocks.listChangeSessions.mockResolvedValue([]);
  mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
});
afterEach(cleanup);

describe("tab URL 驱动（D-013@v1）", () => {
  it("?tab=assets 深链直接落在「产出」tab（不钳制）", async () => {
    await renderAt("tab=assets", makeChange());
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe("产出");
    expect(await screen.findByTestId("change-assets-panel")).toBeInTheDocument();
    expect(navMocks.replace).not.toHaveBeenCalled();
  });

  it("当前 tab 高亮；切换 tab 触发 router.replace 带上 ?tab=（URL 为唯一源）", async () => {
    await renderAt("", makeChange());
    const processTab = screen.getAllByRole("tab").find((t) => t.textContent === "过程");
    expect(processTab).toBeDefined();
    if (processTab) fireEvent.click(processTab);
    expect(navMocks.replace).toHaveBeenCalledWith(
      "/workspaces/ws-1/changes/ch-1?tab=process",
    );
  });
});

describe("归档态收窄与两态空态互斥（task-08 / D-001@v1 / D-007@v1）", () => {
  it("归档态：不出「继续执行」、不渲染在途空态文案、用量区为合计形态；文件与对账 tab 在场（D-019@v1）", async () => {
    await renderAt("", makeChange({ location: "archive", status: "archived" }));
    expect(screen.queryByTestId("change-continue-entry")).toBeNull();
    // 归档首屏为成果语义：摘要卡标题「成果总结」+ 归档留档摘要；无「执行中/进行中」类在途文案
    expect(await screen.findByTestId("change-overview-summary")).toBeInTheDocument();
    expect(screen.getByText("成果总结")).toBeInTheDocument();
    expect(screen.queryByText("进行中")).toBeNull();
    expect(screen.queryByText("非终态每 10 秒自动刷新")).toBeNull();
    navMocks.searchParams = new URLSearchParams("tab=files");
  });

  it("在途态：不出归档空位（无「归档留档」文本、无成果总结卡）", async () => {
    await renderAt("", makeChange());
    expect(await screen.findByTestId("change-overview-panel")).toBeInTheDocument();
    expect(screen.getByTestId("change-continue-entry")).toBeInTheDocument();
    expect(screen.queryByText(/归档留档/)).toBeNull();
    expect(screen.queryByText("成果总结")).toBeNull();
  });
});

describe("thin 出身不特判（D-015@v1）", () => {
  it("thin 在途：同样四个 tab，且阶段条位置渲染轻量流程条", async () => {
    await renderAt(
      "",
      makeChange({
        current_stage: "thin",
        change_type: "quick",
        created_at: "2026-10-01T00:00:00+08:00",
      } as never),
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["概览", "产出", "过程", "文件与对账"]);
    expect(screen.getByText("flow start")).toBeInTheDocument();
    expect(screen.getByText(/flow done 收口/)).toBeInTheDocument();
  });
});
