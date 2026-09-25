// 2026-09-25-change-precipitated-assets（FR-03/04）：沉淀资产卡组件测试。
// 覆盖：四组渲染（fr/决策/测试绑定/归档留档逐组有数据才出现）+ 计数徽标、
// 逐组容错（仅 fr 有数据时其余组不渲染）、在途变更引导空态、归档全空态、
// 失败静默隐藏（isError → 整卡 null）。
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { getChangeAssets } from "@/lib/changes";

vi.mock("@/lib/changes", () => ({
  getChangeAssets: vi.fn(),
}));

const mockGet = vi.mocked(getChangeAssets);

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeAssetsCard workspaceId="ws-1" changeId="c-1" />
    </QueryClientProvider>,
  );
}

const FULL = {
  change_key: "k",
  archived: true,
  fr_entries: [
    { id: "FR-auto-x-001", title: "条目一", status: "active", file: "knowledge/fr/x.md" },
  ],
  decisions: [
    { id: "D-001@v1", title: "决策一", status: "implemented", file: "knowledge/decisions/x.md" },
  ],
  test_rows: [
    {
      row_id: "k:task-01:acc-0",
      anchor: "FR-01",
      tests: ["backend/app/x.py"],
      state: "candidate",
    },
  ],
  patch: { files: 6, additions: 10, deletions: 9, patch_status: "ok", saved_at: null },
  delta: { headline: "h", before_lines: 2, delta_lines: 1 },
};

describe("ChangeAssetsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("四组渲染：展开后 fr/决策/测试绑定/归档留档逐组出现，计数徽标正确", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();

    expect(await screen.findByText(/FR 1 · 决策 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /沉淀资产/ }));
    expect(await screen.findByTestId("change-assets-fr")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-decisions")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-tests")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-audit")).toBeInTheDocument();
    expect(screen.getByText("FR-auto-x-001")).toBeInTheDocument();
    expect(screen.getByText(/6 文件 \+10\/−9/)).toBeInTheDocument();
  });

  it("逐组容错：仅 fr 有数据时其余组不渲染", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      decisions: [],
      test_rows: [],
      patch: null,
      delta: null,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(await screen.findByTestId("change-assets-fr")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-decisions")).toBeNull();
    expect(screen.queryByTestId("change-assets-tests")).toBeNull();
    expect(screen.queryByTestId("change-assets-audit")).toBeNull();
  });

  it("在途变更（archived=false 且无数据）显示引导空态", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      archived: false,
      fr_entries: [],
      decisions: [],
      test_rows: [],
      patch: null,
      delta: null,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(
      await screen.findByTestId("change-assets-inflight"),
    ).toBeInTheDocument();
  });

  it("归档变更全空态显示占位文案", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      fr_entries: [],
      decisions: [],
      test_rows: [],
      patch: null,
      delta: null,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(await screen.findByText("本变更暂无沉淀资产记录。")).toBeInTheDocument();
  });

  it("失败静默：isError → 整卡不渲染", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    const { container } = renderCard();
    // 等 query 落定（retry:false 单次即败）后断言空渲染。
    await new Promise((r) => setTimeout(r, 100));
    expect(container.querySelector('[data-testid="change-assets-card"]')).toBeNull();
  });
});
