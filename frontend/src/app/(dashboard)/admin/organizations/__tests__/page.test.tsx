/**
 * ql-20260903-012-7c69：组织管理页全 antd 重构渲染测试。
 *
 * 依据文档:
 *   - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md（§1 骨架/§4 表格/§6 Modal/§8 删除确认）
 *   - 参照 /admin/users 页布局（工具栏 + 搜索区 + DataTable）
 *
 * 覆盖:
 *   1. 页面骨架：PageHeader 标题「组织管理」+ 树表渲染组织（子组织默认展开可见）
 *   2. 新建弹窗：+ 新建组织 → antd Modal 表单 → 提交调 createOrganization
 *   3. 编辑弹窗：行内「编辑」→ Modal 带初值、code 只读
 *   4. 删除确认：行内「删除」→ antd Modal 二次确认 → 调 deleteOrganization
 *   5. 权限门禁：无 organization:write → 新建按钮禁用
 *
 * 测试模式：照搬 runtimes/__tests__/page.test.tsx 的 AntApp 脚手架
 * （页面 useNotify 依赖 App.useApp 上下文）+ mock @/lib/admin 数据源。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";

import AdminOrganizationsPage from "@/app/(dashboard)/admin/organizations/page";
import { useSession } from "@/stores/session";
import type { OrganizationRead } from "@/lib/admin";

// ── mock @/lib/admin：组织 CRUD 全收口，返回构造的树形 fixture ────────────────
const admin = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  getOrganization: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  disableOrganization: vi.fn(),
  enableOrganization: vi.fn(),
}));

vi.mock("@/lib/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin")>("@/lib/admin");
  return { ...actual, ...admin };
});

/** Object Mother：父子两级组织（子默认折叠在树表里，用例断言「默认展开」）。 */
function makeOrgs(): OrganizationRead[] {
  const now = "2026-09-03T06:00:00Z";
  return [
    {
      id: "hq",
      name: "总部",
      code: "hq",
      description: "集团总部",
      parent_id: null,
      status: "active",
      sort_order: 0,
      member_count: 12,
      children_count: 1,
      subtree_member_count: 20,
      created_at: now,
      updated_at: now,
    },
    {
      id: "dev",
      name: "研发部",
      code: "dev",
      description: null,
      parent_id: "hq",
      status: "disabled",
      sort_order: 1,
      member_count: 8,
      children_count: 0,
      subtree_member_count: 8,
      created_at: now,
      updated_at: now,
    },
  ];
}

const ADMIN = {
  id: "u1",
  email: "admin@test.local",
  displayName: "管理员",
  is_platform_admin: true,
};

function renderPage() {
  return render(
    <AntApp>
      <AdminOrganizationsPage />
    </AntApp>,
  );
}

beforeEach(() => {
  admin.listOrganizations.mockResolvedValue(makeOrgs());
  admin.createOrganization.mockResolvedValue({ id: "new" });
  admin.updateOrganization.mockResolvedValue({ id: "hq" });
  admin.deleteOrganization.mockResolvedValue(undefined);
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

describe("/admin/organizations 页（ql-20260903-012-7c69 antd 重构）", () => {
  it("渲染页面骨架：标题 + 树表组织行（子组织默认展开）+ 状态 Tag", async () => {
    renderPage();

    expect(await screen.findByText("组织管理")).toBeInTheDocument();
    // 树表：父子两级都可见（defaultExpandAllRows）。子行用 findBy 等待——antd
    // Table 子行在慢速 CI 机上比父行晚一个渲染提交，同步 get 会扑空（CI 连续
    // 两次红、本地恒绿的根因）。
    expect(await screen.findByText("总部")).toBeInTheDocument();
    expect(await screen.findByText("研发部")).toBeInTheDocument();
    // 状态 Tag（antd Tag 渲染文本；「启用」与行内操作按钮重名，按 ant-tag 类圈定状态列）
    const tagTexts = Array.from(document.querySelectorAll(".ant-tag")).map(
      (t) => t.textContent,
    );
    expect(tagTexts).toContain("启用");
    expect(tagTexts).toContain("禁用");
  });

  it("新建组织：+ 新建组织 → Modal 表单 → 提交调 createOrganization", async () => {
    renderPage();
    await screen.findByText("总部");

    fireEvent.click(screen.getByRole("button", { name: "+ 新建组织" }));
    // antd Modal 标题 + 表单字段
    expect(await screen.findByText("新建组织")).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "运营部" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "ops" } });
    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    await waitFor(() =>
      expect(admin.createOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ name: "运营部", code: "ops" }),
      ),
    );
  });

  it("编辑组织：行内「编辑」→ Modal 带初值且 code 只读", async () => {
    renderPage();
    await screen.findByText("总部");

    // 行内操作列的编辑按钮（antd link 按钮两字不插空格）
    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]!);
    expect(await screen.findByText("编辑组织 hq")).toBeInTheDocument();

    const codeInput = screen.getByLabelText("Code") as HTMLInputElement;
    expect(codeInput).toBeDisabled();
    expect(codeInput.value).toBe("hq");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("总部");
  });

  it("删除组织：行内「删除」→ antd Modal 二次确认 → 调 deleteOrganization", async () => {
    renderPage();
    await screen.findByText("总部");

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]!);
    expect(await screen.findByText("确认删除组织？")).toBeInTheDocument();

    // Modal ok 按钮（四字不插空格）
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(admin.deleteOrganization).toHaveBeenCalledWith("hq"));
  });

  it("权限门禁：无 organization:write → 新建按钮禁用", async () => {
    useSession.setState({
      user: { id: "u2", email: "viewer@test.local", displayName: "访客", permissions: [] },
    } as never);
    renderPage();
    await screen.findByText("总部");

    expect(screen.getByRole("button", { name: "+ 新建组织" })).toBeDisabled();
  });
});
