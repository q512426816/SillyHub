/**
 * ql-20260903-011-66a4：侧边栏菜单高亮「最长匹配独占」测试。
 *
 * 背景（bug）：isActive 对菜单逐个做前缀判断，兄弟路径互相连累——
 *   - absolute 分支 startsWith：「设置」(/settings) 命中 /settings/providers 等全部
 *     /settings/* 兄弟菜单页，「我的供应商」选中时「设置」同时亮；

 *
 * 契约：侧边栏渲染出的菜单中，只有「匹配当前 pathname 匹配段最长」的那个高亮；
 * 无任何命中时全不高亮。等长命中（数据退化）保持原有可多重高亮语义。
 *
 * 测试模式：照搬 (dashboard)/layout.test.tsx 的 next/navigation hoisted mock；
 * TopBar / LogoutConfirmDialog / next:image mock 成占位，聚焦侧边栏 <nav> 内
 * 菜单 <a> 的 active 类（bg-brand-50）归属。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppShell } from "@/components/app-shell";
import { useSession, type SessionUser } from "@/stores/session";

// ── next/navigation mock：usePathname 用可变变量，每个 it 前改路径；useRouter
//    用共享 hoisted 对象，登出用例可断言「不再走 router.replace」（2026-10-14-
//    logout-full-reload-clear-cache）───────────────────────────────────────────
const nav = vi.hoisted(() => ({
  pathname: "/workspaces",
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav,
}));

// ── useWorkspaceContext mock：可变 workspaceId 供工作区相对菜单用例 ────────────
const ws = vi.hoisted(() => ({
  workspaceId: null as string | null,
  current: null as { id: string } | null,
}));

vi.mock("@/lib/use-workspace-context", () => ({
  useWorkspaceContext: () => ({ workspaceId: ws.workspaceId, current: ws.current }),
}));

// ── 重依赖 mock 成占位：聚焦菜单高亮，不拉 TopBar / 弹窗 / next 优化组件 ───────
vi.mock("@/components/top-bar", () => ({
  TopBar: () => <div data-testid="top-bar" />,
}));

// 登出清理 mock（2026-10-14-logout-localstorage-user-data-cleanup）：断言登出
// 跳转前统一清 localStorage 用户域键的钩子被调（键面行为由其自身单测覆盖）。
const logoutStorage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/logout-storage", () => ({
  clearUserScopedLocalStorage: logoutStorage.clear,
}));
// 弹窗 mock 成「直接透出 onConfirm 的按钮」：本文件聚焦 app-shell 自己的
// performLogout 跳转方式断言，弹窗本体交互由 logout-confirm-dialog.test.tsx 覆盖。
vi.mock("@/components/logout-confirm-dialog", () => ({
  LogoutConfirmDialog: ({
    onConfirm,
  }: {
    onConfirm: () => void | Promise<void>;
  }) => (
    <button data-testid="logout-confirm" onClick={() => void onConfirm()}>
      确认退出
    </button>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

// next/link mock（jsdom 下不导航）。必须透传 className——active 高亮类
// （bg-brand-50）挂在 Link 上，丢了就断言不到选中态。
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// 平台管理员：is_platform_admin 短路 → 全部菜单可见，断言不受权限过滤干扰。
const ADMIN: SessionUser = {
  id: "u1",
  email: "admin@test.local",
  displayName: "管理员",
  is_platform_admin: true,
};

function renderShell() {
  // 2026-09-18-web-menu-management task-10：AppShell 接入 useMenuOverrides（useQuery），
  // 裸渲染会抛 No QueryClient set——包独立 QueryClient（retry:false，真实 app 由
  // AppProviders 提供同款 Provider），覆盖拉取失败经 hook 降级为空数组直通注册表。
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <div>content</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

/** 侧边栏 <nav> 内菜单链接中当前高亮（active 类 bg-brand-50）的文案列表 */
function activeLabels(): string[] {
  const sidebarNav = document.querySelector("aside nav");
  expect(sidebarNav).not.toBeNull();
  return Array.from(sidebarNav!.querySelectorAll("a"))
    .filter((a) => a.className.includes("bg-brand-50"))
    .map((a) => a.textContent ?? "");
}

beforeEach(() => {
  useSession.setState({
    user: ADMIN,
    accessToken: "tok",
    hydrated: true,
  } as never);
  nav.pathname = "/workspaces";
  ws.workspaceId = null;
  ws.current = null;
});

afterEach(() => {
  useSession.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    hydrated: false,
  } as never);
  vi.clearAllMocks();
});

describe("侧边栏菜单高亮 — 最长匹配独占（ql-20260903-011-66a4）", () => {
  it("/settings/providers：仅「我的供应商」高亮，「设置」不再连亮（核心回归）", () => {
    nav.pathname = "/settings/providers";
    renderShell();

    expect(activeLabels()).toEqual(["我的供应商"]);
  });

  it("/settings：仅「设置」高亮", () => {
    nav.pathname = "/settings";
    renderShell();

    expect(activeLabels()).toEqual(["设置"]);
  });

  it("/settings/skills：仅「技能管理」高亮（同根因 /settings/* 兄弟页）", () => {
    nav.pathname = "/settings/skills";
    renderShell();

    expect(activeLabels()).toEqual(["技能管理"]);
  });

  it("/settings/api-keys：仅「API 密钥」高亮（同根因 /settings/* 兄弟页）", () => {
    nav.pathname = "/settings/api-keys";
    renderShell();

    expect(activeLabels()).toEqual(["API 密钥"]);
  });

  // 2026-10-11-retire-components-page：/components 与 /components/topology 两页
  // 已下线，对应高亮用例随之移除（菜单条目同删，无可高亮项）。

  it("/workspaces：仅「工作区首页」高亮（精确匹配分支回归）", () => {
    nav.pathname = "/workspaces";
    renderShell();

    expect(activeLabels()).toEqual(["工作区首页"]);
  });

  it("/account（无菜单命中）→ 无高亮", () => {
    nav.pathname = "/account";
    renderShell();

    expect(activeLabels()).toEqual([]);
  });
});

// ── 退出登录 → 整页跳转清缓存（2026-10-14-logout-full-reload-clear-cache）──────
// 根因：登出曾走 router.replace 的 SPA 内跳转，React Query 缓存与内存 zustand
// store（工作区/看板/悬浮会话）跨登录会话存活，换账号后残留上一用户数据。
// 契约：确认退出后必须 window.location.assign("/login") 整页跳转（对齐 lib/api.ts
// 401 被动登出先例），登出路径上禁止 router.replace。
describe("退出登录 — 整页跳转清缓存（2026-10-14-logout-full-reload-clear-cache）", () => {
  // jsdom 的 window.location 是 accessor 属性且 assign 为 not-implemented 占位，
  // vi.spyOn 拦不住——用 defineProperty 整体替换，afterEach 按原 descriptor 还原。
  const originalLocationDesc = Object.getOwnPropertyDescriptor(window, "location");
  let assignMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignMock },
      configurable: true,
    });
    // performLogout 的 logout POST：stub 成即刻成功，聚焦跳转断言。
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(undefined));
    useSession.setState({
      user: ADMIN,
      accessToken: "tok",
      refreshToken: "rt",
      hydrated: true,
    } as never);
  });

  afterEach(() => {
    if (originalLocationDesc) {
      Object.defineProperty(window, "location", originalLocationDesc);
    }
    vi.unstubAllGlobals();
  });

  it("确认退出 → window.location.assign 整页跳转 /login（不走 router.replace）", async () => {
    renderShell();

    fireEvent.click(screen.getByTestId("logout-confirm"));

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/login"));
    expect(nav.replace).not.toHaveBeenCalled();
    // 2026-10-14-logout-localstorage-user-data-cleanup：跳转前清 localStorage 用户域键
    expect(logoutStorage.clear).toHaveBeenCalledTimes(1);
  });
});
