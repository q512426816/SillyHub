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

// ── @/lib/daemon mock：保留 actual（常量/类型真实），仅替换五个 API ──────────
const daemonApi = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  listWorkspaceAgentSessions: vi.fn(),
  deleteAgentSession: vi.fn(),
  archiveAgentSession: vi.fn(),
  unarchiveAgentSession: vi.fn(),
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
} from "@/lib/daemon";

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

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  machinesHook.useDaemonMachines.mockReturnValue({
    items: defaultMachines(),
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

  it("queryFn 调 listAgentSessions({limit:500, workspace_id}) 且未调 listWorkspaceAgentSessions（C-08）", async () => {
    daemonApi.listAgentSessions.mockResolvedValue(makeResp([makeSession()]));
    renderList("ws-1");

    await waitFor(() => {
      expect(daemonApi.listAgentSessions).toHaveBeenCalledWith({
        limit: 500,
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
