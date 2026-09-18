/**
 * 2026-09-18-web-menu-management task-12：菜单管理页 /admin/menus 交互测试
 * （FR-02 / FR-03 / R-03 / R-08）。
 *
 * 依据:
 *   - tasks/task-12.md implementation——脚手架照搬 admin/organizations/__tests__ 惯例
 *     （AntApp 包裹满足 useNotify 的 App.useApp 上下文 + vi.hoisted vi.mock 数据层 +
 *     useSession.setState 注入会话 + afterEach 复位 session 与 clearAllMocks）；
 *     页面含 react-query（useMenuOverrides / useQueryClient / listRoles），另按
 *     workspaces/[id]/mcp 页测惯例包 QueryClientProvider（retry:false）。
 *   - 数据层全收口 mock @/lib/api 的 apiFetch（menu-overrides GET/PUT 与
 *     /api/admin/roles 都经它走），PUT 断言直接锚定真实 wire 形态。
 *
 * 覆盖（蓝图用例清单权威）:
 *   1. 行内改名保存——编辑显示名回车提交 → PUT 全量三字段形态（label 新值 +
 *      sort_order/hidden 当前值，防改名冲掉已有排序/隐藏覆盖）；
 *   2. 恢复默认——已有 label 覆盖行展示「已改名」标记，「恢复默认」→ PUT label:null
 *      且保留 sort_order/hidden 当前值；
 *   3. 组内上移——相邻交换双 PUT（目标行取相邻行生效排序值，相邻行取目标行值，
 *      未覆盖行以注册表声明序索引为当前值）；
 *   4. 隐藏开关——menus 行 Switch disabled（R-03 防自锁）；普通行切换 → PUT hidden；
 *   5. 权限展开——key + 中文名 + 持有角色 chips（GET /api/admin/roles permissions
 *      客户端反查，D-003）；role:read 403 → 「需 role:read 查看角色分布」占位且
 *      主功能不受阻（R-08）。
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AdminMenusPage from "@/app/(dashboard)/admin/menus/page";
import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import type { RoleRead } from "@/lib/admin";
import type { MenuOverrideRead } from "@/lib/menu-overrides";

// ── mock @/lib/api：apiFetch 按路由分发（menu-overrides GET/PUT + roles GET）────
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

/** 可变 fixture（hoisted 安全持有，beforeEach 复位、用例内按需改写）。 */
const fixtures = vi.hoisted(() => ({
  overrides: [] as Array<{
    menu_key: string;
    label: string | null;
    sort_order: number | null;
    hidden: boolean;
  }>,
  rolesError: false,
}));

// ── 会话：平台管理员（canWrite 短路，聚焦交互而非权限门禁）───────────────────
const ADMIN = {
  id: "u1",
  email: "admin@test.local",
  displayName: "管理员",
  is_platform_admin: true,
};

/** 角色反查 fixture：平台运维持 role:read/write，只读访客仅 user:read。 */
function makeRoles(): RoleRead[] {
  const now = "2026-09-18T06:00:00Z";
  return [
    {
      id: "r1",
      key: "ops",
      name: "平台运维",
      description: null,
      is_system: false,
      is_active: true,
      permissions: ["role:read", "role:write"],
      user_count: 2,
      created_at: now,
      updated_at: now,
    },
    {
      id: "r2",
      key: "viewer",
      name: "只读访客",
      description: null,
      is_system: false,
      is_active: true,
      permissions: ["user:read"],
      user_count: 5,
      created_at: now,
      updated_at: now,
    },
  ];
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <AntApp>
      <QueryClientProvider client={client}>
        <AdminMenusPage />
      </QueryClientProvider>
    </AntApp>,
  );
}

/** 按路由小字定位菜单行（每行路由文本唯一，如 users 行含 “/admin/users”）。 */
function menuRow(route: string): HTMLElement {
  const cell = screen.getByText(route);
  return cell.closest("tr")!;
}

beforeEach(() => {
  fixtures.overrides = [];
  fixtures.rolesError = false;
  apiFetchMock.mockImplementation(
    (path: string, init?: { method?: string; json?: unknown }) => {
      if (path === "/api/menu-overrides") {
        return Promise.resolve({ items: fixtures.overrides });
      }
      if (path === "/api/admin/roles") {
        // R-08 场景开关：无 role:read 的菜单管理员拉角色列表 403
        if (fixtures.rolesError) {
          return Promise.reject(
            new ApiError(403, {
              code: "FORBIDDEN",
              message: "无权限",
              request_id: null,
              details: null,
            }),
          );
        }
        const items = makeRoles();
        return Promise.resolve({ items, total: items.length });
      }
      if (path.startsWith("/api/menu-overrides/") && init?.method === "PUT") {
        const menuKey = decodeURIComponent(path.slice("/api/menu-overrides/".length));
        return Promise.resolve({
          menu_key: menuKey,
          ...(init.json as Record<string, unknown>),
        });
      }
      return Promise.reject(new Error(`测试未预期的 apiFetch 调用: ${path}`));
    },
  );
  useSession.setState({ user: ADMIN, accessToken: "tok", hydrated: true } as never);
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

describe("/admin/menus 菜单管理页（task-11 / task-12）", () => {
  it("页面骨架：标题 + 说明条 + 按 section 分组平铺（system 组 5 行）", async () => {
    renderPage();

    // PageHeader 标题与副标题（菜单管理自身的 menuLabel 也叫「菜单管理」，用副标题锚定页头）
    expect(
      await screen.findByText("调整菜单显示名、组内排序与全局隐藏（全局生效，改动即时保存）"),
    ).toBeInTheDocument();
    // 分组标题行：系统管理（task-08 新增 menus 后 system 组 5 条）
    expect(await screen.findByText("系统管理")).toBeInTheDocument();
    expect(await screen.findByText("5 个菜单")).toBeInTheDocument();
    // 菜单行：users 行（默认名 + 路由小字）
    expect(await screen.findByText("/admin/users")).toBeInTheDocument();
  });

  it("行内改名：点击显示名 → 输入新名回车 → PUT 全量三字段（label 新值 + 其余维度当前值）", async () => {
    renderPage();
    await screen.findByText("/admin/users");
    const row = menuRow("/admin/users");

    fireEvent.click(
      within(row).getByTitle("点击修改显示名（回车或失焦保存）"),
    );
    const input = within(row).getByDisplayValue("用户");
    fireEvent.change(input, { target: { value: "用户中心" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // PUT 整行当前全量三字段：未覆盖维度传默认（label 新值 / sort_order null / hidden false）
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/users", {
        method: "PUT",
        json: { label: "用户中心", sort_order: null, hidden: false },
      }),
    );
  });

  it("恢复默认：已有 label 覆盖行展示「已改名」标记，「恢复默认」→ PUT label:null 且保留其余维度", async () => {
    fixtures.overrides = [
      { menu_key: "users", label: "用户中心", sort_order: 5, hidden: true },
    ];
    renderPage();

    // 等覆盖查询落定（覆盖 label 生效后 users 行显示名变更为覆盖值）
    await screen.findByText("用户中心");
    const row = menuRow("/admin/users");
    // 覆盖生效：显示名 = 覆盖值 + 已改名标记
    expect(within(row).getByText("用户中心")).toBeInTheDocument();
    expect(within(row).getByText("已改名")).toBeInTheDocument();

    fireEvent.click(within(row).getByText("恢复默认"));

    // 清除项传 null 回默认；已有排序/隐藏覆盖原样随行携带（防改名/恢复冲掉其它维度）
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/users", {
        method: "PUT",
        json: { label: null, sort_order: 5, hidden: true },
      }),
    );
  });

  it("组内上移：与相邻行交换生效排序值，双 PUT（未覆盖行以声明序索引为当前值）", async () => {
    renderPage();
    await screen.findByText("/admin/roles");

    // system 组声明序：users=19 / organizations=20 / roles=21（未覆盖 → 生效值=声明序索引）
    const rolesRow = menuRow("/admin/roles");
    fireEvent.click(within(rolesRow).getByTitle("上移"));

    // 先 PUT 目标行（roles 取相邻行 organizations 的生效值 20）
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/roles", {
        method: "PUT",
        json: { label: null, sort_order: 20, hidden: false },
      }),
    );
    // 再 PUT 相邻行（organizations 取 roles 原生效值 21）
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/organizations", {
        method: "PUT",
        json: { label: null, sort_order: 21, hidden: false },
      }),
    );
  });

  it("组内下移：与相邻行交换生效排序值，双 PUT", async () => {
    renderPage();
    await screen.findByText("/admin/roles");

    // organizations(20) 下移 ↔ roles(21)
    const orgRow = menuRow("/admin/organizations");
    fireEvent.click(within(orgRow).getByTitle("下移"));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/organizations", {
        method: "PUT",
        json: { label: null, sort_order: 21, hidden: false },
      }),
    );
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/roles", {
        method: "PUT",
        json: { label: null, sort_order: 20, hidden: false },
      }),
    );
  });

  it("隐藏开关：menus 行 Switch disabled 带锁提示（R-03 防自锁）；普通行切换 → PUT hidden", async () => {
    renderPage();

    // menus 行：管理入口自身不可隐藏
    await screen.findByText("/admin/menus");
    const menusRow = menuRow("/admin/menus");
    expect(within(menusRow).getByRole("switch")).toBeDisabled();
    expect(within(menusRow).getByText("🔒 自身不可隐藏")).toBeInTheDocument();

    // 普通行：organizations 开启全局隐藏 → PUT hidden:true（label/sort 当前值随行携带）
    const orgRow = menuRow("/admin/organizations");
    fireEvent.click(within(orgRow).getByRole("switch"));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/organizations", {
        method: "PUT",
        json: { label: null, sort_order: null, hidden: true },
      }),
    );
  });

  it("权限展开：key + 中文名 + 持有角色 chips（roles permissions 客户端反查，D-003）", async () => {
    renderPage();
    await screen.findByText("/admin/roles");
    const rolesRow = menuRow("/admin/roles");

    fireEvent.click(within(rolesRow).getByText("展开权限 ▾"));

    // 展开行：明细标题 + 只读提示
    expect(
      await screen.findByText("「角色」挂载权限与当前持有角色（只读）"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("权限的分配与收回请前往「角色管理」页操作"),
    ).toBeInTheDocument();
    // key 中文名正常显示
    expect(screen.getByText("角色查看")).toBeInTheDocument();
    expect(screen.getByText("角色编辑")).toBeInTheDocument();
    // 持有角色 chips：平台运维持 role:read 与 role:write（两行各一枚 chip）；
    // 只读访客（仅 user:read）不出现
    expect(await screen.findAllByText("平台运维")).toHaveLength(2);
    expect(screen.queryByText("只读访客")).not.toBeInTheDocument();
  });

  it("role:read 403 降级（R-08）：角色区占位提示，权限 key 正常显示，改名主功能不受阻", async () => {
    fixtures.rolesError = true;
    renderPage();

    await screen.findByText("/admin/roles");
    const rolesRow = menuRow("/admin/roles");
    fireEvent.click(within(rolesRow).getByText("展开权限 ▾"));

    // 角色分布降级占位（role:read / role:write 每个权限行各一枚）；
    // 权限 key 与中文名正常显示
    expect(await screen.findAllByText("需 role:read 查看角色分布")).toHaveLength(2);
    expect(screen.getByText("角色查看")).toBeInTheDocument();

    // 主功能不受阻：行内改名照常 PUT
    const usersRow = menuRow("/admin/users");
    fireEvent.click(
      within(usersRow).getByTitle("点击修改显示名（回车或失焦保存）"),
    );
    fireEvent.change(within(usersRow).getByDisplayValue("用户"), {
      target: { value: "用户中心" },
    });
    fireEvent.keyDown(within(usersRow).getByDisplayValue("用户中心"), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/menu-overrides/users", {
        method: "PUT",
        json: { label: "用户中心", sort_order: null, hidden: false },
      }),
    );
  });
});
