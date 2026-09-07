/**
 * ConflictCompareModal 组件测试（2026-09-07-conflict-diff-compare task-06 /
 * FR-02 / D-002@v1 / D-003@v1）——TDD 红态锚定：组件由 task-07 实现
 * （components/changes/conflict-compare-modal.tsx 尚不存在，当前红 = 模块
 * 不存在，属预期红，非断言/导入写法错误）。
 *
 * 锚定 design §5 Phase 3.3 + §7.2 响应契约，测试数据结构与 api-types.ts
 * 生成类型逐字段对齐：
 *   - SillySpecConflictCompareResponse：kind 二值、files/progress_rows 互补、
 *     response_truncated/dropped_paths、四时间字段原样透传；
 *   - files[].status 四枚举 modified|local_only|platform_only|identical
 *     （B4 方向：local_only=本地有平台无 / platform_only=平台有本地无）；
 *   - diff_rows[].type 三枚举 equal|delete|insert（delete=本地行红 bg-error、
 *     insert=平台行绿 bg-success，语义 token 不手写 hex）；
 *   - progress_rows[] 四字段 label/local_value/platform_value/differ（differ
 *     行 warning 橙高亮，D-003@v1 对比表）。
 *
 * 组件 props 契约（task-07 按此实现，父级 platform-sync-section 接线）：
 *   ConflictCompareModalProps {
 *     open: boolean;                    // react-query enabled: open（关闭不拉取）
 *     onClose: () => void;
 *     instanceId: string;               // compare 端点机器路径参数
 *     workspaceId: string;              // compare 端点 query 参数
 *     conflict: { change; kind: "spec-tree" | "progress";
 *                 ql_id?: string | null; created_at?: string | null } | null;
 *     canOperate: boolean;              // 裁决权限（父级 useMachineSyncActionAccess.canOperate）
 *     onDispatched?: (change: string, strategy: "keep_local" | "take_platform") => void;
 *                                       // 下发成功后回调（父级登记回显条目，§5 3.3
 *                                       // 「下发成功关闭弹窗，回显走既有链路」）
 *   }
 *
 * 惯例：仿 platform-sync-section.test.tsx（vi.hoisted mock @/lib/daemon +
 * QueryClientProvider retry:false/gcTime:0 + <AntApp> 包裹 + .ant-modal-confirm
 * 结构选择器 + 中文 Button autoLetterSpacing 的 \s* 正则）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 组件尚未实现（task-07）——运行时模块不存在即本文件的红态来源。
import { ConflictCompareModal } from "@/components/changes/conflict-compare-modal";
import type { components } from "@/lib/api-types";

type CompareResponse = components["schemas"]["SillySpecConflictCompareResponse"];
type CompareFile = components["schemas"]["SillySpecConflictCompareFile"];

const mocks = vi.hoisted(() => ({
  getCompare: vi.fn(),
  triggerResolve: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  // getSillySpecConflictCompare 由 task-07 落入 lib/daemon.ts；此处提前占位 mock
  getSillySpecConflictCompare: mocks.getCompare,
  triggerMachineSillySpecResolve: mocks.triggerResolve,
}));

// ── fixtures（§7.2 形状，字段与 api-types.ts 生成类型一致）──────────────────

/** spec-tree 主 fixture：4 文件（modified/local_only/platform_only/identical 各一，identical 为归档路径）。 */
function makeFile(overrides: Partial<CompareFile> & { path: string }): CompareFile {
  return {
    status: "modified",
    local_mtime: "2026-09-04T08:35:27+08:00",
    platform_mtime: "2026-09-04T10:35:27+08:00",
    local_truncated: false,
    local_missing: false,
    diff_rows: [],
    diff_truncated: false,
    binary: false,
    ...overrides,
  } as CompareFile;
}

const SPEC_TREE_RESP: CompareResponse = {
  change: "quick-62e1d5fb",
  kind: "spec-tree",
  ql_id: "ql-20260904-002-62e1",
  conflict_created_at: "2026-09-04T00:35:27.490Z",
  // 本地（08:35）较平台（10:35）旧 → 时间条应在本地侧给「保本地将回退」方向提示
  local_updated_at: "2026-09-04T08:35:27+08:00",
  platform_updated_at: "2026-09-04T10:35:27+08:00",
  response_truncated: false,
  dropped_paths: 0,
  files: [
    // 排序口径（§5 3.3）：本变更目录在前、archive 沉底——首个文件默认选中
    makeFile({
      path: "changes/2026-09-02-my-change/design.md",
      status: "modified",
      diff_rows: [
        {
          type: "equal",
          local_lineno: 1,
          local_text: "# 共有标题",
          platform_lineno: 1,
          platform_text: "# 共有标题",
        },
        {
          type: "delete",
          local_lineno: 2,
          local_text: "本地旧内容",
          platform_lineno: null,
          platform_text: null,
        },
        {
          type: "insert",
          local_lineno: null,
          local_text: null,
          platform_lineno: 2,
          platform_text: "平台新内容",
        },
      ],
    }),
    makeFile({ path: "changes/2026-09-02-my-change/local-only.md", status: "local_only" }),
    makeFile({ path: "changes/2026-09-02-my-change/platform-only.md", status: "platform_only" }),
    makeFile({ path: "changes/archive/2026-08-01-old-change/proposal.md", status: "identical" }),
  ],
};

const SPEC_TREE_CONFLICT = {
  change: "quick-62e1d5fb",
  kind: "spec-tree",
  ql_id: "ql-20260904-002-62e1",
  created_at: "2026-09-04T00:35:27.490Z",
} as const;

/** progress fixture：平台（10:00）较本地（12:00）旧 → 「取平台将回退」方向提示。 */
const PROGRESS_RESP: CompareResponse = {
  change: "2026-09-04-active-change",
  kind: "progress",
  ql_id: null,
  conflict_created_at: "2026-09-04T00:35:27.490Z",
  local_updated_at: "2026-09-04T12:00:00+08:00",
  platform_updated_at: "2026-09-04T10:00:00+08:00",
  response_truncated: false,
  dropped_paths: 0,
  files: [],
  progress_rows: [
    { label: "当前阶段", local_value: "⚡ 波次执行", platform_value: "📐 实现计划", differ: true },
    { label: "阶段标签", local_value: "⚙️ 执行实现", platform_value: "⚙️ 执行实现", differ: false },
    { label: "步骤进度", local_value: "4/8", platform_value: "6/8", differ: true },
    { label: "最近活跃", local_value: "2026-09-04 11:00", platform_value: "—", differ: true },
  ],
};

const PROGRESS_CONFLICT = {
  change: "2026-09-04-active-change",
  kind: "progress",
} as const;

/** 截断/二进制 fixture：local_truncated / diff_truncated / binary 三占位。 */
const TRUNC_BIN_RESP: CompareResponse = {
  ...SPEC_TREE_RESP,
  files: [
    makeFile({
      path: "changes/big/local-truncated.md",
      local_truncated: true,
      diff_rows: [], // 本地截断无 content → 不出 diff_rows（§7.2 注释约定）
    }),
    makeFile({
      path: "changes/big/diff-truncated.md",
      diff_rows: [
        {
          type: "equal",
          local_lineno: 1,
          local_text: "第一行",
          platform_lineno: 1,
          platform_text: "第一行",
        },
      ],
      diff_truncated: true,
    }),
    makeFile({ path: "changes/big/image.png", binary: true }),
  ],
};

// ── 渲染 helpers ───────────────────────────────────────────────────────────

interface ModalPropsOverride {
  open?: boolean;
  onClose?: () => void;
  instanceId?: string;
  workspaceId?: string;
  conflict?: { change: string; kind: "spec-tree" | "progress"; ql_id?: string | null; created_at?: string | null };
  canOperate?: boolean;
  onDispatched?: (change: string, strategy: "keep_local" | "take_platform") => void;
}

let queryClient: QueryClient;

function renderModal(props: ModalPropsOverride = {}) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <ConflictCompareModal
          open={props.open ?? true}
          onClose={props.onClose ?? vi.fn()}
          instanceId={props.instanceId ?? "machine-1"}
          workspaceId={props.workspaceId ?? "ws-1"}
          conflict={props.conflict ?? { ...SPEC_TREE_CONFLICT }}
          canOperate={props.canOperate ?? true}
          onDispatched={props.onDispatched}
        />
      </AntApp>
    </QueryClientProvider>,
  );
}

/** 等 antd modal.confirm 挂载（portal 到 body；标题渲染两份走结构选择器）。 */
async function openConfirmRoot(): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector(".ant-modal-confirm");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe("ConflictCompareModal（task-06 红态锚定 / design §7.2）", () => {
  beforeEach(() => {
    mocks.getCompare.mockReset();
    mocks.triggerResolve.mockReset();
    mocks.getCompare.mockResolvedValue(SPEC_TREE_RESP);
    mocks.triggerResolve.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    cleanup();
    // 清掉 antd modal.confirm / message 的独立 portal root（各自 createRoot，
    // 不随 RTL cleanup 卸载；防跨用例残留污染 querySelector / getByText）
    document
      .querySelectorAll(".ant-modal-root, .ant-message")
      .forEach((el) => el.remove());
    queryClient?.clear();
  });

  // ── 1. 拉取门控（enabled: open）────────────────────────────────────────

  it("open=false 不发起 compare 拉取", async () => {
    renderModal({ open: false });
    await act_flush();
    expect(mocks.getCompare).not.toHaveBeenCalled();
  });

  it("打开即拉取 compare 端点——参数 = (instanceId, change, kind, workspaceId)", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);
    expect(mocks.getCompare).toHaveBeenCalledWith(
      "machine-1",
      "quick-62e1d5fb",
      "spec-tree",
      "ws-1",
    );
  });

  // ── 2. spec-tree 模式 ──────────────────────────────────────────────────

  it("spec-tree——文件清单徽章 + 涉及/归档计数 + 默认只看差异可切全部", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);

    // 差异文件默认可见（徽章四分类中的三个差异态；identical=相同默认隐藏）
    expect(screen.getByText("修改")).toBeInTheDocument();
    expect(screen.getByText("仅本地")).toBeInTheDocument();
    expect(screen.getByText("仅平台")).toBeInTheDocument();
    expect(
      screen.queryByText(/changes\/archive\/2026-08-01-old-change\/proposal\.md/),
    ).toBeNull();

    // 头部计数按全量清单（归档行隐藏时计数仍在，§5 3.3）
    expect(screen.getByText(/涉及 4 个文件/)).toBeInTheDocument();
    expect(screen.getByText(/其中归档 1 个/)).toBeInTheDocument();

    // 切「全部」→ identical 归档行 + 相同徽章出现
    fireEvent.click(screen.getByRole("button", { name: /全部/ }));
    expect(
      await screen.findByText(/changes\/archive\/2026-08-01-old-change\/proposal\.md/),
    ).toBeInTheDocument();
    expect(screen.getByText("相同")).toBeInTheDocument();
  });

  it("side-by-side diff——delete 本地行红 bg-error / insert 平台行绿 bg-success / equal 行无高亮", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);

    // 默认选中首个 modified 文件 → 右栏渲染 §7.2 diff_rows（type 三枚举齐活）
    const deleteRow = screen.getByText(/本地旧内容/);
    expect(deleteRow.closest("[class*='bg-error']")).not.toBeNull();
    const insertRow = screen.getByText(/平台新内容/);
    expect(insertRow.closest("[class*='bg-success']")).not.toBeNull();

    // equal 行双侧各渲染一份，且不着差异色
    const equalRows = screen.getAllByText(/# 共有标题/);
    expect(equalRows.length).toBeGreaterThanOrEqual(2);
    for (const el of equalRows) {
      expect(el.closest("[class*='bg-error']")).toBeNull();
      expect(el.closest("[class*='bg-success']")).toBeNull();
    }
  });

  it("时间条——双侧最后更新时间 + 较旧一侧方向提示（本地较旧 → 保本地将回退平台较新内容）", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);
    expect(screen.getByText(/本地最后更新/)).toBeInTheDocument();
    expect(screen.getByText(/平台最后更新/)).toBeInTheDocument();
    expect(screen.getByText(/保本地将回退平台较新内容/)).toBeInTheDocument();
  });

  it("点选清单文件——切到 local_only 文件后右栏跟随切换", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);
    expect(screen.getByText(/本地旧内容/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/changes\/2026-09-02-my-change\/local-only\.md/));
    // 切走后原 diff 文本不再渲染（右侧面板跟随选中文件）
    await waitFor(() => expect(screen.queryByText(/本地旧内容/)).toBeNull());
  });

  // ── 3. progress 模式（D-003@v1 对比表）──────────────────────────────────

  it("progress——三列对比表（对比项/本地/平台）+ differ 行橙高亮 + 平台较旧方向提示", async () => {
    mocks.getCompare.mockResolvedValue(PROGRESS_RESP);
    renderModal({ conflict: { ...PROGRESS_CONFLICT } });

    await screen.findByText("当前阶段");
    expect(screen.getByText("对比项")).toBeInTheDocument();
    expect(screen.getByText("本地")).toBeInTheDocument();
    expect(screen.getByText("平台")).toBeInTheDocument();
    // 对比行值（progress_rows 四字段）
    expect(screen.getByText(/⚡ 波次执行/)).toBeInTheDocument();
    expect(screen.getByText(/📐 实现计划/)).toBeInTheDocument();
    expect(screen.getByText("4/8")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();
    // 本地缺失字段显式「—」（§7.2 progress_rows 约定）
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    // differ=true 行 warning 橙高亮；differ=false 行不高亮
    expect(
      screen.getByText("当前阶段").closest("[class*='bg-warning']"),
    ).not.toBeNull();
    expect(
      screen.getByText("阶段标签").closest("[class*='bg-warning']"),
    ).toBeNull();

    // 平台（10:00）较本地（12:00）旧 → 取平台方向回退提示
    expect(screen.getByText(/本地最后更新/)).toBeInTheDocument();
    expect(screen.getByText(/取平台将回退/)).toBeInTheDocument();
  });

  // ── 4. loading / 失败重试 ───────────────────────────────────────────────

  it("loading 态——拉取中显示加载文案", async () => {
    mocks.getCompare.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(await screen.findByText(/正在加载对比/)).toBeInTheDocument();
  });

  it("失败重试——错误文案 + 重试按钮点击后重拉", async () => {
    mocks.getCompare.mockRejectedValueOnce(new Error("daemon offline"));
    renderModal();

    expect(await screen.findByText(/读取对比数据失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));

    await screen.findByText(/涉及 4 个文件/);
    expect(mocks.getCompare).toHaveBeenCalledTimes(2);
  });

  // ── 5. 截断与二进制占位（§7.2 local_truncated / diff_truncated / binary）──

  it("截断与二进制——local_truncated/diff_truncated 提示条 + binary「无法文本对比」占位", async () => {
    mocks.getCompare.mockResolvedValue(TRUNC_BIN_RESP);
    renderModal();
    await screen.findByText(/涉及 3 个文件/);

    // 本地截断（无 content 不出 diff_rows，只显截断提示）
    fireEvent.click(screen.getByText(/changes\/big\/local-truncated\.md/));
    expect(await screen.findByText(/截断/)).toBeInTheDocument();

    // 单文件 diff 超 5000 行截断
    fireEvent.click(screen.getByText(/changes\/big\/diff-truncated\.md/));
    expect(await screen.findByText(/截断/)).toBeInTheDocument();

    // 二进制文件占位
    fireEvent.click(screen.getByText(/changes\/big\/image\.png/));
    expect(await screen.findByText(/二进制文件无法文本对比/)).toBeInTheDocument();
  });

  // ── 6. 裁决条（STRATEGY_TEXT 确认弹窗先例复用）──────────────────────────

  it("裁决保本地——确认弹窗（STRATEGY_TEXT 覆盖方向）→ 下发参数 + onDispatched + 关闭弹窗", async () => {
    const onClose = vi.fn();
    const onDispatched = vi.fn();
    renderModal({ onClose, onDispatched });
    await screen.findByText(/涉及 4 个文件/);

    fireEvent.click(screen.getByRole("button", { name: "保本地" }));
    const confirmRoot = await openConfirmRoot();
    expect(confirmRoot.querySelector(".ant-modal-confirm-title")).toHaveTextContent(
      "裁决冲突：保本地（keep-local）",
    );
    expect(
      within(confirmRoot).getByText(/用本机版本覆盖平台版本/),
    ).toBeInTheDocument();
    expect(within(confirmRoot).getByText("quick-62e1d5fb")).toBeInTheDocument();

    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /确\s*认\s*·\s*保\s*本\s*地/ }),
    );
    await waitFor(() =>
      expect(mocks.triggerResolve).toHaveBeenCalledWith("machine-1", {
        change: "quick-62e1d5fb",
        strategy: "keep_local",
      }),
    );
    // 下发成功：父级回显登记回调 + 弹窗关闭（§5 3.3）
    expect(onDispatched).toHaveBeenCalledWith("quick-62e1d5fb", "keep_local");
    expect(onClose).toHaveBeenCalled();
  });

  it("裁决取平台（danger 方向）——确认弹窗 → 下发 take_platform", async () => {
    renderModal();
    await screen.findByText(/涉及 4 个文件/);

    fireEvent.click(screen.getByRole("button", { name: "取平台" }));
    const confirmRoot = await openConfirmRoot();
    expect(confirmRoot.querySelector(".ant-modal-confirm-title")).toHaveTextContent(
      "裁决冲突：取平台（take-platform）",
    );
    expect(
      within(confirmRoot).getByText(/用平台版本覆盖本机版本/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /确\s*认\s*·\s*取\s*平\s*台/ }),
    );
    await waitFor(() =>
      expect(mocks.triggerResolve).toHaveBeenCalledWith("machine-1", {
        change: "quick-62e1d5fb",
        strategy: "take_platform",
      }),
    );
  });

  it("无权限（canOperate=false）——裁决按钮不渲染（对比数据仍可见）", async () => {
    renderModal({ canOperate: false });
    await screen.findByText(/涉及 4 个文件/);

    expect(screen.queryByRole("button", { name: "保本地" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取平台" })).toBeNull();
  });
});

/** 微任务冲刷（open=false 用例等 react-query settled，不用 fake timers）。 */
async function act_flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
