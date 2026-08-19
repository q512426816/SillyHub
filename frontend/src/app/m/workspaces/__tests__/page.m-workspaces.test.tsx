/**
 * app/m/workspaces/page.tsx 移动工作区页 task-08 收口测试
 * （change 2026-08-18-workspace-role-type / design §5.6 / FR-08 / D-006@v1）。
 *
 * 覆盖破坏面收口的两个契约（AC-07 前端面）：
 *  - 类型筛选下拉选项来自 lib/workspace-types 新词表（8 值 + 全部 + 未分类），
 *    不再出现废弃旧值 daemon-client；选「未分类」走 ?unclassified=true 不传 type；
 *  - 创建提交体必含合法 type（移动端不加选择 UI，默认 other）。
 *
 * mock 策略（对齐桌面 workspaces/__tests__/page.test.tsx）：@/lib/* 数据层全 mock、
 * stores/session 固定非管理员、errors/useNotify stub；antd Drawer（MobileDetailSheet）
 * 在 jsdom 正常渲染（setup.ts 已有 matchMedia/ResizeObserver polyfill）。
 * createWorkspace 走真 lib/workspaces 实现 + mock 底层 apiFetch——因为 page 直接
 * import 的就是 createWorkspace 符号，经 apiFetch 断言最终请求体（含 type）更贴近
 * 真实契约；断言后用 waitFor 等 Drawer 关闭。
 */
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacesMobilePage from "@/app/m/workspaces/page";

// ── lib/api mock：apiFetch 捕获请求（method/url/body/query）────────────────
const apiCalls = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    ApiError: actual.ApiError,
    apiFetch: apiCalls.apiFetch,
  };
});

// ── 数据层 hook / 杂项 mock ─────────────────────────────────────────────────
vi.mock("@/lib/workspace-daemon-status", () => ({
  useDaemonStatusMap: () => ({ statusMap: {}, isLoading: false, isError: false }),
}));

const daemonApi = vi.hoisted(() => ({ listDaemonInstances: vi.fn() }));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, listDaemonInstances: daemonApi.listDaemonInstances };
});

const adminApi = vi.hoisted(() => ({ listUsers: vi.fn() }));
vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, listUsers: adminApi.listUsers };
});

vi.mock("@/stores/session", () => ({
  useSession: (
    sel: (_state: { user?: { is_platform_admin?: boolean } }) => unknown,
  ) => sel({ user: { is_platform_admin: false } }),
}));

vi.mock("@/lib/errors", () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
  errMessage: (err: unknown, fallback?: string) =>
    err instanceof Error && err.message ? err.message : (fallback ?? "操作失败"),
}));

// ── fixtures ────────────────────────────────────────────────────────────────

/** apiFetch 按 url+method 路由的默认桩：列表 → 空页；daemon → 空数组。 */
function stubApiFetch() {
  apiCalls.apiFetch.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      if (url === "/api/workspaces" && (!init?.method || init.method === "GET")) {
        return { items: [], total: 0 };
      }
      if (url === "/api/daemon/runtimes" || url === "/api/daemon/instances") {
        return [];
      }
      return { items: [], total: 0 };
    },
  );
}

type FetchCall = [string, { method?: string; query?: Record<string, unknown>; json?: unknown }];

/** 最近一次列表请求（fireEvent 后 reload 重发，取最后一条而非挂载首条）。 */
function lastListCall(): FetchCall | undefined {
  const calls = apiCalls.apiFetch.mock.calls
    .filter((call) => {
      const [url, init] = call as FetchCall;
      return url === "/api/workspaces" && (!init?.method || init.method === "GET");
    })
    .map((call) => call as FetchCall);
  return calls.at(-1);
}

function renderPage() {
  return render(
    <AntApp>
      <WorkspacesMobilePage />
    </AntApp>,
  );
}

beforeEach(() => {
  apiCalls.apiFetch.mockReset();
  stubApiFetch();
  // 创建 Sheet 挂载即拉守护进程实例列表（page.tsx useEffect）——mock 需返回 Promise
  daemonApi.listDaemonInstances.mockReset();
  daemonApi.listDaemonInstances.mockResolvedValue([]);
  adminApi.listUsers.mockReset();
  adminApi.listUsers.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("m/workspaces task-08 破坏面收口", () => {
  it("类型筛选下拉来自新词表：8 值 + 全部/未分类，不出现废弃旧值 daemon-client", async () => {
    renderPage();
    const typeSelect = await screen.findByLabelText("筛选类型");
    expect(typeSelect).toBeInTheDocument();

    const options = Array.from(typeSelect.querySelectorAll("option"));
    const texts = options.map((o) => o.textContent ?? "");

    // 全部 + 8 值中文标签 + 未分类（词表项经 lib/workspace-types 注入）
    expect(texts).toContain("全部类型");
    expect(texts).toContain("前端代码");
    expect(texts).toContain("后端代码");
    expect(texts).toContain("全栈代码");
    expect(texts).toContain("业务文档");
    expect(texts).toContain("子模块");
    expect(texts).toContain("部署运维");
    expect(texts).toContain("设计资产");
    expect(texts).toContain("其他");
    expect(texts).toContain("未分类");
    // 废弃旧值不再作为选项出现（AC-07：筛选请求不传旧值的前置）
    expect(texts).not.toContain("Daemon 客户端");

    const values = options.map((o) => o.getAttribute("value") ?? "");
    expect(values).not.toContain("daemon-client");
  });

  it("选「前端代码」→ listWorkspaces 传 ?type=frontend-code；切回「全部」→ 不传 type/unclassified", async () => {
    renderPage();
    const typeSelect = await screen.findByLabelText("筛选类型");

    // 选具体类型 → type 等值匹配
    fireEvent.change(typeSelect, { target: { value: "frontend-code" } });
    await waitFor(() => {
      expect(lastListCall()?.[1]?.query).toMatchObject({ type: "frontend-code" });
    });
    expect(lastListCall()?.[1]?.query?.unclassified).toBeUndefined();

    // 切回全部 → 两参都不传
    apiCalls.apiFetch.mockClear();
    stubApiFetch();
    fireEvent.change(typeSelect, { target: { value: "" } });
    await waitFor(() => {
      expect(lastListCall()).toBeDefined();
    });
    expect(lastListCall()?.[1]?.query?.type).toBeUndefined();
    expect(lastListCall()?.[1]?.query?.unclassified).toBeUndefined();
  });

  it("选「未分类」→ 走 ?unclassified=true 且不传 type（D-005@v1 互斥语义）", async () => {
    renderPage();
    const typeSelect = await screen.findByLabelText("筛选类型");

    fireEvent.change(typeSelect, { target: { value: "unclassified" } });
    await waitFor(() => {
      expect(lastListCall()?.[1]?.query).toMatchObject({ unclassified: true });
    });
    expect(lastListCall()?.[1]?.query?.type).toBeUndefined();
  });

  it("创建工作区：守护进程+路径齐备提交 → POST 请求体必含 type:'other'（AC-07）", async () => {
    // 创建 Sheet 挂载拉守护进程实例（page useEffect）——给一台在线实例撑起下拉选项
    daemonApi.listDaemonInstances.mockResolvedValue([
      {
        id: "daemon-1",
        hostname: "host-1",
        display_alias: "本机守护",
        status: "online",
        providers: [],
      } as never,
    ]);
    renderPage();
    // 打开创建 Sheet
    fireEvent.click(await screen.findByTestId("mobile-workspace-create"));

    const daemonSelect = await screen.findByLabelText("选择守护进程");
    fireEvent.change(daemonSelect, { target: { value: "daemon-1" } });
    // WorkspacePathPicker 的 Input 无 aria-label，经 placeholder 定位（页面源码
    // 字面量含双反斜杠 → DOM 值为 C:\\path\\to\\repo，String.raw 原样对齐）
    const pathInput = await screen.findByPlaceholderText(String.raw`C:\\path\\to\\repo`);
    fireEvent.change(pathInput, { target: { value: String.raw`C:\repo\demo` } });

    // 提交（MobileDetailSheet 顶栏提交按钮）
    fireEvent.click(screen.getByTestId("mobile-detail-sheet-submit"));

    const findPostCall = (): FetchCall | undefined =>
      apiCalls.apiFetch.mock.calls
        .filter((call) => {
          const [url, init] = call as FetchCall;
          return url === "/api/workspaces" && init?.method === "POST";
        })
        .map((call) => call as FetchCall)
        .at(-1);
    await waitFor(() => {
      expect(findPostCall()).toBeDefined();
    });
    const postCall = findPostCall();
    expect(postCall?.[1]?.json).toMatchObject({
      name: "demo",
      // normalizeClientPath 规范化分隔符（jsdom 值经页面 onChange 链）
      root_path: expect.stringContaining("repo"),
      daemon_id: "daemon-1",
      // task-08 最小收口：移动端不加类型 UI，默认 other（D-006@v1）
      type: "other",
    });
  });
});
