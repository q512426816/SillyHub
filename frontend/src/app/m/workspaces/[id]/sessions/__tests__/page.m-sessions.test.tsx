/**
 * task-12 · 会话列表移动页单测（FR-06 / FR-08 / design §5.4 列表页 + 新建两步，
 * change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖任务卡指定契约：
 *  1. 列表装配：MobileWorkspaceHeader tab="sessions" 高亮（aria-selected）+
 *     MobileSessionList 收 workspaceId；onSelect(sid) → push
 *     /m/workspaces/[id]/sessions/[sid]；
 *  2. ＋入口（FAB / 列表空态 onNew）→ PreSessionPicker variant="bottomSheet"
 *     open 且 machines 同源透传（与 SessionPanel 同一 useDaemonMachines 数组）；
 *  3. providers 同 key 同源：["llmProviders","floating-session"] 落缓存 +
 *     staleTime 30s（与悬浮宿主共享缓存零重复请求）；
 *  4. onPick(runtimeId) → 关浮层 + 整页切预会话 SessionPanel（sessionId=null +
 *     preContext={workspaceId, runtimeId} 对齐 sessions-portal.tsx:369 语义 +
 *     variant="mobile"），列表隐藏；
 *  5. 返回列表入口：清 preContext 回列表视图；
 *  6. onPreSessionCreated（对齐门户 :396-405）：清态 + router.replace 到真会话
 *     钻取路由 + invalidateQueries(["agentSessions"])。
 *
 * mock 范式对齐 page.test.tsx（changes 移动页）：W1/W2 子组件（MobileSessionList /
 * PreSessionPicker / SessionPanel）stub 化透传 props 断言（本页契约是装配接线，
 * 子组件行为归各自 colocate 测试）；MobileWorkspaceHeader 用真实组件（断言
 * tab 装配与 onTabChange/onBack 路由）；真实 QueryClient（断言缓存落键）；
 * next/navigation mock useRouter/useParams。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── next/navigation mock：useRouter push/replace + useParams id ──────────────
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: { id: "ws-1" } as { id: string },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

// ── W1/W2 子组件 stub：捕获 props + 触发回调按钮（装配契约归本测试）──────────
const listStub = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/mobile/mobile-session-list", () => ({
  MobileSessionList: (props: Record<string, unknown>) => {
    listStub.props = props;
    return (
      <div data-testid="mobile-session-list-stub">
        <button
          type="button"
          data-testid="stub-session-select"
          onClick={() => (props.onSelect as (sid: string) => void)("s-9")}
        >
          选择会话
        </button>
        <button
          type="button"
          data-testid="stub-session-new"
          onClick={() => (props.onNew as () => void)()}
        >
          列表新建
        </button>
      </div>
    );
  },
}));

const pickerStub = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/sessions/pre-session-picker", () => ({
  PreSessionPicker: (props: Record<string, unknown>) => {
    pickerStub.props = props;
    return (
      <div
        data-testid="pre-picker-stub"
        data-open={String(props.open)}
        data-variant={String(props.variant)}
      >
        <button
          type="button"
          data-testid="stub-picker-pick"
          onClick={() => (props.onPick as (rt: string) => void)("rt-1")}
        >
          选定智能体
        </button>
        <button
          type="button"
          data-testid="stub-picker-cancel"
          onClick={() => (props.onCancel as () => void)()}
        >
          取消
        </button>
      </div>
    );
  },
}));

const panelStub = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/daemon/session-panel", () => ({
  SessionPanel: (props: Record<string, unknown>) => {
    panelStub.props = props;
    return (
      <div data-testid="session-panel-stub">
        <button
          type="button"
          data-testid="stub-pre-created"
          onClick={() =>
            (props.onPreSessionCreated as (r: { session_id: string }) => void)({
              session_id: "s-new",
            })
          }
        >
          首句创建成功
        </button>
      </div>
    );
  },
}));

// ── 数据层 mock：useDaemonMachines 整体受控 + listProviders 部分替换 ──────────
const MACHINES = vi.hoisted(() => [
  {
    id: "m-1",
    hostname: "QINYI-DESKTOP",
    display_alias: null,
    status: "online",
    runtimes: [],
  },
] as unknown as import("@/lib/daemon").DaemonMachineRead[]);

const machinesHook = vi.hoisted(() => ({ useDaemonMachines: vi.fn() }));
vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: machinesHook.useDaemonMachines,
}));

const providersApi = vi.hoisted(() => ({ listProviders: vi.fn() }));
vi.mock("@/lib/api/llm-providers", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/llm-providers")>(
      "@/lib/api/llm-providers",
    );
  return { ...actual, listProviders: providersApi.listProviders };
});

import MobileSessionsPage from "@/app/m/workspaces/[id]/sessions/page";
import { MobileWorkspaceContext } from "@/app/m/workspaces/[id]/layout";
import type { Workspace } from "@/lib/workspaces";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeWorkspace(id = "ws-1"): Workspace {
  return {
    id,
    name: `workspace-${id}`,
    slug: `workspace-${id}`,
    root_path: "C:/proj",
    status: "active",
    default_agent: null,
    default_model: null,
    owner: { user_id: "user-1", email: "owner@test.com", display_name: "Owner" },
    created_at: "2026-06-30T00:55:11Z",
    last_scanned_at: "2026-06-30T00:55:11Z",
  } as unknown as Workspace;
}

function makeProvider(id = "p-1"): LlmProviderRead {
  return {
    id,
    user_id: "u-1",
    name: `provider-${id}`,
    agent_kind: "claude",
    base_url: null,
    model: null,
    notes: null,
    website_url: null,
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    api_format: "anthropic",
    model_role_mappings: null,
    default_fallback_model: null,
    extra_env: null,
    is_default: true,
    multimodal: "auto",
    api_key_masked: "sk-1...abcd",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  } as unknown as LlmProviderRead;
}

describe("m/workspaces/[id]/sessions 会话列表移动页", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    machinesHook.useDaemonMachines.mockReturnValue({
      items: MACHINES,
      // 页面透传给 picker/面板的 machines 取自 machineCandidates（task-10 融合候选），
      // mock 需与 items 同源注入，否则透传空数组。
      sharedToMe: [],
      machineCandidates: MACHINES,
      total: MACHINES.length,
      sessions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    providersApi.listProviders.mockResolvedValue([makeProvider()]);
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.params = { id: "ws-1" };
    listStub.props = null;
    pickerStub.props = null;
    panelStub.props = null;
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  // workspace=null 显式表示「预取未完成」（context 值 undefined）；缺省给完整工作区。
  function renderPage(workspace: Workspace | null = makeWorkspace()) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceContext.Provider
          value={{
            workspaceId: "ws-1",
            workspace: workspace ?? undefined,
            isLoading: workspace === null,
            error: null,
          }}
        >
          <MobileSessionsPage />
        </MobileWorkspaceContext.Provider>
      </QueryClientProvider>,
    );
  }

  it("列表装配：header tab=sessions 高亮 + MobileSessionList 收 workspaceId；onSelect 钻取真会话路由", async () => {
    renderPage();
    // 真实 MobileWorkspaceHeader：会话 Tab 高亮（task-04 契约装配）
    expect(
      screen.getByTestId("mobile-workspace-header-tab-sessions"),
    ).toHaveAttribute("aria-selected", "true");
    expect(listStub.props?.workspaceId).toBe("ws-1");
    fireEvent.click(screen.getByTestId("stub-session-select"));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/sessions/s-9");
  });

  it("顶栏接线：切「变更中心」push 对应路由；返回 push /m/workspaces；预取未完成渲染占位", () => {
    const { unmount } = renderPage();
    fireEvent.click(screen.getByTestId("mobile-workspace-header-tab-changes"));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces/ws-1/changes");
    fireEvent.click(screen.getByTestId("mobile-workspace-header-back"));
    expect(nav.push).toHaveBeenCalledWith("/m/workspaces");
    // workspace 未就绪 → 轻量占位不阻塞列表渲染（先卸载首棵树避免双容器干扰）
    unmount();
    renderPage(null);
    expect(screen.getByTestId("m-sessions-header-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-session-list-stub")).toBeInTheDocument();
  });

  it("＋入口（FAB / 列表空态 onNew）→ PreSessionPicker bottomSheet 打开且 machines 同源透传", async () => {
    renderPage();
    // 初始关闭
    await waitFor(() => {
      expect(pickerStub.props?.open).toBe(false);
    });
    expect(pickerStub.props?.variant).toBe("bottomSheet");
    // FAB ＋ → 打开
    fireEvent.click(screen.getByTestId("m-sessions-fab"));
    expect(pickerStub.props?.open).toBe(true);
    // machines 与 useDaemonMachines 返回同引用（同源不复制）
    expect(pickerStub.props?.machines).toBe(MACHINES);
    // 取消 → 关闭
    fireEvent.click(screen.getByTestId("stub-picker-cancel"));
    expect(pickerStub.props?.open).toBe(false);
    // 列表空态 onNew 接线（MobileSessionList 契约入口）→ 同样打开
    fireEvent.click(screen.getByTestId("stub-session-new"));
    expect(pickerStub.props?.open).toBe(true);
  });

  it("providers 同 key 同源：[llmProviders, floating-session] 落缓存 + staleTime 30s", async () => {
    renderPage();
    await waitFor(() => {
      expect(providersApi.listProviders).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData(["llmProviders", "floating-session"]),
      ).toEqual([makeProvider()]);
    });
    const entry = queryClient
      .getQueryCache()
      .find({ queryKey: ["llmProviders", "floating-session"] });
    // QueryOptions 泛型收窄后不含 staleTime 字段，按运行时实际形状取值断言
    // （对齐 changes 移动页测试 refetchInterval 同款处理）。
    const options = entry?.options as unknown as { staleTime?: number };
    expect(options.staleTime).toBe(30_000);
  });

  it("onPick → 关浮层 + 整页切预会话 SessionPanel（sessionId=null + preContext 门户语义 + variant=mobile），列表隐藏", async () => {
    renderPage();
    // providers 查询异步落缓存后再进预会话（llmProviders 透传断言需数据就绪）
    await waitFor(() => {
      expect(providersApi.listProviders).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId("m-sessions-fab"));
    fireEvent.click(screen.getByTestId("stub-picker-pick"));
    // 预会话视图接管：SessionPanel 挂载、列表与浮层卸载
    expect(screen.getByTestId("session-panel-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-session-list-stub"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("pre-picker-stub")).not.toBeInTheDocument();
    // 透传契约（对齐 sessions-portal.tsx:369 workspace 入口语义 + 第四宿主形态）
    expect(panelStub.props?.mode).toBe("page");
    expect(panelStub.props?.variant).toBe("mobile");
    expect(panelStub.props?.sessionId).toBeNull();
    expect(panelStub.props?.preContext).toEqual({
      workspaceId: "ws-1",
      runtimeId: "rt-1",
    });
    expect(panelStub.props?.machines).toBe(MACHINES);
    await waitFor(() => {
      expect(panelStub.props?.llmProviders).toEqual([makeProvider()]);
    });
    expect(panelStub.props?.onPreSessionCreated).toBeTypeOf("function");
  });

  it("返回列表入口：预会话视图清 preContext 回列表", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("m-sessions-fab"));
    fireEvent.click(screen.getByTestId("stub-picker-pick"));
    expect(screen.getByTestId("m-sessions-pre-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("m-sessions-pre-back"));
    expect(screen.queryByTestId("m-sessions-pre-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-session-list-stub")).toBeInTheDocument();
  });

  it("onPreSessionCreated（门户 :396-405 语义）：清态 + replace 真会话路由 + invalidate [agentSessions]", async () => {
    renderPage();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByTestId("m-sessions-fab"));
    fireEvent.click(screen.getByTestId("stub-picker-pick"));
    fireEvent.click(screen.getByTestId("stub-pre-created"));
    expect(nav.replace).toHaveBeenCalledWith(
      "/m/workspaces/ws-1/sessions/s-new",
    );
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agentSessions"],
      });
    });
    // 清态：回列表视图（replace 后真实路由由 [sid] 页接管，此处断言页内态已清）
    expect(screen.getByTestId("mobile-session-list-stub")).toBeInTheDocument();
  });
});
