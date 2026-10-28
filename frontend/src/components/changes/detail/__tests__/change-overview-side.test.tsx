// 2026-10-15-change-detail-redesign / task-06（FR-08 / D-006@v1 / D-016@v1）：
// 概览右侧信息栏测试——三组渲染（基本信息/执行用量/会话）、用量取数复用（同一
// hook 与 queryKey）、归档态用量形态（标题「执行用量（合计）」+ MUST NOT 提供按
// 模型明细入口）。
// 2026-10-28-change-detail-side-assets-scroll：「范围对账」「产出速览」两组已移除
// （用户裁决——明细入口由专属 tab 承接），相关断言与 mock 一并撤除。
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeOverviewSide } from "@/components/changes/detail/change-overview-side";
import { getChangeUsage } from "@/lib/changes";
import type { ChangeRead } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

vi.mock("@/lib/changes", () => ({
  getChangeUsage: vi.fn(),
}));

const mockUsage = vi.mocked(getChangeUsage);

const CHANGE = {
  id: "c-1",
  workspace_id: "ws-1",
  change_key: "2026-10-15-demo",
  change_type: "full",
  created_at: "2026-10-15T12:00:00Z",
  owner_name: "qinyi",
} as ChangeRead;

const SESSIONS: AgentSessionListItem[] = [
  { id: "sess-ff095390-aaaa", title: null, status: "active" } as AgentSessionListItem,
  { id: "sess-2", title: "第二个会话", status: "ended" } as AgentSessionListItem,
];

function renderSide(archived = false, changePatch: Partial<ChangeRead> = {}) {
  const change = { ...CHANGE, ...changePatch } as ChangeRead;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChangeOverviewSide
        change={change}
        workspaceId="ws-1"
        changeId="c-1"
        archived={archived}
        sessions={SESSIONS}
      />
    </QueryClientProvider>,
  );
}

describe("ChangeOverviewSide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsage.mockResolvedValue({
      started_at: "2026-10-16T00:00:00Z",
      finished_at: "2026-10-16T05:00:00Z",
      duration_ms: 18_000_000,
      totals: {
        input_tokens: 1284,
        output_tokens: 96,
        cache_read_tokens: 9120,
        cache_creation_tokens: 0,
        api_requests: 412,
        num_turns: 38,
      },
      by_model: [],
    } as never);
  });

  it("三组渲染：基本信息 / 执行用量 / 会话（范围对账与产出速览已移除）", async () => {
    renderSide();
    expect(screen.getByTestId("change-overview-side")).toBeInTheDocument();
    for (const title of ["基本信息", "执行用量", "会话"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // 移除的两组不再渲染（2026-10-28-change-detail-side-assets-scroll）。
    expect(screen.queryByText("范围对账")).not.toBeInTheDocument();
    expect(screen.queryByText("产出速览")).not.toBeInTheDocument();
    expect(screen.queryByText("明细见「文件与对账」")).not.toBeInTheDocument();
    expect(screen.queryByText("明细见「产出」")).not.toBeInTheDocument();
    expect(screen.getByText("2026-10-15-demo")).toBeInTheDocument();
    expect(screen.getByText("qinyi")).toBeInTheDocument();
  });

  // ── 类型行 git conventional 彩色标签（2026-10-18-change-type-git-conventional）──

  it("类型行：已知前缀渲染彩色标签（fix 红色阶 / docs 蓝色阶）", () => {
    renderSide(false, { change_type: "fix" });
    const chip = screen.getByTestId("commit-type-chip");
    expect(chip).toHaveTextContent("fix");
    expect(chip.className).toContain("border-red");

    cleanup();
    renderSide(false, { change_type: "docs" });
    const docsChip = screen.getByTestId("commit-type-chip");
    expect(docsChip).toHaveTextContent("docs");
    expect(docsChip.className).toContain("border-blue");
  });

  it("类型行：旧枚举 feature 显示层等价映射 feat（数据不动）", () => {
    renderSide(false, { change_type: "feature" });
    expect(screen.getByTestId("commit-type-chip")).toHaveTextContent("feat");
  });

  it("类型行：未知前缀中性配色显示原值（不误配色）", () => {
    renderSide(false, { change_type: "hotfix" });
    const chip = screen.getByTestId("commit-type-chip");
    expect(chip).toHaveTextContent("hotfix");
    expect(chip.className).not.toContain("border-red");
  });

  it("类型行：change_type 为空 → 显示 —（无标签）", () => {
    renderSide(false, { change_type: null });
    expect(screen.queryByTestId("commit-type-chip")).not.toBeInTheDocument();
    const typeRow = screen.getByText("类型").closest("div");
    expect(typeRow).toHaveTextContent("—");
  });

  it("用量七项压缩行与用量卡同源（耗时/轮次/输入/输出/缓存读取/请求次数/命中率）", async () => {
    renderSide();
    expect(await screen.findByText("耗时")).toBeInTheDocument();
    for (const label of ["轮次", "输入", "输出", "缓存读取", "请求次数", "缓存命中率"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("5.0 小时")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
  });

  it("会话组：最近 2 条（title 优先，缺省回退 id 前 8）+ 工作台入口", () => {
    renderSide();
    expect(screen.getByText("第二个会话")).toBeInTheDocument();
    expect(screen.getByText("sess-ff0")).toBeInTheDocument();
    expect(screen.getByText("打开会话工作台 →")).toBeInTheDocument();
  });

  it("会话组：状态列显示中文标签（active→进行中 / ended→已结束，FR-03）", () => {
    renderSide();
    const sessionsSection = screen.getByText("会话").closest("div");
    expect(sessionsSection).toHaveTextContent("进行中");
    expect(sessionsSection).toHaveTextContent("已结束");
    // 不再裸显英文枚举
    expect(within(sessionsSection!).queryByText("active")).not.toBeInTheDocument();
    expect(within(sessionsSection!).queryByText("ended")).not.toBeInTheDocument();
  });

  it("会话组：未知状态值回退显示原文（不误吞）", () => {
    cleanup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ChangeOverviewSide
          change={CHANGE as ChangeRead}
          workspaceId="ws-1"
          changeId="c-1"
          archived={false}
          sessions={[
            { id: "sess-x1", title: "未知态会话", status: "hibernating" } as AgentSessionListItem,
          ]}
        />
      </QueryClientProvider>,
    );
    const sessionsSection = screen.getByText("会话").closest("div");
    expect(sessionsSection).toHaveTextContent("hibernating");
  });

  it("在途态：提供「按模型明细」入口（用量区为唯一可展开入口）", async () => {
    renderSide(false);
    expect(await screen.findByText("按模型明细 →")).toBeInTheDocument();
    expect(screen.queryByText(/执行用量（合计）/)).not.toBeInTheDocument();
  });

  it("归档态：用量标题改「合计」且 MUST NOT 提供按模型明细（Phase 4 契约）", async () => {
    renderSide(true);
    expect(screen.getByText("执行用量（合计）")).toBeInTheDocument();
    expect(await screen.findByText("耗时")).toBeInTheDocument(); // 等用量数据落定再断言入口缺席
    expect(screen.queryByText("按模型明细 →")).not.toBeInTheDocument();
  });
});
