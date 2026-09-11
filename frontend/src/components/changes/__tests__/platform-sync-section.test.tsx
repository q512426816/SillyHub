/**
 * PlatformSyncSection 组件测试（2026-09-04-conflict-resolve-entry task-09 落地；
 * 2026-09-07-conflict-diff-compare task-06 适配行改造——TDD 红态锚定）。
 *
 * task-06 适配范围（design §5 Phase 3.2 / D-002@v1，组件改造由 task-07 实现，
 * 当前红 = 行为未实现属预期）：
 *   - 按钮收敛：行上不再有「保本地/取平台」，只留「查看对比」单按钮（裁决
 *     收进对比弹窗）；旧 modal.confirm 裁决流程断言移除（弹窗内流程由
 *     conflict-compare-modal.test.tsx 覆盖）；
 *   - ql 标题：ql_id 存在 → 【ql-编号】快速修复 + 小字原始 ID；缺失兜底变更名；
 *   - 行上补冲突发生时间（created_at 相对时间）；
 *   - 机器离线 → 「查看对比」禁用 + title 提示「机器离线，无法读取本地内容」；
 *   - 无权限（非机器所有者且非平台管理员）→ 不渲染「查看对比」。
 *
 * 回显链路（waiting/succeeded/failed/timeout、ECHO_TIMEOUT、快照刷新行消失）
 * 仍归本组件：裁决下发入口改经对比弹窗——本文件以 vi.mock stub 掉弹窗组件，
 * 用 stub 暴露的「下发/关闭」按钮驱动（props 契约与 conflict-compare-modal
 * .test.tsx 钉死的一致：open/onClose/conflict/canOperate/onDispatched）。
 *
 * 惯例：数据源 mock 仿 changes-overview-card.test.tsx（vi.hoisted +
 * importActual 部分 mock + QueryClientProvider retry:false/gcTime:0）；
 * antd App.useApp()（modal/message）包 <AntApp> + portal 断言仿
 * platform-shared-agents-card.test.tsx（.ant-modal-confirm 结构选择器 + 中文
 * Button autoLetterSpacing 的 \s* 正则）。心跳回报到达 = 换 machine fixture 后
 * 对组件内 machines 查询 refetchQueries（等价 15s 轮询到点）。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ECHO_TIMEOUT_MS,
  PlatformSyncSection,
} from "@/components/changes/platform-sync-section";
import { useSession } from "@/stores/session";
import type { components } from "@/lib/api-types";
import type { DaemonMachineRead } from "@/lib/daemon";

type StatusFixture = components["schemas"]["MachineSillySpecStatusRead"];
type ChangeFixture = components["schemas"]["DaemonHeartbeatSillySpecChange"];
type ResultFixture =
  components["schemas"]["MachineSillySpecCommandResultRead"];

const mocks = vi.hoisted(() => ({
  listDaemonMachines: vi.fn(),
  fetchMyBinding: vi.fn(),
  triggerResolve: vi.fn(),
  triggerGhostCleanup: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  listDaemonMachines: mocks.listDaemonMachines,
  triggerMachineSillySpecResolve: mocks.triggerResolve,
  triggerMachineSillySpecGhostCleanup: mocks.triggerGhostCleanup,
}));

vi.mock("@/lib/workspace-binding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-binding")>()),
  fetchMyBinding: mocks.fetchMyBinding,
}));

/**
 * 对比弹窗 stub（task-07 落地前 section 尚未渲染该组件，vi.mock 不激活——
 * 红态来自「查看对比」按钮缺失而非导入错误；task-07 后本 stub 替换真实弹窗，
 * 把「下发成功 → onDispatched + onClose」暴露为按钮，驱动 section 回显链路。
 * 弹窗内部行为（compare 拉取/差异渲染/确认弹窗）由 conflict-compare-modal
 * .test.tsx 覆盖，本文件不重复。
 */
vi.mock("@/components/changes/conflict-compare-modal", () => ({
  ConflictCompareModal: (props: {
    open: boolean;
    onClose: () => void;
    instanceId?: string;
    workspaceId?: string;
    conflict: { change?: string | null } | null;
    canOperate?: boolean;
    onDispatched?: (
      change: string,
      strategy: "keep_local" | "take_platform",
    ) => void;
  }) =>
    props.open && props.conflict?.change ? (
      <div data-testid="conflict-compare-modal-stub">
        <span data-testid="stub-conflict-change">{props.conflict.change}</span>
        <span data-testid="stub-instance-id">{props.instanceId ?? ""}</span>
        <span data-testid="stub-workspace-id">{props.workspaceId ?? ""}</span>
        <span data-testid="stub-can-operate">
          {props.canOperate ? "true" : "false"}
        </span>
        <button
          type="button"
          data-testid="stub-keep-local"
          onClick={() => {
            props.onDispatched?.(props.conflict?.change ?? "", "keep_local");
            props.onClose();
          }}
        >
          stub:保本地下发
        </button>
        <button
          type="button"
          data-testid="stub-take-platform"
          onClick={() => {
            props.onDispatched?.(props.conflict?.change ?? "", "take_platform");
            props.onClose();
          }}
        >
          stub:取平台下发
        </button>
        <button type="button" data-testid="stub-close" onClick={props.onClose}>
          stub:关闭
        </button>
      </div>
    ) : null,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

const OWNER_ID = "u-owner";
const OWNER_USER = {
  id: OWNER_ID,
  email: "o@t.com",
  displayName: "Owner",
  is_platform_admin: false,
};
const ADMIN_USER = {
  id: "u-admin",
  email: "a@t.com",
  displayName: "Admin",
  is_platform_admin: true,
};
const OTHER_USER = {
  id: "u-other",
  email: "x@t.com",
  displayName: "Other",
  is_platform_admin: false,
};

const NOW = Date.now();
const MIN = 60_000;
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function makeChange(
  overrides: Partial<ChangeFixture> & { name: string },
): ChangeFixture {
  return {
    ghost: false,
    current_stage: "execute",
    stage_label: "⚙️ 执行实现",
    last_active: isoAgo(10 * MIN),
    steps: { total: 8, completed: 4 },
    ...overrides,
  } as ChangeFixture;
}

/**
 * 默认 fixture：1 条活跃变更（与冲突同名 → 活跃警示在场）+ 1 条 ghost +
 * 2 条冲突（progress=活跃同名无 ql_id / spec-tree=quick-x 带 ql_id——ql 标题
 * 两分支同卡覆盖）。冲突 created_at=25 分钟前（行上「冲突发生时间」断言锚）。
 */
function makeStatus(overrides: Partial<StatusFixture> = {}): StatusFixture {
  return {
    ok: true,
    errors_count: 0,
    warnings_count: 0,
    generated_at: isoAgo(2 * MIN),
    active_changes: 2,
    healthy_count: 1,
    ghost_count: 1,
    conflict_count: 2,
    conflict_types: { "spec-tree": 1, progress: 1 },
    changes: [
      makeChange({ name: "2026-09-04-active-change", last_active: isoAgo(5 * MIN) }),
      makeChange({
        name: "quick-ghost-1",
        ghost: true,
        current_stage: "quick",
        stage_label: "⚡ 快速修复",
        last_active: isoAgo(2 * MIN),
        steps: { total: 3, completed: 0 },
      }),
    ],
    pending_conflicts: [
      {
        change: "2026-09-04-active-change",
        created_at: isoAgo(25 * MIN),
        type: "progress",
      },
      {
        change: "quick-x",
        created_at: isoAgo(25 * MIN),
        type: "spec-tree",
        ql_id: "ql-20260904-002-62e1",
      },
    ],
    ...overrides,
  } as StatusFixture;
}

function makeMachine(
  status: StatusFixture | null,
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  return {
    id: "machine-1",
    hostname: "DEV-QINYI",
    status: "online",
    owner: { user_id: OWNER_ID, email: "o@t.com", display_name: "Owner" },
    sillyspec_status: status,
    sillyspec_command_result: null,
    ...overrides,
  } as unknown as DaemonMachineRead;
}

function makeResult(overrides: Partial<ResultFixture> = {}): ResultFixture {
  return {
    action: "resolve",
    change: "2026-09-04-active-change",
    strategy: "keep_local",
    state: "success",
    exit_code: 0,
    error: null,
    executed_at: isoAgo(30_000),
    ...overrides,
  };
}

// ── 渲染与心跳回报 helpers ──────────────────────────────────────────────────

/** 机器视图 fixture 持有者：pushMachine 换值 + refetch 等价心跳轮询到点。 */
const holder: { machine: DaemonMachineRead } = {
  machine: makeMachine(makeStatus()),
};
let queryClient: QueryClient;

function setupMachine(machine: DaemonMachineRead) {
  holder.machine = machine;
  mocks.listDaemonMachines.mockImplementation(() =>
    Promise.resolve({ items: [holder.machine], total: 1, limit: 100, offset: 0 }),
  );
}

/** renderSection 的 my-binding 覆盖口（隐藏分支用例注入 daemon_id=null 等）。 */
type BindingFixture = {
  workspace_id: string;
  user_id: string;
  daemon_id: string | null;
  runtime_id: string | null;
};

function renderSection(
  props: { compact?: boolean } = {},
  bindingOverride: Partial<BindingFixture> = {},
) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  // 注意：mockResolvedValue 是整体替换——用例若在 renderSection 之前自行
  // mockResolvedValue 会被这里的默认值覆盖（曾致 daemon_id=null 隐藏用例时好时
  // 坏）。要偏离默认绑定时一律走 bindingOverride 参数，不要在用例里先设 mock。
  mocks.fetchMyBinding.mockResolvedValue({
    workspace_id: "ws-1",
    user_id: OWNER_ID,
    daemon_id: "machine-1",
    runtime_id: null,
    ...bindingOverride,
  } satisfies BindingFixture);
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <PlatformSyncSection workspaceId="ws-1" {...props} />
      </AntApp>
    </QueryClientProvider>,
  );
}

/** 模拟心跳回报到达：换机器视图数据 + 主动 refetch 机器查询。 */
async function pushMachine(machine: DaemonMachineRead) {
  holder.machine = machine;
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: ["platform-sync-section", "machines"],
    });
  });
}

/** 等 antd modal.confirm 挂载（portal 到 body；标题渲染两份走结构选择器）。 */
async function openConfirmRoot(): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector(".ant-modal-confirm");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

/** 冲突行（按文本定位所在 li）。 */
function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

describe("PlatformSyncSection（task-09 落地 + task-06 行改造适配）", () => {
  beforeEach(() => {
    useSession.setState({
      user: OWNER_USER,
      accessToken: "tok",
      hydrated: true,
    } as never);
    setupMachine(makeMachine(makeStatus()));
    mocks.triggerResolve.mockResolvedValue({ sent: true });
    mocks.triggerGhostCleanup.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    cleanup();
    // 清掉 antd modal.confirm / message 的独立 portal root（各自 createRoot，
    // 不随 RTL cleanup 卸载；防跨用例残留污染 querySelector / getByText）
    document
      .querySelectorAll(".ant-modal-root, .ant-message")
      .forEach((el) => el.remove());
    useSession.getState().clear();
    queryClient?.clear();
  });

  // ── 1. 渲染 / 隐藏两分支 ──────────────────────────────────────────────

  it("渲染——type 徽章 / ql 标题两分支 / 冲突发生时间 / 查看对比单按钮（无行内裁决）/ ghost 计数 / 数据源机器", async () => {
    renderSection();

    expect(await screen.findByText("平台同步")).toBeInTheDocument();
    // 冲突行：type 徽章（spec=紫 / 进度=琥珀）
    expect(screen.getByText("spec")).toBeInTheDocument();
    expect(screen.getByText("进度")).toBeInTheDocument();

    // ql 标题（D-004@v1）：ql_id 存在 → 【ql-编号】快速修复 + 小字原始 ID；
    // 缺失 → 兜底原变更名
    expect(screen.getAllByText(/【ql-20260904-002-62e1】/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/快速修复/).length).toBeGreaterThan(0);
    expect(screen.getByText("quick-x")).toBeInTheDocument();
    expect(screen.getByText("2026-09-04-active-change")).toBeInTheDocument();

    // 行上补冲突发生时间（created_at 相对时间）
    expect(within(rowOf("quick-x")).getByText(/25 分钟前/)).toBeInTheDocument();

    // 活跃警示：冲突名出现在 changes[] 活跃行 → ⚠ 徽标在场，但按钮不硬禁（D-003@v1）
    expect(screen.getByTestId("platform-sync-active-warn")).toHaveTextContent(
      "活跃变更",
    );
    expect(
      within(rowOf("2026-09-04-active-change")).getByRole("button", { name: "查看对比" }),
    ).toBeEnabled();

    // 按钮收敛（D-002@v1）：行上不再有保本地/取平台，只留「查看对比」
    expect(screen.queryAllByRole("button", { name: "保本地" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "取平台" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "查看对比" })).toHaveLength(2);

    // ghost 区：计数行 + 清理按钮（ghost=1 可用）+ 卡头数据源机器
    expect(screen.getByText(/目录已不存在 · 建议清理/)).toBeInTheDocument();
    expect(screen.getByTestId("platform-sync-ghost-cleanup")).toBeEnabled();
    expect(screen.getByText(/数据源机器：DEV-QINYI/)).toBeInTheDocument();
  });

  it("隐藏——工作区未绑定守护进程（daemon_id=null）→ 整卡不渲染且不发机器查询", async () => {
    renderSection({}, { daemon_id: null });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.listDaemonMachines).not.toHaveBeenCalled();
    expect(screen.queryByText("平台同步")).toBeNull();
  });

  it("隐藏——sillyspec_status=null（CLI 能力缺失）→ 整卡不渲染", async () => {
    setupMachine(makeMachine(null));
    renderSection();
    await waitFor(() => expect(mocks.listDaemonMachines).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("平台同步")).toBeNull();
  });

  // ── 1b. 工作区级取数（ql-20260910-012-392f：map 优先，对齐总览卡 14a50351d）──

  it("取数——sillyspec_status_map 非空时按当前工作区取，不串台机器级单槽位", async () => {
    // 机器级单槽位 = 别的工作区快照（daemon 每轮采集互相覆盖的「最后一位」）；
    // ws-1 的 map 槽位才是本工作区数据（默认 fixture：2 冲突）
    const otherWsStatus = makeStatus({
      active_changes: 1,
      healthy_count: 1,
      ghost_count: 0,
      conflict_count: 1,
      conflict_types: { "spec-tree": 1 },
      changes: [makeChange({ name: "other-ws-change" })],
      pending_conflicts: [
        {
          change: "quick-other-ws",
          created_at: isoAgo(3 * MIN),
          type: "spec-tree",
        },
      ],
    });
    setupMachine(
      makeMachine(otherWsStatus, {
        sillyspec_status_map: { "ws-1": makeStatus() },
      }),
    );
    renderSection();

    expect(await screen.findByText("quick-x")).toBeInTheDocument();
    expect(screen.getByText("2026-09-04-active-change")).toBeInTheDocument();
    // 串台防御：机器级单槽位携带的别区冲突/变更一概不出现
    expect(screen.queryByText("quick-other-ws")).toBeNull();
    expect(screen.queryByText("other-ws-change")).toBeNull();
  });

  it("取数——map 已启用但当前工作区缺席（未被采集）→ 整卡不渲染（不回退单槽位）", async () => {
    setupMachine(makeMachine(makeStatus(), { sillyspec_status_map: {} }));
    renderSection();
    await waitFor(() => expect(mocks.listDaemonMachines).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("平台同步")).toBeNull();
  });

  // ── 2. 权限 gating（D-003@v1 + Grill B1：compare 与裁决同权限集合）────────

  it("权限——非所有者非平台管理员只读：无查看对比/清理按钮，清单与计数保留 + 只读说明", async () => {
    useSession.setState({ user: OTHER_USER } as never);
    renderSection();

    expect(await screen.findByText("平台同步")).toBeInTheDocument();
    expect(screen.getByText("2026-09-04-active-change")).toBeInTheDocument();
    expect(screen.getByText("quick-x")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "查看对比" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "保本地" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "取平台" })).toHaveLength(0);
    expect(screen.queryByTestId("platform-sync-ghost-cleanup")).toBeNull();
    expect(screen.getByText(/只读视角/)).toBeInTheDocument();
  });

  it("权限——平台管理员（非机器所有者）可见操作按钮", async () => {
    useSession.setState({ user: ADMIN_USER } as never);
    renderSection();

    // fixture 两条冲突行 → 多命中用 findAllBy（至少一行可见查看对比）
    expect(
      (await screen.findAllByRole("button", { name: "查看对比" })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("platform-sync-ghost-cleanup")).toBeInTheDocument();
  });

  // ── 3. 查看对比入口（离线禁用 + 弹窗接线）──────────────────────────────

  it("机器离线——「查看对比」禁用并带 title 提示（无法读取本地内容）", async () => {
    setupMachine(makeMachine(makeStatus(), { status: "offline" }));
    renderSection();
    await screen.findByText("quick-x");

    const btn = within(rowOf("quick-x")).getByRole("button", { name: "查看对比" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title") ?? "").toContain("机器离线");
  });

  it("查看对比——点击打开弹窗（conflict/instanceId/workspaceId 接线），关闭后弹窗卸载", async () => {
    renderSection();
    await screen.findByText("quick-x");
    fireEvent.click(
      within(rowOf("quick-x")).getByRole("button", { name: "查看对比" }),
    );

    const stub = await screen.findByTestId("conflict-compare-modal-stub");
    expect(within(stub).getByTestId("stub-conflict-change")).toHaveTextContent(
      "quick-x",
    );
    expect(within(stub).getByTestId("stub-instance-id")).toHaveTextContent(
      "machine-1",
    );
    expect(within(stub).getByTestId("stub-workspace-id")).toHaveTextContent("ws-1");
    expect(within(stub).getByTestId("stub-can-operate")).toHaveTextContent("true");

    fireEvent.click(within(stub).getByTestId("stub-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("conflict-compare-modal-stub")).toBeNull(),
    );
  });

  // ── 4. ghost 区独立断言（行级操作不变）────────────────────────────────

  it("ghost=0 → 一键清理按钮禁用（无 ghost 行）", async () => {
    setupMachine(
      makeMachine(
        makeStatus({
          ghost_count: 0,
          changes: [makeChange({ name: "2026-09-04-active-change" })],
        }),
      ),
    );
    renderSection();

    expect(await screen.findByTestId("platform-sync-ghost-cleanup")).toBeDisabled();
  });

  it("ghost 清理——弹窗写明波及范围（幽灵记录 + 超 7 天空壳目录 + 需较新 daemon）→ 下发 → 成功回显", async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId("platform-sync-ghost-cleanup"));

    const confirmRoot = await openConfirmRoot();
    expect(
      confirmRoot.querySelector(".ant-modal-confirm-title"),
    ).toHaveTextContent("清理 ghost 残留");
    expect(
      within(confirmRoot).getByText(/目录已不存在的变更行/),
    ).toBeInTheDocument();
    expect(
      within(confirmRoot).getByText(/超过 7 天的空壳变更目录/),
    ).toBeInTheDocument();
    expect(
      within(confirmRoot).getByText(/旧版本会静默忽略/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /确\s*认\s*清\s*理/ }),
    );
    await waitFor(() =>
      expect(mocks.triggerGhostCleanup).toHaveBeenCalledWith("machine-1"),
    );
    // 回显 waiting：清理按钮禁用 + 状态文案
    await waitFor(() =>
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("platform-sync-ghost-cleanup")).toBeDisabled();

    // 心跳回报 success → toast + 清理完成回显
    await pushMachine(
      makeMachine(makeStatus(), {
        sillyspec_command_result: makeResult({
          action: "ghost_cleanup",
          change: null,
          strategy: null,
          state: "success",
        }),
      }),
    );
    expect(await screen.findByText(/ghost 清理完成/)).toBeInTheDocument();
    expect(
      screen.getByText("清理完成 · 等待快照刷新（≤75 秒）"),
    ).toBeInTheDocument();
  });

  // ── 5. 裁决回显（入口收进弹窗，经 stub 下发；成功 / 失败 / 150s 恢复）────

  it("回显成功——弹窗内保本地 → 等待回报 → toast + 已消解 + 行随快照消失", async () => {
    renderSection();
    await screen.findByText("2026-09-04-active-change");
    const row = rowOf("2026-09-04-active-change");
    fireEvent.click(within(row).getByRole("button", { name: "查看对比" }));

    // 弹窗内下发保本地（stub 模拟：onDispatched(change,"keep_local") + onClose）
    const stub = await screen.findByTestId("conflict-compare-modal-stub");
    fireEvent.click(within(stub).getByTestId("stub-keep-local"));
    await waitFor(() =>
      expect(screen.queryByTestId("conflict-compare-modal-stub")).toBeNull(),
    );

    // 回显 waiting：行上查看对比禁用 + 状态文案
    await waitFor(() =>
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument(),
    );
    expect(within(row).getByRole("button", { name: "查看对比" })).toBeDisabled();

    // 心跳回报 success（action+change+strategy 匹配）→ 成功 toast + 已消解 + 按钮隐藏
    await pushMachine(
      makeMachine(makeStatus(), {
        sillyspec_command_result: makeResult(),
      }),
    );
    expect(await screen.findByText(/冲突已消解/)).toBeInTheDocument();
    expect(
      screen.getByText("已消解 · 等待快照刷新（≤75 秒）"),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "查看对比" })).toBeNull();

    // 快照刷新（≤60-75s 采集）→ 冲突行随快照消失
    await pushMachine(
      makeMachine(
        makeStatus({
          pending_conflicts: [
            {
              change: "quick-x",
              created_at: isoAgo(25 * MIN),
              type: "spec-tree",
              ql_id: "ql-20260904-002-62e1",
            },
          ],
          conflict_count: 1,
          conflict_types: { "spec-tree": 1 },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("2026-09-04-active-change")).toBeNull(),
    );
  });

  it("回显失败——红字摘要（exit code + stderr 节选）+ 行按钮恢复可重试", async () => {
    renderSection();
    await screen.findByText("2026-09-04-active-change");
    const row = rowOf("2026-09-04-active-change");
    fireEvent.click(within(row).getByRole("button", { name: "查看对比" }));

    // 弹窗内下发取平台（stub 模拟 onDispatched(change,"take_platform")）
    const stub = await screen.findByTestId("conflict-compare-modal-stub");
    fireEvent.click(within(stub).getByTestId("stub-take-platform"));
    await waitFor(() =>
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument(),
    );

    // 心跳回报 failed → 红字摘要 + 按钮恢复（可重试）
    await pushMachine(
      makeMachine(makeStatus(), {
        sillyspec_command_result: makeResult({
          strategy: "take_platform",
          state: "failed",
          exit_code: 1,
          error: "change not found in pending conflicts",
        }),
      }),
    );
    expect(await screen.findByTestId("platform-sync-fail-text")).toHaveTextContent(
      "执行失败（exit 1）：change not found in pending conflicts",
    );
    expect(within(row).getByRole("button", { name: "查看对比" })).toBeEnabled();
  });

  it("150 秒无回报恢复——fake timers 推进后按钮恢复可点并提示旧版 daemon", async () => {
    vi.useFakeTimers();
    try {
      renderSection();
      // 数据链两级查询（binding → machines）在 fake timers 下冲刷微任务 settle
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
      }
      const row = rowOf("2026-09-04-active-change");
      const compareBtn = within(row).getByRole("button", { name: "查看对比" });

      fireEvent.click(compareBtn);
      // stub 同步挂载（fireEvent 已包 act），无需 findBy*（fake timers 下不适用）
      const stub = screen.getByTestId("conflict-compare-modal-stub");
      fireEvent.click(within(stub).getByTestId("stub-keep-local"));
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
      }
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument();
      expect(compareBtn).toBeDisabled();

      // 150s 无回报（旧 daemon 静默忽略，R-03）→ timeout：按钮恢复 + 提示
      act(() => {
        vi.advanceTimersByTime(ECHO_TIMEOUT_MS + 1_000);
      });
      expect(compareBtn).toBeEnabled();
      expect(screen.getByText(/150 秒无机器回报/)).toBeInTheDocument();
      expect(screen.getByText(/旧版 daemon 可能已忽略/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
