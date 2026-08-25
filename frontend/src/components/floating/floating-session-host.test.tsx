/**
 * 悬浮会话宿主测试（task-05 / FR-1~4）。
 *
 * 覆盖三条硬约束：互斥协议（门户路由卸载球+抽屉+落壳态）、最小化保活
 * （抽屉 hidden 不卸载 + 恢复胶囊）、挂载门控（全关无会话只渲染球）。
 * SessionPanel / PreSessionPicker / 数据查询全部 mock——本文件只测壳层。
 */
import { act, render, screen } from "@testing-library/react";
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
  SessionPanel: (props: { sessionId: string | null }) => (
    <div data-testid="mock-session-panel" data-session={props.sessionId ?? "null"}>
      panel
    </div>
  ),
}));

vi.mock("@/components/sessions/pre-session-picker", () => ({
  PreSessionPicker: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-picker">picker</div> : null,
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
    pushMock.mockClear();
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
    await screen.findByTestId("mock-session-panel");
    const s = useFloatingSessionStore.getState();
    expect(s.preContext?.runtimeId).toBe("rt-1");
    expect(s.pageContext).toEqual({ page_key: "ppm_project", project_id: "p-1" });
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
});
