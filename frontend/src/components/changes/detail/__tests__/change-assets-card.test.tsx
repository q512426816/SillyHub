// 2026-09-25-change-precipitated-assets（FR-03/04）：沉淀资产卡组件测试。
// 覆盖：四组渲染（fr/决策/测试绑定/归档留档逐组有数据才出现）+ 计数徽标、
// 逐组容错（仅 fr 有数据时其余组不渲染）、在途变更引导空态、归档全空态、
// 失败静默隐藏（isError → 整卡 null）。
//
// 2026-09-25-change-detail-assets-usability（FR-01~04）追加：FR/决策行 href 带
// file+anchor 深链、测试绑定行点开测试文件预览弹窗（FilePreview 收到仓库路径）、
// 归档留档文件清单渲染与点开单文件 diff 弹窗（命中/note 两态）。
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { getChangeAssets, getChangePatchFile } from "@/lib/changes";

vi.mock("@/lib/changes", () => ({
  getChangeAssets: vi.fn(),
  getChangePatchFile: vi.fn(),
}));

// FilePreview 走 explorer 取数（仓库文件），本卡只验证「弹窗打开且把路径交给它」——
// 取数与渲染由 explorer 自己的用例覆盖，这里用替身把路径回显出来。
vi.mock("@/components/explorer/file-preview", () => ({
  FilePreview: ({ filePath }: { filePath: string | null }) => (
    <div data-testid="file-preview-stub">{filePath}</div>
  ),
}));

const mockGet = vi.mocked(getChangeAssets);
const mockPatch = vi.mocked(getChangePatchFile);

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
  patch: {
    files: 6,
    additions: 10,
    deletions: 9,
    patch_status: "ok",
    saved_at: null,
    file_list: ["src/flow.js", "test/x.test.mjs"],
    files_truncated: false,
  },
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

  it("FR/决策索引行：href 带 file+anchor 深链（FR-01/02）", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    const frLink = (await screen.findByText("FR-auto-x-001")).closest("a");
    expect(frLink).toHaveAttribute(
      "href",
      "/workspaces/ws-1/knowledge?file=knowledge%2Ffr%2Fx.md&anchor=FR-auto-x-001",
    );
    const decLink = screen.getByText("D-001@v1").closest("a");
    expect(decLink).toHaveAttribute(
      "href",
      "/workspaces/ws-1/knowledge?file=knowledge%2Fdecisions%2Fx.md&anchor=D-001%40v1",
    );
  });

  it("测试绑定行：锚点标注「变更内」且测试文件可点开预览（FR-03）", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(await screen.findByText(/变更内 FR-01/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("change-assets-test-file-backend/app/x.py"));
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/app/x.py",
    );
  });

  it("归档留档：清单渲染 + 点开命中文件出 diff 弹窗（FR-04）", async () => {
    mockGet.mockResolvedValue(FULL);
    mockPatch.mockResolvedValue({
      path: "src/flow.js",
      diff: "diff --git a/src/flow.js b/src/flow.js\n@@ -1 +1 @@\n-a\n+b\n",
      note: null,
      truncated: false,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(await screen.findByTestId("change-assets-patch-files")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-patch-file-src/flow.js")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-patch-file-test/x.test.mjs")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("change-assets-patch-file-src/flow.js"));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith("ws-1", "c-1", "src/flow.js"),
    );
    expect(await screen.findByTestId("diff-view")).toBeInTheDocument();
  });

  it("归档留档：切片未命中出 note 文案而非空 diff（FR-04）", async () => {
    mockGet.mockResolvedValue(FULL);
    mockPatch.mockResolvedValue({
      path: "src/flow.js",
      diff: null,
      note: "该文件不在 change.patch 内（留档窗口外，或仅改了不纳入 patch 的面）。",
      truncated: false,
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    fireEvent.click(await screen.findByTestId("change-assets-patch-file-src/flow.js"));
    expect(await screen.findByTestId("change-assets-patch-note")).toHaveTextContent(
      "不在 change.patch 内",
    );
  });

  it("归档留档：清单截断时显式标注（FR-04）", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      patch: { ...FULL.patch, files_truncated: true },
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /沉淀资产/ }));

    expect(await screen.findByText("清单已截断")).toBeInTheDocument();
  });
});
