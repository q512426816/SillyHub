import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AdminOrgTree } from "@/components/admin-org-tree";
import type { OrganizationRead } from "@/lib/admin";

// antd Tree 内部 rc-resize-observer 依赖 ResizeObserver,jsdom 无此全局,
// 补一个 no-op polyfill 否则渲染即抛 "ResizeObserver is not defined"。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * 测试用 OrganizationRead factory(含 subtree_member_count 字段,与
 * OrganizationRead 类型一致——AC-06)。subtree 缺省传 undefined 触发 fallback。
 */
function makeOrg(
  id: string,
  name: string,
  overrides: Partial<OrganizationRead> = {},
): OrganizationRead {
  return {
    id,
    name,
    code: id,
    description: null,
    parent_id: null,
    status: "active",
    sort_order: 0,
    member_count: 0,
    children_count: 0,
    subtree_member_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// antd Tree 在 jsdom 中渲染 role="treeitem";title 文本在 .ant-tree-title 内。
// 点击 .ant-tree-node-content-wrapper(标题容器)触发 onSelect。
function treeitemByTitle(title: string): HTMLElement {
  // title 文本(组织名 / 成员数)渲染在 treeitem 内,getByText 精确匹配组织名,
  // 再上溯到 role="treeitem"。
  const titleEl = screen.getByText(title);
  const item = titleEl.closest('[role="treeitem"]') as HTMLElement;
  return item;
}

// antd Tree 标题点击区:.ant-tree-node-content-wrapper
function clickTitleOf(title: string): void {
  const titleEl = screen.getByText(title);
  const wrapper = titleEl.closest(".ant-tree-node-content-wrapper") as HTMLElement;
  fireEvent.click(wrapper);
}

describe("AdminOrgTree", () => {
  it("T-01: 空 organizations 仍渲染「全部组织」节点,不崩", () => {
    render(
      <AdminOrgTree
        organizations={[]}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    // 「全部组织」根节点存在
    expect(screen.getByText("全部组织")).toBeInTheDocument();
    // role=tree 渲染成功
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("T-02: 按 parent_id 组装树(根 + 子 + 孙三层)", () => {
    const orgs: OrganizationRead[] = [
      makeOrg("root", "总公司"),
      makeOrg("child", "分公司A", { parent_id: "root" }),
      makeOrg("grandchild", "部门A1", { parent_id: "child" }),
    ];
    render(
      <AdminOrgTree
        organizations={orgs}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    // 三个组织名都渲染出来(全展开 + 按 parent_id 正确组装未丢节点)
    expect(screen.getByText("总公司")).toBeInTheDocument();
    expect(screen.getByText("分公司A")).toBeInTheDocument();
    expect(screen.getByText("部门A1")).toBeInTheDocument();
    // 层级:antd Tree v6 在 jsdom 平铺 treeitem(父子非 DOM 嵌套,也不设
    // aria-level),改用 document order 验证组装后的树形 —— 全展开下根在前、
    // 子居中、孙在后,顺序正确即证明按 parent_id 组装成功(design §4.6,不依赖
    // 内部实现细节)。
    const allItems = screen.getAllByRole("treeitem");
    const rootIdx = allItems.indexOf(treeitemByTitle("总公司"));
    const childIdx = allItems.indexOf(treeitemByTitle("分公司A"));
    const grandIdx = allItems.indexOf(treeitemByTitle("部门A1"));
    expect(rootIdx).toBeLessThan(childIdx);
    expect(childIdx).toBeLessThan(grandIdx);
  });

  it("T-03: 只显 active(disabled 整体不进树)", () => {
    const orgs: OrganizationRead[] = [
      makeOrg("active1", "在线组织"),
      makeOrg("disabled1", "停用组织", { status: "disabled" }),
    ];
    render(
      <AdminOrgTree
        organizations={orgs}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("在线组织")).toBeInTheDocument();
    expect(screen.queryByText("停用组织")).not.toBeInTheDocument();
  });

  it("T-04: 节点 title 含 subtree_member_count(fallback member_count)", () => {
    // ① 有 subtree_member_count → title 显示该数
    const { rerender } = render(
      <AdminOrgTree
        organizations={[
          makeOrg("o1", "总公司A", { subtree_member_count: 42 }),
        ]}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();

    // ② subtree_member_count 缺省 → fallback member_count
    rerender(
      <AdminOrgTree
        organizations={[
          makeOrg("o2", "总公司B", {
            subtree_member_count: undefined as unknown as number,
            member_count: 7,
          }),
        ]}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("T-05: 点「全部组织」→ onSelect(null)", () => {
    const onSelect = vi.fn();
    render(
      <AdminOrgTree
        organizations={[makeOrg("o1", "组织X")]}
        selectedOrgId={null}
        onSelect={onSelect}
      />,
    );
    clickTitleOf("全部组织");
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("T-06: 点组织节点 → onSelect(orgId)", () => {
    const onSelect = vi.fn();
    render(
      <AdminOrgTree
        organizations={[makeOrg("o1", "组织X")]}
        selectedOrgId={null}
        onSelect={onSelect}
      />,
    );
    clickTitleOf("组织X");
    expect(onSelect).toHaveBeenCalledWith("o1");
  });

  it("T-07: selectedOrgId 命中 → 该节点选中态;null → 「全部组织」选中", () => {
    const orgs: OrganizationRead[] = [makeOrg("o1", "组织X")];
    const { rerender } = render(
      <AdminOrgTree
        organizations={orgs}
        selectedOrgId={"o1"}
        onSelect={() => {}}
      />,
    );
    // 选中态:antd 给选中 treeitem 加 aria-selected=true
    const orgItem = treeitemByTitle("组织X");
    expect(orgItem.getAttribute("aria-selected")).toBe("true");
    const allItem = treeitemByTitle("全部组织");
    expect(allItem.getAttribute("aria-selected")).toBe("false");

    // selectedOrgId=null → 「全部组织」选中
    rerender(
      <AdminOrgTree
        organizations={orgs}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    const allItem2 = treeitemByTitle("全部组织");
    expect(allItem2.getAttribute("aria-selected")).toBe("true");
  });

  it("T-08: 默认全展开(所有节点 expanded)", () => {
    const orgs: OrganizationRead[] = [
      makeOrg("root", "总公司"),
      makeOrg("child", "分公司A", { parent_id: "root" }),
      makeOrg("grandchild", "部门A1", { parent_id: "child" }),
    ];
    render(
      <AdminOrgTree
        organizations={orgs}
        selectedOrgId={null}
        onSelect={() => {}}
      />,
    );
    // 全展开 → 孙节点(最深层)也可见;且根/子 treeitem aria-expanded=true
    expect(screen.getByText("部门A1")).toBeInTheDocument();
    const rootItem = treeitemByTitle("总公司");
    expect(rootItem.getAttribute("aria-expanded")).toBe("true");
    // 「全部组织」根也展开
    const allItem = treeitemByTitle("全部组织");
    expect(allItem.getAttribute("aria-expanded")).toBe("true");
  });
});
