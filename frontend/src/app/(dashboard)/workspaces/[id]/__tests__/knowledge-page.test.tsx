/**
 * 知识库页测试（ql-20260821-015 重构后补；task-03 2026-09-17-knowledge-precipitation 适配；
 * task-05 同变更补写入口权限两态与 decisions 只读断言；task-06 同变更补待审核
 * 条目「合并/拒绝」操作区权限两态与拒绝确认流；task-08 同变更补蒸馏任务条挂载；
 * task-05 / 2026-09-20-knowledge-effect-panel 补 fr「需求规则」组、树行文件级
 * 🔥 use_count 徽标与「卡片/原文」双 tab 分发）。
 *
 * 覆盖：
 * 1. 只渲染知识库（无快速日志 tab）；树按 zone 分组（待审核置顶 + 计数徽标、知识手册、
 *    决策库、需求规则、自动生成）+ FileNodeIcon 按扩展名分型 + 日期灰字
 * 2. 空待审核负例：无 proposed 条目时不渲染待审核组与徽标
 * 3. 点目录行展开/收起（expandAction=click）；点文件行 → getKnowledge 拉详情，
 *    默认卡片视图（EntryCardList），「原文」tab 切既有 Markdown 渲染
 * 4. 树栏拖拽把手：默认 280px，拖动调宽 + localStorage 记忆
 * 5. WorkspaceTabs 含「知识库」tab，位于「文件」之后
 * 6. task-05 写入口权限两态：持有 knowledge:write（或 is_platform_admin 短路）见
 *    「沉淀知识」与「编辑」入口；未持有两入口均不渲染（页面与现状一致）
 * 7. task-05 decisions 只读（D-006@v1）：decisions 条目无编辑按钮 + 「由归档流程维护 ·
 *    只读」标注；编辑态挂载 EntryEditor
 * 8. task-06 待审核操作区（FR-05）：proposed 条目挂「⇥ 合并 / ✕ 拒绝」——持有
 *    knowledge:write 可见、未持有不渲染；合并开 MergeDialog；拒绝走 Popconfirm
 *    二次确认后调 rejectKnowledge 并刷新列表 + 清详情；top 条目不渲染合并/拒绝
 * 9. task-08 蒸馏任务条：挂知识库页列表上方（workspace id 透传），任务完成
 *    onCompleted 回调重拉知识列表（任务条内部轮询/终态行为由
 *    distill-task-bar.test.tsx 覆盖，页面级 stub 隔离）
 * 10. task-05（2026-09-20-knowledge-effect-panel / D-005@v1 / FR-04 / FR-06）：fr
 *     条目归「需求规则」组（决策库后）；树行文件级 🔥 use_count 徽标；md 文件
 *     点开双 tab——默认卡片（EntryCardList 挂载）、原文 tab 切既有 md 视图可切回
 */

import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// antd Tree / rc-component resize-observer 需要 ResizeObserver，jsdom 缺，补 mock
// （file-explorer.test 同款前置）。
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

vi.mock("@/lib/knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge")>();
  return {
    ...actual,
    listKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
    // task-06：MergeDialog / 拒绝流消费的写端点一并 mock（弹层内真实请求会打
    // jsdom 缺失的 fetch）。
    previewMergeKnowledge: vi.fn(),
    mergeKnowledge: vi.fn(),
    rejectKnowledge: vi.fn(),
    // task-08：蒸馏任务条消费的任务列表端点（页面挂真实请求会打 jsdom 缺失
    // 的 fetch；缺省空列表 = 无任务，任务条不渲染）。
    listDistillTasks: vi.fn(),
    // task-04（2026-09-20-knowledge-effect-panel）：顶部运营仪表盘消费的
    // stats 端点（真实请求会打 jsdom 缺失的 fetch；缺省零值指标 = 空态）。
    getKnowledgeStats: vi.fn(),
  };
});

// task-08：DistillTaskBar 在页面级测试替换为 stub（task-06 MergeDialog stub
// 先例）——任务条内部轮询/终态消失/离线文案由 distill-task-bar.test.tsx 全覆盖；
// 这里用 stub 暴露的「任务完成」按钮驱动 onCompleted → 列表刷新接线。
vi.mock("@/components/knowledge/distill-task-bar", () => ({
  DistillTaskBar: (props: { workspaceId: string; onCompleted: () => void }) => (
    <div data-testid="distill-task-bar-stub" data-workspace={props.workspaceId}>
      DistillTaskBar stub
      <button type="button" data-testid="stub-distill-completed" onClick={props.onCompleted}>
        stub:任务完成
      </button>
    </div>
  ),
  distillTasksQueryKey: (workspaceId: string) =>
    ["knowledge", "distill-tasks", workspaceId] as const,
}));

// ql-20260918-002：DistillHistoryDialog 页面级 stub（Radix Dialog 同族 jsdom
// 崩溃面，同 MergeDialog 先例）——弹层行为由 distill-history-dialog.test 覆盖。
vi.mock("@/components/knowledge/distill-history-dialog", () => ({
  DistillHistoryDialog: () => <div data-testid="distill-history-stub">历史记录 stub</div>,
}));

// task-06：页面拒绝流用 useNotify toast（antd App 上下文依赖），换纯函数实现
// （precipitate-dialog.test 同款）；errMessage 保持真实实现（错误文案路径）。
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, useNotify: () => notify };
});

// task-06：MergeDialog 在页面级测试替换为 stub——弹层内部行为（预览渲染/409/
// 幂等标志）已由 merge-dialog.test.tsx 全覆盖；这里挂真实 Radix Dialog portal
// 会与 antd v6 Tree 注入样式在 jsdom/nwsai 组合下炸选择器解析
// （"div#radix-…:focus-visible" is not a valid selector，同族根因见
// precipitate-dialog.tsx 头注释的 antd Tabs jsdom 取舍），stub 隔离测试环境债。
vi.mock("@/components/knowledge/merge-dialog", () => ({
  MergeDialog: (props: { filename: string }) => (
    <div data-testid="merge-dialog-stub" data-filename={props.filename}>
      MergeDialog stub（{props.filename}）
    </div>
  ),
}));

// task-05：页面写入口可见性读 useSession（permissions + is_platform_admin），
// 可配置 session 态（runtime/page.test 同款 selector 直调 mock）。
const sessionState = vi.hoisted(() => ({
  user: null as { permissions?: string[]; is_platform_admin?: boolean } | null,
}));
vi.mock("@/stores/session", () => ({
  useSession: (selector: (_s: { user: typeof sessionState.user }) => unknown) =>
    selector({ user: sessionState.user }),
}));

// MarkdownPreview 是 dynamic(ssr:false) 异步组件，直接替换为静态渲染避免测试环境异步挂载。
vi.mock("@uiw/react-markdown-preview", () => ({
  default: ({ source }: { source?: string }) => <div data-testid="md-preview">{source}</div>,
}));

// WorkspaceTabs 的 usePathname 需要 app router 上下文，jsdom 下 mock 掉
// （知识库页本身用 params prop，不受影响）。
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspaces/ws-1/knowledge",
}));

import KnowledgePage from "@/app/(dashboard)/workspaces/[id]/knowledge/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import {
  getKnowledge,
  getKnowledgeStats,
  listDistillTasks,
  listKnowledge,
  previewMergeKnowledge,
  rejectKnowledge,
} from "@/lib/knowledge";
import { closestAntdTreeRow, queryAntdTreeIcon, closestAntdTreeNodeWrapper } from "@/test/dom-queries";

const mockList = listKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockGet = getKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockPreviewMerge = previewMergeKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockReject = rejectKnowledge as unknown as ReturnType<typeof vi.fn>;

const WS = "ws-1";

function entry(partial: Partial<Record<string, unknown>> & { filename: string; path: string }) {
  return {
    title: null,
    content: null,
    last_modified_at: null,
    // task-03：mock 补 zone（缺省 top，与后端 KnowledgeEntry 契约对齐）。
    zone: "top",
    // task-05（2026-09-20-knowledge-effect-panel）：Wave1 透传的文件级命中计数
    // （缺省 null = 无徽标；树行 🔥 徽标用例按需覆写）。
    use_count: null,
    ...partial,
  };
}

/** 默认：真实 knowledge 目录样例——顶层手册 + decisions/ + fr/ + generated/ +
 * proposed/ 五 zone（fr 为 2026-09-20-knowledge-effect-panel 新增独立组）。 */
function mockDefaultList() {
  mockList.mockResolvedValue({
    items: [
      entry({
        filename: "INDEX.md",
        path: ".sillyspec/knowledge/INDEX.md",
      }),
      entry({
        filename: "conventions.md",
        path: ".sillyspec/knowledge/conventions.md",
        last_modified_at: "2026-08-20T10:00:00Z",
        use_count: 214,
      }),
      entry({
        filename: "decisions/daemon.md",
        path: ".sillyspec/knowledge/decisions/daemon.md",
        zone: "decisions",
      }),
      entry({
        filename: "fr/host-fs-handler.md",
        path: ".sillyspec/knowledge/fr/host-fs-handler.md",
        zone: "fr",
        use_count: 18,
      }),
      entry({
        filename: "generated/runtime.md",
        path: ".sillyspec/knowledge/generated/runtime.md",
        zone: "generated",
      }),
      entry({
        filename: "proposed/pending-fix.md",
        path: ".sillyspec/knowledge/proposed/pending-fix.md",
        zone: "proposed",
      }),
    ],
  });
}

/** jsdom 无 PointerEvent，fireEvent.pointer* 带不上坐标：createEvent 后手工补属性再派发。 */
function firePointer(
  el: Element | Window,
  name: "pointerDown" | "pointerMove" | "pointerUp",
  init: { clientX?: number } = {},
) {
  const ev = createEvent[name](el as Element, init);
  for (const [k, v] of Object.entries(init)) {
    Object.defineProperty(ev, k, { value: v });
  }
  fireEvent(el, ev);
}

async function waitForTree(names: string[]) {
  await waitFor(() => {
    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();
  });
}

// task-08：页面经 useQueryClient invalidate 蒸馏任务查询，渲染需 Provider 包裹
// （platform-sync-section.test 同款 retry:false / gcTime:0）。
let queryClient: QueryClient;

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgePage params={{ id: WS }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("sillyhub-knowledge-tree-width");
  // task-05：默认未持有 knowledge:write 且非平台管理员（既有只读用例的页面形态）。
  sessionState.user = { permissions: [], is_platform_admin: false };
  mockDefaultList();
  // task-06：写端点缺省成功态（各用例按需覆写失败分支）。
  mockPreviewMerge.mockResolvedValue({
    section_text: "## 预填小节",
    index_line: "- 预填 → [预填小节](known-issues.md#预填小节)",
    section_skipped: false,
    index_line_skipped: false,
  });
  mockReject.mockResolvedValue(undefined);
  // task-08：任务列表缺省空（无进行中任务，任务条不渲染——被 stub 后本断言
  // 不依赖真实条渲染）。
  (listDistillTasks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  // task-04（2026-09-20-knowledge-effect-panel）：stats 缺省零值指标（运营
  // 仪表盘空态「暂无使用数据」，不干扰既有树/详情断言；指标卡渲染细节由
  // ops-dashboard.test.tsx 覆盖）。
  (getKnowledgeStats as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    coverage: { used_entries: 0, total_entries: 0, trend: [] },
    dead_entries: [],
    density: { per_task_avg: 0, trend: [] },
    freshness: { recent_new: 0, recent_used: 0 },
    usage_board: [],
    entry_counts: [],
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("知识库页（task-03 zone 分组树）", () => {
  it("树按 zone 分组：待审核置顶带计数徽标、五组中文标签（含需求规则）、目录/文件图标分型、日期灰字", async () => {
    renderPage();
    await waitForTree([
      "待审核",
      "知识手册",
      "决策库",
      "需求规则",
      "自动生成",
      "pending-fix.md",
      "INDEX.md",
      "host-fs-handler.md",
    ]);

    // 无快速日志 tab（重构后只剩知识库）。
    expect(screen.queryByText("快速日志")).not.toBeInTheDocument();

    // 待审核组置顶：徽标计数 1 条（挂在待审核组行内）。
    const badge = screen.getByTestId("proposed-zone-badge");
    expect(badge).toHaveTextContent("1 条");
    expect(closestAntdTreeRow(badge)?.textContent).toContain("待审核");
    const groupTitles = ["待审核", "知识手册", "决策库", "需求规则", "自动生成"].map(
      (label) => closestAntdTreeRow(screen.getByText(label))!,
    );
    // 固定 zone 顺序：待审核在最前（DOM 顺序即树顺序），需求规则在决策库后
    // （task-05 / D-005@v1，fr 独立 zone）。
    const order = groupTitles.map((row) => row.textContent);
    expect(order.indexOf("待审核")).toBeLessThan(order.indexOf("知识手册"));
    expect(order.indexOf("知识手册")).toBeLessThan(order.indexOf("决策库"));
    expect(order.indexOf("决策库")).toBeLessThan(order.indexOf("需求规则"));
    expect(order.indexOf("需求规则")).toBeLessThan(order.indexOf("自动生成"));

    // zone 组行是目录图标（Folder），组内文件行按扩展名分型（.md → FileText）。
    const dirRow = closestAntdTreeRow(screen.getByText("决策库"))!;
    expect(queryAntdTreeIcon(dirRow, "folder")).toBeTruthy();
    const fileRow = closestAntdTreeRow(screen.getByText("conventions.md"))!;
    expect(queryAntdTreeIcon(fileRow, "file-text")).toBeTruthy();
    // 日期灰字（zh-CN 本地化，UTC 时间戳在本地时区渲染，断言年份存在）。
    expect(fileRow.textContent).toMatch(/2026/);
  });

  it("fr 条目归「需求规则」组且组内剥 fr/ 前缀；树行文件级 🔥 use_count 徽标（task-05 / FR-06）", async () => {
    renderPage();
    await waitForTree(["需求规则", "host-fs-handler.md"]);

    // fr 条目挂在需求规则组（zone 组节点路径 zone:fr）。
    const frRow = closestAntdTreeRow(screen.getByText("host-fs-handler.md"))! as HTMLElement;
    expect(frRow.textContent).not.toContain("fr/");
    // 文件级命中徽标：conventions.md 🔥214 / fr 文件 🔥18；无计数条目（INDEX.md）不带。
    const conventionsRow = screen.getByText("conventions.md").closest(
      ".ant-tree-treenode",
    )! as HTMLElement;
    expect(
      within(conventionsRow).getByTestId("tree-use-badge").textContent,
    ).toBe("🔥214");
    expect(within(frRow).getByTestId("tree-use-badge").textContent).toBe("🔥18");
    const indexRow = closestAntdTreeRow(screen.getByText("INDEX.md"))! as HTMLElement;
    expect(within(indexRow).queryByTestId("tree-use-badge")).not.toBeInTheDocument();
  });

  it("空待审核负例：无 proposed 条目时不渲染待审核组与徽标", async () => {
    mockList.mockResolvedValue({
      items: [
        entry({ filename: "INDEX.md", path: ".sillyspec/knowledge/INDEX.md" }),
        entry({
          filename: "decisions/daemon.md",
          path: ".sillyspec/knowledge/decisions/daemon.md",
          zone: "decisions",
        }),
      ],
    });
    renderPage();
    await waitForTree(["知识手册", "决策库", "INDEX.md"]);

    expect(screen.queryByText("待审核")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposed-zone-badge")).not.toBeInTheDocument();
  });

  it("缺 zone 条目兜底归知识手册组", async () => {
    mockList.mockResolvedValue({
      items: [
        entry({ filename: "INDEX.md", path: ".sillyspec/knowledge/INDEX.md", zone: undefined }),
      ],
    });
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);
    expect(screen.queryByText("待审核")).not.toBeInTheDocument();
  });

  it("点目录行收起/展开；点文件行 → getKnowledge 拉详情，默认卡片视图切「原文」走 Markdown 渲染", async () => {
    mockGet.mockResolvedValue(
      entry({
        filename: "proposed/pending-fix.md",
        path: ".sillyspec/knowledge/proposed/pending-fix.md",
        zone: "proposed",
        title: "待合并修复",
        content: "# 你好",
      }),
    );
    renderPage();
    await waitForTree(["待审核", "pending-fix.md"]);

    // 点 zone 组行 → 收起（子行隐藏，ql-20260821-015 expandAction=click）。
    fireEvent.click(closestAntdTreeNodeWrapper(screen.getByText("待审核"))!);
    await waitFor(() =>
      expect(screen.queryByText("pending-fix.md")).not.toBeInTheDocument(),
    );
    // 再点 → 展开。
    fireEvent.click(closestAntdTreeNodeWrapper(screen.getByText("待审核"))!);
    await waitForTree(["pending-fix.md"]);

    // 点文件行 → 按 filename（含子目录段）拉详情；md 文件默认卡片视图
    // （task-05 / FR-04：统一条目渲染器挂载，md 阅读视图不在默认态）。
    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("pending-fix.md"))!,
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(WS, "proposed/pending-fix.md"));
    await waitFor(() => expect(screen.getByText("待合并修复")).toBeInTheDocument());
    const cards = await screen.findByTestId("entry-card-list");
    expect(cards).toHaveAttribute("data-form", "single");
    expect(screen.queryByTestId("md-preview")).not.toBeInTheDocument();

    // 「原文」tab → 既有 Markdown 阅读视图（零改动路径）。
    fireEvent.click(screen.getByTestId("view-tab-raw"));
    await waitFor(() => expect(screen.getByTestId("md-preview")).toHaveTextContent("# 你好"));
    expect(screen.queryByTestId("entry-card-list")).not.toBeInTheDocument();
  });

  it("树栏默认 280px，拖动把手调宽并写入 localStorage 记忆", async () => {
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);

    const panel = screen.getByTestId("knowledge-tree-panel");
    expect(panel.style.getPropertyValue("--tree-w")).toBe("280px");

    const resizer = screen.getByTestId("knowledge-tree-resizer");
    firePointer(resizer, "pointerDown", { clientX: 280 });
    firePointer(window, "pointerMove", { clientX: 380 });
    firePointer(window, "pointerUp");

    expect(panel.style.getPropertyValue("--tree-w")).toBe("380px");
    expect(localStorage.getItem("sillyhub-knowledge-tree-width")).toBe("380");
  });
});

describe("写入口权限与 decisions 只读（task-05 / FR-02 / FR-07 / D-006@v1）", () => {
  it("未持有 knowledge:write（非平台管理员）→ 沉淀与编辑入口均不渲染", async () => {
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);

    expect(screen.queryByTestId("precipitate-entry")).not.toBeInTheDocument();

    // 选中条目后内容区也无编辑按钮（页面与现状一致）。
    mockGet.mockResolvedValue(
      entry({
        filename: "conventions.md",
        path: ".sillyspec/knowledge/conventions.md",
        zone: "top",
        title: "约定",
        content: "# 约定",
      }),
    );
    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("conventions.md"))!,
    );
    await waitFor(() => expect(screen.getByText("约定")).toBeInTheDocument());
    expect(screen.queryByTestId("edit-entry")).not.toBeInTheDocument();
  });

  it("持有 knowledge:write → 见「沉淀知识」；选中条目后见「编辑」，点开挂 EntryEditor", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    mockGet.mockResolvedValue(
      entry({
        filename: "conventions.md",
        path: ".sillyspec/knowledge/conventions.md",
        zone: "top",
        title: "约定",
        content: "# 约定\n\n正文",
      }),
    );
    renderPage();
    await waitForTree(["知识手册", "conventions.md"]);

    expect(screen.getByTestId("precipitate-entry")).toHaveTextContent("沉淀知识");

    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("conventions.md"))!,
    );
    await waitFor(() => expect(screen.getByTestId("edit-entry")).toBeInTheDocument());

    // 点「编辑」→ 内容区切换 EntryEditor（Markdown 正文编辑框）。
    fireEvent.click(screen.getByTestId("edit-entry"));
    await waitFor(() => expect(screen.getByTestId("entry-editor")).toBeInTheDocument());
    expect(screen.getByLabelText("正文编辑")).toHaveValue("# 约定\n\n正文");
  });

  it("is_platform_admin 短路 → 无 permissions 数组也见「沉淀知识」入口", async () => {
    sessionState.user = { permissions: undefined, is_platform_admin: true };
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);
    expect(screen.getByTestId("precipitate-entry")).toBeInTheDocument();
  });

  it("decisions 条目（即使持有写权限）→ 无编辑按钮 + 「由归档流程维护 · 只读」标注", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    mockGet.mockResolvedValue(
      entry({
        filename: "decisions/daemon.md",
        path: ".sillyspec/knowledge/decisions/daemon.md",
        zone: "decisions",
        title: "daemon 决策",
        content: "# daemon 决策",
      }),
    );
    renderPage();
    await waitForTree(["决策库", "daemon.md"]);

    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("daemon.md"))!,
    );
    await waitFor(() => expect(screen.getByText("daemon 决策")).toBeInTheDocument());

    expect(screen.queryByTestId("edit-entry")).not.toBeInTheDocument();
    expect(screen.getByTestId("decisions-readonly-tag")).toHaveTextContent(
      "由归档流程维护 · 只读",
    );
  });
});

/** 选中待审核条目并等待详情渲染（task-06 操作区用例共用步骤）。 */
async function selectProposedEntry() {
  mockGet.mockResolvedValue(
    entry({
      filename: "proposed/pending-fix.md",
      path: ".sillyspec/knowledge/proposed/pending-fix.md",
      zone: "proposed",
      title: "待合并修复",
      content: "# 候选正文",
    }),
  );
  renderPage();
  await waitForTree(["待审核", "pending-fix.md"]);
  fireEvent.click(
    closestAntdTreeNodeWrapper(screen.getByText("pending-fix.md"))!,
  );
  await waitFor(() => expect(screen.getByText("待合并修复")).toBeInTheDocument());
}

describe("待审核操作区：合并/拒绝（task-06 / FR-05 / D-007@v1）", () => {
  it("未持有 knowledge:write → 选中 proposed 条目后合并/拒绝按钮均不渲染", async () => {
    await selectProposedEntry();
    expect(screen.queryByTestId("edit-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("merge-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reject-entry")).not.toBeInTheDocument();
  });

  it("持有 knowledge:write → proposed 条目挂「合并/拒绝」；top 条目只有编辑无合并/拒绝", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    await selectProposedEntry();
    expect(screen.getByTestId("merge-entry")).toHaveTextContent("合并");
    expect(screen.getByTestId("reject-entry")).toHaveTextContent("拒绝");

    // top 条目（非待审核）不渲染审核操作区。
    mockGet.mockResolvedValue(
      entry({
        filename: "conventions.md",
        path: ".sillyspec/knowledge/conventions.md",
        zone: "top",
        title: "约定",
        content: "# 约定",
      }),
    );
    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("conventions.md"))!,
    );
    await waitFor(() => expect(screen.getByText("约定")).toBeInTheDocument());
    expect(screen.queryByTestId("merge-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reject-entry")).not.toBeInTheDocument();
  });

  it("点「合并」→ 挂载 MergeDialog（目标条目 filename 透传）", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    await selectProposedEntry();

    fireEvent.click(screen.getByTestId("merge-entry"));

    const stub = await screen.findByTestId("merge-dialog-stub");
    expect(stub).toHaveAttribute("data-filename", "proposed/pending-fix.md");
  });

  it("拒绝流：Popconfirm 二次确认后调 reject → 成功 toast + 刷新列表 + 清详情", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    await selectProposedEntry();
    const listCallsBefore = mockList.mock.calls.length;

    // 点「拒绝」只弹确认层，不调端点。
    fireEvent.click(screen.getByTestId("reject-entry"));
    await waitFor(() =>
      expect(screen.getByText("拒绝该候选知识？")).toBeInTheDocument(),
    );
    expect(mockReject).not.toHaveBeenCalled();

    // 确认：调 reject（filename 含 proposed/ 段）→ toast + 列表重拉 + 详情复位。
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith(WS, "proposed/pending-fix.md"),
    );
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith("已拒绝该候选知识"),
    );
    await waitFor(() => expect(mockList.mock.calls.length).toBe(listCallsBefore + 1));
    // 详情复位（候选已删，内容区回空态提示）。
    await waitFor(() =>
      expect(screen.getByText("选择左侧文档查看内容。")).toBeInTheDocument(),
    );
  });

  it("拒绝取消：Popconfirm 点「取消」不调 reject、详情保留", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    await selectProposedEntry();

    fireEvent.click(screen.getByTestId("reject-entry"));
    await waitFor(() =>
      expect(screen.getByText("拒绝该候选知识？")).toBeInTheDocument(),
    );
    // antd 2 字按钮自动插入字间空格（「取 消」）。
    fireEvent.click(screen.getByRole("button", { name: "取 消" }));

    // 未确认即不调端点、详情不动（jsdom 关闭动画不触发 unmount，不断言弹层消失）。
    await waitFor(() =>
      expect(screen.getByText("待合并修复")).toBeInTheDocument(),
    );
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockList.mock.calls.length).toBe(1);
  });

  it("拒绝失败 → error toast，详情保留不刷新", async () => {
    sessionState.user = { permissions: ["knowledge:write"], is_platform_admin: false };
    mockReject.mockRejectedValueOnce(new Error("文件在别处被修改，请刷新后重试"));
    await selectProposedEntry();

    fireEvent.click(screen.getByTestId("reject-entry"));
    await waitFor(() =>
      expect(screen.getByText("拒绝该候选知识？")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("文件在别处被修改，请刷新后重试"),
    );
    // 失败不清详情（候选仍在）。
    expect(screen.getByText("待合并修复")).toBeInTheDocument();
  });
});

describe("蒸馏任务条挂载（task-08 / FR-01 / FR-03 / D-002@v1）", () => {
  it("任务条挂知识库页列表上方（workspace id 透传）；任务完成回调重拉知识列表", async () => {
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);

    const stub = screen.getByTestId("distill-task-bar-stub");
    expect(stub).toHaveAttribute("data-workspace", WS);

    // stub 暴露的「任务完成」= onCompleted 接线：触发后知识列表重拉
    // （蒸馏候选经上行同步回流后出现在待审核区）。
    const listCallsBefore = mockList.mock.calls.length;
    fireEvent.click(screen.getByTestId("stub-distill-completed"));
    await waitFor(() => expect(mockList.mock.calls.length).toBe(listCallsBefore + 1));
  });
});

describe("运营仪表盘挂载（task-04 / 2026-09-20-knowledge-effect-panel / FR-02 / FR-03）", () => {
  it("挂页面顶部（PageHeader 之下、任务条/树之上），stats 按 workspace 拉取；零值指标走空态", async () => {
    renderPage();
    await waitForTree(["知识手册", "INDEX.md"]);

    // stats 端点按 workspace id 拉取。
    await waitFor(() =>
      expect(getKnowledgeStats).toHaveBeenCalledWith(WS),
    );
    // 缺省零值指标 → 空态「暂无使用数据」（不干扰树/详情形态）。
    await waitFor(() =>
      expect(screen.getByTestId("ops-dashboard-empty")).toBeInTheDocument(),
    );

    // 版位：仪表盘在任务条 stub 与树面板之前（PageHeader 之下第一个区块）。
    const dashboard = screen.getByTestId("ops-dashboard-empty");
    const bar = screen.getByTestId("distill-task-bar-stub");
    const tree = screen.getByTestId("knowledge-tree-panel");
    expect(dashboard.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("卡片/原文双 tab 分发（task-05 / 2026-09-20-knowledge-effect-panel / FR-04 / D-004@v2）", () => {
  /** 选中 conventions.md（手册形态多小节）并等卡片视图渲染（双 tab 用例共用步骤）。 */
  async function selectManualEntry(content: string, useCount: number | null = 214) {
    mockGet.mockResolvedValue(
      entry({
        filename: "conventions.md",
        path: ".sillyspec/knowledge/conventions.md",
        zone: "top",
        title: "项目约定",
        content,
        use_count: useCount,
      }),
    );
    renderPage();
    await waitForTree(["知识手册", "conventions.md"]);
    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("conventions.md"))!,
    );
    await waitFor(() => expect(screen.getByText("项目约定")).toBeInTheDocument());
    await screen.findByTestId("entry-card-list");
  }

  const MANUAL_TWO_SECTIONS =
    "---\nauthor: q\n---\n\n# 项目约定\n\n## 小节一\n\n正文一。\n\n## 小节二\n\n正文二。\n";

  it("md 文件点开默认卡片（手册形态逐小节卡 + 文件级 🔥 徽标）；tab 可往返；重新选文件回默认卡片", async () => {
    await selectManualEntry(MANUAL_TWO_SECTIONS);

    // 默认卡片：手册形态逐小节成卡 + 头部文件级 🔥 徽标。
    expect(screen.getByTestId("entry-card-list")).toHaveAttribute("data-form", "manual");
    expect(screen.getAllByTestId("manual-section-card")).toHaveLength(2);
    expect(screen.getByText("小节一")).toBeInTheDocument();
    expect(screen.getByText("正文二。")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("entry-use-badge").map((b) => b.textContent),
    ).toContain("🔥 214");
    // tab 选中态：默认卡片。
    expect(screen.getByTestId("view-tab-cards")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("view-tab-raw")).toHaveAttribute("aria-selected", "false");

    // 切原文 → 既有 md 阅读视图（零改动）；再切回卡片。
    fireEvent.click(screen.getByTestId("view-tab-raw"));
    await waitFor(() => expect(screen.getByTestId("md-preview")).toBeInTheDocument());
    expect(screen.getByTestId("view-tab-raw")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByTestId("view-tab-cards"));
    await waitFor(() => expect(screen.getByTestId("entry-card-list")).toBeInTheDocument());

    // 原文态下换选文件 → 回默认卡片（selectEntry 复位 viewMode）。
    fireEvent.click(screen.getByTestId("view-tab-raw"));
    await waitFor(() => expect(screen.getByTestId("md-preview")).toBeInTheDocument());
    mockGet.mockResolvedValue(
      entry({
        filename: "INDEX.md",
        path: ".sillyspec/knowledge/INDEX.md",
        zone: "top",
        title: "Knowledge Index",
        content: "# Knowledge Index\n\n## Conventions\n- 关键词 → [标题](conventions.md#锚)\n",
      }),
    );
    fireEvent.click(
      closestAntdTreeNodeWrapper(screen.getByText("INDEX.md"))!,
    );
    await waitFor(() =>
      expect(screen.getByTestId("entry-card-list")).toHaveAttribute("data-form", "index"),
    );
    expect(screen.queryByTestId("md-preview")).not.toBeInTheDocument();
  });

  it("条目级计数从 stats usage_board 派生（同 key 复用缓存）：锚对齐小节带 🔥 徽标", async () => {
    // stats 榜含 conventions.md#小节一 锚（slug=中文原样保留）——条目级徽标数据链。
    (getKnowledgeStats as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      coverage: { used_entries: 1, total_entries: 5, trend: [] },
      dead_entries: [],
      density: { per_task_avg: 0, trend: [] },
      freshness: { recent_new: 0, recent_used: 0 },
      usage_board: [
        {
          anchor: "conventions.md#小节一",
          per_task: 0.5,
          total: 41,
          task_count: 3,
          first_hit: null,
          last_hit: null,
        },
      ],
      entry_counts: [{ file: "conventions.md", count: 41 }],
    });
    await selectManualEntry(MANUAL_TWO_SECTIONS);

    // 小节一带条目级徽标 🔥 41；小节二不带（仅头部文件级 🔥 214）。
    const badges = screen.getAllByTestId("entry-use-badge").map((b) => b.textContent);
    expect(badges).toContain("🔥 41");
    expect(badges).toContain("🔥 214");
    expect(badges).toHaveLength(2);
  });

  it("无使用数据的端（stats 空榜）：条目卡不带徽标，仅文件级 useCount 头部徽标（FR-06 降级口径）", async () => {
    await selectManualEntry(MANUAL_TWO_SECTIONS);
    // 缺省 stats 零值（usage_board 空）→ 无条目级徽标，头部文件级 🔥 214 仍在。
    const badges = screen.getAllByTestId("entry-use-badge").map((b) => b.textContent);
    expect(badges).toEqual(["🔥 214"]);
  });
});

describe("WorkspaceTabs「知识库」tab（ql-20260821-015）", () => {  it("标签列表包含「知识库」且 href 为 /knowledge，位于「文件」之后", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    const links = screen.getAllByRole("link");
    const labels = links.map((a) => a.textContent);
    const fileIdx = labels.indexOf("文件");
    const knowledgeIdx = labels.indexOf("知识库");
    expect(knowledgeIdx).toBeGreaterThan(fileIdx);
    expect(links[knowledgeIdx]).toHaveAttribute("href", "/workspaces/ws-1/knowledge");
  });
});
