/**
 * task-11 · MobileSessionList 单测（2026-08-26-mobile-workspace-page design
 * §5.4 / §7 / FR-06 / Grill C-08 / X-04 锁 key）。
 *
 * 覆盖契约：
 *  - query key 逐字断言（X-04 / R-03）：["agentSessions","sessionsPortal",
 *    scope, {limit:500, archived, assoc:null}]，scope = {kind:"workspace",
 *    workspaceId}——与桌面 session-list-panel.tsx:584 同构（数据落键即证 key
 *    形态，错键取 null 即失败）；
 *  - queryFn 调 listAgentSessions 且入参含 workspace_id / limit=500
 *    （archived 视图加 archived:true），**未调** listWorkspaceAgentSessions
 *    （C-08：后者无 limit/archived 参数、返回类型不同）；
 *  - 机器分组：在线组在前（runtime→机器在线态），快照 machine_name 回退组
 *    按离线渲染；组头机器名 + 在线/离线；
 *  - 状态 Tab：全部/进行中客户端过滤（进行中 = 非 ended/failed）、已归档切
 *    key 服务端重拉（key archived:true 落键 + 入参带 archived:true）；
 *  - ⋯ 菜单三操作：归档/取消归档（按视图）调对应 API，删除 danger +
 *    Modal.confirm「确认删除」后调 deleteAgentSession；成功均 invalidate
 *    ["agentSessions"] 前缀；
 *  - 点击卡片 onSelect(sessionId)；空态引导 onNew。
 *
 * mock 策略（对齐 layout.m-workspace-id.test.tsx）：@/lib/daemon 保留 actual、
 * 仅替换五个 API（常量 AGENT_SESSIONS_TREE_FETCH_LIMIT 取真实值）；机器在线
 * 态 hook @/lib/use-daemon-machines 整体 mock（避免其内部 listAgentSessions
 * 干扰入参断言）；react-query 用真实 QueryClient（断言缓存落键需要真实缓存）。
 * 相对时间 / MobileActionMenu 不 mock——直接锁「复用而非复制」契约。
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── @/lib/daemon mock：保留 actual（常量/类型真实），仅替换 API ──────────────
const daemonApi = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  archiveAgentSession: vi.fn(),
  unarchiveAgentSession: vi.fn(),
  // 群聊分区数据源（2026-09-02 quick，照桌面群分区同款 mock 手法）。
  listGroupChats: vi.fn(),
}));
vi.mock("@/lib/daemon", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...daemonApi };
});

// ── @/lib/use-daemon-machines 整体 mock（在线态受控注入） ────────────────────
const machinesHook = vi.hoisted(() => ({ useDaemonMachines: vi.fn() }));
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: machinesHook.useDaemonMachines,
}));

import { MobileSessionList } from "@/components/mobile/mobile-session-list";
import {
  AGENT_SESSIONS_TREE_FETCH_LIMIT,
  type AgentSessionListResponse,
  type AgentSessionRead,
  type DaemonMachineRead,
  type GroupChatListItemRead,
} from "@/lib/daemon";
import { groupLastOpenKey } from "@/lib/group-unread";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<AgentSessionRead> = {}): AgentSessionRead {
  return {
    id: "s-1",
    runtime_id: "rt-1",
    lease_id: null,
    provider: "claude",
    status: "active",
    agent_session_id: null,
    config: null,
    turn_count: 3,
    created_at: "2026-08-26T10:00:00Z",
    // 刚刚活跃（<30s）→ formatRelativeTime「刚刚」稳定输出
    last_active_at: new Date(Date.now() - 10_000).toISOString(),
    ended_at: null,
    change_id: null,
    user_id: "u-1",
    workspace_id: "ws-1",
    title: "主控会话",
    origin: "chat",
    config_snapshot: {
      engine: "claude",
      machine_name: "QINYI-DESKTOP",
      agent_name: "主控",
    },
    ...overrides,
  } as unknown as AgentSessionRead;
}

function makeMachine(overrides: Partial<DaemonMachineRead> = {}): DaemonMachineRead {
  return {
    id: "m-1",
    hostname: "QINYI-DESKTOP",
    display_alias: null,
    os: "win",
    arch: "x64",
    status: "online",
    last_heartbeat_at: null,
    version: null,
    build_id: null,
    started_at: null,
    created_at: "2026-08-26T10:00:00Z",
    owner: null,
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [],
    ...overrides,
  } as unknown as DaemonMachineRead;
}

function makeResp(items: AgentSessionRead[]): AgentSessionListResponse {
  return { items, total: items.length } as unknown as AgentSessionListResponse;
}

/**
 * 群列表项固件（2026-09-02 quick，形态对齐 session-list-panel.test
 * makeGroupListItem：members 摘要 + last_message + last_mention）。
 */
function makeGroupListItem(
  overrides: Partial<GroupChatListItemRead> = {},
): GroupChatListItemRead {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [
      {
        id: "mem-1",
        member_type: "agent",
        display_name: "小码",
        runtime_id: "rt-1",
        joined_at: "2026-09-01T00:00:00Z",
        shadow_status: "none",
        team_enabled: false,
      },
      {
        id: "mem-2",
        member_type: "user",
        display_name: "林一",
        user_id: "u-lin",
        joined_at: "2026-09-01T00:00:00Z",
        shadow_status: "none",
        team_enabled: false,
      },
    ],
    online_member_ids: [],
    last_message: "小码：已定位到问题在 hooks 依赖数组…",
    last_mention: null,
    ...overrides,
  } as unknown as GroupChatListItemRead;
}

/** 组件期望的 query key 形态（X-04 逐字：scope 槽位 + 参数对象槽位）。 */
function sessionsPortalKey(workspaceId: string, archived: boolean) {
  return [
    "agentSessions",
    "sessionsPortal",
    { kind: "workspace", workspaceId },
    {
      limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
      archived,
      assoc: null,
    },
  ];
}

/** 默认机器源：m-on（在线，挂 rt-a）+ m-off（离线，挂 rt-b）。 */
function defaultMachines(): DaemonMachineRead[] {
  return [
    makeMachine({
      id: "m-off",
      hostname: "MAC-MINI",
      status: "offline",
      runtimes: [{ id: "rt-b" } as DaemonMachineRead["runtimes"][number]],
    }),
    makeMachine({
      id: "m-on",
      hostname: "QINYI-DESKTOP",
      status: "online",
      runtimes: [{ id: "rt-a" } as DaemonMachineRead["runtimes"][number]],
    }),
  ];
}

let queryClient: QueryClient;
let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

function renderList(workspaceId = "ws-1") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MobileSessionList
        workspaceId={workspaceId}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** 带群回调渲染（群分区启用形态；渲染后手动传参不裁剪既有用例）。 */
function renderListGroupCallbacks(
  onOpenGroup: (g: GroupChatListItemRead) => void,
  onNewGroup: () => void,
  workspaceId = "ws-1",
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MobileSessionList
        workspaceId={workspaceId}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onOpenGroup={onOpenGroup}
        onNewGroup={onNewGroup}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  // machineCandidates 与 items 同源注入：组件分组已改读融合候选（task-10，
  // 2026-08-28-daemon-agent-share），漏配会走 config_snapshot 回退恒离线。
  machinesHook.useDaemonMachines.mockReturnValue({
    items: defaultMachines(),
    sharedToMe: [],
    machineCandidates: defaultMachines(),
    total: 2,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  daemonApi.listAgentSessions.mockResolvedValue(makeResp([]));
  daemonApi.listWorkspaceAgentSessions.mockResolvedValue([]);
  daemonApi.deleteAgentSession.mockResolvedValue(undefined);
  daemonApi.archiveAgentSession.mockResolvedValue(undefined);
  daemonApi.unarchiveAgentSession.mockResolvedValue(undefined);
  // 群分区默认空列表（@我已读记忆跨用例清零——红点判定依赖 localStorage）。
  daemonApi.listGroupChats.mockResolvedValue([]);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

/* ────────────── 数据契约（X-04 锁 key / C-08 数据函数） ────────────── */

describe("MobileSessionList 同 key query（X-04 / C-08）", () => {
  it("query key 逐字对齐桌面门户形态且数据落键（scope 槽位 + limit:500/archived/assoc 参数对象）", async () => {
    const resp = makeResp([makeSession()]);
    daemonApi.listAgentSessions.mockResolvedValue(resp);
    renderList("ws-1");

    await waitFor(() => {
      // 数据落在这个键下才取得到（错键取 null 即失败）→ key 形态逐字锁定
      expect(
        queryClient.getQueryData(sessionsPortalKey("ws-1", false)),
      ).toBe(resp);
    });
    // 键形态错任一槽位（scope kind / archived 布尔 / assoc null）都取不到
    expect(
      queryClient.getQueryData(sessionsPortalKey("ws-2", false)),
    ).toBeUndefined();
    // limit 常量数值锁 500（与桌面 D-103 单次全量拉取一致）
    expect(AGENT_SESSIONS_TREE_FETCH_LIMIT).toBe(500);
  });

  it("queryFn 调 listAgentSessions({limit:500, archived:false, workspace_id}) 且未调 listWorkspaceAgentSessions（C-08）", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(makeResp([makeSession()]));
    renderList("ws-1");

    await waitFor(() => {
      // ql-20260831-015：后端 HTTP 默认改三态（不传=全部含已归档），移动端
      // 默认视图显式 archived:false 保持只看未归档。
      expect(daemonApi.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        archived: false,
        workspace_id: "ws-1",
      });
    });
    expect(daemonApi.listWorkspaceAgentSessions).not.toHaveBeenCalled();
  });

  it("已归档 Tab：isArchivedView 切 key 重拉（archived:true 落键 + 入参加 archived:true）", async () => {
    const activeResp = makeResp([makeSession({ id: "s-live" })]);
    const archivedResp = makeResp([
      makeSession({ id: "s-arch", title: "归档会话", status: "ended" }),
    ]);
    daemonApi.listAgentSessions.mockImplementation((params?: { archived?: boolean }) =>
      Promise.resolve(params?.archived ? archivedResp : activeResp),
    );
    renderList("ws-1");

    await waitFor(() => {
      expect(screen.getByText("主控会话")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("mobile-session-tab-archived"));

    // 服务端入参：archived 视图带 archived:true（仍带 limit/workspace_id）
    await waitFor(() => {
      expect(daemonApi.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
        archived: true,
        workspace_id: "ws-1",
      });
    });
    // archived:true 是独立键（两份数据各自落键，不互相覆盖）
    await waitFor(() => {
      expect(
        queryClient.getQueryData(sessionsPortalKey("ws-1", true)),
      ).toBe(archivedResp);
    });
    await waitFor(() => {
      expect(screen.getByText("归档会话")).toBeInTheDocument();
    });
  });
});

/* ────────────── 机器分组（在线组在前 / 快照回退离线） ────────────── */

describe("MobileSessionList 机器分组", () => {
  it("在线组在前、离线组在后；组头机器名 + 在线/离线；快照回退组按离线渲染", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([
        // 离线机器会话排最前（验证在线组重排到前，非首次出现序）
        makeSession({ id: "s-off", title: "离线会话", runtime_id: "rt-b" }),
        makeSession({ id: "s-on", title: "在线会话", runtime_id: "rt-a" }),
        // runtime 映射缺席 → config_snapshot.machine_name 回退（离线）
        makeSession({
          id: "s-snap",
          title: "快照会话",
          runtime_id: null,
          config_snapshot: { machine_name: "SNAP-BOX" },
        }),
      ]),
    );
    renderList();

    await waitFor(() => {
      expect(screen.getByText("在线会话")).toBeInTheDocument();
    });

    const headers = screen
      .getAllByTestId("mobile-session-group-header")
      .map((h) => h.textContent);
    // 在线组在前；离线机器组与快照回退组随后（各自按首次出现序）
    expect(headers).toEqual([
      "QINYI-DESKTOP在线",
      "MAC-MINI离线",
      "SNAP-BOX离线",
    ]);
  });

  it("无 runtime 也无快照 → 「未知机器」离线组兜底", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([
        makeSession({
          id: "s-unk",
          title: "孤儿会话",
          runtime_id: null,
          config_snapshot: null,
        }),
      ]),
    );
    renderList();

    await waitFor(() => {
      expect(
        screen.getByTestId("mobile-session-group-header").textContent,
      ).toBe("未知机器离线");
    });
  });
});

/* ────────────── 状态 Tab 过滤 ────────────── */

describe("MobileSessionList 状态 Tab", () => {
  it("全部：显示全部会话；进行中：客户端过滤仅非 ended/failed", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([
        makeSession({ id: "s-active", title: "活跃会话", status: "active" }),
        makeSession({ id: "s-pending", title: "排队会话", status: "pending" }),
        makeSession({ id: "s-ended", title: "结束会话", status: "ended" }),
        makeSession({ id: "s-failed", title: "失败会话", status: "failed" }),
      ]),
    );
    renderList();

    await waitFor(() => {
      expect(screen.getByText("结束会话")).toBeInTheDocument();
    });
    // 全部 Tab：4 张卡
    expect(screen.getAllByTestId("mobile-session-card")).toHaveLength(4);
    // Tab 计数：全部 4 / 进行中 2
    expect(screen.getByTestId("mobile-session-tab-all").textContent).toContain("4");
    expect(screen.getByTestId("mobile-session-tab-ongoing").textContent).toContain("2");

    // 切「进行中」：仅 active/pending（ended/failed 客户端滤除）
    fireEvent.click(screen.getByTestId("mobile-session-tab-ongoing"));
    await waitFor(() => {
      expect(screen.queryByText("结束会话")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("失败会话")).not.toBeInTheDocument();
    expect(screen.getByText("活跃会话")).toBeInTheDocument();
    expect(screen.getByText("排队会话")).toBeInTheDocument();
    // 客户端过滤：不换 queryKey、不发第二次请求
    expect(daemonApi.listAgentSessions).toHaveBeenCalledTimes(1);
  });

  it("空态：非归档视图渲染「新建会话」引导，归档视图无引导按钮", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(makeResp([]));
    renderList();

    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText("暂无会话")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mobile-session-tab-archived"));
    await waitFor(() => {
      expect(screen.getByText("暂无已归档会话")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mobile-session-list-new")).not.toBeInTheDocument();
  });
});

/* ────────────── ⋯ 菜单三操作（MobileActionMenu 承载） ────────────── */

describe("MobileSessionList 卡片菜单操作", () => {
  it("归档：⋯ → MobileActionMenu「归档」→ archiveAgentSession(id) + invalidate [agentSessions]", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([makeSession({ id: "s-1" })]),
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText("主控会话")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("mobile-session-card-menu-s-1"));
    fireEvent.click(await screen.findByText("归档"));

    await waitFor(() => {
      expect(daemonApi.archiveAgentSession).toHaveBeenCalledWith("s-1");
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agentSessions"],
      });
    });
  });

  it("取消归档：归档视图菜单换「取消归档」→ unarchiveAgentSession(id) + invalidate", async () => {
    daemonApi.listAgentSessions.mockImplementation((params?: { archived?: boolean }) =>
      Promise.resolve(
        params?.archived
          ? makeResp([makeSession({ id: "s-arch", status: "ended" })])
          : makeResp([]),
      ),
    );
    renderList();
    fireEvent.click(screen.getByTestId("mobile-session-tab-archived"));
    await waitFor(() => {
      expect(screen.getByText("主控会话")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("mobile-session-card-menu-s-arch"));
    // 归档视图不含「归档」动作，只有「取消归档」
    expect(screen.queryByText("归档")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("取消归档"));

    await waitFor(() => {
      expect(daemonApi.unarchiveAgentSession).toHaveBeenCalledWith("s-arch");
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agentSessions"],
      });
    });
  });

  it("删除：danger 动作 → Modal.confirm「确认删除」二次确认 → deleteAgentSession(id) + invalidate", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([makeSession({ id: "s-1" })]),
    );
    renderList();
    await waitFor(() => {
      expect(screen.getByText("主控会话")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("mobile-session-card-menu-s-1"));
    fireEvent.click(await screen.findByText("删除"));

    // 二次确认弹层出现：antd confirm 标题渲染两份（modal-title + confirm-title），
    // 直接以唯一 ok 按钮断言（antd 两字以上中文按钮 autoLetterSpacing → \s* 兼容）
    const okBtn = await screen.findByRole("button", { name: /确\s*认\s*删\s*除/ });
    await act(async () => {
      fireEvent.click(okBtn);
    });

    await waitFor(() => {
      expect(daemonApi.deleteAgentSession).toHaveBeenCalledWith("s-1");
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agentSessions"],
      });
    });
  });
});

/* ────────────── 回调（onSelect / onNew） ────────────── */

describe("MobileSessionList 回调", () => {
  it("点击卡片主体 → onSelect(sessionId)", async () => {
    const onSelect = vi.fn();
    daemonApi.listAgentSessions.mockResolvedValue(
      makeResp([makeSession({ id: "s-9" })]),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <MobileSessionList workspaceId="ws-1" onSelect={onSelect} onNew={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "打开会话 主控会话" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("s-9");
  });

  it("空态「新建会话」→ onNew", async () => {
    const onNew = vi.fn();
    daemonApi.listAgentSessions.mockResolvedValue(makeResp([]));
    render(
      <QueryClientProvider client={queryClient}>
        <MobileSessionList workspaceId="ws-1" onSelect={vi.fn()} onNew={onNew} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("mobile-session-list-new"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});

/* ────────────── 群聊分区（2026-09-02 quick，照桌面 task-07 群分区契约） ────────────── */

describe("MobileSessionList 群聊分区", () => {
  it("群行渲染 + 独立数据源同 key 形态（groupChats/list/workspaceId 落缓存）+ workspace 客户端过滤", async () => {
    const groups = [
      makeGroupListItem(),
      makeGroupListItem({ id: "g-2", title: "别家的群", workspace_id: "ws-other" }),
    ];
    daemonApi.listGroupChats.mockResolvedValue(groups);
    renderListGroupCallbacks(vi.fn(), vi.fn());

    // 群行渲染（本工作区群；他工作区群被客户端过滤）+ facepile + 摘要
    const row = await screen.findByTestId("mobile-group-chat-row");
    expect(row).toHaveAttribute("data-group-id", "g-1");
    expect(row.textContent).toContain("前端攻坚小分队");
    expect(row.textContent).toContain("小码：已定位到问题在 hooks 依赖数组…");
    // facepile：成员昵称 title 提示（小码/林一，复用桌面导出）。
    expect(row.querySelector('[title="小码"]')).toBeTruthy();
    expect(row.querySelector('[title="林一"]')).toBeTruthy();
    expect(screen.queryByText("别家的群")).not.toBeInTheDocument();
    // 分区计数
    expect(screen.getByLabelText("群聊分区").textContent).toContain("1 个");

    // 数据落键：key 形态 = ["groupChats","list",workspaceId]（与桌面 workspace
    // scope 群分区同 key 共享缓存；错键取不到即失败）。
    await waitFor(() => {
      expect(queryClient.getQueryData(["groupChats", "list", "ws-1"])).toBe(
        groups,
      );
    });
    // 独立数据源：群分区不掺单聊端点
    expect(daemonApi.listGroupChats).toHaveBeenCalledTimes(1);
    expect(daemonApi.listAgentSessions).toHaveBeenCalledTimes(1);
  });

  it("点击群行 → onOpenGroup(完整群列表项)；分区头「＋」→ onNewGroup", async () => {
    const onOpenGroup = vi.fn();
    const onNewGroup = vi.fn();
    const group = makeGroupListItem();
    daemonApi.listGroupChats.mockResolvedValue([group]);
    renderListGroupCallbacks(onOpenGroup, onNewGroup);

    fireEvent.click(
      await screen.findByRole("button", { name: "打开群聊 前端攻坚小分队" }),
    );
    expect(onOpenGroup).toHaveBeenCalledTimes(1);
    expect(onOpenGroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "g-1", title: "前端攻坚小分队" }),
    );

    fireEvent.click(screen.getByTestId("mobile-group-chat-new"));
    expect(onNewGroup).toHaveBeenCalledTimes(1);
  });

  it("未传 onOpenGroup → 分区零渲染零请求（照桌面 onSelectGroup 门控）", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("mobile-session-list")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mobile-group-chat-section")).not.toBeInTheDocument();
    expect(daemonApi.listGroupChats).not.toHaveBeenCalled();
  });

  it("红点：last_mention 晚于本地已读 → 行首红点 + [有人@我] 前缀；已读/无提及 → 无红点", async () => {
    daemonApi.listGroupChats.mockResolvedValue([
      makeGroupListItem({
        id: "g-unread",
        title: "有人艾特我",
        last_mention: {
          ts: new Date(Date.now() - 5_000).toISOString(),
          content: "在吗",
          member_name: "小码",
        },
      }),
      makeGroupListItem({
        id: "g-read",
        title: "早已读",
        // 有提及但已打开过（已读记忆晚于提及）→ 无红点
        last_mention: {
          ts: "2026-09-01T00:00:00Z",
          content: "旧提及",
          member_name: "小码",
        },
      }),
    ]);
    // g-read 已读记忆晚于其 last_mention ts → 视为已读。
    window.localStorage.setItem(
      groupLastOpenKey("g-read"),
      new Date(Date.now() - 60_000).toISOString(),
    );
    renderListGroupCallbacks(vi.fn(), vi.fn());

    const rows = await screen.findAllByTestId("mobile-group-chat-row");
    expect(rows).toHaveLength(2);
    const unreadRow = rows.find((r) => r.dataset.groupId === "g-unread");
    if (!unreadRow) throw new Error("未读群行缺失（g-unread）");
    expect(unreadRow).toHaveAttribute("data-mention-unread", "true");
    expect(unreadRow).toHaveAttribute("data-mention-unread", "true");
    expect(
      screen.getByTestId("mobile-group-mention-dot"),
    ).toBeInTheDocument();
    expect(unreadRow.textContent).toContain("[有人@我]");

    const readRow = rows.find((r) => r.dataset.groupId === "g-read");
    if (!readRow) throw new Error("已读群行缺失（g-read）");
    expect(readRow).not.toHaveAttribute("data-mention-unread");
    expect(readRow.textContent).not.toContain("[有人@我]");
    // 只有一个红点（未读群）
    expect(screen.getAllByTestId("mobile-group-mention-dot")).toHaveLength(1);
  });

  it("last_message 空 → 回退成员构成摘要；加载失败 → 错误提示", async () => {
    daemonApi.listGroupChats.mockResolvedValue([
      makeGroupListItem({ last_message: null }),
    ]);
    const { unmount } = renderListGroupCallbacks(vi.fn(), vi.fn());
    const row = await screen.findByTestId("mobile-group-chat-row");
    expect(row.textContent).toContain("2 名成员 · 1 位 Agent · 1 位用户");

    // 错误分支：清缓存（staleTime 30s 内新鲜缓存不会重拉）+ 换 mock 拒绝 →
    // 重渲染出错误提示、不出群行。
    unmount();
    queryClient.clear();
    daemonApi.listGroupChats.mockRejectedValue(new Error("网络异常"));
    renderListGroupCallbacks(vi.fn(), vi.fn());
    expect(
      await screen.findByTestId("mobile-group-chat-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-group-chat-row")).not.toBeInTheDocument();
  });
});
