/**
 * PlatformSyncSection 组件测试（2026-09-04-conflict-resolve-entry task-09 /
 * FR-01~FR-05 / D-003@v1）。
 *
 * 覆盖任务卡 acceptance：
 *   1. 渲染/隐藏两分支——无绑定（daemon_id=null）或 sillyspec_status=null
 *      整卡不渲染；正常态冲突行（type 徽章 / mono 变更名 / 活跃警示在场但不
 *      硬禁）+ ghost 计数 + 数据源机器摘要；
 *   2. 权限 gating——机器所有者 / 平台管理员见操作按钮；其他成员只读
 *      （无按钮 + 只读说明，清单与计数保留）；
 *   3. 回显——确认弹窗（STRATEGY_TEXT 覆盖方向 + 活跃警示段 + 旧 daemon
 *      提示）→ 下发参数 → command_result 的 action+change 匹配：成功 toast +
 *      「已消解」+ 行随快照消失 / 失败红字摘要 + 按钮恢复；
 *   4. 150s 无回报恢复（fake timers）——按钮恢复可点 + 旧版 daemon 提示；
 *   5. ghost 区——弹窗写明波及范围（幽灵记录 + 超 7 天空壳目录）→ 下发 →
 *      成功回显；ghost=0 清理按钮禁用。
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
 * 2 条冲突（progress=活跃同名 / spec-tree=quick-x 独立）。
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
      { change: "2026-09-04-active-change", created_at: isoAgo(70 * MIN), type: "progress" },
      { change: "quick-x", created_at: isoAgo(70 * MIN), type: "spec-tree" },
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

function renderSection(props: { compact?: boolean } = {}) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  mocks.fetchMyBinding.mockResolvedValue({
    workspace_id: "ws-1",
    user_id: OWNER_ID,
    daemon_id: "machine-1",
    runtime_id: null,
  });
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

/** 冲突行（按变更名定位 li）。 */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

describe("PlatformSyncSection（task-09 / 平台同步处理区）", () => {
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

  it("渲染——type 徽章 / mono 变更名 / 活跃警示在场（不硬禁）/ ghost 计数 / 数据源机器", async () => {
    renderSection();

    expect(await screen.findByText("平台同步")).toBeInTheDocument();
    // 冲突行：type 徽章（spec=紫 / 进度=琥珀）+ 变更名
    expect(screen.getByText("spec")).toBeInTheDocument();
    expect(screen.getByText("进度")).toBeInTheDocument();
    expect(screen.getByText("2026-09-04-active-change")).toBeInTheDocument();
    expect(screen.getByText("quick-x")).toBeInTheDocument();
    // 活跃警示：冲突名出现在 changes[] 活跃行 → ⚠ 徽标在场，但行按钮不硬禁（D-003@v1）
    expect(screen.getByTestId("platform-sync-active-warn")).toHaveTextContent(
      "活跃变更",
    );
    expect(
      within(rowOf("2026-09-04-active-change")).getByRole("button", { name: "保本地" }),
    ).toBeEnabled();
    // ghost 区：计数行 + 清理按钮（ghost=1 可用）+ 卡头数据源机器
    expect(screen.getByText(/目录已不存在 · 建议清理/)).toBeInTheDocument();
    expect(screen.getByTestId("platform-sync-ghost-cleanup")).toBeEnabled();
    expect(screen.getByText(/数据源机器：DEV-QINYI/)).toBeInTheDocument();
  });

  it("隐藏——工作区未绑定守护进程（daemon_id=null）→ 整卡不渲染且不发机器查询", async () => {
    mocks.fetchMyBinding.mockResolvedValue({
      workspace_id: "ws-1",
      user_id: OWNER_ID,
      daemon_id: null,
      runtime_id: null,
    });
    renderSection();
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

  // ── 2. 权限 gating（D-003@v1：所有者 + 平台管理员可操作，其余只读）─────

  it("权限——非所有者非平台管理员只读：无裁决/清理按钮，清单与计数保留 + 只读说明", async () => {
    useSession.setState({ user: OTHER_USER } as never);
    renderSection();

    expect(await screen.findByText("平台同步")).toBeInTheDocument();
    expect(screen.getByText("2026-09-04-active-change")).toBeInTheDocument();
    expect(screen.getByText("quick-x")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "保本地" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "取平台" })).toHaveLength(0);
    expect(screen.queryByTestId("platform-sync-ghost-cleanup")).toBeNull();
    expect(screen.getByText(/只读视角/)).toBeInTheDocument();
  });

  it("权限——平台管理员（非机器所有者）可见操作按钮", async () => {
    useSession.setState({ user: ADMIN_USER } as never);
    renderSection();

    // fixture 两条冲突行 → 多命中用 findAllBy（至少一行可见裁决按钮）
    expect(
      (await screen.findAllByRole("button", { name: "保本地" })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("platform-sync-ghost-cleanup")).toBeInTheDocument();
  });

  // ── 3. ghost 区独立断言 ────────────────────────────────────────────────

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

  // ── 4. 裁决回显（成功 / 失败 / 150s 恢复）───────────────────────────────

  it("回显成功——保本地弹窗（覆盖方向 + 活跃警示段 + 旧 daemon 提示）→ 下发参数 → toast + 已消解 + 行随快照消失", async () => {
    renderSection();
    await screen.findByText("2026-09-04-active-change");
    const row = rowOf("2026-09-04-active-change");
    fireEvent.click(within(row).getByRole("button", { name: "保本地" }));

    // 弹窗文案（原型 STRATEGY_TEXT：保本地 = 本机覆盖平台 + 活跃警示加重不硬禁）
    const confirmRoot = await openConfirmRoot();
    expect(
      confirmRoot.querySelector(".ant-modal-confirm-title"),
    ).toHaveTextContent("裁决冲突：保本地（keep-local）");
    expect(
      within(confirmRoot).getByText(/用本机版本覆盖平台版本/),
    ).toBeInTheDocument();
    expect(
      within(confirmRoot).getByText("2026-09-04-active-change"),
    ).toBeInTheDocument();
    expect(
      within(confirmRoot).getByText(/另一会话可能正在推进/),
    ).toBeInTheDocument();
    expect(
      within(confirmRoot).getByText(/旧版本会静默忽略/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /确\s*认\s*·\s*保\s*本\s*地/ }),
    );
    await waitFor(() =>
      expect(mocks.triggerResolve).toHaveBeenCalledWith("machine-1", {
        change: "2026-09-04-active-change",
        strategy: "keep_local",
      }),
    );

    // 回显 waiting：行按钮禁用 + 状态文案
    await waitFor(() =>
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument(),
    );
    expect(within(row).getByRole("button", { name: "保本地" })).toBeDisabled();

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
    expect(within(row).queryByRole("button", { name: "保本地" })).toBeNull();

    // 快照刷新（≤60-75s 采集）→ 冲突行随快照消失
    await pushMachine(
      makeMachine(
        makeStatus({
          pending_conflicts: [
            { change: "quick-x", created_at: isoAgo(70 * MIN), type: "spec-tree" },
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
    fireEvent.click(within(row).getByRole("button", { name: "取平台" }));

    // 弹窗文案（取平台 = 平台覆盖本机，危险方向）
    const confirmRoot = await openConfirmRoot();
    expect(
      confirmRoot.querySelector(".ant-modal-confirm-title"),
    ).toHaveTextContent("裁决冲突：取平台（take-platform）");
    expect(
      within(confirmRoot).getByText(/用平台版本覆盖本机版本/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmRoot).getByRole("button", { name: /确\s*认\s*·\s*取\s*平\s*台/ }),
    );
    await waitFor(() =>
      expect(mocks.triggerResolve).toHaveBeenCalledWith("machine-1", {
        change: "2026-09-04-active-change",
        strategy: "take_platform",
      }),
    );
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
    expect(within(row).getByRole("button", { name: "保本地" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "取平台" })).toBeEnabled();
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
      const keepBtn = within(row).getByRole("button", { name: "保本地" });

      fireEvent.click(keepBtn);
      let confirmRoot: HTMLElement | null = null;
      for (let i = 0; i < 10 && confirmRoot === null; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20);
        });
        confirmRoot = document.querySelector(".ant-modal-confirm");
      }
      expect(confirmRoot).not.toBeNull();
      fireEvent.click(
        within(confirmRoot as HTMLElement).getByRole("button", { name: /确\s*认/ }),
      );
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
      }
      expect(screen.getByText("已下发 · 等待机器回报")).toBeInTheDocument();
      expect(keepBtn).toBeDisabled();

      // 150s 无回报（旧 daemon 静默忽略，R-03）→ timeout：按钮恢复 + 提示
      act(() => {
        vi.advanceTimersByTime(ECHO_TIMEOUT_MS + 1_000);
      });
      expect(keepBtn).toBeEnabled();
      expect(screen.getByText(/150 秒无机器回报/)).toBeInTheDocument();
      expect(screen.getByText(/旧版 daemon 可能已忽略/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
