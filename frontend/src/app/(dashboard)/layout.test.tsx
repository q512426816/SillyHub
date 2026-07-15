/**
 * task-05：(dashboard)/layout.tsx 工作区守卫单测（D-006 方案 A 客户端守卫）。
 *
 * 守卫契约（design §5 P2 + §9 白名单 + CB-3 实现顺序）：
 *   - 登录态前置：未 hydrated / 无 accessToken → 守卫不触发（登录守卫管 /login）
 *   - CB-3 顺序：先判 /workspaces/:id（有 wsId 放行）再判白名单前缀，
 *     避免 /workspaces/xxx 被白名单 /workspaces 前缀误匹配造成重定向循环。
 *   - 白名单：精确匹配或带 / 前缀（防 /admins 误命中 /admin）。
 *   - 否则（依赖工作区但无 wsId）→ router.replace("/workspaces")。
 *
 * 聚焦守卫逻辑，mock 掉 AppShell（避免拉入菜单/上下文等无关依赖）与 fetchMe
 * （fetchMe 的行为由既有登录守卫用例覆盖，这里只断言守卫 replace 调用）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import DashboardLayout from "@/app/(dashboard)/layout";
import { useSession } from "@/stores/session";

// ── next/navigation mock：usePathname 用可变变量，每个 it 前改路径 ─────────────
const nav = vi.hoisted(() => ({
  pathname: "/workspaces",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// ── mock AppShell：layout 渲染期会调 AppShell，mock 成纯 passthrough 避免拉依赖 ─
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// ── mock fetchMe：避免真实网络请求（fetchMe 失败由既有用例覆盖） ─────────────────
vi.mock("@/lib/auth", () => ({
  fetchMe: vi.fn().mockResolvedValue(undefined),
}));

function renderLayout() {
  return render(
    <DashboardLayout>
      <span>content</span>
    </DashboardLayout>,
  );
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  nav.pathname = "/workspaces";
  nav.replace = vi.fn();
});

afterEach(() => {
  useSession.setState({
    hydrated: false,
    accessToken: null,
    refreshToken: null,
    user: null,
  } as never);
  vi.clearAllMocks();
});

describe("DashboardLayout 工作区守卫 — CB-3 顺序与白名单", () => {
  it("/workspaces/A/changes 有 wsId → 放行（不 replace）", async () => {
    nav.pathname = "/workspaces/A/changes";
    renderLayout();
    // 等一帧让 useEffect 跑完，确认 replace 未被调（CB-3 第 1 步：先判 :id 放行）
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/workspaces/A （仅 wsId 根）→ 放行", async () => {
    nav.pathname = "/workspaces/A";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/admin/users → 放行（白名单 /admin 带前缀）", async () => {
    nav.pathname = "/admin/users";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/admin （白名单根）→ 放行", async () => {
    nav.pathname = "/admin";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/settings → 放行（白名单）", async () => {
    nav.pathname = "/settings";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/ppm/x → 放行（白名单 /ppm 带前缀）", async () => {
    nav.pathname = "/ppm/x";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/runtimes → 放行（白名单）", async () => {
    nav.pathname = "/runtimes";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // task-08 / AC-09：/account（个人中心）已加入白名单，放行不被守卫拦截。
  it("/account → 放行（白名单，task-08 个人中心入口）", async () => {
    nav.pathname = "/account";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/workspaces （列表/选择器页本身，无 wsId）→ 放行", async () => {
    nav.pathname = "/workspaces";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    // 关键：/workspaces 精确匹配白名单，不进 :id 正则也不被误判
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/agents （依赖工作区但无 wsId）→ replace /workspaces", async () => {
    nav.pathname = "/agents";
    renderLayout();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workspaces"));
  });

  it("/ （根，无 wsId 非白名单）→ replace /workspaces", async () => {
    nav.pathname = "/";
    renderLayout();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workspaces"));
  });

  it("/dashboard/overview （其他非白名单）→ replace /workspaces", async () => {
    nav.pathname = "/dashboard/overview";
    renderLayout();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workspaces"));
  });
});

describe("DashboardLayout 工作区守卫 — 白名单边界（防误命中）", () => {
  // CB-3 第 2 步白名单匹配规则：pathname === p || startsWith(p + "/")
  // 防 /admins（带 s）误命中 /admin、/runtimes-x 误命中 /runtimes 等。
  it("/admins （类似但非白名单）→ replace /workspaces（不被 /admin 误吞）", async () => {
    nav.pathname = "/admins";
    renderLayout();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workspaces"));
  });

  it("/settings-x （前缀相似但非白名单）→ replace /workspaces", async () => {
    nav.pathname = "/settings-x";
    renderLayout();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workspaces"));
  });

  // CB-3 关键：/workspaces/xxx 必须先判 :id 放行，不能进白名单分支后被前缀逻辑误判。
  // （此用例与 /workspaces/A/changes 互补，专门锁定 CB-3 顺序不被颠倒。）
  it("/workspaces/abc/def/ghi （深路径）→ 放行（CB-3 :id 先判，不被白名单吞）", async () => {
    nav.pathname = "/workspaces/abc/def/ghi";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("DashboardLayout 工作区守卫 — 登录前置", () => {
  it("未登录（无 accessToken）→ 守卫不触发（不 replace /workspaces，交给登录守卫）", async () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/agents"; // 非白名单，但因未登录守卫应跳过
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    // 工作区守卫前置 if (!hydrated || !accessToken) return → 不应调 replace("/workspaces")
    // （登录守卫会 replace /login，但本用例聚焦工作区守卫不触发，故只断言不 replace workspaces）
    expect(nav.replace).not.toHaveBeenCalledWith("/workspaces");
  });

  it("persist 未恢复（hydrated=false）→ 守卫不触发", async () => {
    useSession.setState({ accessToken: null, hydrated: false } as never);
    nav.pathname = "/agents";
    renderLayout();
    await new Promise((r) => setTimeout(r, 0));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
