// task-06（2026-08-22-workspace-sessions-portal）：入口形态适配——原 :21-27
// 「Dialog 打开 + ChangeSessionSection 透传」断言改为入口断言（预览条目渲染/
// 链接指向 /仅本人过滤），用例语义保留：①入口卡渲染（原 case 1）②数据源
// workspaceId/changeId 透传（原 case 2）③新增 D-003@v1 仅本人过滤分支。
// useSession 经真实 zustand store 的 setUser/clear 控制（同
// workspace-session-section.test.tsx 既有惯例，等效 mock 当前用户）。
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeSessionsCard } from "@/components/changes/detail/change-sessions-card";
import { useSession } from "@/stores/session";
import type { AgentSessionListItem } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  listChangeSessions: vi.fn(),
}));

// 部分 mock：仅替换本卡数据源 listChangeSessions，其余导出（经
// session-list-panel 的 formatRelativeTime 再导出链传递）保持真实实现。
vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  listChangeSessions: mocks.listChangeSessions,
}));

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

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
      <ChangeSessionsCard workspaceId="ws-1" changeId="ch-2" />
    </QueryClientProvider>,
  );
}

const PORTAL = "/workspaces/ws-1/changes/ch-2/sessions";

describe("ChangeSessionsCard 入口形态（task-06）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.getState().clear();
  });

  it("渲染入口卡与「打开会话工作台」链接（无参），无 Dialog 与内嵌会话面板", async () => {
    setCurrentUser(ME);
    mocks.listChangeSessions.mockResolvedValue([]);
    renderCard();

    expect(screen.getByText("会话调试")).toBeInTheDocument();
    // 卡尾入口：Link 指向变更级门户路由（task-03），不带 session 参数。
    const openLink = screen.getByRole("link", { name: "打开会话工作台" });
    expect(openLink).toHaveAttribute("href", PORTAL);
    // 原 Dialog + 内嵌 ChangeSessionSection 装配已移除（组件退役归 task-07）。
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 空态提示（仅本人零会话；查询 resolve 后才离开加载态）。
    expect(
      await screen.findByText("暂无本人会话，可打开工作台新建"),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(mocks.listChangeSessions).toHaveBeenCalledWith("ws-1", "ch-2"),
    );
  });

  it("渲染本人最近前 3 条预览：短码/状态中文/相对时间，链接带 ?session= 深链", async () => {
    setCurrentUser(ME);
    // 乱序喂入：客户端按 last_active_at 倒序 → me1 > me2 > me3（me4 第 4 条截断，
    // other1 他人过滤）。
    mocks.listChangeSessions.mockResolvedValue([
      sessionOf("dddddddd-0000-0000-0000-000000000004", ME, "2026-01-02T00:00:00Z"),
      sessionOf("eeeeeeee-0000-0000-0000-000000000005", OTHER, "2026-01-06T00:00:00Z"),
      sessionOf("bbbbbbbb-0000-0000-0000-000000000002", ME, "2026-01-04T00:00:00Z", "ended"),
      sessionOf("cccccccc-0000-0000-0000-000000000003", null, "2026-01-03T00:00:00Z"),
      sessionOf("aaaaaaaa-0000-0000-0000-000000000001", ME, "2026-01-05T00:00:00Z"),
    ]);
    renderCard();

    // 数据源透传（原 case 2 语义保留）。
    await waitFor(() =>
      expect(mocks.listChangeSessions).toHaveBeenCalledWith("ws-1", "ch-2"),
    );

    // 前 3 条按倒序渲染：id 短码 + 状态中文 + 相对时间（≥7 天回退日期格式）。
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
    expect(screen.getByText("#aaaaaaaa")).toBeInTheDocument();
    // me1 与 me3 均 active（缺 author 项默认 active）→ 两处「进行中」。
    expect(screen.getAllByText("进行中")).toHaveLength(2);
    expect(screen.getByText("已结束")).toBeInTheDocument(); // me2 ended
    expect(screen.getByText("2026-01-05")).toBeInTheDocument();

    // 第 4 条本人会话与第 5 条他人会话均不出现。
    expect(screen.queryByText("#dddddddd")).not.toBeInTheDocument();
    expect(screen.queryByText("#eeeeeeee")).not.toBeInTheDocument();
  });

  it("仅本人过滤（D-003@v1）：他人会话不渲染，缺 author 项保留", async () => {
    setCurrentUser(ME);
    mocks.listChangeSessions.mockResolvedValue([
      sessionOf("eeeeeeee-0000-0000-0000-000000000005", OTHER, "2026-01-06T00:00:00Z"),
      sessionOf("cccccccc-0000-0000-0000-000000000003", null, "2026-01-03T00:00:00Z"),
    ]);
    renderCard();

    await waitFor(() =>
      expect(mocks.listChangeSessions).toHaveBeenCalledWith("ws-1", "ch-2"),
    );
    // 缺 author 视为本人保留；他人会话被剔除（logs/stream owner-only，展示误导）。
    expect(await screen.findByText("#cccccccc")).toBeInTheDocument();
    expect(screen.queryByText("#eeeeeeee")).not.toBeInTheDocument();
  });
});
