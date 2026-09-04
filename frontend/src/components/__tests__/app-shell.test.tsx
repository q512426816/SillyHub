/**
 * ql-20260903-011-66a4：侧边栏菜单高亮「最长匹配独占」测试。
 *
 * 背景（bug）：isActive 对菜单逐个做前缀判断，兄弟路径互相连累——
 *   - absolute 分支 startsWith：「设置」(/settings) 命中 /settings/providers 等全部
 *     /settings/* 兄弟菜单页，「我的供应商」选中时「设置」同时亮；
 *   - 相对分支 includes：「项目组组件」(/components) 命中 /workspaces/:id/components/topology，
 *     「拓扑图」选中时「项目组组件」同时亮。
 *
 * 契约：侧边栏渲染出的菜单中，只有「匹配当前 pathname 匹配段最长」的那个高亮；
 * 无任何命中时全不高亮。等长命中（数据退化）保持原有可多重高亮语义。
 *
 * 测试模式：照搬 (dashboard)/layout.test.tsx 的 next/navigation hoisted mock；
 * TopBar / LogoutConfirmDialog / next:image mock 成占位，聚焦侧边栏 <nav> 内
 * 菜单 <a> 的 active 类（bg-brand-50）归属。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { AppShell } from "@/components/app-shell";
import { useSession, type SessionUser } from "@/stores/session";

// ── next/navigation mock：usePathname 用可变变量，每个 it 前改路径 ─────────────
const nav = vi.hoisted(() => ({ pathname: "/workspaces" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
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
vi.mock("@/components/logout-confirm-dialog", () => ({
  LogoutConfirmDialog: () => <div data-testid="logout-dialog" />,
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
  return render(
    <AppShell>
      <div>content</div>
    </AppShell>,
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

  it("/workspaces/:id/components/topology：仅「拓扑图」高亮，「项目组组件」不再连亮（相对菜单 includes 分支）", () => {
    ws.workspaceId = "1";
    nav.pathname = "/workspaces/1/components/topology";
    renderShell();

    expect(activeLabels()).toEqual(["拓扑图"]);
  });

  it("/workspaces/:id/components：仅「项目组组件」高亮（相对菜单自身页回归）", () => {
    ws.workspaceId = "1";
    nav.pathname = "/workspaces/1/components";
    renderShell();

    expect(activeLabels()).toEqual(["项目组组件"]);
  });

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
