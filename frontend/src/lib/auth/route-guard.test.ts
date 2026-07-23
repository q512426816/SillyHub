/**
 * task-03：移动端路由守卫单测（design §5.2 / §9 / R-10 / FR-08）。
 *
 * 守卫契约（镜像 app/(dashboard)/layout.test.tsx 的桌面守卫用例，1:1 对应）：
 *   - 未登录访问受保护 /m 页 → 重定向 /m/login（不回桌面 /login）。
 *   - /m/login 判为公开页：未登录也放行，不无限重定向。
 *   - 已登录 + 白名单 /m 路径 → 放行；/m/workspaces/:id → 放行。
 *   - 已登录 + 依赖工作区但无 wsId → 重定向 /m/workspaces（不回桌面 /workspaces）。
 *   - CB-3 顺序：先判 /workspaces/:id 放行，再判白名单前缀，否则循环。
 *   - 白名单边界：精确或带 / 前缀，防 /m/admins 被 /admin 误吞。
 *
 * R-10 防漂移：本文件用例与桌面 (dashboard)/layout.test.tsx 一一对应；
 * 改桌面守卫或移动守卫任一方，都必须同步另一方 + 本套用例。
 */

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { useMobileRouteGuard } from "@/lib/auth/route-guard";
import { useSession } from "@/stores/session";

// ── next/navigation mock：usePathname 用可变变量，每个 it 前改路径 ─────────────
const nav = vi.hoisted(() => ({
  pathname: "/m/workspaces",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
}));

// 守卫是纯 hook，套一个空壳组件承载调用（app/m/layout.tsx 在 Wave2 接线，此处不依赖）。
// 返回 null 即可：只需组件挂载触发守卫 effect，不依赖任何 DOM 输出，故不需要 JSX/tsx。
function GuardHarness() {
  useMobileRouteGuard();
  return null;
}

function renderGuard() {
  return render(createElement(GuardHarness));
}

// 等一帧让 useEffect 跑完（与桌面 layout.test.tsx 同手法）。
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useSession.setState({ accessToken: "tok", hydrated: true } as never);
  nav.pathname = "/m/workspaces";
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

describe("useMobileRouteGuard 登录守卫 — 镜像桌面 layout.tsx:21-24", () => {
  it("未登录访问受保护 /m 页 → replace /m/login?redirect=<原路径>（深链回跳 FR-03）", async () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/m/ppm/workbench";
    renderGuard();
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        "/m/login?redirect=" + encodeURIComponent("/ppm/workbench"),
      ),
    );
    expect(nav.replace).not.toHaveBeenCalledWith("/login");
  });

  it("persist 未恢复（hydrated=false）→ 守卫不触发（不 replace）", async () => {
    useSession.setState({ accessToken: null, hydrated: false } as never);
    nav.pathname = "/m/ppm/workbench";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("已登录受保护页 → 登录守卫不 replace /m/login", async () => {
    nav.pathname = "/m/ppm/workbench"; // 非白名单 → 会被工作区守卫 replace /m/workspaces，但不应 replace /m/login
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalledWith("/m/login");
  });
});

describe("useMobileRouteGuard 公开页 — /m/login 不要求 auth（防无限重定向）", () => {
  it("/m/login 未登录 → 放行（既不 replace /m/login 也不 replace /m/workspaces）", async () => {
    useSession.setState({ accessToken: null, hydrated: true } as never);
    nav.pathname = "/m/login";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/login 已登录 → 放行（不跳工作区选择器，允许已登录用户访问登录页）", async () => {
    nav.pathname = "/m/login";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("useMobileRouteGuard 工作区守卫 — CB-3 顺序与白名单（镜像 layout.tsx:14,44-52）", () => {
  it("/m/workspaces/A/changes 有 wsId → 放行（CB-3 第 1 步：先判 :id）", async () => {
    nav.pathname = "/m/workspaces/A/changes";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/workspaces/A （仅 wsId 根）→ 放行", async () => {
    nav.pathname = "/m/workspaces/A";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/workspaces/abc/def/ghi （深路径）→ 放行（CB-3 :id 先判，不被白名单吞）", async () => {
    nav.pathname = "/m/workspaces/abc/def/ghi";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/admin/users → 放行（白名单 /admin 带前缀）", async () => {
    nav.pathname = "/m/admin/users";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/admin （白名单根）→ 放行", async () => {
    nav.pathname = "/m/admin";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/settings → 放行（白名单）", async () => {
    nav.pathname = "/m/settings";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/ppm/workbench → 放行（白名单 /ppm 带前缀）", async () => {
    nav.pathname = "/m/ppm/workbench";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/runtimes → 放行（白名单）", async () => {
    nav.pathname = "/m/runtimes";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/account → 放行（白名单，task-08 个人中心入口）", async () => {
    nav.pathname = "/m/account";
    renderGuard();
    await flush();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("/m/workspaces （列表/选择器页本身，无 wsId）→ 放行", async () => {
    nav.pathname = "/m/workspaces";
    renderGuard();
    await flush();
    // /workspaces 精确匹配白名单，不进 :id 正则也不被误判
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("useMobileRouteGuard 工作区守卫 — 依赖工作区但无 wsId → /m/workspaces", () => {
  it("/m/agents （依赖工作区无 wsId）→ replace /m/workspaces（不回桌面 /workspaces）", async () => {
    nav.pathname = "/m/agents";
    renderGuard();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/m/workspaces"));
    expect(nav.replace).not.toHaveBeenCalledWith("/workspaces");
  });

  it("/m （根，无 wsId 非白名单）→ replace /m/workspaces", async () => {
    nav.pathname = "/m";
    renderGuard();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/m/workspaces"));
  });
});

describe("useMobileRouteGuard 工作区守卫 — 白名单边界（防误命中）", () => {
  // 白名单匹配规则：pathname(strip 后) === w || startsWith(w + "/")
  // 防 /m/admins（带 s）误命中 /admin 等。
  it("/m/admins （类似但非白名单）→ replace /m/workspaces（不被 /admin 误吞）", async () => {
    nav.pathname = "/m/admins";
    renderGuard();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/m/workspaces"));
  });

  it("/m/settings-x （前缀相似但非白名单）→ replace /m/workspaces", async () => {
    nav.pathname = "/m/settings-x";
    renderGuard();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/m/workspaces"));
  });
});
