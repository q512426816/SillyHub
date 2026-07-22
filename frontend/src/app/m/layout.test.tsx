/**
 * task-05 · app/m/layout.tsx 单测（design §5.2 / §9 / R-10 / FR-02 / FR-08）。
 *
 * 覆盖 layout 自身渲染决策（守卫副作用由 task-03 route-guard.test.ts 覆盖，此处 mock 掉）：
 *  - 调用 useMobileRouteGuard（守卫已接线）。
 *  - !hydrated → 不渲染（防 FOUC，镜像桌面 layout:54）。
 *  - 公开页 /m/login + 无 token → 仍渲染 children（登录页不要求 token，不裹 Shell）。
 *  - 受保护页 + 无 token → 不渲染（镜像桌面 layout:55，守卫已 replace）。
 *  - 受保护页 + 已登录 → 渲染 MobileAppShell，activeTab 按路由推断。
 *  - inferActiveTab：/m 前缀 strip 后命中 MOBILE_TABS；非 Tab 根页返回 undefined。
 *
 * mock 策略与 route-guard.test.tsx / mobile-tab-bar.test.tsx 一致：next/navigation 用可变 ref，
 * useSession 直接 setState（真实 zustand store），MobileAppShell mock 成带 activeTab 锚点的 div，
 * useMobileRouteGuard mock 成 spy（隔离 task-05 渲染逻辑）。
 */

import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { useSession } from "@/stores/session";

// ── next/navigation mock：usePathname 用可变 ref ─────────────────────────────
const nav = vi.hoisted(() => ({ pathname: "/m/ppm/workbench" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// ── 守卫 mock：隔离渲染逻辑，仅断言被调用 ─────────────────────────────────────
const guard = vi.hoisted(() => ({ useMobileRouteGuard: vi.fn() }));
vi.mock("@/lib/auth/route-guard", () => ({
  useMobileRouteGuard: guard.useMobileRouteGuard,
}));

// ── MobileAppShell mock：渲染 activeTab 锚点 + 透传 children，便于断言高亮与内容 ──
const shell = vi.hoisted(() => ({ activeTab: "<none>" as string }));
vi.mock("@/components/mobile/mobile-app-shell", () => ({
  MobileAppShell: ({
    children,
    activeTab,
  }: {
    children: ReactNode;
    activeTab?: string;
  }) => {
    shell.activeTab = activeTab ?? "<none>";
    return (
      <div data-testid="mobile-app-shell" data-active-tab={shell.activeTab}>
        {children}
      </div>
    );
  },
}));

import MobileLayoutShell from "@/app/m/layout";

function renderLayout() {
  return render(
    createElement(
      MobileLayoutShell,
      null,
      createElement("div", { "data-testid": "page-content" }, "page"),
    ),
  );
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  nav.pathname = "/m/ppm/workbench";
  guard.useMobileRouteGuard.mockReset();
  shell.activeTab = "<none>";
});

afterEach(() => {
  // 先卸载组件再重置 store，避免 setState 通知仍挂载组件触发 act 警告。
  cleanup();
  useSession.setState({
    hydrated: false,
    accessToken: null,
    refreshToken: null,
    user: null,
  } as never);
  vi.clearAllMocks();
});

describe("MobileLayoutShell 接线与守卫", () => {
  it("挂载即调用 useMobileRouteGuard（守卫已接线）", () => {
    renderLayout();
    expect(guard.useMobileRouteGuard).toHaveBeenCalledTimes(1);
  });

  it("!hydrated → 不渲染 children（防 FOUC，镜像桌面 layout:54）", () => {
    useSession.setState({ accessToken: "tok", hydrated: false } as never);
    renderLayout();
    expect(screen.queryByTestId("page-content")).toBeNull();
    expect(screen.queryByTestId("mobile-app-shell")).toBeNull();
  });
});

describe("MobileLayoutShell 公开页 / 受保护页渲染分支", () => {
  it("公开页 /m/login + 无 token → 仍渲染 children（不裹 Shell）", () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/m/login";
    renderLayout();
    expect(screen.getByTestId("page-content")).toBeTruthy();
    expect(screen.queryByTestId("mobile-app-shell")).toBeNull();
  });

  it("受保护页 + 无 token → 不渲染（镜像桌面 layout:55，守卫已 replace）", () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/m/ppm/workbench";
    renderLayout();
    expect(screen.queryByTestId("page-content")).toBeNull();
    expect(screen.queryByTestId("mobile-app-shell")).toBeNull();
  });

  it("受保护页 + 已登录 → 渲染 MobileAppShell 且 children 进 Shell", () => {
    nav.pathname = "/m/ppm/workbench";
    renderLayout();
    const sh = screen.getByTestId("mobile-app-shell");
    expect(sh).toBeTruthy();
    expect(sh.querySelector('[data-testid="page-content"]')).toBeTruthy();
  });
});

describe("MobileLayoutShell activeTab 推断（strip /m + isTabActive）", () => {
  it("/m/ppm/workbench → workbench", () => {
    nav.pathname = "/m/ppm/workbench";
    renderLayout();
    expect(shell.activeTab).toBe("workbench");
  });

  it("/m/ppm/task-plans → task-plans（含子路径前缀匹配）", () => {
    nav.pathname = "/m/ppm/task-plans/abc-1";
    renderLayout();
    expect(shell.activeTab).toBe("task-plans");
  });

  it("/m/ppm/problem-list → problem-list", () => {
    nav.pathname = "/m/ppm/problem-list";
    renderLayout();
    expect(shell.activeTab).toBe("problem-list");
  });

  it("/m/account → mine", () => {
    nav.pathname = "/m/account";
    renderLayout();
    expect(shell.activeTab).toBe("mine");
  });

  it("/m/workspaces → switch", () => {
    nav.pathname = "/m/workspaces";
    renderLayout();
    expect(shell.activeTab).toBe("switch");
  });

  it("/m/workspaces/:id 子路径同样命中 switch（isTabActive 前缀语义，与详情页保持父级高亮一致）", () => {
    nav.pathname = "/m/workspaces/ws-9";
    renderLayout();
    expect(shell.activeTab).toBe("switch");
  });

  it("非 Tab 根页（/m/admin，白名单平台页但无对应 Tab）→ activeTab undefined，不强制高亮", () => {
    nav.pathname = "/m/admin";
    renderLayout();
    expect(shell.activeTab).toBe("<none>");
  });

  it("/m/login 公开页不推断 Tab（不裹 Shell，activeTab 未触达）", () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/m/login";
    renderLayout();
    // 未裹 Shell → activeTab 锚点保持初始值
    expect(shell.activeTab).toBe("<none>");
    expect(screen.queryByTestId("mobile-app-shell")).toBeNull();
  });
});
