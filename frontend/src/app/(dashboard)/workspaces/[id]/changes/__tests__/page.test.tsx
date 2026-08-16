/**
 * 变更中心列表页测试（task-06 / 2026-08-15-change-step-visibility useQuery 改造适配）。
 *
 * 覆盖：
 *   1. 原 task-06（列表页重做）六行为面回归：
 *      主 tab 切换 + tab 计数 pill / 聚焦开关（D-007）/ 待办徽标 / 空状态引导 /
 *      排序切换 / 负责人列
 *   2. useQuery 改造新增断言：
 *      - ChangeStepBadge 接线：step_progress 有值行渲染摘要副行（step x/y + 当前步名），
 *        缺失行降级为纯 stage 徽章（无摘要副行）
 *      - 智能轮询纯函数两分支：非终态存在 → 30000；全终态 / 无数据 → false
 *      - 重新扫描成功后走 queryClient.invalidateQueries（主列表 key 被失效）
 *      - 主 load 失败 → 错误横幅「加载变更列表失败」语义保持（R-07）
 *
 * mock 范式：vi.mock @/lib/changes + @/lib/workspaces + next/navigation +
 * next/link；page 用 useQuery → render 包 QueryClientProvider（retry/gcTime/
 * refetchInterval 关闭，范式照 agent-profile-card-grid / runtimes page.test）。
 * 两个 useQuery 用 pageSize 区分：主 load 默认 pageSize=20，tabTotals 显式 pageSize=1。
 * antd 中文 Button autoLetterSpacing（字间插空格）→ name 匹配用 \s* 正则兼容。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangesPage, {
  CHANGES_POLL_INTERVAL_MS,
  changesRefetchInterval,
  hasActiveChanges,
  isTerminalChange,
} from "@/app/(dashboard)/workspaces/[id]/changes/page";
import type { ChangeSummary } from "@/lib/changes";
import type { Workspace } from "@/lib/workspaces";

// ── mocks（hoisted，让 mock 工厂能引用同一组 vi.fn）──────────────────────
const mocks = vi.hoisted(() => ({
  listChanges: vi.fn(),
  reparseChanges: vi.fn(),
  getWorkspace: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("@/lib/changes", () => ({
  listChanges: mocks.listChanges,
  reparseChanges: mocks.reparseChanges,
}));

vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, getWorkspace: mocks.getWorkspace };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

function makeChange(overrides: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    id: "ch-1",
    change_key: "2026-08-13-test-change",
    title: "测试变更",
    status: "in_progress",
    location: "active",
    change_type: null,
    // 默认非空：避免影响组件列「—」占位与徽标/owner 列「—」撞（getByText multiple）
    affected_components: ["frontend"],
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    updated_at: "2026-08-13T10:00:00Z",
    ...overrides,
  };
}

function makeWorkspace(): Workspace {
  return {
    id: "ws-1",
    name: "测试工作区",
    slug: "test-ws",
    root_path: "C:/proj",
    status: "active",
    default_agent: null,
    default_model: null,
    owner: { user_id: "u1", email: "o@t.com", display_name: "O" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
  } as unknown as Workspace;
}

/**
 * 配置 listChanges mock。
 * - pageSize=1 调用 = tabTotals query（按 location 返总数 pill 用）
 * - 其它 = 主 load（返 items + total）
 *
 * 两个查询用 pageSize 区分：主 load 默认 pageSize=20，tabTotals 显式 pageSize=1。
 */
function setupListChanges(
  opts: {
    items?: ChangeSummary[];
    total?: number;
    activeTotal?: number;
    archiveTotal?: number;
  } = {},
) {
  const { items = [], total, activeTotal = 0, archiveTotal = 0 } = opts;
  mocks.listChanges.mockImplementation((_wid: string, params?: any) => {
    const loc = params?.location ?? "active";
    if (params?.pageSize === 1) {
      // tabTotals query 只关心 total
      return Promise.resolve({
        items: [],
        total: loc === "archive" ? archiveTotal : activeTotal,
      });
    }
    return Promise.resolve({
      items,
      total: total ?? items.length,
    });
  });
}

/** 包 QueryClientProvider 渲染（page 用 useQuery，task-06 改造）。 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={client}>
      <ChangesPage params={{ id: "ws-1" }} />
    </QueryClientProvider>,
  );
  return { ...utils, client, invalidateSpy };
}

/** render + 等 workspace 名出现在副标题（确保主 load 已 resolve）。 */
async function renderAndWait() {
  mocks.getWorkspace.mockResolvedValue(makeWorkspace());
  const utils = renderPage();
  // 等 workspace 名出现在副标题（避免与徽标/owner 列的 "—" 撞）。
  await waitFor(() =>
    expect(screen.getAllByText(/测试工作区/).length).toBeGreaterThan(0),
  );
  return utils;
}

/** 拿最近一次「主 load」调用（pageSize !== 1）的入参，用于断言 listChanges 入参 */
function lastMainLoadParams(): any {
  const calls = mocks.listChanges.mock.calls.filter(
    ([, p]: any[]) => p?.pageSize !== 1,
  );
  return calls.at(-1)?.[1];
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("变更中心列表页（task-06 重做行为 + useQuery 改造）", () => {
  beforeEach(() => {
    // 每个用例默认空列表 + 0 计数；用例内按需 setupListChanges 覆盖
    setupListChanges();
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  // ── 1. 主 tab 切换 + 计数 ──────────────────────────────────────────────

  it("默认渲染进行中 tab，listChanges 主 load location=active", async () => {
    await renderAndWait();
    expect(lastMainLoadParams()?.location).toBe("active");
  });

  it("点已归档 tab → 切换 location=archive 且聚焦开关隐藏", async () => {
    await renderAndWait();
    expect(screen.getByText(/只看待我处理/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已归档/ }));
    });
    await waitFor(() =>
      expect(lastMainLoadParams()?.location).toBe("archive"),
    );
    // 聚焦开关仅进行中 tab 显示（archive 隐藏）
    expect(screen.queryByText(/只看待我处理/)).not.toBeInTheDocument();
  });

  it("tab 计数 pill 显示（tabTotals 独立 query 拉，不被聚焦污染）", async () => {
    setupListChanges({ activeTotal: 5, archiveTotal: 3 });
    await renderAndWait();

    const activeTab = screen.getByRole("button", { name: /^进行中/ });
    const archiveTab = screen.getByRole("button", { name: /已归档/ });
    await waitFor(() => expect(activeTab).toHaveTextContent("5"));
    await waitFor(() => expect(archiveTab).toHaveTextContent("3"));
  });

  // ── 2. 聚焦开关（D-007 核心）──────────────────────────────────────────

  it("默认 focusMine=true → listChanges 主 load 收到 pendingReviewOnly:true", async () => {
    await renderAndWait();
    expect(lastMainLoadParams()?.pendingReviewOnly).toBe(true);
  });

  it("取消聚焦 → listChanges 主 load pendingReviewOnly 不再为 true", async () => {
    await renderAndWait();
    expect(lastMainLoadParams()?.pendingReviewOnly).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    await waitFor(() =>
      expect(lastMainLoadParams()?.pendingReviewOnly).not.toBe(true),
    );
  });

  it("仅进行中 tab 显示聚焦开关（archive tab 隐藏）", async () => {
    await renderAndWait();
    expect(screen.getByText(/只看待我处理/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已归档/ }));
    });
    await waitFor(() =>
      expect(screen.queryByText(/只看待我处理/)).not.toBeInTheDocument(),
    );
  });

  // ── 3. 待办徽标（renderTodoBadge）────────────────────────────────────

  it("status=blocked → 徽标「阻塞中」", async () => {
    setupListChanges({
      items: [makeChange({ status: "blocked", owner_id: "owner1234" })],
    });
    await renderAndWait();
    expect(screen.getByText("阻塞中")).toBeInTheDocument();
  });

  it("pending_review=proposal_review → 「待提案审核」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "proposal_review", owner_id: "owner1234" }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("待提案审核")).toBeInTheDocument();
  });

  it("pending_review=plan_review → 「待计划审核」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "plan_review", owner_id: "owner1234" }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("待计划审核")).toBeInTheDocument();
  });

  it("pending_review=human_test → 「待人工测试」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "human_test", owner_id: "owner1234" }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("待人工测试")).toBeInTheDocument();
  });

  it("pending_review=archive_confirm → 「待归档确认」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "archive_confirm", owner_id: "owner1234" }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("待归档确认")).toBeInTheDocument();
  });

  it("pending_review=null 且非 blocked → 占位 —（owner_id 设值避免双源 —）", async () => {
    setupListChanges({
      items: [
        makeChange({
          pending_review: null,
          status: "in_progress",
          owner_id: "owner1234",
        }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── 4. 空状态引导（task-09 / FR-04a：去表单，引导会话页）──────────────

  it("聚焦勾 + 待我处理空 → 「暂无待你处理的变更」+ 查看全部 + 去会话引导（无新建入口）", async () => {
    // 默认 setupListChanges 返空 items，focusMine 默认 true
    await renderAndWait();
    await waitFor(() =>
      expect(screen.getByText(/暂无待你处理的变更/)).toBeInTheDocument(),
    );
    // task-09：PageHeader actions 与空态 CTA 的「新建变更」按钮均已删除
    expect(
      screen.queryAllByRole("button", { name: /\+\s*新\s*建\s*变\s*更/ }).length,
    ).toBe(0);
    // 「查看全部进行中」保留（聚焦开关兜底，非新建入口）
    expect(
      screen.getByRole("button", { name: /查\s*看\s*全\s*部\s*进\s*行\s*中/ }),
    ).toBeInTheDocument();
    // 去会话引导链接 → /workspaces/ws-1/sessions（FR-04a）
    expect(screen.getByRole("link", { name: "去会话页" })).toHaveAttribute(
      "href",
      "/workspaces/ws-1/sessions",
    );
  });

  it("进行中空（取消聚焦）→ 「当前没有进行中的变更」+ 去会话引导（无新建/查看全部）", async () => {
    await renderAndWait();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    await waitFor(() =>
      expect(screen.getByText(/当前没有进行中的变更/)).toBeInTheDocument(),
    );
    // 无「新建变更」入口
    expect(
      screen.queryAllByRole("button", { name: /\+\s*新\s*建\s*变\s*更/ }).length,
    ).toBe(0);
    // 不聚焦空态不显示「查看全部进行中」CTA
    expect(
      screen.queryAllByRole("button", { name: /查\s*看\s*全\s*部/ }).length,
    ).toBe(0);
    // 去会话引导链接 → /workspaces/ws-1/sessions
    expect(screen.getByRole("link", { name: "去会话页" })).toHaveAttribute(
      "href",
      "/workspaces/ws-1/sessions",
    );
  });

  it("已归档空 → 「还没有归档的变更」", async () => {
    await renderAndWait();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已归档/ }));
    });
    await waitFor(() =>
      expect(screen.getByText(/还没有归档的变更/)).toBeInTheDocument(),
    );
  });

  // ── 5. 排序切换 ────────────────────────────────────────────────────────

  it("点更新时间列头 → sortDir 切换，listChanges sort 参数 desc→asc", async () => {
    setupListChanges({
      items: [makeChange({ owner_id: "owner1234" })],
    });
    await renderAndWait();
    // 默认 updated_at_desc
    expect(lastMainLoadParams()?.sort).toBe("updated_at_desc");

    // 列头按钮（含「更新时间」文案 + ↑/↓ 指示）
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /更新时间/ }));
    });
    await waitFor(() =>
      expect(lastMainLoadParams()?.sort).toBe("updated_at_asc"),
    );
  });

  // ── 6. 负责人列（task-05 / FR-04 三态：owner_name 优先 / UUID 前 8 位 / —）──

  it("owner_name 有值 → 优先显示用户名（2026-08-16-change-owner-from-token task-05）", async () => {
    setupListChanges({
      items: [
        makeChange({
          owner_id: "abcdef1234567890abcd",
          owner_name: "qinyi",
          pending_review: "proposal_review",
        }),
      ],
    });
    await renderAndWait();
    // 用户名优先（owner_id 存在也不走 UUID 短标识）
    expect(screen.getByText("qinyi")).toBeInTheDocument();
    expect(screen.queryByText("abcdef12")).not.toBeInTheDocument();
  });

  it("owner_name 空 + owner_id 有值 → 降级 UUID 前 8 位短标识（mono）", async () => {
    setupListChanges({
      items: [
        makeChange({
          owner_id: "abcdef1234567890abcd",
          owner_name: null,
          pending_review: "proposal_review",
        }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("owner_name / owner_id 双空 → 占位 —（pending_review 设值避免徽标双源 —）", async () => {
    setupListChanges({
      items: [
        makeChange({ owner_id: null, owner_name: null, pending_review: "proposal_review" }),
      ],
    });
    await renderAndWait();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── 7. ChangeStepBadge 接线（task-06 / FR-03 / D-003@v1 降级）──────────

  it("step_progress 有值行 → 渲染摘要副行（step x/y + 当前步名）", async () => {
    setupListChanges({
      items: [
        makeChange({
          id: "ch-step",
          owner_id: "owner1234",
          pending_review: "proposal_review",
          step_progress: {
            step_total: 8,
            steps_completed: 2,
            current_step_name: "对话式探索与需求澄清",
            current_step_status: "active",
            current_step_desc: null,
          },
        }),
      ],
    });
    await renderAndWait();
    // 摘要副行：step 2/8 计数 + 当前步名（ChangeStepBadge 的 step-sub-row）
    expect(screen.getByTestId("step-sub-row")).toBeInTheDocument();
    expect(screen.getByText("step 2/8")).toBeInTheDocument();
    expect(screen.getByText(/对话式探索与需求澄清/)).toBeInTheDocument();
    // stage 主行徽章照常（execute → 执行）
    expect(screen.getByText("执行")).toBeInTheDocument();
  });

  it("step_progress 缺失行 → 降级纯 stage 徽章（无摘要副行，D-003@v1）", async () => {
    setupListChanges({
      items: [
        makeChange({
          id: "ch-nostep",
          owner_id: "owner1234",
          pending_review: "proposal_review",
          step_progress: null,
        }),
      ],
    });
    await renderAndWait();
    // stage 主行照常渲染（execute → 执行）
    expect(screen.getByText("执行")).toBeInTheDocument();
    // 无摘要副行（降级：视觉与现状一致）
    expect(screen.queryByTestId("step-sub-row")).not.toBeInTheDocument();
    expect(screen.queryByText(/step \d+\/\d+/)).not.toBeInTheDocument();
  });

  // ── 8. 智能轮询纯函数（D-001@v1：非终态 30000 / 全终态 false）─────────

  it("isTerminalChange：status=archived 或 location=archive 为终态", () => {
    expect(isTerminalChange({ status: "archived", location: "active" })).toBe(
      true,
    );
    expect(isTerminalChange({ status: "in_progress", location: "archive" })).toBe(
      true,
    );
    expect(
      isTerminalChange({ status: "in_progress", location: "active" }),
    ).toBe(false);
    expect(isTerminalChange({ status: "blocked", location: "active" })).toBe(
      false,
    );
  });

  it("changesRefetchInterval：存在非终态 → 30000；全终态 / 无数据 → false", () => {
    const activeItem = makeChange({ status: "in_progress", location: "active" });
    const archivedItem = makeChange({
      status: "archived",
      location: "archive",
    });
    // 非终态存在 → 轮询间隔
    expect(
      changesRefetchInterval({
        items: [archivedItem, activeItem],
        total: 2,
        workspace: makeWorkspace(),
      }),
    ).toBe(CHANGES_POLL_INTERVAL_MS);
    expect(CHANGES_POLL_INTERVAL_MS).toBe(30000);
    // 全终态 → 停轮
    expect(
      changesRefetchInterval({
        items: [archivedItem],
        total: 1,
        workspace: makeWorkspace(),
      }),
    ).toBe(false);
    // 无数据（首载挂起）→ 不轮
    expect(changesRefetchInterval(undefined)).toBe(false);
    // 空列表 → 停轮（无行即无非终态）
    expect(
      changesRefetchInterval({ items: [], total: 0, workspace: makeWorkspace() }),
    ).toBe(false);
    expect(hasActiveChanges(undefined)).toBe(false);
  });

  // ── 9. 重新扫描 / 错误处理（useQuery 化后语义保持，R-07）───────────────

  it("重新扫描成功 → queryClient.invalidateQueries 失效主列表 key", async () => {
    mocks.reparseChanges.mockResolvedValue({
      stats: { parsed: 3, created: 1, updated: 1, deleted: 0 },
      warnings: [],
    });
    const { invalidateSpy } = await renderAndWait();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /重\s*新\s*扫\s*描/ }));
    });
    await waitFor(() =>
      expect(screen.getByText(/已重新扫描：解析 3/)).toBeInTheDocument(),
    );
    // task-06：刷新改 queryClient 失效（key 前缀 ["changes", workspaceId]）
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["changes", "ws-1"],
    });
  });

  it("主 load 失败（非 ApiError）→ 错误横幅「加载变更列表失败」", async () => {
    mocks.getWorkspace.mockRejectedValue(new Error("network down"));
    mocks.listChanges.mockImplementation((_wid: string, params?: any) => {
      if (params?.pageSize === 1) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error("network down"));
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("加载变更列表失败")).toBeInTheDocument(),
    );
  });

  it("主 load 失败（ApiError）→ 错误横幅取 err.message", async () => {
    const { ApiError } = await import("@/lib/api");
    const apiErr = new ApiError(500, {
      code: "INTERNAL_ERROR",
      message: "后端解析失败啦",
      request_id: null,
      details: null,
    });
    mocks.getWorkspace.mockRejectedValue(apiErr);
    mocks.listChanges.mockImplementation((_wid: string, params?: any) => {
      if (params?.pageSize === 1) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(apiErr);
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("后端解析失败啦")).toBeInTheDocument(),
    );
  });
});
