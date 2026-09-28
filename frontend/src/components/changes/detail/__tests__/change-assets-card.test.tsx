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
import { fetchSearch } from "@/lib/explorer";

vi.mock("@/lib/changes", () => ({
  getChangeAssets: vi.fn(),
  getChangePatchFile: vi.fn(),
}));

// 路径解析兜底（2026-09-26-assets-testfile-path-resolve）：TestFileBody 打开时
// 按文件名调 explorer search。默认给与 FULL fixture 等值命中（backend/app/x.py），
// 既有「点开预览」用例走 resolved 分支不依赖 jsdom fetch 失败时序；新用例各自覆盖。
vi.mock("@/lib/explorer", () => ({
  fetchSearch: vi.fn(),
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
const mockSearch = vi.mocked(fetchSearch);

/** 单命中 matches 便捷构造（type 恒 file——本卡只消费 path）。 */
function matchesOf(paths: string[]) {
  return {
    matches: paths.map((p) => ({
      path: p,
      name: p.split("/").pop() ?? p,
      type: "file" as const,
    })),
    truncated: false,
  };
}

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
      // 手写绑定原文（2026-09-26-assets-test-binding-raw-text）：test-trace 摘录
      // 截断 ::用例 后缀后，行下显示该原文（用例级锚点 + 描述）。
      raw_binding: "backend/app/x.py::四组渲染 用例（共享 fixture FULL）",
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
    // 默认等值命中（FULL fixture 的 backend/app/x.py）——「点开预览」用例走
    // resolved 等值分支（clearAllMocks 只清调用记录，但两个 describe 各自
    // 显式设默认，互不依赖顺序）。
    mockSearch.mockResolvedValue(matchesOf(["backend/app/x.py"]));
  });

  it("默认展开（2026-09-28-change-ux-detail-batch）：分组直接可见，点击头部可收起", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();

    // 分组零点击直接可见（用户裁决：默认展开 + 主栏网格形态）
    expect(await screen.findByTestId("change-assets-fr")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-audit")).toBeInTheDocument();
    // 头部态为 open；点击后收起、分组隐藏
    const toggle = screen.getByRole("button", { name: /沉淀资产/ });
    expect(toggle).toHaveAttribute("data-state", "open");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /沉淀资产/ })).toHaveAttribute(
      "data-state",
      "closed",
    );
    expect(screen.queryByTestId("change-assets-fr")).toBeNull();
  });

  it("四组渲染：展开后 fr/决策/测试绑定/归档留档逐组出现，计数徽标正确", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();

    expect(await screen.findByText(/FR 1 · 决策 1/)).toBeInTheDocument();

    // 默认展开（2026-09-28-change-ux-detail-batch），无需点击
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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    expect(await screen.findByText(/变更内 FR-01/)).toBeInTheDocument();

    // raw_binding 原文行显示（2026-09-26-assets-test-binding-raw-text）：
    // 行下小字含「原文：」前缀与用例级文本，title 悬停可见全文。
    const raw = await screen.findByTestId("change-assets-test-raw-k:task-01:acc-0");
    expect(raw).toHaveTextContent("原文：backend/app/x.py::四组渲染 用例");
    expect(raw).toHaveAttribute(
      "title",
      "backend/app/x.py::四组渲染 用例（共享 fixture FULL）",
    );

    fireEvent.click(screen.getByTestId("change-assets-test-file-backend/app/x.py"));
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/app/x.py",
    );
  });

  it("raw_binding 与 tests 等价（纯文件级）时不渲染原文行", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      test_rows: [
        {
          row_id: "k:task-02:acc-0",
          anchor: "FR-02",
          tests: ["backend/app/y.py"],
          state: "candidate",
          raw_binding: "backend/app/y.py",
        },
      ],
    });
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    expect(await screen.findByText(/变更内 FR-02/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("change-assets-test-raw-k:task-02:acc-0"),
    ).toBeNull();
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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

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
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    expect(await screen.findByText("清单已截断")).toBeInTheDocument();
  });
});

// ── 路径解析兜底（2026-09-26-assets-testfile-path-resolve / FR-01~02）────────
// 短路径数据瑕疵（如 tests/x.py 实为 backend/app/modules/<m>/tests/x.py）+ 误导
// 文案的生产实证驱动：点开测试文件先按文件名搜索，等值/唯一后缀自动救回，
// worktree 副本排除，多候选列清单，零命中中性文案。
describe("ChangeAssetsCard 测试文件路径解析", () => {
  /** 换 tests fixture 打开测试文件弹窗。 */
  async function openTestFile(tests: string[]) {
    mockGet.mockResolvedValue({
      ...FULL,
      test_rows: [
        { row_id: "k:task-01:acc-0", anchor: "FR-01", tests, state: "candidate" },
      ],
    });
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击
    fireEvent.click(
      await screen.findByTestId(`change-assets-test-file-${tests[0]}`),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue(matchesOf(["backend/app/x.py"]));
  });

  it("等值命中：原路径直接预览，无重定向注记", async () => {
    await openTestFile(["backend/app/x.py"]);
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/app/x.py",
    );
    expect(
      screen.queryByTestId("change-assets-test-redirect-note"),
    ).toBeNull();
  });

  it("短路径唯一后缀救回：自动用真实路径并标注原记录路径", async () => {
    mockSearch.mockResolvedValue(
      matchesOf(["backend/app/modules/spec_workspace/tests/conv.py"]),
    );
    await openTestFile(["tests/conv.py"]);
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/app/modules/spec_workspace/tests/conv.py",
    );
    // 注记须同时含原记录路径与真实路径——「」包裹形态防止真实路径包含
    // 短路径子串导致断言空转（评审 P2①）。
    const note = screen.getByTestId("change-assets-test-redirect-note");
    expect(note).toHaveTextContent("记录路径「tests/conv.py」未直接命中");
    expect(note).toHaveTextContent(
      "backend/app/modules/spec_workspace/tests/conv.py",
    );
  });

  it("worktree 副本排除：后缀多命中时跳过 .sillyspec/.runtime/ 副本取唯一真实路径", async () => {
    mockSearch.mockResolvedValue(
      matchesOf([
        ".sillyspec/.runtime/worktrees/2026-09-12-foo/tests/conv.py",
        "backend/app/modules/spec_workspace/tests/conv.py",
      ]),
    );
    await openTestFile(["tests/conv.py"]);
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/app/modules/spec_workspace/tests/conv.py",
    );
  });

  it("多真实候选：列出清单由用户点选，选中后预览", async () => {
    mockSearch.mockResolvedValue(
      matchesOf([
        "backend/a/tests/conv.py",
        "backend/b/tests/conv.py",
        ".sillyspec/.runtime/worktrees/2026-09-12-foo/tests/conv.py",
      ]),
    );
    await openTestFile(["tests/conv.py"]);
    const list = await screen.findByTestId("change-assets-test-candidates");
    expect(list).toHaveTextContent("2 个同名测试文件");
    expect(
      screen.queryByTestId(
        "change-assets-test-candidate-.sillyspec/.runtime/worktrees/2026-09-12-foo/tests/conv.py",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId("change-assets-test-candidate-backend/a/tests/conv.py"),
    );
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "backend/a/tests/conv.py",
    );
  });

  it("零命中：中性文案，不再出现「工作区目录可能已被移动或删除」误导语义", async () => {
    mockSearch.mockResolvedValue(matchesOf([]));
    await openTestFile(["tests/gone.py"]);
    const tip = await screen.findByTestId("change-assets-test-notfound");
    expect(tip).toHaveTextContent("未在仓库中找到该测试文件");
    expect(tip).not.toHaveTextContent("工作区目录可能已被移动或删除");
  });

  // ── 「用例名」注解粘联（2026-09-27-assets-testfile-bracket-note）────────
  // 生产实证：sillyspec CLI flow done 补全的 tests[] 把绑定槽「路径「用例名」」
  // 整串收录——归一剥离后搜索与比较才成立，否则恒零命中误报未找到。
  it("「用例名」注解剥离：按干净文件名发起搜索并等值命中预览", async () => {
    mockSearch.mockResolvedValue(matchesOf(["test/ui-visual-guidance.test.mjs"]));
    await openTestFile([
      "test/ui-visual-guidance.test.mjs「detectUiTouch 正例：页面/前端/UI/视觉/组件/tsx」",
    ]);
    // 搜索入参必须是剥掉注解的干净文件名——粘联正是此前零命中的根因。
    expect(mockSearch).toHaveBeenCalledWith(
      "ws-1",
      "ui-visual-guidance.test.mjs",
    );
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "test/ui-visual-guidance.test.mjs",
    );
    expect(
      screen.queryByTestId("change-assets-test-redirect-note"),
    ).toBeNull();
  });

  it("多段注解剥离：短路径唯一后缀救回并预览真实路径", async () => {
    mockSearch.mockResolvedValue(
      matchesOf(["packages/cli/test/ui-visual-guidance.test.mjs"]),
    );
    await openTestFile(["test/ui-visual-guidance.test.mjs「甲」「乙」"]);
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "packages/cli/test/ui-visual-guidance.test.mjs",
    );
  });

  it("全注解串：剥离后为空仍按未找到处理", async () => {
    await openTestFile(["「只有用例名没有路径」"]);
    expect(await screen.findByTestId("change-assets-test-notfound")).toBeTruthy();
  });
});

// ── 资产透明面（2026-09-26-change-asset-transparency / FR-01~03）────────────
describe("ChangeAssetsCard 资产透明面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue(matchesOf(["backend/app/x.py"]));
  });

  it("知识触达组：待复核条目渲染并带知识库 file+anchor 深链 href", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      knowledge_touch: [
        {
          id: "FR-auto-backend-015",
          title: "THIN 辅助阶段与派发配置",
          file: "knowledge/fr/auto-backend.md",
        },
      ],
    });
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    const group = await screen.findByTestId("change-assets-knowledge-touch");
    expect(group).toHaveTextContent("FR-auto-backend-015");
    expect(group).toHaveTextContent("THIN 辅助阶段与派发配置");
    const link = group.querySelector("a");
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link!.getAttribute("href") ?? "")).toContain(
      "file=knowledge/fr/auto-backend.md&anchor=FR-auto-backend-015",
    );
  });

  it("模块触达组：chip 渲染中文名，点击打开模块文档预览弹窗（.sillyspec 前缀）", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      touched_modules: [
        { id: "change", name: "变更中心", project: "backend", doc: "docs/backend/modules/change.md" },
      ],
    });
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    const chip = await screen.findByTestId("change-assets-module-change");
    expect(chip).toHaveTextContent("变更中心");
    fireEvent.click(chip);
    // 弹窗打开且 FilePreview 收到补 .sillyspec/ 前缀的仓库相对路径。
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      ".sillyspec/docs/backend/modules/change.md",
    );
  });

  it("两组无数据时不渲染（fail-open 同款逐组门控）", async () => {
    mockGet.mockResolvedValue(FULL);
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ }); // 默认展开（2026-09-28-change-ux-detail-batch），无需点击

    expect(await screen.findByTestId("change-assets-tests")).toBeInTheDocument();
    expect(screen.queryByTestId("change-assets-knowledge-touch")).toBeNull();
    expect(screen.queryByTestId("change-assets-touched-modules")).toBeNull();
  });
});
