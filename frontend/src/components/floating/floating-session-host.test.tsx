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

vi.mock("@/components/daemon/session-panel", () => ({
  // task-12：透出收到的 preContext.pageContext——创建轮上下文是否真正送达
  // 面板（用户实测反馈③：UI 新建会话恒不注入的根因即此 props 断链）。
  // task-10（2026-08-28-daemon-agent-share）：追加透出收到的 machines 候选
  // ids——共享机器是否并入 SessionPanel 机器候选的断言锚点。
  SessionPanel: (props: {
    sessionId: string | null;
    preContext?: { pageContext?: unknown } | null;
    machines?: { id: string }[];
  }) => (
    <div
      data-testid="mock-session-panel"
      data-session={props.sessionId ?? "null"}
      data-pagectx={JSON.stringify(props.preContext?.pageContext ?? null)}
      data-machines={JSON.stringify((props.machines ?? []).map((m) => m.id))}
    >
      panel
    </div>
  ),
}));

// task-10：透出收到的 machines 候选 ids——共享机器是否并入 picker 候选的
// 断言锚点（本文件不测 picker 内部渲染，那是 pre-session-picker 自身职责）。
vi.mock("@/components/sessions/pre-session-picker", () => ({
  PreSessionPicker: ({
    open,
    machines,
  }: {
    open: boolean;
    machines?: { id: string }[];
  }) =>
    open ? (
      <div
        data-testid="mock-picker"
        data-machines={JSON.stringify((machines ?? []).map((m) => m.id))}
      >
        picker
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
// task-10（2026-08-28-daemon-agent-share）：机器候选融合透传（默认=自有机器，
// 单测内按需注入共享条目）。
const machineCandidatesRef = { current: null as never[] | null };

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => ({
    items: machinesRef.current,
    machineCandidates:
      machineCandidatesRef.current ?? machinesRef.current,
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
    machinesLoadingRef.current = false;
    machineCandidatesRef.current = null;
    // task-10 用例会改写 machinesRef（清空 runtime 模拟兜底浮层路径）——
    // 此处恢复默认形态，防跨用例泄漏。
    machinesRef.current = [
      {
        id: "m-1",
        status: "online",
        runtimes: [{ id: "rt-1", status: "online", provider: "claude" }],
      },
    ] as never[];
    pushMock.mockClear();
    window.localStorage.clear();
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

  // ── task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2）────────────
  // 共享机器并入机器候选（显示层）；回退链默认解析仍只认自有机器（零改动红线）。

  it("task-10：共享机器并入 SessionPanel 机器候选；默认解析回退链仍只认自有机器（D-004@v2）", async () => {
    // 融合候选：自有 m-1（在线 claude）+ 共享 m-s（在线，无 runtime 明细，带
    // sharedMeta 标识元数据——显示名含「共享 + 共享人」标注）。
    machineCandidatesRef.current = [
      {
        id: "m-1",
        status: "online",
        runtimes: [{ id: "rt-1", status: "online", provider: "claude" }],
      },
      {
        id: "m-s",
        status: "online",
        hostname: "lender-mac",
        display_alias: "lender-mac · 张三 共享",
        runtimes: [],
        sharedMeta: { lenderDisplayName: "张三", sourceWorkspaceId: null },
      },
    ] as never[];
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().requestNewSession(null);
    });
    // 回退链零改动：默认解析命中自有 m-1 的 rt-1（claude），不落共享机器
    //（共享机器由用户在 picker 里显式选择，D-004@v2 不做自动回退）。
    await waitFor(() => {
      expect(useFloatingSessionStore.getState().preContext?.runtimeId).toBe("rt-1");
    });
    // SessionPanel 机器候选 = 自有 + 共享（共享条目随候选透出）。
    const panel = await screen.findByTestId("mock-session-panel");
    expect(JSON.parse(panel.dataset.machines ?? "[]")).toEqual(["m-1", "m-s"]);
  });

  it("task-10：兜底两步浮层机器候选同样含共享机器（共享条目可见可选）", async () => {
    // 自有机器无可会话 runtime → 回退链落 picker 兜底；候选仍含共享机器。
    machinesRef.current = [
      { id: "m-1", status: "online", runtimes: [] },
    ] as never[];
    machineCandidatesRef.current = [
      { id: "m-1", status: "online", runtimes: [] },
      {
        id: "m-s",
        status: "online",
        hostname: "lender-mac",
        display_alias: "lender-mac · 张三 共享",
        runtimes: [],
        sharedMeta: { lenderDisplayName: "张三", sourceWorkspaceId: null },
      },
    ] as never[];
    render(wrap(<FloatingSessionHost />));
    act(() => {
      useFloatingSessionStore.getState().openDrawer();
    });
    // 空态点「新会话」→ 默认解析未命中（无在线 claude/codex runtime）→ picker。
    const btn = await screen.findByRole("button", { name: /新会话/ });
    btn.click();
    const picker = await screen.findByTestId("mock-picker");
    expect(JSON.parse(picker.dataset.machines ?? "[]")).toEqual(["m-1", "m-s"]);
    // 未自动进预会话（无自有 runtime 可解析，也不拿共享机器顶替）。
    expect(useFloatingSessionStore.getState().preContext).toBeNull();
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
