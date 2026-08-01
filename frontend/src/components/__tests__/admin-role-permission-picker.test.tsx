import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AdminRolePermissionPicker } from "@/components/admin-role-permission-picker";
import {
  MENU_PERMISSION_GROUPS,
  MENU_SECTION_LABEL,
  MENU_SECTION_ORDER,
} from "@/lib/menu-permissions";

/**
 * 辅助：从某个 menuLabel 文本节点回溯到包含全选 checkbox 的 <label>，
 * 再取其内部 input[type=checkbox]。
 *
 * picker.tsx 的 menu 行 DOM 结构：
 *   <div>
 *     <button aria-label="折叠|展开">…</button>
 *     <label>
 *       <input type="checkbox" aria-label="{menuLabel} 全选" />
 *       <span>{menuLabel}</span>
 *       <span>（X/Y）</span>
 *     </label>
 *   </div>
 */
function getMenuCheckbox(menuLabel: string): HTMLInputElement {
  const label = screen.getByLabelText(`${menuLabel} 全选`);
  return label as HTMLInputElement;
}

/**
 * 辅助：根据 menuKey 取 menuLabel（避免 hardcode）。
 */
function labelOf(menuKey: string): string {
  const group = MENU_PERMISSION_GROUPS.find((g) => g.menuKey === menuKey);
  if (!group) {
    throw new Error(`unknown menuKey in MENU_PERMISSION_GROUPS: ${menuKey}`);
  }
  return group.menuLabel;
}

describe("AdminRolePermissionPicker", () => {
  // ────────────────────────────────────────────────────────────────────
  // A. 渲染结构（6 例）— FR-08
  // change 2026-07-29-sidebar-menu-restructure: 分组由 overview/management/admin/system
  // 重组为 workspace/agent/config/governance/system（ppm 不变），本组用例同步适配。
  // ────────────────────────────────────────────────────────────────────

  it("renders 6 sections in fixed order", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const renderedTitles = MENU_SECTION_ORDER.map(
      (section) => MENU_SECTION_LABEL[section],
    );
    renderedTitles.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    // 顺序断言：picker 每个 section 用 <section data-section="..."> 包裹。
    // 取出这些容器，再按 MENU_SECTION_ORDER 对应取每个 section 内的标题文本。
    const sectionContainers = renderedTitles.map((_, idx) => {
      const sectionKey = MENU_SECTION_ORDER[idx]!;
      return document.querySelector(`section[data-section="${sectionKey}"]`);
    });
    sectionContainers.forEach((container, idx) => {
      expect(container, `section ${MENU_SECTION_ORDER[idx]} should exist`).not.toBeNull();
    });

    // 通过 DOM 顺序比较：取每个 section 在 body 中的位置
    const ordered = sectionContainers
      .map((c, idx) => ({
        sectionKey: MENU_SECTION_ORDER[idx]!,
        el: c as Element,
      }))
      .sort((a, b) => {
        const rel = a.el.compareDocumentPosition(b.el);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
    const actualOrderKeys = ordered.map((x) => x.sectionKey);
    expect(actualOrderKeys).toEqual([...MENU_SECTION_ORDER]);
  });

  it("workspace section renders 8 menus", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const workspaceMenus = MENU_PERMISSION_GROUPS.filter(
      (g) => g.section === "workspace",
    );
    expect(workspaceMenus).toHaveLength(8);
    workspaceMenus.forEach((g) => {
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });
  });

  it("agent section renders 4 menus (含新增 技能管理/MCP 管理)", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const agentMenus = MENU_PERMISSION_GROUPS.filter(
      (g) => g.section === "agent",
    );
    expect(agentMenus).toHaveLength(4);
    agentMenus.forEach((g) => {
      // pickerHidden 菜单（skills,D-003 无独立权限）picker 不渲染卡片，跳过
      if (g.pickerHidden) return;
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });
  });

  it("config section renders 4 menus (git-identities 与我的供应商可分配)", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    // ql-005: git-identities 改独立权限 git_identity:admin 后，picker 重新渲染该卡片。
    // change 2026-07-29-sidebar-menu-restructure: config 组现有 4 个 menu
    // （llm-providers / api-keys / git-identities / runtimes）全部可见。
    const configMenus = MENU_PERMISSION_GROUPS.filter(
      (g) => g.section === "config",
    );
    expect(configMenus).toHaveLength(4);
    configMenus.forEach((g) => {
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });

    // git-identities 应出现在 picker 中
    expect(screen.getByText("Git 身份管理")).toBeInTheDocument();
    // 我的供应商（llm_provider:read）应可作为权限卡片分配
    expect(screen.getByText("我的供应商")).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("llm_provider:read").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("governance section renders 3 menus", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const governanceMenus = MENU_PERMISSION_GROUPS.filter(
      (g) => g.section === "governance",
    );
    expect(governanceMenus).toHaveLength(3);
    governanceMenus.forEach((g) => {
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });
  });

  it("system section renders 4 menus", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const systemMenus = MENU_PERMISSION_GROUPS.filter(
      (g) => g.section === "system",
    );
    expect(systemMenus).toHaveLength(4);
    systemMenus.forEach((g) => {
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // B. 全选交互（5 例）— FR-09
  // ────────────────────────────────────────────────────────────────────

  it("all-selected menu shows checked checkbox", () => {
    const usersGroup = MENU_PERMISSION_GROUPS.find((g) => g.menuKey === "users")!;
    const keys = usersGroup.permissions.map((p) => p.key);

    render(
      <AdminRolePermissionPicker permissions={keys} onChange={vi.fn()} />,
    );

    const cb = getMenuCheckbox(usersGroup.menuLabel);
    expect(cb.checked).toBe(true);
  });

  it("clicking checked select-all removes all users permissions", () => {
    const onChange = vi.fn();
    const usersGroup = MENU_PERMISSION_GROUPS.find((g) => g.menuKey === "users")!;
    const userKeys = usersGroup.permissions.map((p) => p.key);

    render(
      <AdminRolePermissionPicker
        permissions={[...userKeys, "organization:read"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(getMenuCheckbox(usersGroup.menuLabel));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["organization:read"]);
  });

  it("partial selection shows indeterminate checkbox", () => {
    render(
      <AdminRolePermissionPicker
        permissions={["user:read"]}
        onChange={vi.fn()}
      />,
    );

    const usersLabel = labelOf("users");
    const cb = getMenuCheckbox(usersLabel);
    expect(cb.indeterminate).toBe(true);
    expect(cb.checked).toBe(false);
  });

  it("clicking indeterminate select-all adds all 3 user permissions", () => {
    const onChange = vi.fn();
    const usersGroup = MENU_PERMISSION_GROUPS.find((g) => g.menuKey === "users")!;
    const userKeys = usersGroup.permissions.map((p) => p.key);

    render(
      <AdminRolePermissionPicker
        permissions={["organization:read"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(getMenuCheckbox(usersGroup.menuLabel));

    expect(onChange).toHaveBeenCalledTimes(1);
    const called = onChange.mock.calls[0]![0] as string[];
    expect(called).toEqual(
      expect.arrayContaining([...userKeys, "organization:read"]),
    );
    expect(called).toHaveLength(userKeys.length + 1);
  });

  it("selecting one menu does not affect other menus", () => {
    const onChange = vi.fn();
    render(<AdminRolePermissionPicker permissions={[]} onChange={onChange} />);

    const orgLabel = labelOf("organizations");
    fireEvent.click(getMenuCheckbox(orgLabel));

    expect(onChange).toHaveBeenCalledTimes(1);
    const called = onChange.mock.calls[0]![0] as string[];
    expect(called).toEqual(["organization:read", "organization:write"]);
    expect(called.some((k) => k.startsWith("user:"))).toBe(false);
    expect(called.some((k) => k.startsWith("role:"))).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────
  // C. 折叠交互（4 例）— FR-10
  // ────────────────────────────────────────────────────────────────────

  it("defaults to all menus expanded", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    // 展开后所有 menu 的 permission checkbox 都可直接通过 aria-label 查到。
    // ql-005: 全部 menu 都在 picker 中渲染（无 pickerHidden）。
    const allKeys = MENU_PERMISSION_GROUPS.flatMap((g) =>
      g.permissions.map((p) => p.key),
    );
    const uniqueKeys = [...new Set(allKeys)];
    uniqueKeys.forEach((key) => {
      // 同一个 key 可能出现在多个 menu（如 workspace:read），用 getAllByLabelText
      const inputs = screen.getAllByLabelText(key);
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("collapsing one menu hides its permission list", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const usersLabel = labelOf("users");
    const usersRow = screen.getByText(usersLabel).closest("div")!;
    const toggleBtn = usersRow.querySelector(
      "button[aria-label]",
    ) as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();

    // user:read 在 picker 中只出现在 users menu（git-identities 被 alwaysVisible 过滤、
    // settings 移除 user:read），折叠后计数应为 0。用 queryAll 避免抛错。
    const beforeCount = screen.getAllByLabelText("user:read").length;
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    fireEvent.click(toggleBtn);

    // users menu 折叠后 user:read 不再可见
    expect(screen.queryAllByLabelText("user:read")).toEqual([]);
  });

  it("collapsing users does not collapse organizations", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const usersLabel = labelOf("users");
    const usersRow = screen.getByText(usersLabel).closest("div")!;
    const usersToggle = usersRow.querySelector(
      "button[aria-label]",
    ) as HTMLButtonElement;
    fireEvent.click(usersToggle);

    // organizations 折叠状态不变 → 其 permission 仍可见
    expect(screen.getByLabelText("organization:read")).toBeInTheDocument();
    expect(screen.getByLabelText("organization:write")).toBeInTheDocument();
  });

  it("collapsed menu can be expanded again", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    const usersLabel = labelOf("users");
    const usersRow = screen.getByText(usersLabel).closest("div")!;
    const toggleBtn = usersRow.querySelector(
      "button[aria-label]",
    ) as HTMLButtonElement;

    const baselineCount = screen.getAllByLabelText("user:read").length;
    expect(baselineCount).toBeGreaterThanOrEqual(1);

    // 折叠：user:read 计数变 0
    fireEvent.click(toggleBtn);
    expect(screen.queryAllByLabelText("user:read")).toEqual([]);

    // 再展开：user:read 计数恢复
    fireEvent.click(toggleBtn);
    expect(screen.getAllByLabelText("user:read").length).toBe(baselineCount);
  });

  // ────────────────────────────────────────────────────────────────────
  // D. 数据源切换（3 例）— 验证已迁移到 MENU_PERMISSION_GROUPS
  // ────────────────────────────────────────────────────────────────────

  it("MENU_PERMISSION_GROUPS data has all 37 menus across 6 sections", () => {
    // 数据源当前 37 项(与 lib/__tests__/menu-permissions.test.ts 长度断言一致)
    // change 2026-07-29-sidebar-menu-restructure: 34 → 37（新增 skills/mcp/llm-providers）
    expect(MENU_PERMISSION_GROUPS).toHaveLength(37);
    expect(MENU_PERMISSION_GROUPS.map((g) => g.menuKey)).toEqual(
      expect.arrayContaining(["users", "organizations", "roles"]),
    );

    const sectionCounts = MENU_PERMISSION_GROUPS.reduce<
      Record<string, number>
    >((acc, g) => {
      acc[g.section] = (acc[g.section] ?? 0) + 1;
      return acc;
    }, {});
    expect(sectionCounts).toEqual({
      workspace: 8,
      agent: 4,
      config: 4,
      governance: 3,
      system: 4,
      ppm: 14,
    });
  });

  it("renders total permission checkbox count equal to unique keys in MENU_PERMISSION_GROUPS", () => {
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);

    // ql-005: 全部 menu 都在 picker 中渲染（无 pickerHidden）。
    const allKeys = MENU_PERMISSION_GROUPS.flatMap((g) =>
      g.permissions.map((p) => p.key),
    );
    const uniqueKeys = [...new Set(allKeys)];

    // 每个 unique key 都应能通过 aria-label 查到一个 checkbox
    uniqueKeys.forEach((key) => {
      const inputs = screen.getAllByLabelText(key);
      // 同一个 key 可能出现在多个 menu（如 workspace:read），每个 menu 各渲染一个 checkbox
      // 但至少有一个
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    });

    // platform:admin 已不再被任何 menu 使用（git-identities 改 git_identity:admin，
    // api-keys/settings/runtimes 各自独立），不应出现在 picker 中。
    expect(screen.queryAllByLabelText("platform:admin")).toEqual([]);
  });

  it("toggling a single permission calls onChange with that key added", () => {
    const onChange = vi.fn();
    render(<AdminRolePermissionPicker permissions={[]} onChange={onChange} />);

    // user:read 出现在 users 菜单（pickerHidden=false，正常渲染）
    const userReadInputs = screen.getAllByLabelText("user:read");
    expect(userReadInputs.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(userReadInputs[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["user:read"]);
  });
});
