// 2026-10-15-change-detail-redesign / task-03（Grill B-3 契约）：
// 资产卡降级与分组形态边界测试——
//   ①主查询失败：卡头保留 + 分区级错误说明（不再整卡 return null）；
//   ②归档态失败：额外渲染「归档留档」分区壳 + 重试入口（D-007 的降级路径不被静默掐断）；
//   ③在途态失败：不渲染归档留档壳；
//   ④在途态即使有 patch/delta 数据也不渲染「归档留档」组（D-001：两态互不出现对方空位）；
//   ⑤分组上限：每组最多直接显示 5 行 + 「展开全部 N 条」可展开/收起（取代固定高度内滚）。
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { getChangeAssets, getChangePatchFile } from "@/lib/changes";

vi.mock("@/lib/changes", () => ({
  getChangeAssets: vi.fn(),
  getChangePatchFile: vi.fn(),
}));

vi.mock("@/lib/explorer", () => ({
  fetchSearch: vi.fn(),
}));

vi.mock("@/lib/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge")>();
  return { ...actual, getKnowledge: vi.fn() };
});

const mockGet = vi.mocked(getChangeAssets);
const mockPatchFile = vi.mocked(getChangePatchFile);

function renderCard(archived?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChangeAssetsCard
        workspaceId="ws-1"
        changeId="c-1"
        changeKey="k-demo"
        archived={archived}
      />
    </QueryClientProvider>,
  );
}

function fullFixture(over: Record<string, unknown> = {}) {
  return {
    change_key: "k",
    archived: true,
    fr_entries: [],
    decisions: [],
    test_rows: [],
    patch: {
      files: 6,
      additions: 10,
      deletions: 9,
      patch_status: "ok",
      saved_at: null,
      file_list: ["src/flow.js"],
      files_truncated: false,
    },
    delta: { headline: "h", before_lines: 2, delta_lines: 1 },
    knowledge_touch: [],
    touched_modules: [],
    ...over,
  };
}

describe("ChangeAssetsCard 降级与分组形态（task-03）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchFile.mockResolvedValue({ path: "src/flow.js", diff: "", note: null, truncated: false });
  });

  it("在途态主查询失败：卡头保留 + 错误说明 + 重试入口，且不渲染归档留档壳", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderCard(false);
    expect(await screen.findByTestId("change-assets-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-card")).toBeInTheDocument();
    expect(screen.getByText(/沉淀资产暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-audit-fallback")).not.toBeInTheDocument();
  });

  it("归档态主查询失败：额外渲染「归档留档」分区壳与重试入口（降级路径不被掐断）", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderCard(true); // 页面层传 isTerminalChange(change)：首帧失败也能判定归档语义
    expect(await screen.findByTestId("change-assets-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-audit-fallback")).toBeInTheDocument();
    expect(screen.getByText(/改动面数据暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("在途态主查询失败：不渲染归档留档壳（两态互不出现对方空位）", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderCard(false);
    expect(await screen.findByTestId("change-assets-error")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-audit-fallback")).not.toBeInTheDocument();
  });

  it("在途态有 patch/delta 数据也不渲染「归档留档」组（两态互不出现对方空位）", async () => {
    mockGet.mockResolvedValue(fullFixture({ archived: false }));
    renderCard();
    expect(await screen.findByTestId("change-assets-card")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-audit")).not.toBeInTheDocument();
    expect(screen.queryByText("归档留档")).not.toBeInTheDocument();
  });

  it("归档态有 patch/delta 数据：渲染「归档留档」组（对照组）", async () => {
    mockGet.mockResolvedValue(fullFixture({ archived: true }));
    renderCard();
    expect(await screen.findByTestId("change-assets-audit")).toBeInTheDocument();
  });

  it("分组上限：8 条 FR 只直接显示 5 行 + 「展开全部 8 条」，展开后全量、可再收起", async () => {
    mockGet.mockResolvedValue(
      fullFixture({
        archived: false,
        fr_entries: Array.from({ length: 8 }, (_, i) => ({
          id: `FR-auto-x-00${i + 1}`,
          title: `条目${i + 1}`,
          status: "active",
          file: "knowledge/fr/x.md",
        })),
        patch: null,
        delta: null,
      }),
    );
    renderCard();
    expect(await screen.findByTestId("change-assets-fr")).toBeInTheDocument();
    expect(screen.getAllByText(/^FR-auto-x-00/)).toHaveLength(5);

    fireEvent.click(screen.getByText(/展开全部 8 条/));
    expect(screen.getAllByText(/^FR-auto-x-00/)).toHaveLength(8);

    fireEvent.click(screen.getByText("收起"));
    expect(screen.getAllByText(/^FR-auto-x-00/)).toHaveLength(5);
  });

  it("分组限高滚动：卡片最大高度固定 + 组内滚动容器（2026-10-28-change-detail-side-assets-scroll 用户裁决，推翻 2026-10-15 自然高度口径）", async () => {
    mockGet.mockResolvedValue(
      fullFixture({
        archived: false,
        // 8 条：触发「展开全部」按钮渲染（≤5 条无按钮，滚动区外断言无从验）。
        fr_entries: Array.from({ length: 8 }, (_, i) => ({
          id: `FR-auto-x-00${i + 1}`,
          title: `条目${i + 1}`,
          status: "active",
          file: "knowledge/fr/x.md",
        })),
        patch: null,
        delta: null,
      }),
    );
    const { container } = renderCard();
    const group = await screen.findByTestId("change-assets-fr");
    // 卡片限高（max-h-64）+ 内容区滚动容器在场。
    expect(group.className).toContain("max-h-64");
    expect(container.querySelectorAll(".overflow-y-auto").length).toBeGreaterThan(0);
    // 展开按钮钉在滚动区外（卡片层直接子级，不被滚动带走）。
    const toggle = container.querySelector('[data-testid="change-assets-group-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.closest(".overflow-y-auto")).toBeNull();
  });
});
