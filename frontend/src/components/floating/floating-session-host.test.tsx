/**
 * 悬浮会话宿主测试（task-05 / FR-1~4）。
 *
 * 覆盖三条硬约束：互斥协议（门户路由卸载球+抽屉+落壳态）、最小化保活
 * （抽屉 hidden 不卸载 + 恢复胶囊）、挂载门控（全关无会话只渲染球）。
 * SessionPanel / PreSessionPicker / 数据查询全部 mock——本文件只测壳层。
 *
 * 2026-08-25 悬浮球增强补测：拖拽定位、边缘吸附收起、拖拽尾音 click 抑制、
 * 点击抽屉外自动收起（portal 白名单放行）。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const pathnameRef = { current: "/ppm/projects" };
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("@/components/daemon/session-panel", async () => {
  // task-12：透出收到的 preContext.pageContext——创建轮上下文是否真正送达
  // 面板（用户实测反馈③：UI 新建会话恒不注入的根因即此 props 断链）。
  // task-07 Phase 5：autoTeamOpen 按挂载初值快照透出（真实面板同口径——宿主
  // 送达下一拍即复位 prop，动态读取会竞态闪烁）。
  // task-05（2026-08-28-session-ppm-task-binding / FR-04）：ppmItem / workspaceId
  // 同样透出（挂起位 → preContext.ppmItem + 工作区解析断言数据源）。
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    SessionPanel: (props: {
      sessionId: string | null;
      preContext?:
        | {
            pageContext?: unknown;
            ppmItem?: { kind: string; id: string } | null;
            workspaceId?: string | null;
          }
        | null
        | undefined;
      autoTeamOpen?: boolean;
    }) => {
      const autoTeamAtMount = React.useRef(props.autoTeamOpen === true);
      return (
        <div
          data-testid="mock-session-panel"
          data-session={props.sessionId ?? "null"}
          data-pagectx={JSON.stringify(props.preContext?.pageContext ?? null)}
          data-ppm={JSON.stringify(props.preContext?.ppmItem ?? null)}
          data-workspace={props.preContext?.workspaceId ?? ""}
          data-autoteam={autoTeamAtMount.current ? "true" : "false"}
        >
          panel
        </div>
      );
    },
  };
});

// P2-3（QA 边界修复）：透出 onPick/onCancel 触发器——两步浮层兜底分支的
// PPM 绑定意图消费/取消路径需从测试侧驱动。
vi.mock("@/components/sessions/pre-session-picker", () => ({
  PreSessionPicker: ({
    open,
    onPick,
    onCancel,
  }: {
    open: boolean;
    onPick?: (_runtimeId: string) => void;
    onCancel?: () => void;
  }) =>
    open ? (
      <div data-testid="mock-picker">
        picker
        <button
          type="button"
          data-testid="mock-picker-pick"
          onClick={() => onPick?.("rt-pick")}
        >
          pick
        </button>
        <button
          type="button"
          data-testid="mock-picker-cancel"
          onClick={() => onCancel?.()}
        >
          cancel
        </button>
      </div>
    ) : null,
}));

// FR-02/FR-03：抽屉左栏换成 SessionListPanel，需 mock 避免真实数据查询。
vi.mock("@/components/sessions/session-list-panel", () => ({
  SessionListPanel: (props: {
    selectedSessionId?: string | null;
    onSelect?: (s: { id: string }) => void;
    scope?: { kind: string; runtimeId?: string };
    // 用户反馈⑤回归锚：四个操作回调必须接线（缺任一则抽屉失去新建/删除/归档）。
    onNewInGroup?: unknown;
    onDeleteSessions?: unknown;
    onArchiveSessions?: unknown;
    onUnarchiveSessions?: unknown;
  }) => (
    <div
      data-testid="mock-session-list-panel"
      data-scope-kind={props.scope?.kind ?? "global"}
      data-runtime-id={props.scope?.runtimeId ?? ""}
      data-selected={props.selectedSessionId ?? ""}
      data-ops-wired={
        [props.onNewInGroup, props.onDeleteSessions, props.onArchiveSessions, props.onUnarchiveSessions]
          .every(Boolean)
          ? "true"
          : "false"
      }
    >
      session-list-panel
    </div>
  ),
}));

vi.mock("@/components/sessions/sessions-portal", () => ({
  resolveDefaultMachineId: () => "m-1",
}));

const machinesRef = {
  current: [
    {
      id: "m-1",
      status: "online",
      runtimes: [{ id: "rt-1", status: "online", provider: "claude" }],
    },
  ] as never[],
};
const sessionsRef = { current: [] as never[] };
const machinesLoadingRef = { current: false };

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({
    items: machinesRef.current,
    sessions: sessionsRef.current,
    isLoading: machinesLoadingRef.current,
  }),
}));

vi.mock("@/lib/daemon", () => ({
  listAgentSessions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: vi.fn().mockResolvedValue([]),
}));

// task-05（2026-08-28-session-ppm-task-binding / FR-04 / D-004@v2）：PPM 条目
// 入口的工作区解析数据源（listProjectWorkspaces 按 workspace_id 升序取第一）。
const workspaceApi = vi.hoisted(() => ({
  listProjectWorkspaces: vi.fn(),
}));

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: workspaceApi.listProjectWorkspaces };
});

import { FloatingSessionHost } from "@/components/floating/floating-session-host";
import { useFloatingSessionStore } from "@/stores/floating-session";

function resetStore() {
  useFloatingSessionStore.setState({
    open: false,
    minimized: false,
    sessionId: null,
    preContext: null,
    pageContext: null,
    autoNewPending: false,
    autoTeamIntent: false,
    pendingPpmItem: null,
  });
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("FloatingSessionHost", () => {
  beforeEach(() => {
    resetStore();
    pathnameRef.current = "/ppm/projects";
    // P2-3：机器数据改为每例重置（新用例会替换成「无可用 runtime」形态，
    // 防跨用例泄漏）。
    machinesRef.current = [
      {
        id: "m-1",
        status: "online",
        runtimes: [{ id: "rt-1", status: "online", provider: "claude" }],
      },
    ] as never[];
    machinesLoadingRef.current = false;
    pushMock.mockClear();
    window.localStorage.clear();
    workspaceApi.listProjectWorkspaces.mockReset();
    workspaceApi.listProjectWorkspaces.mockResolvedValue([]);
  });

  it("非门户路由渲染悬浮球；全关无会话时抽屉主体不挂载（门控）", () => {
    const { container } = render(wrap(<FloatingSessionHost />));
    expect(screen.getByTestId("floating-ball")).toBeInTheDocument();
    expect(screen.queryByTestId("floating-drawer")).not.toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it("点球开抽屉；requestNewSession 自动进预会话（默认机器解析）", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore
        .getState()
        .requestNewSession({ page_key: "ppm_project", project_id: "p-1" });
    });
    const drawer = await screen.findByTestId("floating-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer.dataset.open).toBe("true");
    // 自动解析默认机器（m-1 → rt-1 claude）进预会话。
    const panel = await screen.findByTestId("mock-session-panel");
    const s = useFloatingSessionStore.getState();
    expect(s.preContext?.runtimeId).toBe("rt-1");
    expect(s.pageContext).toEqual({ page_key: "ppm_project", project_id: "p-1" });
    // task-12（用户实测反馈③回归锚）：pageContext 必须真正进入面板的
    // preContext props（创建轮 createSession 的数据源）——此前断链致 UI
    // 新建会话恒不注入。
    expect(panel.dataset.pagectx).toBe(
      JSON.stringify({ page_key: "ppm_project", project_id: "p-1" }),
    );
  });

  it("左栏操作回调全接线：组头新建/删除/归档/取消归档（用户反馈⑤回归锚）", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().openDrawer();
    });
    const list = await screen.findByTestId("mock-session-list-panel");
    expect(list.dataset.opsWired).toBe("true");
  });

  it("URL 派生上下文同样送达面板（/workspaces 新建会话注入锚点）", async () => {
    pathnameRef.current = "/workspaces";
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().openDrawer();
    });
    // 空态点右侧面板「新会话」按钮 → 默认机器解析进预会话。
    const btn = await screen.findByRole("button", { name: /新会话/ });
    btn.click();
    const panel = await screen.findByTestId("mock-session-panel");
    expect(panel.dataset.pagectx).toBe(
      JSON.stringify({ page_key: "generic_page", route_key: "workspaces" }),
    );
  });

  // ── task-07 Phase 5（FR-06 / D-004@v2）：autoTeamIntent → autoTeamOpen 通道 ──

  it("requestNewSession(ppm_project)：意图经 autoTeamOpen 送达预会话，送达后清 store 意图", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore
        .getState()
        .requestNewSession({ page_key: "ppm_project", project_id: "p-1" });
    });
    const panel = await screen.findByTestId("mock-session-panel");
    // 预会话面板挂载拍收到 autoTeamOpen=true（挂载初值快照——宿主下一拍清
    // store 意图，prop 翻 false 不撤回面板已消费的意图）。
    expect(panel.dataset.autoteam).toBe("true");
    // 送达后 store 意图清除（防下一次 autoNew 误读残留）。
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false),
    );
  });

  it("requestNewSession(非 ppm_project)：预会话不携带 autoTeamOpen（零回归）", async () => {
    pathnameRef.current = "/workspaces";
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore
        .getState()
        .requestNewSession({ page_key: "generic_page", route_key: "workspaces" });
    });
    const panel = await screen.findByTestId("mock-session-panel");
    expect(panel.dataset.autoteam).toBe("false");
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false);
  });

  it("意图送达后手动再建预会话不重弹（latch 复位）", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore
        .getState()
        .requestNewSession({ page_key: "ppm_project", project_id: "p-1" });
    });
    await screen.findByTestId("mock-session-panel");
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false),
    );
    // 选中真会话（预会话退出）→ 左栏「＋」再建新预会话：autoTeamOpen 不得
    // 再为 true（防 PPM 意图泄漏进手动新建）。
    act(() => {
      useFloatingSessionStore.getState().selectSession("s-real");
    });
    act(() => {
      useFloatingSessionStore
        .getState()
        .startPreSession({ runtimeId: "rt-1", workspaceId: null }, null);
    });
    // 确已切回预会话面板（data-session=null）再断言意图不复弹。
    await waitFor(() =>
      expect(
        screen.getByTestId("mock-session-panel").dataset.session,
      ).toBe("null"),
    );
    const panel = screen.getByTestId("mock-session-panel");
    expect(panel.dataset.autoteam).toBe("false");
  });

  // ── task-05（2026-08-28-session-ppm-task-binding / FR-04 / D-004@v2）：
  //    pendingPpmItem → preContext.ppmItem + 工作区升序取首 ────────────────

  it("pendingPpmItem + requestNewSession：preContext.ppmItem 送达 + workspace_id 升序取第一预填 + 挂起位消费清除", async () => {
    // 乱序返回（b 在前）——断言按 workspace_id 字典序升序取 a（D-004@v2 与
    // 后端 link.workspace_id 同键）。
    workspaceApi.listProjectWorkspaces.mockResolvedValue([
      { workspace_id: "ws-b", workspace_name: "工作区B" },
      { workspace_id: "ws-a", workspace_name: "工作区A" },
    ]);
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().setPendingPpmItem({
        kind: "plan_task",
        id: "task-1",
        projectId: "p-1",
        title: "排行榜接口性能优化",
      });
      useFloatingSessionStore.getState().requestNewSession(null);
    });
    const panel = await screen.findByTestId("mock-session-panel");
    // 绑定经挂起位进入面板 preContext（创建轮 createSession 上送数据源）。
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.ppmItem).toEqual({
        kind: "plan_task",
        id: "task-1",
        title: "排行榜接口性能优化",
      }),
    );
    expect(panel.dataset.ppm).toBe(
      JSON.stringify({ kind: "plan_task", id: "task-1", title: "排行榜接口性能优化" }),
    );
    // 工作区解析：按 projectId 拉取 + 升序取首（ws-a）。
    expect(workspaceApi.listProjectWorkspaces).toHaveBeenCalledWith("p-1");
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.workspaceId).toBe("ws-a"),
    );
    // 读取即消费：挂起位清除（一次性，防残留泄漏进后续手动新建）。
    expect(useFloatingSessionStore.getState().pendingPpmItem).toBeNull();
  });

  it("工作区解析失败/无关联：不带 workspaceId 不阻塞，ppmItem 照常送达（D-004 降级）", async () => {
    workspaceApi.listProjectWorkspaces.mockRejectedValue(new Error("network down"));
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().setPendingPpmItem({
        kind: "problem",
        id: "prob-1",
        projectId: "p-9",
      });
      useFloatingSessionStore.getState().requestNewSession(null);
    });
    await screen.findByTestId("mock-session-panel");
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.ppmItem).toEqual({
        kind: "problem",
        id: "prob-1",
      }),
    );
    // 解析失败 → 非工作区语义（workspaceId null），预会话照开。
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.workspaceId).toBeNull(),
    );
    expect(useFloatingSessionStore.getState().open).toBe(true);
  });

  it("无挂起位：预会话不带 ppmItem、工作区解析零调用（缺省零回归）", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore
        .getState()
        .requestNewSession({ page_key: "ppm_project", project_id: "p-1" });
    });
    await screen.findByTestId("mock-session-panel");
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.runtimeId).toBe("rt-1"),
    );
    expect(useFloatingSessionStore.getState().preContext?.ppmItem).toBeUndefined();
    expect(workspaceApi.listProjectWorkspaces).not.toHaveBeenCalled();
  });

  // ── P2-3（QA 边界修复）：两步浮层兜底分支的 PPM 绑定意图保活/消费/取消 ──

  it("P2-3：默认 runtime 解析失败走两步浮层——onPick 后 preContext 仍带 ppmItem + 工作区预选", async () => {
    // m-1 无在线 claude/codex runtime → 默认机器三级回退落空 → PreSessionPicker
    // 兜底（此前该分支绑定意图在入口被清、onPick 丢失——本次修复的回归锚）。
    machinesRef.current = [
      { id: "m-1", status: "online", runtimes: [] },
    ] as never[];
    workspaceApi.listProjectWorkspaces.mockResolvedValue([
      { workspace_id: "ws-b", workspace_name: "工作区B" },
      { workspace_id: "ws-a", workspace_name: "工作区A" },
    ]);
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().setPendingPpmItem({
        kind: "plan_task",
        id: "task-9",
        projectId: "p-2",
        title: "浮层兜底绑定意图",
      });
      useFloatingSessionStore.getState().requestNewSession(null);
    });
    // 兜底浮层弹出；绑定意图保活（读取不再即清），预会话尚未打开。
    await screen.findByTestId("mock-picker");
    expect(useFloatingSessionStore.getState().pendingPpmItem).not.toBeNull();
    expect(useFloatingSessionStore.getState().preContext).toBeNull();
    // 浮层选定 runtime → 消费 ref：绑定 + 工作区升序取首照样送达面板。
    fireEvent.click(screen.getByTestId("mock-picker-pick"));
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.ppmItem).toEqual({
        kind: "plan_task",
        id: "task-9",
        title: "浮层兜底绑定意图",
      }),
    );
    expect(useFloatingSessionStore.getState().preContext?.runtimeId).toBe("rt-pick");
    expect(workspaceApi.listProjectWorkspaces).toHaveBeenCalledWith("p-2");
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.workspaceId).toBe("ws-a"),
    );
    const panel = await waitFor(() => screen.getByTestId("mock-session-panel"));
    expect(panel.dataset.ppm).toBe(
      JSON.stringify({ kind: "plan_task", id: "task-9", title: "浮层兜底绑定意图" }),
    );
    expect(panel.dataset.workspace).toBe("ws-a");
    // 消费后挂起位清干净（不留陈旧意图）。
    expect(useFloatingSessionStore.getState().pendingPpmItem).toBeNull();
  });

  it("P2-3：两步浮层取消兜底清——后续普通新建不误带 PPM 绑定", async () => {
    machinesRef.current = [
      { id: "m-1", status: "online", runtimes: [] },
    ] as never[];
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().setPendingPpmItem({
        kind: "problem",
        id: "prob-9",
        projectId: "p-9",
      });
      useFloatingSessionStore.getState().requestNewSession(null);
    });
    await screen.findByTestId("mock-picker");
    // 取消（✕ 与遮罩点击同走 onCancel 契约）→ 保活的挂起位一并清。
    fireEvent.click(screen.getByTestId("mock-picker-cancel"));
    expect(useFloatingSessionStore.getState().pendingPpmItem).toBeNull();
    expect(screen.queryByTestId("mock-picker")).not.toBeInTheDocument();
    // 后续普通新建（仍无默认 runtime → 再次走浮层）→ onPick 不带 ppm 绑定。
    fireEvent.click(screen.getByRole("button", { name: /新会话/ }));
    await screen.findByTestId("mock-picker");
    workspaceApi.listProjectWorkspaces.mockClear();
    fireEvent.click(screen.getByTestId("mock-picker-pick"));
    await waitFor(() =>
      expect(useFloatingSessionStore.getState().preContext?.runtimeId).toBe("rt-pick"),
    );
    expect(useFloatingSessionStore.getState().preContext?.ppmItem).toBeUndefined();
    expect(workspaceApi.listProjectWorkspaces).not.toHaveBeenCalled();
  });

  it("最小化保活：抽屉隐藏但不卸载，胶囊出现，恢复后展开", () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().selectSession("s-1");
    });
    const drawer = screen.getByTestId("floating-drawer");
    expect(drawer.dataset.open).toBe("true");

    act(() => {
      useFloatingSessionStore.getState().minimize();
    });
    // 保活断言：抽屉仍在 DOM（SessionPanel 未卸载），仅视觉隐藏。
    const hidden = screen.getByTestId("floating-drawer");
    expect(hidden).toBeInTheDocument();
    expect(hidden.dataset.open).toBe("false");
    expect(hidden.style.visibility).toBe("hidden");
    expect(screen.getByTestId("floating-capsule")).toBeInTheDocument();

    act(() => {
      useFloatingSessionStore.getState().restore();
    });
    expect(screen.getByTestId("floating-drawer").dataset.open).toBe("true");
  });

  it("互斥协议：门户路由不渲染球与抽屉，并落壳态", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().openDrawer();
    });
    expect(screen.getByTestId("floating-drawer")).toBeInTheDocument();

    // 导航到门户路由（模拟 pathname 变化触发的重渲染）。
    pathnameRef.current = "/sessions";
    act(() => {
      vi.clearAllTimers();
    });
    render(wrap(<FloatingSessionHost />));
    expect(screen.queryByTestId("floating-ball")).not.toBeInTheDocument();
    expect(screen.queryByTestId("floating-drawer")).not.toBeInTheDocument();
    // 壳态被互斥协议收口（open=false）。
    expect(useFloatingSessionStore.getState().open).toBe(false);
  });

  it("工作区门户路由同样互斥", () => {
    pathnameRef.current = "/workspaces/abc/sessions";
    render(wrap(<FloatingSessionHost />));
    expect(screen.queryByTestId("floating-ball")).not.toBeInTheDocument();
  });

  it("全屏按钮携带 ?session= 深链直达当前会话（task-10 用户反馈修复）", async () => {
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().selectSession("s-77");
    });
    const btn = await screen.findByTestId("floating-fullscreen");
    btn.click();
    expect(pushMock).toHaveBeenCalledWith("/sessions?session=s-77");
    pushMock.mockClear();
  });

  // ── 2026-08-25 悬浮球增强 ────────────────────────────────────────────

  // jsdom 无 PointerEvent 构造器，fireEvent.pointerDown(type, init) 的
  // clientX/button/pointerId 会被丢弃——构造 Event 后手动挂属性再派发。
  function pointerEvt(type: string, props: Record<string, unknown>) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, props);
    return ev;
  }

  it("拖拽球到屏幕中部：位置跟手且不吸附", () => {
    render(wrap(<FloatingSessionHost />));
    const ball = screen.getByTestId("floating-ball");
    // jsdom 视口 1024×768；BALL=52 → 默认球心 (978, 722)，left=498-26、top=398-26。
    fireEvent(ball, pointerEvt("pointerdown", { button: 0, pointerId: 1, clientX: 980, clientY: 724 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 1, clientX: 500, clientY: 400 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 1, clientX: 500, clientY: 400 }));
    expect(ball.dataset.dock).toBe("none");
    expect(ball.style.left).toBe("472px"); // 498 - 26
    expect(ball.style.top).toBe("372px"); // 398 - 26
  });

  it("拖拽球贴右缘松手：自动吸附半藏并持久化；吸附后位移不触发开合", () => {
    render(wrap(<FloatingSessionHost />));
    const ball = screen.getByTestId("floating-ball");
    fireEvent(ball, pointerEvt("pointerdown", { button: 0, pointerId: 1, clientX: 980, clientY: 724 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 1, clientX: 1015, clientY: 300 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 1, clientX: 1015, clientY: 300 }));
    // x 钳到 998 ≥ 吸附阈 970 → 右缘半藏（right:-38px 露出 14px）。
    expect(ball.dataset.dock).toBe("right");
    expect(ball.style.right).toBe("-38px");
    // 持久化含吸附态，刷新后可恢复。
    const saved = JSON.parse(window.localStorage.getItem("sillyhub:floating-ball")!);
    expect(saved.dock).toBe("right");
    expect(saved.x).toBe(998); // 1024 - 26
    // 拖拽尾音 click（松手 250ms 内）被抑制：不开抽屉。
    fireEvent.click(ball);
    expect(useFloatingSessionStore.getState().open).toBe(false);
  });

  it("点击抽屉外自动收起；抽屉内部与 portal 白名单点击不收", async () => {
    render(wrap(<FloatingSessionHost />));
    const ball = screen.getByTestId("floating-ball");
    fireEvent.click(ball);
    const drawer = await screen.findByTestId("floating-drawer");
    expect(drawer.dataset.open).toBe("true");

    // 抽屉内部点击：不收。
    fireEvent.pointerDown(drawer);
    expect(useFloatingSessionStore.getState().open).toBe(true);

    // radix/antd 浮层 portal（role=menu 例）：不收。
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    fireEvent.pointerDown(menu);
    expect(useFloatingSessionStore.getState().open).toBe(true);
    menu.remove();

    // 真正的外部点击：closeDrawer（无会话 → 全清，抽屉卸载）。
    fireEvent.pointerDown(document.body);
    expect(useFloatingSessionStore.getState().open).toBe(false);
    expect(screen.queryByTestId("floating-drawer")).not.toBeInTheDocument();
  });

  it("拖拽吸附左缘后：抽屉从左侧滑出（跟随球所在半屏）", async () => {
    render(wrap(<FloatingSessionHost />));
    const ball = screen.getByTestId("floating-ball");
    fireEvent(ball, pointerEvt("pointerdown", { button: 0, pointerId: 1, clientX: 980, clientY: 724 }));
    fireEvent(window, pointerEvt("pointermove", { pointerId: 1, clientX: 10, clientY: 400 }));
    fireEvent(window, pointerEvt("pointerup", { pointerId: 1, clientX: 10, clientY: 400 }));
    expect(ball.dataset.dock).toBe("left");

    act(() => {
      useFloatingSessionStore.getState().openDrawer();
    });
    const drawer = await screen.findByTestId("floating-drawer");
    expect(drawer.dataset.side).toBe("left");
    expect(drawer.className).toContain("left-0");
  });
});

// ── 宠物形象（2026-08-26）：双选 + 本地记忆 + 右键选择器 ────────────────────
describe("FloatingSessionHost / 宠物形象", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认渲染小狗形象", async () => {
    render(wrap(<FloatingSessionHost />));
    const mascot = await screen.findByTestId("floating-mascot");
    expect(mascot.dataset.pet).toBe("dog");
  });

  it("右键球唤起选择器，选小猫后切换并写入 localStorage", async () => {
    render(wrap(<FloatingSessionHost />));
    const ball = await screen.findByTestId("floating-ball");
    fireEvent.contextMenu(ball, { clientX: 300, clientY: 300 });
    const picker = await screen.findByTestId("pet-picker");
    expect(picker).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pet-option-cat"));
    const mascot = await screen.findByTestId("floating-mascot");
    expect(mascot.dataset.pet).toBe("cat");
    expect(window.localStorage.getItem("sillyhub:floating-pet")).toBe("cat");
    expect(screen.queryByTestId("pet-picker")).not.toBeInTheDocument();
  });

  it("挂载时读取本地记忆的选择（cat 持久化恢复）", async () => {
    window.localStorage.setItem("sillyhub:floating-pet", "cat");
    render(wrap(<FloatingSessionHost />));
    const mascot = await screen.findByTestId("floating-mascot");
    expect(mascot.dataset.pet).toBe("cat");
  });

  it("选择器遮罩点击关闭不改动选择", async () => {
    render(wrap(<FloatingSessionHost />));
    const ball = await screen.findByTestId("floating-ball");
    fireEvent.contextMenu(ball, { clientX: 300, clientY: 300 });
    await screen.findByTestId("pet-picker");
    // 遮罩是 picker 前的 fixed inset-0 div；用 Escape 外方式：点击小狗选项保持 dog
    fireEvent.click(screen.getByTestId("pet-option-dog"));
    const mascot = await screen.findByTestId("floating-mascot");
    expect(mascot.dataset.pet).toBe("dog");
    expect(window.localStorage.getItem("sillyhub:floating-pet")).toBe("dog");
  });
});
