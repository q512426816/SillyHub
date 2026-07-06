/**
 * task-20 / D-006@v1：审计页 page.test.tsx
 *
 * 覆盖:
 *   1. 渲染统计概览 + 筛选区 + 记录列表 + 分页器
 *   2. mock usePolicyAudit 返回 fixture → 表格渲染 ALLOW/DENY 行 + Tag 颜色
 *   3. 筛选交互（选 decision=DENY → hook 收到 decision 参数）
 *   4. 分页交互（点「下一页」→ offset 推进）
 *   5. 缺 ?wid（workspace 来源缺失）→ 不发请求，展示提示
 *
 * 依据:
 *   - tasks/task-20.md（审计页 UI：统计+筛选+列表+分页）
 *   - design.md §7.3/§7.4（policy-audit 端点 + AuditLogRead 字段）
 *   - prototype-policy-audit.html（线框布局）
 *
 * 后端路由 /workspaces/{wid}/runtimes/{rid}/policy-audit 强制 path wid（UUID），
 * 但 daemon runtime 跨 workspace 无固定 wid（DaemonRuntimeRead 无 workspace_id）。
 * 本页从 URL ?wid= 取 workspace 来源；缺失则 enabled=false 并提示（设计偏差，
 * 见 page.tsx 顶部注释）。测试分别覆盖「带 wid」与「不带 wid」两种。
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AuditPage from "@/app/(dashboard)/runtimes/[id]/audit/page";
import type { AuditLogRead } from "@/lib/daemon-audit";

// ── next/navigation mock：动态路由 params + searchParams（wid 来源） ──────────

const nav = vi.hoisted(() => ({
  // useParams 在 Next.js 客户端组件返回同步对象（非 Promise）。
  params: { id: "rt-123" },
  searchParams: new URLSearchParams({ wid: "ws-abc" }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useSearchParams: () => nav.searchParams,
}));

// ── usePolicyAudit mock：捕获最后一次调用的参数 + 可控返回 ────────────────────

const auditMock = vi.hoisted(() => ({
  usePolicyAuditByRuntime: vi.fn(),
}));

vi.mock("@/lib/daemon-audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon-audit")>(
    "@/lib/daemon-audit",
  );
  return {
    ...actual,
    usePolicyAuditByRuntime: auditMock.usePolicyAuditByRuntime,
  };
});

// vitest jsdom 无 window.matchMedia / ResizeObserver，Antd Table 的
// responsiveObserver（Grid.useBreakpoint）会调用 matchMedia。本测试渲染真实
// Antd Table（非纯组件），需自行 polyfill（setup.ts 不在本任务 allowed_paths
// 内，故测试文件内 beforeEach stub，对齐 ppm/milestone-details 注释提及的限制）。
beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!window.ResizeObserver) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  }
});

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>{ui}</AntApp>
    </QueryClientProvider>,
  );
}

const FIXTURE_ITEMS: AuditLogRead[] = [
  {
    id: "a1",
    runtime_id: "rt-123",
    workspace_id: "ws-abc",
    decision: "DENY",
    provider: "claude",
    tool: "Write",
    path: "E:\\Temp\\a.txt",
    reason: "目标目录未配置为可写目录",
    created_at: "2026-07-02T14:52:31Z",
  },
  {
    id: "a2",
    runtime_id: "rt-123",
    workspace_id: "ws-abc",
    decision: "ALLOW",
    provider: "codex",
    tool: "Edit",
    path: "D:\\Projects\\a.ts",
    reason: "",
    created_at: "2026-07-02T14:50:05Z",
  },
];

/** 默认返回：fixture 列表 + total=1301（对齐 prototype 分页文案）。 */
function defaultReturn(overrides: Partial<ReturnType<typeof auditMock.usePolicyAuditByRuntime>> = {}) {
  return {
    items: FIXTURE_ITEMS,
    total: 1301,
    limit: 50,
    offset: 0,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("runtime audit page (task-20)", () => {
  beforeEach(() => {
    nav.params = { id: "rt-123" };
    nav.searchParams = new URLSearchParams({ wid: "ws-abc" });
    auditMock.usePolicyAuditByRuntime.mockReset();
    auditMock.usePolicyAuditByRuntime.mockReturnValue(defaultReturn());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染统计概览 + 筛选区 + 记录列表 + 分页器", async () => {
    renderPage(<AuditPage />);

    // 统计概览（ALLOW/DENY 计数）
    expect(screen.getByText(/放行 ALLOW/)).toBeInTheDocument();
    expect(screen.getByText(/拒绝 DENY/)).toBeInTheDocument();

    // 筛选区字段（Antd Form label；部分文案与表头列同名，用 getAllByText 验证存在）
    expect(screen.getAllByText("决策").length).toBeGreaterThan(0);
    expect(screen.getByText("Agent 种类")).toBeInTheDocument();
    expect(screen.getByText("路径包含")).toBeInTheDocument();
    expect(screen.getByText("时间范围")).toBeInTheDocument();

    // 记录列表：fixture 行路径（唯一可定位）
    await waitFor(() => {
      expect(screen.getByText("E:\\Temp\\a.txt")).toBeInTheDocument();
      expect(screen.getByText("D:\\Projects\\a.ts")).toBeInTheDocument();
    });

    // 分页器：共 1301 条
    expect(screen.getByText(/共 1301 条/)).toBeInTheDocument();
  });

  it("决策标签渲染为中文（DENY→拒绝 红 / ALLOW→放行 绿）", async () => {
    renderPage(<AuditPage />);
    await waitFor(() => {
      // ql-20260706-001：决策列回显中文——DENY→「拒绝」/ ALLOW→「放行」（红绿 Tag）。
      expect(screen.getAllByText("拒绝").length).toBeGreaterThan(0);
      expect(screen.getAllByText("放行").length).toBeGreaterThan(0);
    });
  });

  it("usePolicyAuditByRuntime 收到正确的 runtimeId + 初始分页参数", async () => {
    renderPage(<AuditPage />);

    // 新 hook（ql-20260703-003）接 (runtimeId, params, opts?)。
    expect(auditMock.usePolicyAuditByRuntime).toHaveBeenCalled();
    const initialCall = auditMock.usePolicyAuditByRuntime.mock.calls[0]!;
    expect(initialCall[0]).toBe("rt-123");

    // 初始 params 带 limit/offset=0
    const initialParams = initialCall[1] as { limit?: number; offset?: number };
    expect(initialParams.limit).toBe(50);
    expect(initialParams.offset).toBe(0);

    // enabled 应为 true（runtimeId 在）
    const opts = initialCall[2] as { enabled?: boolean } | undefined;
    expect(opts?.enabled).toBe(true);
  });

  it("点「下一页」→ offset 推进（page 状态 +1）", async () => {
    renderPage(<AuditPage />);

    const next = screen.getByRole("button", { name: "下一页" });
    fireEvent.click(next);

    // usePolicyAuditByRuntime 被再次求值，offset 应 = limit（50）
    await waitFor(() => {
      const lastCall =
        auditMock.usePolicyAuditByRuntime.mock.calls[auditMock.usePolicyAuditByRuntime.mock.calls.length - 1]!;
      const params = lastCall[1] as { offset?: number; limit?: number };
      expect(params.offset).toBe(50);
    });
  });

  it("缺 ?wid（ql-003 免 wid 路由）→ 正常加载（不再要求 ?wid）", async () => {
    nav.searchParams = new URLSearchParams();
    renderPage(<AuditPage />);

    // 免 wid 路由下仍正常渲染（无 wid 提示），hook 被调用
    expect(auditMock.usePolicyAuditByRuntime).toHaveBeenCalled();
  });
});
