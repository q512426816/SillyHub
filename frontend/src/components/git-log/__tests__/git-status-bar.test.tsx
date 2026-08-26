/**
 * task-03：Git 状态条组件测试（full/compact 双形态 / fetch 降级 / 边界形态 /
 * staleTime 双实例单请求 / 主题色板）。
 *
 * 覆盖（tasks/task-03.md acceptance + design §5.4/§5.5）：
 * 1. full 形态全要素渲染（分支徽标⎇/upstream 跟踪/↑N 未推送/↓N 远程新提交/
 *    改动 +A/−D（N 文件）/未跟踪/已同步·HH:MM，原型①）；
 * 2. compact 形态只渲染分支/↑↓/+−（upstream/同步时刻不出条，原型②）；
 * 3. fetch 失败降级：full 黄条「无法连接远程，显示上次同步数据」+ behind 数字
 *    隐藏（原型③）；compact「⚠」；no_remote 单独文案；
 * 4. 边界形态：无 upstream 无 ↑↓ / detached 短哈希+提示 / 空仓库轻提示 /
 *    no_git 渲染 null / 加载骨架文案；
 * 5. 双实例同屏（full + compact 同 workspaceId）apiFetch 只调 1 次——
 *    useGitLogStatus staleTime 60s 两页共享缓存（D-003，mock 计数断言）；
 * 6. statusBarPalette 主题消费链（对齐 commit-graph lanePalette 断言形态）：
 *    三主题取 themes.ts 语义系原值 / dark 提亮档不同 / 容器注入 --sb-* 随
 *    主题切换即时换值。
 *
 * mock 策略：不 mock @/lib/git-log（真实 useGitLogStatus + react-query 缓存，
 * 单请求断言才有意义），仅 mock @/lib/api 的 apiFetch（ApiError 等 actual 透传）。
 *
 * 依据：tasks/task-03.md、design.md §5.3（响应字段）/ §5.4 / §5.5、
 *       prototype-git-status-bar.html（五形态双主题）。
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  GitStatusBar,
  statusBarPalette,
} from "@/components/git-log/git-status-bar";
import type { GitLogStatusResponse } from "@/lib/git-log";
import { useThemeStore } from "@/stores/theme";
import { themes } from "@/styles/themes";

// ── mock @/lib/api：只换 apiFetch（status 请求计数 = mock 计数）──────────

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// ── fixture（design §5.3 全字段）────────────────────────────────────────

function makeStatus(
  overrides: Partial<GitLogStatusResponse> = {},
): GitLogStatusResponse {
  return {
    git_mode: "git",
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
    dirty: {
      files_changed: 8,
      additions: 45,
      deletions: 12,
      untracked_count: 3,
    },
    head_short: "8a29e78a",
    empty: false,
    fetch: { performed: true, error: null },
    synced_at: "2026-08-26T00:31:00Z",
    ...overrides,
  };
}

function renderBar(variant: "full" | "compact") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GitStatusBar workspaceId="ws-1" variant={variant} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 主题 store 复位默认（ai-native），避免用例间主题串扰（commit-graph 先例）
  act(() => {
    useThemeStore.getState().setTheme("ai-native");
  });
});

afterEach(() => {
  cleanup();
});

// ── 1. full 形态全要素（原型①常态）──────────────────────────────────────

describe("GitStatusBar full 形态渲染", () => {
  it("分支/跟踪/↑↓/改动 ±行数（N 文件）/未跟踪/同步时刻全要素", async () => {
    apiFetchMock.mockResolvedValue(makeStatus());
    renderBar("full");

    const bar = await screen.findByTestId("git-status-bar");
    expect(bar).toHaveAttribute("data-variant", "full");
    expect(bar).toHaveAttribute("role", "status");

    // 分支徽标（brand 阶）+ upstream 跟踪名
    expect(screen.getByTestId("git-status-bar-branch")).toHaveTextContent(
      "⎇ main",
    );
    expect(screen.getByTestId("git-status-bar-upstream")).toHaveTextContent(
      "跟踪 origin/main",
    );
    // ↑N 未推送 / ↓N 远程新提交
    expect(screen.getByTestId("git-status-bar-ahead")).toHaveTextContent(
      "↑ 2 未推送",
    );
    expect(screen.getByTestId("git-status-bar-behind")).toHaveTextContent(
      "↓ 1 远程新提交",
    );
    // 改动 +A/−D（N 个文件） + 未跟踪
    const dirty = screen.getByTestId("git-status-bar-dirty");
    expect(dirty).toHaveTextContent("改动");
    expect(dirty).toHaveTextContent("+45");
    expect(dirty).toHaveTextContent("−12");
    expect(dirty).toHaveTextContent("（8 个文件）");
    expect(screen.getByTestId("git-status-bar-untracked")).toHaveTextContent(
      "未跟踪 3",
    );
    // 同步时刻（本地时区 HH:MM，正则断言免时区耦合）
    expect(
      screen.getByTestId("git-status-bar-sync").textContent,
    ).toMatch(/^↻ 已同步远程 · \d{2}:\d{2}$/);
    // 常态无黄条
    expect(
      screen.queryByTestId("git-status-bar-fetch-warn"),
    ).not.toBeInTheDocument();
  });

  it("加载中骨架文案（页面首渲不等 status，R-01）", async () => {
    // 永不 resolve：停在 isPending 骨架态
    apiFetchMock.mockReturnValue(new Promise(() => {}));
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-loading"),
    ).toHaveTextContent("Git 状态加载中…");
    expect(screen.queryByTestId("git-status-bar")).not.toBeInTheDocument();
  });
});

// ── 2. compact 形态（原型②：只分支/↑↓/+−，其余进 Tooltip）──────────────

describe("GitStatusBar compact 形态渲染", () => {
  it("只渲染分支/↑2/↓1/+45/−12，upstream 与同步时刻不出条", async () => {
    apiFetchMock.mockResolvedValue(makeStatus());
    renderBar("compact");

    const bar = await screen.findByTestId("git-status-bar");
    expect(bar).toHaveAttribute("data-variant", "compact");
    expect(screen.getByTestId("git-status-bar-branch")).toHaveTextContent(
      "⎇ main",
    );
    expect(screen.getByTestId("git-status-bar-ahead")).toHaveTextContent("↑2");
    expect(screen.getByTestId("git-status-bar-behind")).toHaveTextContent("↓1");
    const dirty = screen.getByTestId("git-status-bar-dirty");
    expect(dirty).toHaveTextContent("+45");
    expect(dirty).toHaveTextContent("−12");

    // full 独有要素不进紧凑条（细节归 Tooltip）
    expect(
      screen.queryByTestId("git-status-bar-upstream"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("git-status-bar-sync")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("git-status-bar-untracked"),
    ).not.toBeInTheDocument();
  });
});

// ── 3. fetch 失败降级（原型③：黄条 + behind 隐藏）───────────────────────

describe("GitStatusBar fetch 失败降级", () => {
  it("full：黄条「无法连接远程，显示上次同步数据」，behind stale 数字隐藏", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({
        behind: 1, // stale 值仍在，但降级态不展示
        fetch: { performed: false, error: "fetch_failed" },
      }),
    );
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-fetch-warn"),
    ).toHaveTextContent("⚠ 无法连接远程，显示上次同步数据");
    // behind 隐藏（R-03：stale 数字误导）；其余字段照常（ahead 仍在）
    expect(screen.queryByTestId("git-status-bar-behind")).not.toBeInTheDocument();
    expect(screen.getByTestId("git-status-bar-ahead")).toHaveTextContent(
      "↑ 2 未推送",
    );
    expect(screen.getByTestId("git-status-bar-dirty")).toHaveTextContent("+45");
    // fetch 未成功 → 不显示同步时刻
    expect(screen.queryByTestId("git-status-bar-sync")).not.toBeInTheDocument();
  });

  it("compact：降级「⚠」图标（细节文案进 aria-label/Tooltip）", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({ fetch: { performed: false, error: "fetch_timeout" } }),
    );
    renderBar("compact");

    const warn = await screen.findByTestId("git-status-bar-fetch-warn");
    expect(warn).toHaveTextContent("⚠");
    expect(warn).toHaveAttribute(
      "aria-label",
      "无法连接远程，显示上次同步数据",
    );
  });

  it("no_remote 单独文案「未配置远程仓库，跳过同步」", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({ fetch: { performed: false, error: "no_remote" } }),
    );
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-fetch-warn"),
    ).toHaveTextContent("未配置远程仓库，跳过同步");
  });
});

// ── 4. 边界形态（原型④/⑤ + design §5.4）────────────────────────────────

describe("GitStatusBar 边界形态", () => {
  it("无 upstream：提示「未设置远程跟踪」，无 ↑↓", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({ upstream: null, ahead: null, behind: null }),
    );
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-upstream"),
    ).toHaveTextContent("未设置远程跟踪（无 ↑↓）");
    expect(screen.queryByTestId("git-status-bar-ahead")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("git-status-bar-behind"),
    ).not.toBeInTheDocument();
  });

  it("detached HEAD：分支位显示短哈希 + 提示", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({
        branch: "8a29e78",
        detached: true,
        upstream: null,
        ahead: null,
        behind: null,
      }),
    );
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-branch"),
    ).toHaveTextContent("⎇ 8a29e78");
    expect(screen.getByTestId("git-status-bar-detached")).toHaveTextContent(
      "detached HEAD（游离头指针）",
    );
  });

  it("空仓库：轻提示「仓库还没有任何提交」", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({
        branch: null,
        upstream: null,
        ahead: null,
        behind: null,
        dirty: {
          files_changed: null,
          additions: null,
          deletions: null,
          untracked_count: null,
        },
        head_short: null,
        empty: true,
        fetch: { performed: true, error: null },
      }),
    );
    renderBar("full");

    expect(
      await screen.findByTestId("git-status-bar-empty"),
    ).toHaveTextContent("仓库还没有任何提交");
  });

  it("no_git：渲染 null（空态语义归页面空态卡）", async () => {
    apiFetchMock.mockResolvedValue(
      makeStatus({
        git_mode: "no_git",
        branch: null,
        upstream: null,
        ahead: null,
        behind: null,
        dirty: {
          files_changed: null,
          additions: null,
          deletions: null,
          untracked_count: null,
        },
        head_short: null,
        empty: false,
        fetch: { performed: false, error: null },
      }),
    );
    const { container } = renderBar("full");

    // 请求已 resolve 后仍零输出（组件级 return null，非挂起态）
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId("git-status-bar-loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("git-status-bar")).not.toBeInTheDocument();
    expect(container.innerHTML).toBe("");
  });
});

// ── 5. 双实例同屏单请求（staleTime 60s 缓存共享，D-003）─────────────────

describe("GitStatusBar 双实例同屏单请求（staleTime 60s）", () => {
  it("full + compact 同 workspaceId 同屏：status 请求只发 1 次", async () => {
    apiFetchMock.mockResolvedValue(makeStatus());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <div>
          <GitStatusBar workspaceId="ws-1" variant="full" />
          <GitStatusBar workspaceId="ws-1" variant="compact" />
        </div>
      </QueryClientProvider>,
    );

    // 双形态都渲染成功（同一份缓存数据）
    const bars = await screen.findAllByTestId("git-status-bar");
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.getAttribute("data-variant")).sort()).toEqual([
      "compact",
      "full",
    ]);

    // 关键断言：staleTime 60s 内两实例共享缓存，status 只请求 1 次
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/git-log/status",
    );
  });
});

// ── 6. 主题色板断言（对齐 commit-graph lanePalette 断言形态）────────────

describe("statusBarPalette 主题消费链", () => {
  it("三主题色板取 themes.ts 的 accent/语义系/brand 阶原值", () => {
    for (const name of ["blue", "ai-native", "dark"] as const) {
      const c = themes[name].color;
      expect(statusBarPalette(name)).toEqual({
        ahead: c.accent,
        behind: c.semantic.warning,
        additions: c.semantic.success,
        deletions: c.semantic.error,
        badgeBg: c.brand["100"],
        badgeText: c.brand["600"],
      });
    }
  });

  it("dark 与浅色主题取值不同（亮暗档随主题切换）", () => {
    expect(statusBarPalette("dark")).not.toEqual(statusBarPalette("ai-native"));
    expect(statusBarPalette("blue")).not.toEqual(statusBarPalette("ai-native"));
  });

  it("容器注入 --sb-* 且随主题切换（themes.ts 取值）", async () => {
    apiFetchMock.mockResolvedValue(makeStatus());
    renderBar("full");

    const bar = await screen.findByTestId("git-status-bar");
    expect(bar.style.getPropertyValue("--sb-ahead")).toBe(
      themes["ai-native"].color.accent,
    );
    expect(bar.style.getPropertyValue("--sb-behind")).toBe(
      themes["ai-native"].color.semantic.warning,
    );
    expect(bar.style.getPropertyValue("--sb-badge-bg")).toBe(
      themes["ai-native"].color.brand["100"],
    );
    expect(bar.style.getPropertyValue("--sb-badge-text")).toBe(
      themes["ai-native"].color.brand["600"],
    );

    // 切 dark：--sb-ahead 换为 dark 主题 accent（提亮档）
    act(() => {
      useThemeStore.getState().setTheme("dark");
    });
    expect(bar.style.getPropertyValue("--sb-ahead")).toBe(
      themes.dark.color.accent,
    );
    // ↑ 数字颜色引用 --sb-ahead 变量（token 消费链，零 hex）
    expect(screen.getByTestId("git-status-bar-ahead").getAttribute("style")).toBe(
      "color: var(--sb-ahead);",
    );
  });
});
