// 2026-09-25-change-precipitated-assets（FR-03/04）：沉淀资产卡组件测试。
// 覆盖：四组渲染（fr/决策/测试绑定/归档留档逐组有数据才出现）+ 计数徽标、
// 逐组容错（仅 fr 有数据时其余组不渲染）、在途变更引导空态、归档全空态、
// 失败降级（isError → 卡头保留 + 分区级错误说明；2026-10-15-change-detail-redesign / D-016@v1）。
//
// 2026-09-25-change-detail-assets-usability（FR-01~04）追加：测试绑定行点开测试
// 文件预览弹窗（FilePreview 收到仓库路径）、归档留档文件清单渲染与点开单文件
// diff 弹窗（命中/note 两态）。
//
// 2026-10-14-assets-knowledge-popup-preview（FR-01~03/05）改写：FR 索引/决策
// 蒸馏/知识触达三组从整页跳知识库深链改为点击打开条目内容预览弹窗（getKnowledge
// 取数 + EntryCardList 条目卡 + 锚点定位），弹窗头部「在知识库中打开」深链沿用
// 原 file+anchor 格式。
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeAssetsCard } from "@/components/changes/detail/change-assets-card";
import { getChangeAssets, getChangePatchFile } from "@/lib/changes";
import { fetchSearch } from "@/lib/explorer";
import { getKnowledge } from "@/lib/knowledge";

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

// 知识条目预览弹窗（2026-10-14-assets-knowledge-popup-preview）取数端点 mock；
// normalizeKnowledgeFileParam 为纯函数，importOriginal 透传真实实现。
vi.mock("@/lib/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge")>();
  return { ...actual, getKnowledge: vi.fn() };
});

// EntryCardList 正文渲染链 CardMarkdown → MarkdownText 用 next/dynamic
// （ssr:false），jsdom 同步渲染 null（entry-card-list.test 先例）——stub 直接
// 回显 content，正文文本断言照常命中。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="md-stub">{content}</div>
  ),
}));

// jsdom 未实现 scrollIntoView（弹窗锚点定位 effect 调用）——knowledge-page.test
// 同款先例：文件级打桩防 Uncaught TypeError 拖挂整跑。本文件的复合锚用例还要
// 断言「滚到了哪张卡」——scrollIntoView 的目标是 this 而非首参，包装一层把
// 元素记为 spy 首参。
const scrollIntoViewSpy = vi.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = function (
    this: Element,
    ...args: Parameters<typeof Element.prototype.scrollIntoView>
  ) {
    scrollIntoViewSpy(this, ...args);
  } as typeof Element.prototype.scrollIntoView;
});
afterAll(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

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
const mockGetKnowledge = vi.mocked(getKnowledge);

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

/** 知识条目取数响应便捷构造（zone/filename/content 为弹窗渲染三要素）。 */
function knowledgeOf(filename: string, zone: string, content: string) {
  return {
    zone,
    filename,
    path: `.sillyspec/knowledge/${filename}`,
    title: filename,
    content,
  };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeAssetsCard workspaceId="ws-1" changeId="c-1" changeKey="k-demo" />
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

  it("失败降级：isError → 卡头保留 + 分区级错误说明（不再整卡消失）", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderCard();
    expect(await screen.findByTestId("change-assets-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-assets-card")).toBeInTheDocument();
    expect(screen.getByText(/沉淀资产暂不可用/)).toBeInTheDocument();
  });

  it("FR/决策索引行：点击弹窗预览条目内容并定位，弹窗内含知识库深链（FR-01/03）", async () => {
    mockGet.mockResolvedValue(FULL);
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf(
        "fr/x.md",
        "fr",
        "## FR-auto-x-001 条目一\n状态：active\n变更：k-demo\n理由：条目正文理由。\n",
      ),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    // FR 行不再是整页跳转的 <a>，点击打开预览弹窗
    const frRow = await screen.findByText("FR-auto-x-001");
    expect(frRow.closest("a")).toBeNull();
    fireEvent.click(frRow);
    // 取数按归一后文件名发起（file=knowledge/fr/x.md → fr/x.md）
    await waitFor(() =>
      expect(mockGetKnowledge).toHaveBeenCalledWith("ws-1", "fr/x.md"),
    );
    // 弹窗内条目卡渲染 + 锚点定位目标卡存在（复合锚：变更号+决策号）
    const dialog = await screen.findByRole("dialog");
    expect(
      dialog.querySelector('[data-entry-anchor-qualified="fr/x.md#k-demo#FR-auto-x-001"]'),
    ).not.toBeNull();
    // 弹窗头部知识库深链：anchor 带变更号前缀（复合锚跨页同样精确）
    const jump = within(dialog).getByText("在知识库中打开").closest("a");
    expect(jump).toHaveAttribute(
      "href",
      "/workspaces/ws-1/knowledge?file=knowledge%2Ffr%2Fx.md&anchor=k-demo%23FR-auto-x-001",
    );

    // 关闭后点决策行：同一弹窗通道，决策文件深链同理
    fireEvent.click(within(dialog).getByText("关闭"));
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf(
        "decisions/x.md",
        "decisions",
        "## D-001@v1 : 决策一\n状态：implemented\n变更：k-demo\n理由：决策理由文本。\n",
      ),
    );
    fireEvent.click(screen.getByText("D-001@v1"));
    await waitFor(() =>
      expect(mockGetKnowledge).toHaveBeenCalledWith("ws-1", "decisions/x.md"),
    );
    const dialog2 = await screen.findByRole("dialog");
    expect(
      dialog2.querySelector('[data-entry-anchor-qualified="decisions/x.md#k-demo#D-001@v1"]'),
    ).not.toBeNull();
    expect(
      within(dialog2).getByText("在知识库中打开").closest("a"),
    ).toHaveAttribute(
      "href",
      "/workspaces/ws-1/knowledge?file=knowledge%2Fdecisions%2Fx.md&anchor=k-demo%23D-001%40v1",
    );
  });

  it("决策行弹窗定位：同 id 跨变更按变更号+决策号复合锚精确命中（FR-02）", async () => {
    // 生产实证形态（decisions/unmapped.md）：多个变更各有同名决策号，裸锚
    // 「文件#id」首卡误命中——滚动目标必须锁定 changeKey 的复合锚卡。
    mockGet.mockResolvedValue({
      ...FULL,
      decisions: [
        {
          id: "D-003@v1",
          title: "本变更的磁盘旁路决策",
          status: "active",
          file: "knowledge/decisions/dup.md",
        },
      ],
    });
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf(
        "decisions/dup.md",
        "decisions",
        [
          "## D-003@v1 : 别变更的三波交付决策",
          "状态：active",
          "变更：2026-08-29-other",
          "",
          "## D-003@v1 : 本变更的磁盘旁路决策",
          "状态：active",
          "变更：k-demo",
          "",
        ].join("\n"),
      ),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    fireEvent.click(await screen.findByText("D-003@v1"));
    await waitFor(() =>
      expect(mockGetKnowledge).toHaveBeenCalledWith("ws-1", "decisions/dup.md"),
    );
    const dialog = await screen.findByRole("dialog");
    // 文件里两个同 id 卡都在（裸锚同值）；滚动目标必须是 k-demo 的复合锚卡。
    await waitFor(() =>
      expect(
        dialog.querySelectorAll('[data-entry-anchor="decisions/dup.md#D-003@v1"]'),
      ).toHaveLength(2),
    );
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalled());
    const target = scrollIntoViewSpy.mock.calls.at(-1)![0] as Element;
    expect(target.getAttribute("data-entry-anchor-qualified")).toBe(
      "decisions/dup.md#k-demo#D-003@v1",
    );
  });

  it("FR 行兜底：条目无「变更：」字段时复合锚查无退裸锚（评审 P1 回归钉）", async () => {
    // FR 文件条目缺「变更：」行（老数据容差形态）：qualified 属性不存在，
    // 兜底键必须剥掉变更号前缀按裸锚命中——否则静默不滚（改动前可定位，构成回退）。
    mockGet.mockResolvedValue(FULL);
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf(
        "fr/x.md",
        "fr",
        "## FR-auto-x-001 条目一\n状态：active\n理由：条目正文理由。\n",
      ),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    fireEvent.click(await screen.findByText("FR-auto-x-001"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        dialog.querySelector('[data-entry-anchor="fr/x.md#FR-auto-x-001"]'),
      ).not.toBeNull(),
    );
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalled());
    const target = scrollIntoViewSpy.mock.calls.at(-1)![0] as Element;
    // 滚动目标 = 裸锚卡（无复合属性可命中——兜底生效而非静默不滚）。
    expect(target.getAttribute("data-entry-anchor")).toBe("fr/x.md#FR-auto-x-001");
    expect(target.hasAttribute("data-entry-anchor-qualified")).toBe(false);
  });

  it("知识条目预览弹窗：取数失败就近展示错误文案，深链仍可见（FR-05）", async () => {
    mockGet.mockResolvedValue(FULL);
    mockGetKnowledge.mockRejectedValue(new Error("知识库不可用"));
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    fireEvent.click(await screen.findByText("FR-auto-x-001"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/知识库不可用/)).toBeInTheDocument();
    expect(within(dialog).getByText("在知识库中打开")).toBeInTheDocument();
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

  // ── 用例锚四形态 + 全角括号残段（2026-09-30-assets-testfile-nodeid-anchor）──
  // 生产实证：2026-09-30-title-adopt-clobber-guard 归档件 tests[] 为 pytest 节点
  // ID + flow done 空白切 token 的注解残段（…::test_x（documents）——剥锚契约
  // 四形态（「」/#/::/>）此前读侧只落了「」，其余形态整串进 basename 必零命中
  // 误报「未在仓库中找到该测试文件」（文件实际就在仓库里）。
  const TITLE_NORM = "backend/app/modules/change/tests/test_title_normalization.py";

  it(":: 用例锚（pytest 节点 ID）剥离：按纯路径等值命中预览，无重定向注记", async () => {
    mockSearch.mockResolvedValue(matchesOf([TITLE_NORM]));
    await openTestFile([
      `${TITLE_NORM}::TestAdoptedTitleClobberGuard::test_apply_parsed_fallback_keeps_semantic_title`,
    ]);
    // 搜索入参必须是剥锚后的干净 basename——整串进搜索正是此前零命中的根因。
    expect(mockSearch).toHaveBeenCalledWith("ws-1", "test_title_normalization.py");
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      TITLE_NORM,
    );
    expect(
      screen.queryByTestId("change-assets-test-redirect-note"),
    ).toBeNull();
  });

  it(":: 锚后粘联全角括号残段（截断未闭合形）一并剥离（生产实证串）", async () => {
    mockSearch.mockResolvedValue(matchesOf([TITLE_NORM]));
    await openTestFile([
      `${TITLE_NORM}::TestAdoptedTitleClobberGuard::test_adopted_title_survives_template_docs_push（documents`,
    ]);
    expect(mockSearch).toHaveBeenCalledWith("ws-1", "test_title_normalization.py");
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      TITLE_NORM,
    );
  });

  it("闭合形全角括号注解粘联（无锚界符）同样剥除", async () => {
    mockSearch.mockResolvedValue(matchesOf([TITLE_NORM]));
    await openTestFile([`${TITLE_NORM}（documents 推送不回翻，实现前先红实证）`]);
    expect(mockSearch).toHaveBeenCalledWith("ws-1", "test_title_normalization.py");
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      TITLE_NORM,
    );
  });

  it("# 与 > 形态锚剥离：同归纯路径，短路径唯一后缀救回", async () => {
    mockSearch.mockResolvedValue(
      matchesOf(["packages/cli/test/flow-draft.test.mjs"]),
    );
    await openTestFile([
      "test/flow-draft.test.mjs#extractTestAnchors 多段锚全收",
      "test/flow-draft.test.mjs>flow draft>多段锚全收",
    ]);
    expect(mockSearch).toHaveBeenCalledWith("ws-1", "flow-draft.test.mjs");
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "packages/cli/test/flow-draft.test.mjs",
    );
    // 同组第二条（> 形态）同样可点开预览——两形态归一路径。
    fireEvent.click(
      screen.getByTestId(
        "change-assets-test-file-test/flow-draft.test.mjs>flow draft>多段锚全收",
      ),
    );
    expect(await screen.findByTestId("file-preview-stub")).toHaveTextContent(
      "packages/cli/test/flow-draft.test.mjs",
    );
  });
});

// ── 资产透明面（2026-09-26-change-asset-transparency / FR-01~03）────────────
describe("ChangeAssetsCard 资产透明面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue(matchesOf(["backend/app/x.py"]));
  });

  it("知识触达：锚点条目行点击弹窗打开，弹窗深链沿用 file+anchor（不整页跳转）", async () => {
    // 2026-10-09-knowledge-touch-marker-sunset：标题不再分裂归档/实时双口径，
    // 悬停说明注入命中留痕口径；禁止「待复核」「以标记为准」字样。
    // 2026-10-14-assets-knowledge-popup-preview：行点击改弹窗预览，不再整页跳转。
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
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf(
        "fr/auto-backend.md",
        "fr",
        "## FR-auto-backend-015 THIN 辅助阶段与派发配置\n状态：active\n",
      ),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    const group = await screen.findByTestId("change-assets-knowledge-touch");
    expect(group).toHaveTextContent("知识触达（本变更注入命中的知识）");
    const tooltip = group.querySelector("span[title]")?.getAttribute("title") ?? "";
    expect(tooltip).toContain("注入");
    expect(tooltip).not.toContain("待复核");
    expect(tooltip).not.toContain("以标记为准");
    // id≠title 的锚点条目：双栏各显示一份，挂在文件组头下。
    expect(group).toHaveTextContent("FR-auto-backend-015");
    expect(group).toHaveTextContent("THIN 辅助阶段与派发配置");

    // 条目行点击 → 弹窗（行不再是 <a>），取数按归一文件名，深链带 file+anchor。
    // 组头也是 button（文件级打开），用行文本定位锚点条目行。
    const row = within(group).getByText("THIN 辅助阶段与派发配置").closest("button");
    expect(row).not.toBeNull();
    expect(row!.closest("a")).toBeNull();
    fireEvent.click(row!);
    await waitFor(() =>
      expect(mockGetKnowledge).toHaveBeenCalledWith("ws-1", "fr/auto-backend.md"),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      decodeURIComponent(
        within(dialog).getByText("在知识库中打开").closest("a")!.getAttribute("href") ?? "",
      ),
    ).toContain("file=knowledge/fr/auto-backend.md&anchor=FR-auto-backend-015");
  });

  it("在途变更知识触达：同 slug 只显示一份（id==title 不连排两遍）", async () => {
    // 2026-09-28-knowledge-touch-live 起在途即有触达（knowledge_hits inject 行）；
    // 2026-10-09-knowledge-touch-marker-sunset：live 行 id==title——单份渲染。
    mockGet.mockResolvedValue({
      ...FULL,
      archived: false,
      knowledge_touch: [
        { id: "-audit_hooks-只在测试", title: "-audit_hooks-只在测试", file: "known-issues.md" },
      ],
    });
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf("known-issues.md", "top", "## -audit_hooks 只在测试 lifespan 注册\n正文\n"),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    const group = await screen.findByTestId("change-assets-knowledge-touch");
    // 在途与归档同文案（无「· 实时」尾标分裂）。
    expect(group).toHaveTextContent("知识触达（本变更注入命中的知识）");
    // slug 恰好出现一次（改前 id+title 双栏连排两遍）。
    expect((group.textContent?.match(/-audit_hooks-只在测试/g) ?? []).length).toBe(1);
    // 条目行（非组头）点击弹窗打开；裸知识文件深链（file 不带 knowledge/ 前缀）。
    const row = within(group).getByText("-audit_hooks-只在测试").closest("button");
    fireEvent.click(row!);
    const dialog = await screen.findByRole("dialog");
    expect(
      decodeURIComponent(
        within(dialog).getByText("在知识库中打开").closest("a")!.getAttribute("href") ?? "",
      ),
    ).toContain("file=known-issues.md&anchor=-audit_hooks-只在测试");
    // 在途引导空态不出现（已有触达数据）
    expect(screen.queryByTestId("change-assets-inflight")).toBeNull();
  });

  it("知识触达分组：整文件路由收拢 chip（点击弹窗文件级打开），锚点条目按文件分组", async () => {
    mockGet.mockResolvedValue({
      ...FULL,
      knowledge_touch: [
        { id: "fr/daemon.md", title: "fr/daemon.md", file: "fr/daemon.md" },
        { id: "slug-a", title: "slug-a", file: "conventions.md" },
        { id: "slug-b", title: "slug-b", file: "conventions.md" },
        { id: "slug-c", title: "slug-c", file: "patterns.md" },
      ],
    });
    mockGetKnowledge.mockResolvedValue(
      knowledgeOf("fr/daemon.md", "fr", "## FR-daemon-001 守护进程规则\n状态：active\n"),
    );
    renderCard();
    await screen.findByRole("button", { name: /沉淀资产/ });

    const group = await screen.findByTestId("change-assets-knowledge-touch");
    expect(group).toHaveTextContent("整文件");
    // 整文件 chip：点击弹窗文件级打开（无 anchor 定位），不再整页跳转。
    const chip = group.querySelector("button[title*='整文件路由注入']");
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    await waitFor(() =>
      expect(mockGetKnowledge).toHaveBeenCalledWith("ws-1", "fr/daemon.md"),
    );
    const dialog = await screen.findByRole("dialog");
    const chipJump = within(dialog).getByText("在知识库中打开").closest("a")!;
    expect(chipJump.getAttribute("href")).toContain("file=fr%2Fdaemon.md");
    expect(chipJump.getAttribute("href")).not.toContain("anchor=");
    // 锚点条目按文件分组：组头计数 + 组内 slug。
    const g1 = screen.getByTestId("change-assets-touch-group-conventions.md");
    expect(g1).toHaveTextContent("conventions.md（2）");
    expect(g1).toHaveTextContent("slug-a");
    expect(g1).toHaveTextContent("slug-b");
    const g2 = screen.getByTestId("change-assets-touch-group-patterns.md");
    expect(g2).toHaveTextContent("slug-c");
    // 计数含整文件与锚点条目共 4 条。
    expect(group).toHaveTextContent("4 条");
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
