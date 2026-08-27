/**
 * app/m/workspaces/[id] 段骨架单测（task-02 / FR-02 / D-004@V1，
 * change 2026-08-26-mobile-workspace-page）。
 *
 * 覆盖两个契约：
 *  1. layout（工作区上下文 Provider）：
 *     - useQuery 预取 getWorkspace(id)，queryKey 逐字为桌面既有三段形态
 *       ["workspaces", "detail", id]（对齐 (dashboard)/workspaces/[id]/git-log/
 *       page.tsx:64 共享缓存，缓存落键即证 key 形态）；
 *     - 子组件经 useMobileWorkspace() 取到 workspaceId 与解析后的 Workspace；
 *     - 预取失败不阻塞子页渲染（children 无条件直出，error 透传 context）。
 *  2. page（主页薄壳 redirect）：useEffect 内 router.replace 到
 *     /m/workspaces/[id]/changes（client redirect 对齐 m/login / m/account 形态）。
 *
 * mock 策略（对齐 (dashboard)/workspaces/[id]/page.test.tsx）：@/lib/workspaces
 * 保留 actual、仅替换 getWorkspace；next/navigation mock useRouter（replace spy）；
 * react-query 用真实 QueryClient（断言缓存落键需要真实缓存）。
 */
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── next/navigation mock：useRouter 提供 replace spy ─────────────────────────
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

// ── @/lib/workspaces mock：保留 actual，仅替换 getWorkspace ───────────────────
const workspacesApi = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, getWorkspace: workspacesApi.getWorkspace };
});

import {
  useMobileWorkspace,
  default as MobileWorkspaceLayout,
} from "@/app/m/workspaces/[id]/layout";
import MobileWorkspaceHomePage from "@/app/m/workspaces/[id]/page";
import type { Workspace } from "@/lib/workspaces";

// ── fixtures ────────────────────────────────────────────────────────────────

/** 最小 WorkspaceRead fixture（对齐桌面 [id]/page.test.tsx makeWorkspace）。 */
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

/** 消费 useMobileWorkspace 的探针子组件（锚点暴露 context 全字段）。 */
function ContextProbe() {
  const { workspaceId, workspace, isLoading, error } = useMobileWorkspace();
  return (
    <div>
      <span data-testid="ctx-workspace-id">{workspaceId}</span>
      <span data-testid="ctx-workspace-name">{workspace?.name ?? "<none>"}</span>
      <span data-testid="ctx-is-loading">{String(isLoading)}</span>
      <span data-testid="ctx-error">{error?.message ?? "<none>"}</span>
    </div>
  );
}

describe("m/workspaces/[id] layout 工作区上下文 Provider", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    workspacesApi.getWorkspace.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  function renderLayout(id: string, children?: ReactNode) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceLayout params={{ id }}>
          {children ?? <ContextProbe />}
        </MobileWorkspaceLayout>
      </QueryClientProvider>,
    );
  }

  it("经 getWorkspace(id) 预取且缓存落桌面三段键 [workspaces, detail, id]（共享缓存）", async () => {
    const ws = makeWorkspace("ws-1");
    workspacesApi.getWorkspace.mockResolvedValue(ws);
    renderLayout("ws-1");

    await waitFor(() => {
      expect(workspacesApi.getWorkspace).toHaveBeenCalledWith("ws-1");
    });
    // queryKey 逐字三段形态：数据落在这个键下才取得到（错键取 null 即失败）
    await waitFor(() => {
      expect(queryClient.getQueryData(["workspaces", "detail", "ws-1"])).toBe(
        ws,
      );
    });
  });

  it("子组件经 useMobileWorkspace() 取到 workspaceId 与解析后的 Workspace", async () => {
    workspacesApi.getWorkspace.mockResolvedValue(makeWorkspace("ws-1"));
    renderLayout("ws-1");

    expect(screen.getByTestId("ctx-workspace-id").textContent).toBe("ws-1");
    await waitFor(() => {
      expect(screen.getByTestId("ctx-workspace-name").textContent).toBe(
        "workspace-ws-1",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("ctx-is-loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("ctx-error").textContent).toBe("<none>");
  });

  it("预取失败不阻塞子页渲染：children 直出，error 透传 context、workspace 降级 undefined", async () => {
    workspacesApi.getWorkspace.mockRejectedValue(new Error("加载失败"));
    renderLayout("ws-1");

    // 子组件始终渲染（workspaceId 即时可见）
    expect(screen.getByTestId("ctx-workspace-id").textContent).toBe("ws-1");
    await waitFor(() => {
      expect(screen.getByTestId("ctx-error").textContent).toBe("加载失败");
    });
    await waitFor(() => {
      expect(screen.getByTestId("ctx-workspace-name").textContent).toBe(
        "<none>",
      );
    });
  });
});

describe("m/workspaces/[id] page 主页薄壳 redirect（D-004）", () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.push.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("挂载即 router.replace 到 /m/workspaces/ws-1/changes 且渲染 null", async () => {
    const { container } = render(
      createElement(MobileWorkspaceHomePage, { params: { id: "ws-1" } }),
    );
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/m/workspaces/ws-1/changes");
    });
    // 薄壳零 UI：渲染 null
    expect(container.innerHTML).toBe("");
  });

  it("id 透传进目标：/m/workspaces/ws-2/changes（不写死 ws-1）", async () => {
    render(
      createElement(MobileWorkspaceHomePage, { params: { id: "ws-2" } }),
    );
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/m/workspaces/ws-2/changes");
    });
  });
});
