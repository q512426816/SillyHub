---
id: task-07
title: 前端新组件 admin-org-tree.tsx — 组织树筛选（flat 组装/全部组织节点/subtree_member_count/只显 active/受控展开/onSelect）
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 1.5
depends_on:
  - task-06
blocks:
  - task-09
  - task-10
requirement_ids:
  - FR-03
decision_ids:
  - D-001@v1
  - D-002@v1
allowed_paths:
  - frontend/src/components/admin-org-tree.tsx
---

## 1. 目标

新增左侧组织树筛选组件 `AdminOrgTree`，作为 `/admin/users` 页主体布局左 `<aside>` 的内容（task-09 负责接入布局与传 `selectedOrgId`）。组件职责：

- 接收扁平 `organizations: OrganizationRead[]`，客户端按 `parent_id` 组装成树。
- 仅显示 `status === 'active'` 的组织（disabled 不显示，但其成员数仍计入父节点 `subtree_member_count`，由后端聚合，D-002@v1）。
- 顶部固定「全部组织」节点（key=`'all'`），各组织节点 key=org.id。
- 节点 title = 组织名 + `subtree_member_count`（fallback `member_count`）。
- antd `Tree` 受控：`expandedKeys` 默认全展开（避免异步 treeData 下 `defaultExpandAll` 不可靠）、`selectedKeys=[selectedOrgId ?? 'all']`、`onSelect` → `onSelect(key === 'all' ? null : key)`。

本 task **只新增组件文件**，不改 lib / page / drawer。组件在 task-09 被 `<AdminOrgTree organizations={...} selectedOrgId={...} onSelect={...} />` 接入。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 5 | props `{organizations, selectedOrgId, onSelect}`；按 parent_id 组装；过滤 active；顶部「全部组织」key='all'；title=name+subtree_member_count(fallback member_count)；Tree 受控 expandedKeys 全展开 + selectedKeys + onSelect |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §10 R-04 | flat 组装正确性：parent_id 自引用无环，组装时 visited set 防御 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/decisions.md`（design §11） | D-001@v1 | include_children 固定 true（树点击即含下级，组件不暴露开关） |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/decisions.md`（design §11） | D-002@v1 | 树只显 active；subtree_member_count 含 disabled 下级 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 2 task-07 | 覆盖 FR-03, D-001, D-002；dep task-06 |
| 现状代码 | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:241-274` | antd Tree `TreeDataNode` 用法：title 用 JSX `<span className="flex items-center justify-between gap-2">name + count</span>`；根节点「全部」font-medium |
| 现状代码 | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:279-286` | 受控 expandedKeys 全展开：`allTreeKeys` useMemo 收集所有 key（注释说明 defaultExpandAll 异步不可靠，改受控） |
| 现状代码 | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:593-602` | antd `<Tree blockNode treeData expandedKeys selectedKeys onSelect>` 用法 |
| 现状代码 | `frontend/src/lib/admin.ts:219-231` | `OrganizationRead` 字段（id/name/parent_id/status/member_count/children_count，task-06 加 subtree_member_count） |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `frontend/src/components/admin-org-tree.tsx` | **新增**组件文件 | ✅ |

## 4. 实现要求

1. 组件为纯展示 + 客户端组装，无自身数据请求（`organizations` 由父组件 task-09 通过 `listOrganizations()` 拉取后传入）。
2. 组装算法：先按 `parent_id` 分组（`Map<parent_id|null, OrganizationRead[]>`），从 `parent_id === null` 的根组织递归构建 children；递归时维护 `visited: Set<string>` 防御自引用环（design R-04，理论上 `update_organization` 有环检测不会出现，但组件层防御）。
3. 过滤 `status === 'active'`：组装前先 `organizations.filter(o => o.status === 'active')`，disabled 组织整体不进树（但其成员已聚合进父节点 `subtree_member_count`，由后端算，组件不重算）。
4. 顶部「全部组织」节点：`key='all'`，title 用 JSX `<span className="flex items-center justify-between gap-2 font-medium"><span>全部组织</span><span className="text-xs text-muted-foreground">{totalMembers}</span></span>`。`totalMembers` 取所有 active 组织 `subtree_member_count` 不合适（会重复累加子树），改为不显示数字或显示 active 组织数量——**本 task 「全部组织」节点不显示成员数**（成员总数由后端 total 在右侧表格体现），仅显示文字「全部组织」，避免重复累加歧义。
5. 各组织节点 title：`<span className="flex items-center justify-between gap-2"><span className="truncate">{o.name}</span><span className="text-xs text-muted-foreground">{o.subtree_member_count ?? o.member_count}</span></span>`。fallback `member_count` 防御后端 task-02 未落地或字段缺失（design §9 兼容）。
6. antd `Tree` 受控：
   - `treeData` = `[{ title: 全部组织, key: 'all', children: <组织树> }]`。
   - `expandedKeys` = 所有节点 key（含 `'all'` + 所有 active org.id）的 useMemo，**强制全展开**（参考 project-plans page.tsx:279-286 注释：异步 treeData 下 defaultExpandAll 不可靠）。
   - `selectedKeys = [selectedOrgId ?? 'all']`。
   - `onSelect={(keys) => { const k = keys[0] as string | undefined; onSelect(k === 'all' || k === undefined ? null : k); }}`。
   - `blockNode`（整行可点击，参考 project-plans page.tsx:594）。
7. 树为只读筛选器，不显示连接线、不支持多选、不支持拖拽（`selectable` 默认 true，`multiple={false}`）。
8. 组件 `"use client"`（用 antd Tree + useMemo，需客户端组件）。
9. import 风格：`import { Tree, type TreeDataNode } from "antd";` + `import type { OrganizationRead } from "@/lib/admin";`（参考 project-plans page.tsx:16-23, 37-42）。

## 5. 接口定义（精确到 props + 组装函数签名）

### 5.1 组件 props

```ts
export interface AdminOrgTreeProps {
  /** 扁平组织列表（含 disabled，组件内部过滤 active）。来自 listOrganizations()。 */
  organizations: OrganizationRead[];
  /** 当前选中组织 id；null = 「全部组织」。 */
  selectedOrgId: string | null;
  /** 点击节点回调：点「全部组织」或取消选中 → null；点组织 → org.id。 */
  onSelect: (id: string | null) => void;
}
```

### 5.2 内部组装函数（模块级，纯函数，可单测）

```ts
/** 按 parent_id 组装树（仅 active 组织）。返回不含「全部组织」根节点的组织子树。 */
function buildOrgTree(orgs: OrganizationRead[]): TreeDataNode[]

/** 收集树所有 key（用于受控 expandedKeys 全展开）。 */
function collectAllKeys(nodes: TreeDataNode[]): string[]
```

`buildOrgTree` 实现要点：
- `const active = orgs.filter(o => o.status === "active");`
- `const byParent = new Map<string | null, OrganizationRead[]>();` 分组。
- 根 = `byParent.get(null) ?? []`，递归 `buildNode(org)`：
  - `children = (byParent.get(org.id) ?? []).map(buildNode)`（递归前 visited.add(org.id) 防环）。
  - `title` JSX（name + `subtree_member_count ?? member_count`）。
  - `key = org.id`。
  - `isLeaf = children.length === 0`。

### 5.3 组件签名

```tsx
export function AdminOrgTree({
  organizations,
  selectedOrgId,
  onSelect,
}: AdminOrgTreeProps): JSX.Element
```

组件内部：
```tsx
const orgTree = useMemo(() => buildOrgTree(organizations), [organizations]);
const treeData = useMemo<TreeDataNode[]>(() => [
  { title: <span className="...font-medium">全部组织</span>, key: "all", children: orgTree },
], [orgTree]);
const allKeys = useMemo<string[]>(
  () => ["all", ...collectAllKeys(orgTree)],
  [orgTree],
);
return (
  <Tree
    blockNode
    treeData={treeData}
    expandedKeys={allKeys}
    selectedKeys={[selectedOrgId ?? "all"]}
    onSelect={(keys) => {
      const k = keys[0] as string | undefined;
      onSelect(!k || k === "all" ? null : k);
    }}
  />
);
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `organizations=[]` 空数组 | 树仅显「全部组织」节点（无子节点），selectedKeys=['all'] | 组件（本 task） |
| B-02 | 全部组织 disabled | active 过滤后无组织节点，同 B-01 | 组件（本 task） |
| B-03 | 组织 `subtree_member_count` 缺失（后端未落地） | fallback 显示 `member_count`（`?? member_count`） | 组件（本 task）；后端（task-02） |
| B-04 | `selectedOrgId=null` | selectedKeys=['all']，高亮「全部组织」 | 组件（本 task） |
| B-05 | `selectedOrgId` 指向一个 disabled 组织（理论上父组件不会传，但防御） | 该 id 不在 active 树 key 中，antd Tree selectedKeys 不命中任何节点（无高亮），不报错 | 组件（本 task） |
| B-06 | parent_id 形成自引用环（防御，理论不发生） | `visited` set 阻断递归，避免无限循环 | 组件（本 task，design R-04） |
| B-07 | 多根组织（多个 parent_id=null） | 全部作为「全部组织」下的并列 children | 组件（本 task） |
| B-08 | 点击已选中节点（antd 默认允许取消选中） | `keys[0]` 为 undefined → `onSelect(null)`，回到「全部组织」语义 | 组件（本 task） |

## 7. 非目标

- 不做组织 CRUD（新建/编辑/删除组织走 `/admin/organizations` 页，不在本组件）。
- 不做 `include_children` UI 开关（D-001@v1 固定 true，点击即含下级）。
- 不在树中显示 disabled 组织（D-002@v1，UI 仅 active）。
- 不做节点搜索 / 拖拽排序 / 虚拟滚动（YAGNI，组织量小）。
- 不做「全部组织」成员数显示（避免子树重复累加歧义；成员总数由右侧表格 total 体现）。
- 不发起数据请求（organizations 由父组件传入，职责分离）。
- 不改 lib / page / drawer（task-06 / task-09 / task-08）。

## 8. 参考

- `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:241-274`（managerTreeData 组装：TreeDataNode title JSX span flex justify-between name+count，根节点 font-medium）
- `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:279-286`（allTreeKeys 受控全展开 + 注释「defaultExpandAll 异步不可靠」）
- `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:593-602`（antd Tree blockNode + expandedKeys + selectedKeys + onSelect 用法）
- `frontend/src/lib/admin.ts:219-231`（OrganizationRead 字段；task-06 后含 subtree_member_count）
- `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` §5 Phase 5 / §10 R-04 / §11 D-001 D-002

## 9. TDD 步骤

> 聚焦「树组装正确性 / active 过滤 / fallback / onSelect 映射」，组件渲染用 @testing-library。

1. **先写测试**（`frontend/src/components/__tests__/admin-org-tree.test.tsx` 新增）：
   - `test_build_tree_by_parent_id`：传入扁平 `[rootA(parent=null), childA1(parent=rootA), rootB(parent=null)]`，断言 buildOrgTree 返回 2 个根节点，rootA 有 1 个 child。
   - `test_filters_disabled`：传入含一个 disabled 组织，断言树中无该节点（但其父节点仍存在）。
   - `test_fallback_member_count`：传入 `subtree_member_count` 为 undefined 的组织（模拟旧后端），断言 title 渲染 `member_count` 值。
   - `test_selected_org_id_highlights_node`：`selectedOrgId=orgA.id`，断言 Tree `selectedKeys=[orgA.id]`；`selectedOrgId=null` 断言 `selectedKeys=['all']`。
   - `test_on_select_all_returns_null`：点击「全部组织」节点，断言 `onSelect` 被调用参数 `null`。
   - `test_on_select_org_returns_id`：点击某组织节点，断言 `onSelect` 被调用参数为该 org.id。
   - `test_all_keys_expanded`：断言 expandedKeys 含 'all' + 所有 active org.id（全展开）。
   - `test_cycle_defense`：构造 parent_id 自引用环（mock 数据），断言 buildOrgTree 不无限递归（visited 防御）。
2. **跑测试**确认全红（组件未实现）。
3. **实现组件**（按 §5 buildOrgTree + collectAllKeys + AdminOrgTree）。
4. **跑测试**确认全绿。
5. `tsc --noEmit` + `eslint` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 渲染 `AdminOrgTree` 传入多层级 active 组织 | 树按 parent_id 正确组装，「全部组织」为根，各级组织为 children |
| AC-02 | 传入含 disabled 组织 | 树中不显示 disabled 节点（D-002@v1） |
| AC-03 | 组织节点 title | 显示「组织名 + subtree_member_count」（fallback member_count） |
| AC-04 | `selectedOrgId=null` | 「全部组织」节点高亮（selectedKeys=['all']） |
| AC-05 | 点击「全部组织」节点 | `onSelect(null)` 被调用 |
| AC-06 | 点击某组织节点 | `onSelect(org.id)` 被调用（D-001@v1 含下级语义由 page 层 include_children=true 体现） |
| AC-07 | expandedKeys | 含 'all' + 所有 active org.id，树默认全展开 |
| AC-08 | `organizations=[]` | 仅显「全部组织」节点，不报错 |
| AC-09 | `tsc --noEmit` | 无类型错误 |
| AC-10 | `eslint frontend/src/components/admin-org-tree.tsx` | 无告警 |
| AC-11 | `git diff --stat` 仅含新增 `frontend/src/components/admin-org-tree.tsx` | true |

## 11. 完成定义

- [ ] §5.1 AdminOrgTreeProps 落地
- [ ] §5.2 buildOrgTree + collectAllKeys 纯函数落地（含 active 过滤、visited 防环）
- [ ] §5.3 AdminOrgTree 组件落地（antd Tree 受控全展开 + onSelect 映射）
- [ ] §9 TDD 测试用例全绿
- [ ] §10 AC-01~AC-11 全部通过
- [ ] `git diff` 仅含新增 `frontend/src/components/admin-org-tree.tsx`
