/**
 * task-07 / Wave 6：变更中心列表页 task-06 重做行为的回归测试。
 *
 * 覆盖 task-06 的六个行为面：
 *   1. 主 tab 切换（进行中 / 已归档）+ tab 计数 pill
 *   2. 聚焦开关（D-007 核心：pendingReviewOnly 随 tab/focusMine 联动）
 *   3. 待办徽标（renderTodoBadge：blocked + 4 种 pending_review + null 占位）
 *   4. 空状态 CTA（聚焦空 / 不聚焦空 / 已归档空 三态）
 *   5. 排序切换（更新时间列头点击 desc↔asc，sort 参数随之）
 *   6. 负责人列（owner_id 前 8 位 / 空 — 占位）
 *
 * mock 范式参考 workspaces/[id]/page.test.tsx：vi.mock @/lib/changes +
 * @/lib/workspaces + next/navigation + next/link，RTL render + waitFor。
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChangesPage from "@/app/(dashboard)/workspaces/[id]/changes/page";
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
 * - pageSize=1 调用 = tabTotals effect（按 location 返总数 pill 用）
 * - 其它 = 主 load（返 items + total）
 *
 * 两个 effect 用 pageSize 区分：主 load 默认 pageSize=20，tabTotals effect 显式 pageSize=1。
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
      // tabTotals effect 只关心 total
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

async function renderPage() {
  mocks.getWorkspace.mockResolvedValue(makeWorkspace());
  render(<ChangesPage params={{ id: "ws-1" }} />);
  // 等 workspace 名出现在副标题（确保 getWorkspace 已 resolve，副标题不再
  // 渲染 `workspace?.name ?? "—"` 的 "—" 占位，避免与徽标/owner 列的 "—" 撞）。
  await waitFor(() =>
    expect(screen.getAllByText(/测试工作区/).length).toBeGreaterThan(0),
  );
}

/** "新建变更" 按钮在 PageHeader actions 和空态 CTA 两处同文本，用 getAll 断言存在 */
function expectCreateChangeButton(): void {
  expect(
    screen.getAllByRole("button", { name: /\+\s*新\s*建\s*变\s*更/ }).length,
  ).toBeGreaterThan(0);
}

/** 拿最近一次「主 load」调用（pageSize !== 1）的入参，用于断言 listChanges 入参 */
function lastMainLoadParams(): any {
  const calls = mocks.listChanges.mock.calls.filter(
    ([, p]: any[]) => p?.pageSize !== 1,
  );
  return calls.at(-1)?.[1];
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("变更中心列表页（task-06 重做行为）", () => {
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
    await renderPage();
    expect(lastMainLoadParams()?.location).toBe("active");
  });

  it("点已归档 tab → 切换 location=archive 且聚焦开关隐藏", async () => {
    await renderPage();
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

  it("tab 计数 pill 显示（tabTotals 单独 effect 拉，不被聚焦污染）", async () => {
    setupListChanges({ activeTotal: 5, archiveTotal: 3 });
    await renderPage();

    const activeTab = screen.getByRole("button", { name: /^进行中/ });
    const archiveTab = screen.getByRole("button", { name: /已归档/ });
    await waitFor(() => expect(activeTab).toHaveTextContent("5"));
    await waitFor(() => expect(archiveTab).toHaveTextContent("3"));
  });

  // ── 2. 聚焦开关（D-007 核心）──────────────────────────────────────────

  it("默认 focusMine=true → listChanges 主 load 收到 pendingReviewOnly:true", async () => {
    await renderPage();
    expect(lastMainLoadParams()?.pendingReviewOnly).toBe(true);
  });

  it("取消聚焦 → listChanges 主 load pendingReviewOnly 不再为 true", async () => {
    await renderPage();
    expect(lastMainLoadParams()?.pendingReviewOnly).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    await waitFor(() =>
      expect(lastMainLoadParams()?.pendingReviewOnly).not.toBe(true),
    );
  });

  it("仅进行中 tab 显示聚焦开关（archive tab 隐藏）", async () => {
    await renderPage();
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
    await renderPage();
    expect(screen.getByText("阻塞中")).toBeInTheDocument();
  });

  it("pending_review=proposal_review → 「待提案审核」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "proposal_review", owner_id: "owner1234" }),
      ],
    });
    await renderPage();
    expect(screen.getByText("待提案审核")).toBeInTheDocument();
  });

  it("pending_review=plan_review → 「待计划审核」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "plan_review", owner_id: "owner1234" }),
      ],
    });
    await renderPage();
    expect(screen.getByText("待计划审核")).toBeInTheDocument();
  });

  it("pending_review=human_test → 「待人工测试」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "human_test", owner_id: "owner1234" }),
      ],
    });
    await renderPage();
    expect(screen.getByText("待人工测试")).toBeInTheDocument();
  });

  it("pending_review=archive_confirm → 「待归档确认」", async () => {
    setupListChanges({
      items: [
        makeChange({ pending_review: "archive_confirm", owner_id: "owner1234" }),
      ],
    });
    await renderPage();
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
    await renderPage();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── 4. 空状态 CTA ──────────────────────────────────────────────────────

  it("聚焦勾 + 待我处理空 → 「暂无待你处理的变更」+ 新建/查看全部 CTA", async () => {
    // 默认 setupListChanges 返空 items，focusMine 默认 true
    await renderPage();
    expect(screen.getByText(/暂无待你处理的变更/)).toBeInTheDocument();
    // antd Button 中文 autoLetterSpacing → 字间插空格，name 用 \s* 兼容。
    // "新建变更" 按钮在 PageHeader actions + 空态 CTA 两处渲染，用 getAll 断言。
    expectCreateChangeButton();
    // "查看全部进行中" 仅空态 CTA 渲染（唯一）
    expect(
      screen.getByRole("button", { name: /查\s*看\s*全\s*部\s*进\s*行\s*中/ }),
    ).toBeInTheDocument();
  });

  it("进行中空（取消聚焦）→ 「当前没有进行中的变更」+ 新建 CTA（无查看全部）", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    await waitFor(() =>
      expect(screen.getByText(/当前没有进行中的变更/)).toBeInTheDocument(),
    );
    expectCreateChangeButton();
    // 不聚焦空态不显示「查看全部进行中」CTA
    expect(
      screen.queryAllByRole("button", { name: /查\s*看\s*全\s*部/ }).length,
    ).toBe(0);
  });

  it("已归档空 → 「还没有归档的变更」", async () => {
    await renderPage();
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
    await renderPage();
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

  // ── 6. 负责人列 ────────────────────────────────────────────────────────

  it("owner_id 有值 → 显示前 8 位短标识", async () => {
    setupListChanges({
      items: [
        makeChange({
          owner_id: "abcdef1234567890abcd",
          pending_review: "proposal_review",
        }),
      ],
    });
    await renderPage();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("owner_id 为空 → 占位 —（pending_review 设值避免徽标双源 —）", async () => {
    setupListChanges({
      items: [makeChange({ owner_id: null, pending_review: "proposal_review" })],
    });
    await renderPage();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
