/**
 * task-15 · 会话对话移动页单测（FR-07 / FR-09 / design §5.4 对话页，
 * change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖任务卡指定契约（mock SessionPanel 桩，透传 props 断言）：
 *  1. 透传 props：key 由 sid 变化重挂载佐证（key 不在 props 上，以挂载日志
 *     证明）、sessionId=sid、mode="page"、variant="mobile"、machines 与
 *     useDaemonMachines 同引用透传、llmProviders 数据解析、
 *     onSessionListRefresh 可调且 invalidate ["agentSessions"]；
 *  2. 页面级数据同源（对齐 floating-session-host.tsx:86-96）：
 *     useDaemonMachines({limit:100}) 调用形态 + providers query key 逐字为
 *     ["llmProviders","floating-session"] 且 staleTime 30s（与悬浮宿主同 key
 *     共享缓存零重复请求）；
 *  3. sid 变化（路由参数变化）→ 桩重挂载（key={sid} 契约：SSE/队列状态机
 *     干净重建）。
 *
 * mock 范式对齐 page.m-sessions.test.tsx（同变更 task-12）：SessionPanel 桩
 * 记录 props + 每次挂载 push sessionId；@/lib/use-daemon-machines 整体受控、
 * @/lib/api/llm-providers 部分替换（保留 actual）；真实 QueryClient（断言缓存
 * 落键）；next/navigation mock useParams（可变 holder 支撑 sid 变化 rerender）。
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── next/navigation mock：useParams 可变 holder（sid 变化 rerender 用） ───────
const nav = vi.hoisted(() => ({
  params: { id: "ws-1", sid: "s-1" } as { id: string; sid: string },
}));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
}));

// ── SessionPanel 桩：捕获 props + 挂载日志（key={sid} 重挂载断言佐证） ────────
const panelStub = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  mounts: [] as (string | null)[],
}));
vi.mock("@/components/daemon/session-panel", () => ({
  SessionPanel: (props: Record<string, unknown>) => {
    panelStub.props = props;
    panelStub.mounts.push(props.sessionId as string | null);
    return (
      <div data-testid="session-panel-stub" data-sid={String(props.sessionId)} />
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

import MobileSessionChatPage from "@/app/m/workspaces/[id]/sessions/[sid]/page";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

// ── fixtures ────────────────────────────────────────────────────────────────

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

describe("m/workspaces/[id]/sessions/[sid] 会话对话移动页（SessionPanel 第四宿主）", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    machinesHook.useDaemonMachines.mockReturnValue({
      items: MACHINES,
      // 页面透传给面板的 machines 取自 machineCandidates（task-10 融合候选），
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
    nav.params = { id: "ws-1", sid: "s-1" };
    panelStub.props = null;
    panelStub.mounts = [];
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  /** 每次构造新元素（rerender 传相同元素引用会被 React bailout 跳过重渲染）。 */
  function makeView() {
    return (
      <QueryClientProvider client={queryClient}>
        <MobileSessionChatPage />
      </QueryClientProvider>
    );
  }

  function renderPage() {
    return { ...render(makeView()) };
  }

  it("透传 props：sessionId/mode/variant/machines/llmProviders/onSessionListRefresh（对齐 floating-session-host.tsx:307-315 调用形态）", async () => {
    renderPage();
    expect(screen.getByTestId("m-session-chat-page")).toBeInTheDocument();
    expect(screen.getByTestId("session-panel-stub")).toHaveAttribute(
      "data-sid",
      "s-1",
    );
    expect(panelStub.props?.mode).toBe("page");
    expect(panelStub.props?.variant).toBe("mobile");
    expect(panelStub.props?.sessionId).toBe("s-1");
    // machines 与 useDaemonMachines 返回同引用（同源不复制）
    expect(panelStub.props?.machines).toBe(MACHINES);
    await waitFor(() => {
      expect(panelStub.props?.llmProviders).toEqual([makeProvider()]);
    });
    // onSessionListRefresh 可调：invalidate ["agentSessions"]（与悬浮宿主同前缀）
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    expect(panelStub.props?.onSessionListRefresh).toBeTypeOf("function");
    await act(async () => {
      (panelStub.props?.onSessionListRefresh as () => void)();
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agentSessions"],
      });
    });
  });

  it("页面级数据同源：useDaemonMachines({limit:100}) + providers 同 key [llmProviders, floating-session] 落缓存 + staleTime 30s", async () => {
    renderPage();
    expect(machinesHook.useDaemonMachines).toHaveBeenCalledWith({
      limit: 100,
    });
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

  it("sid 变化（路由参数变化）→ key={sid} 触发桩重挂载，sessionId 更新", () => {
    const { rerender } = renderPage();
    expect(panelStub.mounts).toEqual(["s-1"]);
    // 路由参数换 sid：key 变化 → 卸载旧桩重挂新桩（SSE/队列干净重建契约）
    nav.params = { id: "ws-1", sid: "s-2" };
    rerender(makeView());
    expect(panelStub.mounts).toEqual(["s-1", "s-2"]);
    expect(panelStub.props?.sessionId).toBe("s-2");
    expect(screen.getByTestId("session-panel-stub")).toHaveAttribute(
      "data-sid",
      "s-2",
    );
  });
});
