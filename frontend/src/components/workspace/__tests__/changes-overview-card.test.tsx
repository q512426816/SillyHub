/**
 * ChangesOverviewCard 组件测试（2026-09-02-changes-overview-card task-06）。
 *
 * 惯例：仿 LinkedProjectsSection.test.tsx（vi.hoisted mock 数据源 + afterEach
 * cleanup/mockReset）；react-query 侧按 change-sessions-card.test.tsx 惯例包
 * QueryClientProvider（retry:false / gcTime:0）。
 *
 * fixture 用真实 envelope 形态（含 daemon 摘要不透传的 readable/command/stages
 * 字段——卡片不消费但解析需容忍不报错，task-06 acceptance）。
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangesOverviewCard } from "@/components/workspace/changes-overview-card";
import type { components } from "@/lib/api-types";
import type { DaemonMachineRead } from "@/lib/daemon";
import type { MemberBindingView } from "@/lib/workspace-binding";

type StatusFixture = components["schemas"]["MachineSillySpecStatusRead"];
type ChangeFixture = components["schemas"]["DaemonHeartbeatSillySpecChange"];

const mocks = vi.hoisted(() => ({
  listDaemonMachines: vi.fn(),
  fetchMyBinding: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  listDaemonMachines: mocks.listDaemonMachines,
}));

vi.mock("@/lib/workspace-binding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-binding")>()),
  fetchMyBinding: mocks.fetchMyBinding,
}));

// fixture 基准时钟：文件加载时取一次；相对时间断言（"15 分钟前"）与用例执行同量级
// （秒级差），分档结果稳定。
const NOW = Date.now();
const MIN = 60_000;
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

/** envelope 真实形态 change 行（含摘要不透传的 stages 字段，解析容忍）。 */
function makeChange(
  overrides: Partial<ChangeFixture> & { name: string },
): ChangeFixture {
  return {
    ghost: false,
    current_stage: "execute",
    stage_label: "⚙️ 执行实现",
    last_active: isoAgo(10 * MIN),
    steps: { total: 8, completed: 4 },
    // envelope 原生字段（daemon 摘要截掉不透传，前端不消费但需容忍）：
    stages: {
      execute: { status: "in_progress", steps_total: 8, steps_completed: 4 },
    },
    ...overrides,
  } as unknown as ChangeFixture;
}

function makeStatus(overrides: Partial<StatusFixture> = {}): StatusFixture {
  return {
    ok: true,
    errors_count: 0,
    warnings_count: 28,
    generated_at: isoAgo(3 * MIN),
    active_changes: 3,
    healthy_count: 2,
    ghost_count: 1,
    conflict_count: 3,
    conflict_types: { "spec-tree": 2, progress: 1 },
    changes: [],
    pending_conflicts: [],
    // envelope 原生字段（daemon 摘要不透传，前端解析容忍）：
    readable: { summary: "人类可读总览" },
    command: ["node", "sillyspec.js", "progress", "show", "--json"],
    ...overrides,
  } as unknown as StatusFixture;
}

function makeMachine(status: StatusFixture | null): DaemonMachineRead {
  return {
    id: "machine-1",
    hostname: "dev-host",
    sillyspec_status: status,
  } as unknown as DaemonMachineRead;
}

/** happy path：workspace 绑定 machine-1，机器视图返回给定 status。 */
function mockHappyPath(status: StatusFixture | null) {
  mocks.fetchMyBinding.mockResolvedValue({
    workspace_id: "ws-1",
    user_id: "u-1",
    daemon_id: "machine-1",
    runtime_id: null,
  } as unknown as MemberBindingView);
  mocks.listDaemonMachines.mockResolvedValue({
    items: [makeMachine(status)],
    total: 1,
    limit: 100,
    offset: 0,
  });
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangesOverviewCard workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

describe("ChangesOverviewCard（task-06 / 活跃变更总览）", () => {
  afterEach(() => {
    cleanup();
    mocks.listDaemonMachines.mockReset();
    mocks.fetchMyBinding.mockReset();
  });

  it("渲染——健康条计数/管线两态/stage 徽标/steps 进度/相对时间/倒序（fixture 含 envelope readable/command 容忍字段）", async () => {
    mockHappyPath(
      makeStatus({
        changes: [
          makeChange({
            name: "chg-older",
            current_stage: "verify",
            stage_label: "✅ 验收核对",
            last_active: isoAgo(40 * MIN),
            steps: { total: 6, completed: 6 },
          }),
          makeChange({
            name: "chg-newer",
            current_stage: "brainstorm",
            stage_label: "🧠 需求探索",
            last_active: isoAgo(15 * MIN),
            steps: { total: 8, completed: 4 },
          }),
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
          { change: "quick-x", created_at: isoAgo(70 * MIN), type: "spec-tree" },
          { change: "big-change", created_at: isoAgo(70 * MIN), type: "progress" },
        ],
        conflict_count: 2,
        conflict_types: { "spec-tree": 1, progress: 1 },
      }),
    );

    renderCard();

    // 健康条计数 + envelope mono 徽标 + generated_at 相对时间（fixture 带
    // readable/command/stages 冗余字段，解析容忍不报错）
    expect(await screen.findByText("活跃 2")).toBeInTheDocument();
    expect(screen.getByText("残留 (ghost) 1")).toBeInTheDocument();
    expect(screen.getByText("未决冲突 2")).toBeInTheDocument();
    expect(screen.getByText("ok=true · warnings=28 · errors=0")).toBeInTheDocument();
    expect(screen.getByText("更新于 3 分钟前")).toBeInTheDocument();
    expect(screen.queryByText("数据可能过期")).toBeNull();

    // 变更行：名称 / stage 徽标 / 步骤 / last_active 相对时间 / 倒序（newer 在前）
    expect(screen.getByText("chg-newer")).toBeInTheDocument();
    expect(screen.getByText("🧠 需求探索")).toBeInTheDocument();
    expect(screen.getByText("步骤 4/8")).toBeInTheDocument();
    expect(screen.getByText("最近活跃 15 分钟前")).toBeInTheDocument();
    expect(
      screen.getByText("chg-newer").compareDocumentPosition(screen.getByText("chg-older")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // 主管线两态（两行各一条管线，共享态用 getAllBy）
    expect(screen.getAllByLabelText("scan 已完成")).toHaveLength(2);
    expect(screen.getByLabelText("brainstorm 进行中")).toBeInTheDocument();
    expect(screen.getByLabelText("verify 进行中")).toBeInTheDocument();
    expect(screen.getAllByLabelText("archive 待办")).toHaveLength(2);

    // steps 进度条（4/8 = 50%）
    expect(
      screen.getByRole("progressbar", { name: "步骤进度 chg-newer" }),
    ).toHaveAttribute("aria-valuenow", "50");
  });

  it("ghost 折叠组——默认折一行（计数+清理指引 code），展开逐行，再点收起", async () => {
    mockHappyPath(
      makeStatus({
        changes: [
          makeChange({ name: "chg-live" }),
          makeChange({
            name: "quick-ghost-9",
            ghost: true,
            current_stage: "quick",
            stage_label: "⚡ 快速修复",
            last_active: isoAgo(2 * MIN),
            steps: { total: 3, completed: 2 },
          }),
        ],
      }),
    );

    renderCard();

    const toggle = await screen.findByRole("button", {
      name: /残留记录 \(ghost\) 1 个/,
    });
    // 默认折叠：ghost 行不可见；折行上带清理指引 code
    expect(screen.queryByText("quick-ghost-9")).toBeNull();
    expect(
      screen.getByText("sillyspec doctor --cleanup-ghosts --confirm"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByText("quick-ghost-9")).toBeInTheDocument();
    expect(screen.getByText("ghost")).toBeInTheDocument();
    expect(screen.getByText("⚡ quick")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("最近活跃 2 分钟前")).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText("quick-ghost-9")).toBeNull());
  });

  it("冲突区——spec·进度 type 徽标 + change 名 mono + resolve 指引", async () => {
    mockHappyPath(
      makeStatus({
        changes: [makeChange({ name: "chg-live" })],
        pending_conflicts: [
          { change: "quick-x", created_at: isoAgo(70 * MIN), type: "spec-tree" },
          { change: "big-change", created_at: isoAgo(70 * MIN), type: "progress" },
        ],
        conflict_count: 2,
        conflict_types: { "spec-tree": 1, progress: 1 },
      }),
    );

    renderCard();

    expect(await screen.findByText("未决同步冲突 (2)")).toBeInTheDocument();
    expect(screen.getByText("spec")).toBeInTheDocument();
    expect(screen.getByText("进度")).toBeInTheDocument();
    expect(screen.getByText("spec ×1 · 进度 ×1")).toBeInTheDocument();
    expect(screen.getByText("quick-x")).toBeInTheDocument();
    expect(screen.getByText("big-change")).toBeInTheDocument();
    expect(screen.getByText("sillyspec platform resolve")).toBeInTheDocument();
  });

  it("过滤 tab——全部/需关注计数正确，切换后仅留冲突关联活跃行（ghost 组与冲突区保留）", async () => {
    mockHappyPath(
      makeStatus({
        changes: [
          makeChange({ name: "chg-conflicted", last_active: isoAgo(5 * MIN) }),
          makeChange({ name: "chg-clean-1", last_active: isoAgo(20 * MIN) }),
          makeChange({ name: "chg-clean-2", last_active: isoAgo(30 * MIN) }),
          makeChange({
            name: "ghost-1",
            ghost: true,
            current_stage: "quick",
            stage_label: "⚡ 快速修复",
            last_active: isoAgo(50 * MIN),
            steps: { total: 3, completed: 1 },
          }),
          makeChange({
            name: "ghost-2",
            ghost: true,
            current_stage: "quick",
            stage_label: "⚡ 快速修复",
            last_active: isoAgo(55 * MIN),
            steps: { total: 3, completed: 0 },
          }),
        ],
        active_changes: 5,
        healthy_count: 3,
        ghost_count: 2,
        pending_conflicts: [
          { change: "chg-conflicted", created_at: isoAgo(70 * MIN), type: "progress" },
          { change: "conflict-only-change", created_at: isoAgo(70 * MIN), type: "spec-tree" },
        ],
        conflict_count: 2,
        conflict_types: { progress: 1, "spec-tree": 1 },
      }),
    );

    renderCard();

    // 全部=5（3 活跃+2 ghost）；需关注=|{ghost-1, ghost-2, chg-conflicted, conflict-only-change}|=4
    expect(await screen.findByRole("button", { name: "全部 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "需关注 4" })).toBeInTheDocument();
    expect(screen.getByText("chg-clean-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "需关注 4" }));
    // chg-conflicted 在活跃行与冲突区两处渲染（冲突关联的活跃变更本就双显），
    // 断言至少存在于活跃行（span 语义）；全量匹配用 findAllByText。
    expect((await screen.findAllByText("chg-conflicted")).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("chg-clean-1")).toBeNull();
    expect(screen.queryByText("chg-clean-2")).toBeNull();
    // ghost 折叠组与冲突区在需关注 tab 仍展示
    expect(
      screen.getByRole("button", { name: /残留记录 \(ghost\) 2 个/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("conflict-only-change")).toBeInTheDocument();
  });

  it("null 占位态——sillyspec_status 为 null 显「总览不可用」", async () => {
    mockHappyPath(null);

    renderCard();

    expect(
      await screen.findByText("总览不可用（sillyspec 未安装/版本过低）"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /全部/ })).toBeNull();
    expect(screen.queryByText(/活跃 \d/)).toBeNull();
  });

  it("generated_at 陈旧——健康条显示「数据可能过期」标记", async () => {
    mockHappyPath(
      makeStatus({
        generated_at: isoAgo(30 * MIN),
        changes: [makeChange({ name: "chg-live" })],
      }),
    );

    renderCard();

    expect(await screen.findByText("数据可能过期")).toBeInTheDocument();
  });

  it("超限降级——changes 缺失但计数在，显「列表过大，仅计数」且明细不渲染", async () => {
    mockHappyPath(
      makeStatus({
        changes: null,
        pending_conflicts: null,
        active_changes: 200,
        healthy_count: 183,
        ghost_count: 17,
        conflict_count: 0,
        conflict_types: {},
      }),
    );

    renderCard();

    expect(await screen.findByText("列表过大，仅计数")).toBeInTheDocument();
    // 健康计数仍有效；明细列表与过滤 tab 不渲染
    expect(screen.getByText("活跃 183")).toBeInTheDocument();
    expect(screen.getByText("残留 (ghost) 17")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /全部/ })).toBeNull();
    expect(screen.queryByText(/步骤 \d+\/\d+/)).toBeNull();
  });
});
