// task-12（2026-08-25-session-spec-binding / FR-04 / D-006@v1）：快速修复关联
// 会话卡测试，范式照 detail/__tests__/change-sessions-card.test.tsx——部分 mock
// 本卡数据源 listQuicklogSessions（经 session-list-panel 的 formatRelativeTime
// 再导出链保持真实实现），useSession 经真实 zustand store 的 setUser/clear 控制。
//
// 覆盖：①渲染与卡尾「打开会话工作台」链接（不带参）+ 空态文案 ②本人过滤 +
// last_active_at 倒序前 3 条预览 + ?session= 深链 href ③仅本人过滤分支
// （他人剔除，缺 author 保留）④加载态文案。
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuicklogSessionsCard } from "@/components/changes/quicklog-sessions-card";
import { useSession } from "@/stores/session";
import type { AgentSessionListItem } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  listQuicklogSessions: vi.fn(),
}));

// 部分 mock：仅替换本卡数据源 listQuicklogSessions，其余导出保持真实实现。
vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  listQuicklogSessions: mocks.listQuicklogSessions,
}));

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const QL_ID = "ql-20260817-001-abcd";

function sessionOf(
  id: string,
  userId: string | null,
  lastActiveAt: string,
  status = "active",
): AgentSessionListItem {
  return {
    id,
    provider: "claude",
    status,
    turn_count: 1,
    mode: null,
    author: userId === null ? null : { user_id: userId, display_name: "作者" },
    last_active_at: lastActiveAt,
    title: null,
  } as unknown as AgentSessionListItem;
}

function setCurrentUser(userId: string | null) {
  if (userId === null) {
    useSession.getState().clear();
    return;
  }
  useSession.getState().setUser({
    id: userId,
    email: "me@test.local",
    displayName: "我",
    is_platform_admin: true,
    permissions: [],
  });
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuicklogSessionsCard workspaceId="ws-1" qlId={QL_ID} />
    </QueryClientProvider>,
  );
}

const PORTAL = `/workspaces/ws-1/quicklog/${QL_ID}/sessions`;

describe("QuicklogSessionsCard（task-12）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.getState().clear();
  });

  it("渲染关联会话卡与「打开会话工作台」链接（不带参），空态提示可新建", async () => {
    setCurrentUser(ME);
    mocks.listQuicklogSessions.mockResolvedValue([]);
    renderCard();

    expect(screen.getByText("关联会话")).toBeInTheDocument();
    expect(
      screen.getByText("本快速修复的执行会话（自动绑定，点击直达选中）"),
    ).toBeInTheDocument();
    // 卡尾入口：Link 指向快速修复门户路由（D-006@v1），不带 session 参数。
    const openLink = screen.getByRole("link", { name: "打开会话工作台" });
    expect(openLink).toHaveAttribute("href", PORTAL);
    // 空态提示（仅本人零会话；查询 resolve 后才离开加载态）。
    expect(
      await screen.findByText("暂无本人会话，可打开工作台新建"),
    ).toBeInTheDocument();

    // 数据源透传（task-09 契约 [workspaceId, qlId]）。
    await waitFor(() =>
      expect(mocks.listQuicklogSessions).toHaveBeenCalledWith("ws-1", QL_ID),
    );
  });

  it("渲染本人最近前 3 条预览：短码/状态中文/相对时间，链接带 ?session= 深链", async () => {
    setCurrentUser(ME);
    // 乱序喂入：客户端按 last_active_at 倒序 → me1 > me2 > me3（me4 第 4 条
    // 截断，other1 他人过滤）。
    mocks.listQuicklogSessions.mockResolvedValue([
      sessionOf("dddddddd-0000-0000-0000-000000000004", ME, "2026-01-02T00:00:00Z"),
      sessionOf("eeeeeeee-0000-0000-0000-000000000005", OTHER, "2026-01-06T00:00:00Z"),
      sessionOf("bbbbbbbb-0000-0000-0000-000000000002", ME, "2026-01-04T00:00:00Z", "ended"),
      sessionOf("cccccccc-0000-0000-0000-000000000003", null, "2026-01-03T00:00:00Z"),
      sessionOf("aaaaaaaa-0000-0000-0000-000000000001", ME, "2026-01-05T00:00:00Z"),
    ]);
    renderCard();

    await waitFor(() =>
      expect(mocks.listQuicklogSessions).toHaveBeenCalledWith("ws-1", QL_ID),
    );

    // 前 3 条按倒序渲染：?session= 深链直达门户选中态（encodeURIComponent）。
    const links = await waitFor(() => {
      const items = screen
        .getAllByRole("link")
        .filter((a) => a.getAttribute("href")?.startsWith(`${PORTAL}?session=`));
      expect(items).toHaveLength(3);
      return items;
    });
    expect(links[0]).toHaveAttribute(
      "href",
      `${PORTAL}?session=aaaaaaaa-0000-0000-0000-000000000001`,
    );
    expect(links[1]).toHaveAttribute(
      "href",
      `${PORTAL}?session=bbbbbbbb-0000-0000-0000-000000000002`,
    );
    expect(links[2]).toHaveAttribute(
      "href",
      `${PORTAL}?session=cccccccc-0000-0000-0000-000000000003`,
    );
    // id 短码（# + slice(0,8)）+ 状态中文（五态口径）+ 相对时间（≥7 天回退日期）。
    expect(screen.getByText("#aaaaaaaa")).toBeInTheDocument();
    expect(screen.getAllByText("进行中")).toHaveLength(2); // me1 与缺 author 项
    expect(screen.getByText("已结束")).toBeInTheDocument(); // me2 ended
    expect(screen.getByText("2026-01-05")).toBeInTheDocument();

    // 第 4 条本人会话与第 5 条他人会话均不出现。
    expect(screen.queryByText("#dddddddd")).not.toBeInTheDocument();
    expect(screen.queryByText("#eeeeeeee")).not.toBeInTheDocument();
  });

  it("仅本人过滤：他人会话不渲染，缺 author 项保留", async () => {
    setCurrentUser(ME);
    mocks.listQuicklogSessions.mockResolvedValue([
      sessionOf("eeeeeeee-0000-0000-0000-000000000005", OTHER, "2026-01-06T00:00:00Z"),
      sessionOf("cccccccc-0000-0000-0000-000000000003", null, "2026-01-03T00:00:00Z"),
    ]);
    renderCard();

    await waitFor(() =>
      expect(mocks.listQuicklogSessions).toHaveBeenCalledWith("ws-1", QL_ID),
    );
    // 缺 author 视为本人保留；他人会话被剔除（logs/stream owner-only，展示误导）。
    expect(await screen.findByText("#cccccccc")).toBeInTheDocument();
    expect(screen.queryByText("#eeeeeeee")).not.toBeInTheDocument();
  });

  it("加载态：查询 pending 时显示「加载中…」", async () => {
    setCurrentUser(ME);
    // 永不 resolve 的 promise——卡停留在加载态。
    mocks.listQuicklogSessions.mockReturnValue(new Promise(() => undefined));
    renderCard();

    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(
      screen.queryByText("暂无本人会话，可打开工作台新建"),
    ).not.toBeInTheDocument();
  });
});
