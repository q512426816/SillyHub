---
id: task-10
title: 前端测试 — admin-org-tree 组装/点击筛选/只显 active/新建带入（vitest）
phase: V1
priority: P1
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
depends_on:
  - task-07
  - task-08
  - task-09
blocks:
  - task-11
requirement_ids:
  - FR-03
  - FR-05
decision_ids:
  - D-001@v1
  - D-002@v1
allowed_paths:
  - frontend/src/components/__tests__/admin-org-tree.test.tsx
  - frontend/src/components/__tests__/admin-user-drawer.test.tsx
---

## 1. 目标

用 vitest（照 `admin-user-drawer.test.tsx` 风格）为新增的组织树筛选链路补前端测试：

- **admin-org-tree**（task-07 新组件）：flat organizations 按 parent_id 组装成树、点击节点触发 onSelect 筛选、只显 active（disabled 不渲染）、节点 title 含 subtree_member_count。
- **admin-user-drawer**（task-08 改造）：create 模式按 `defaultOrganizationIds` 预填 organizationIds；edit 模式忽略该 prop 仍用 user.organizations。

本 task **只加测试**，被测组件（task-07/08）和 page 接线（task-09）由前置 task 落地。覆盖 FR-03（树组装/筛选）+ FR-05（新建带入）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 5 | AdminOrgTree props `{organizations, selectedOrgId, onSelect}`；客户端按 parent_id 组装；过滤 active；顶部「全部组织」key='all'；点节点 onSelect(key==='all'?null:key) |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 6 | 新建用户 defaultOrganizationIds 预填；page 传 `selectedOrgId ? [selectedOrgId] : undefined` |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §11 D-001/D-002 | include_children 固定 true；树只显 active、subtree 含 disabled 下级 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 4 task-10 | dep task-07/08/09；P1；vitest；覆盖 FR-03/FR-05 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | 全局验收 AC-02~AC-07 | 点叶子/父组织筛选、树显 subtree_member_count、新建带入 |
| 现状代码 | `frontend/src/components/__tests__/admin-user-drawer.test.tsx:1-67` | vitest + RTL 风格：`describe/it/expect`、`render/screen/fireEvent/waitFor`、makeOrg/makeUser factory、baseProps 模式 |
| 现状代码 | `frontend/src/components/__tests__/admin-user-drawer.test.tsx:323-335` | organizations checkbox 测试范式（getByLabelText + click + checked 断言），新建带入用例照此扩展 |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `frontend/src/components/__tests__/admin-org-tree.test.tsx` | **新增**：admin-org-tree 组装树 / 点击筛选 / 只显 active / title 含 subtree_member_count 用例 | ✅ |
| `frontend/src/components/__tests__/admin-user-drawer.test.tsx` | **追加**：defaultOrganizationIds 预填（create）/ 忽略（edit）用例 | ✅ |
| `frontend/src/components/admin-org-tree.tsx` | **不改**（task-07 实现） | ❌ |
| `frontend/src/components/admin-user-drawer.tsx` | **不改**（task-08 实现） | ❌ |
| `frontend/src/app/(dashboard)/admin/users/page.tsx` | **不改**（task-09 实现；page 交互测试不在本 task 范围，组织树组件级测试已覆盖核心筛选逻辑） | ❌ |

## 4. 实现要求

1. **测试风格照 admin-user-drawer.test.tsx**：`import { describe, expect, it, vi } from "vitest"` + `import { fireEvent, render, screen, waitFor } from "@testing-library/react"`；用 factory（makeOrg）构造数据；用 baseProps 模式；断言用 `screen.getByText/getByRole/queryByText` + `.toBeInTheDocument()`。
2. **admin-org-tree.test.tsx**：新增文件。先 import 被测组件 `AdminOrgTree` from `@/components/admin-org-tree` 和 `OrganizationRead` 类型。构造多级 organizations（根 → 子 → 孙 + 一个 disabled 兄弟）覆盖组装 / 过滤 / 点击。
3. **admin-user-drawer.test.tsx**：追加用例，**不删现有用例**（现状 13 个 it 全保留）。新用例复用现有 makeOrg / makeUser / baseProps。
4. **不 mock 组件内部**：直接 render 真实组件，测真实 DOM 行为（与 admin-user-drawer.test 一致）。仅必要时 mock 外部依赖（如 listUsers 这类网络调用——但本批用例都是纯组件渲染，无需 mock）。
5. **用例命名**：核心交互用中文描述 it 标题（照现状 `create mode renders...` / `organizations checkbox toggles selection` 风格，可中英混排）。
6. **断言稳健**：用 `getByRole('tree')` / `getByText` 找节点；点击用 antd Tree 的节点触发（fireEvent.click 节点 title 元素）；不依赖内部实现细节（不查 className 私有结构）。

## 5. 接口定义

### 5.1 测试用例列表

**`admin-org-tree.test.tsx`（新增）**

| # | 用例 | 验证点 |
|---|---|---|
| T-01 | renders "全部组织" node when organizations empty | 空数组时仍渲染「全部组织」节点（key='all'），不崩 |
| T-02 | builds tree from flat organizations by parent_id | 传入根+子+孙三层 flat 列表，按 parent_id 组装成嵌套结构（根节点下含子节点） |
| T-03 | filters out disabled organizations, keeps active | 同时传 active + disabled 组织，DOM 中只显 active 组织名，不显 disabled |
| T-04 | shows subtree_member_count in node title (fallback member_count) | 组织有 subtree_member_count 时 title 含该数；缺省时 fallback member_count |
| T-05 | selects "全部组织" calls onSelect(null) | 点「全部组织」节点 → onSelect 被调用且参数为 null |
| T-06 | selects organization node calls onSelect(orgId) | 点某组织节点 → onSelect 被调用且参数为该 org.id |
| T-07 | highlights selectedOrgId node (selectedKeys) | selectedOrgId=某id 时该节点为选中态；selectedOrgId=null 时「全部组织」选中 |
| T-08 | default expands all nodes | 异步 organizations 加载后所有节点默认展开（受控 expandedKeys 含全部 key） |

**`admin-user-drawer.test.tsx`（追加，不删现有）**

| # | 用例 | 验证点 |
|---|---|---|
| T-09 | create mode pre-fills organizationIds from defaultOrganizationIds | 传 `defaultOrganizationIds=["o1"]` + create 模式 → 「全部组织」对应的 o1 组织 checkbox 默认勾选（AC-07） |
| T-10 | create mode without defaultOrganizationIds leaves orgs unchecked | 不传 / 传 undefined + create 模式 → 组织 checkbox 默认不勾（现状 `[]` 行为不变，AC-08） |
| T-11 | edit mode ignores defaultOrganizationIds, uses user.organizations | 传 `defaultOrganizationIds=["o1"]` + edit 模式 + user.organizations=[o2] → o2 勾选、o1 不勾（task-08 prop 仅 create 生效） |

### 5.2 验证命令

```bash
# 跑本 task 涉及的两个测试文件
cd frontend && pnpm exec vitest run src/components/__tests__/admin-org-tree.test.tsx src/components/__tests__/admin-user-drawer.test.tsx

# 跑全部前端单测（task-11 全量验证用）
cd frontend && pnpm test
```

注：`pnpm test` 脚本对应 vitest run（一次性，非 watch），与 task-11 的 `test_frontend` 一致。

## 6. 边界处理

| # | 场景 | 测试断言 | 责任层 |
|---|---|---|---|
| B-01 | organizations=[] | 仍渲染「全部组织」节点，selectedKeys=['all']，onSelect(null) | admin-org-tree（task-07）；测试（T-01/T-05） |
| B-02 | 多根组织（多个 parent_id=null） | 每个根都成顶层节点，不丢不重 | admin-org-tree（task-07）；测试（T-02） |
| B-03 | disabled 组织 | DOM 不渲染其节点（queryByText 返回 null） | admin-org-tree（task-07）；测试（T-03，D-002） |
| B-04 | subtree_member_count 缺省 | title fallback 显示 member_count | admin-org-tree（task-07）；测试（T-04） |
| B-05 | selectedOrgId 指向不存在组织 | 不崩，selectedKeys 仅含该 id（antd Tree 容错） | admin-org-tree（task-07）；测试可不专门覆盖（低风险） |
| B-06 | create 模式 defaultOrganizationIds 指向不存在 org | 该 org 在 organizations 列表中无 checkbox，预填无效但不报错 | drawer（task-08）；测试可不专门覆盖 |
| B-07 | edit 模式误传 defaultOrganizationIds | drawer 内部按 mode 判定，edit 忽略该 prop | drawer（task-08）；测试（T-11） |
| B-08 | create → 切换 org 勾选 → 关闭 → 重开 | 每次打开 create 模式都按 defaultOrganizationIds 重置（useEffect 依赖 open/mode） | drawer（task-08）；测试可不专门覆盖（属实现细节） |

## 7. 非目标

- 不测 page.tsx 整体（路由级 / listUsers 网络层）——核心筛选逻辑由 admin-org-tree 组件级测试覆盖，page 接线由 task-11 浏览器验收。
- 不 mock listUsers / listOrganizations（本批用例纯组件渲染，无网络调用）。
- 不改被测组件实现（task-07/08）。
- 不测 subtree_member_count 的数值正确性（属后端 organizations_service，task-05 后端测试覆盖）。
- 不测组织树展开态持久化 / 拖拽（AdminOrgTree 无此能力）。
- 不删 / 不改 admin-user-drawer.test.tsx 现有 13 个用例。

## 8. 参考源码

- `frontend/src/components/__tests__/admin-user-drawer.test.tsx:1-9`（vitest + RTL import 风格）
- `frontend/src/components/__tests__/admin-user-drawer.test.tsx:11-25`（makeOrg factory — 测试用 OrganizationRead 构造，task-06 后需加 `subtree_member_count` 字段）
- `frontend/src/components/__tests__/admin-user-drawer.test.tsx:59-67`（baseProps 模式）
- `frontend/src/components/__tests__/admin-user-drawer.test.tsx:323-335`（organizations checkbox toggle 测试范式，T-09/10 照此）
- `frontend/src/components/__tests__/admin-user-drawer.test.tsx:96-119`（edit 模式回填 user.organizations 范式，T-11 照此）
- `frontend/src/components/admin-org-tree.tsx`（task-07 实现，被测对象）
- `frontend/src/components/admin-user-drawer.tsx`（task-08 实现，被测对象；现 create 模式 organizationIds 硬编码 `[]` 在 line 75 附近）

## 9. TDD 步骤

> 严格 TDD：先写测试（红）→ 推动前置 task 实现（绿）。但本 task 依赖 task-07/08/09 已落地（plan Wave 顺序），故实际为「实现先行 + 测试补全」模式——先确认前置 task 完成，再补测试锁定行为。

1. **确认前置就绪**：task-07 已导出 `AdminOrgTree`、task-08 已加 `defaultOrganizationIds` prop、task-09 已接线 page。
2. **写 admin-org-tree.test.tsx**：按 §5.1 T-01~T-08 写 8 个用例。先 import + makeOrg factory（带 subtree_member_count 字段）+ 构造多级 fixtures。
3. **写 admin-user-drawer.test.tsx 追加用例**：按 §5.1 T-09~T-11 追加 3 个用例（不删现有）。
4. **跑测试**：`cd frontend && pnpm exec vitest run src/components/__tests__/admin-org-tree.test.tsx src/components/__tests__/admin-user-drawer.test.tsx` 确认全绿。若红，先排查是测试写错还是前置 task 实现缺陷——**实现有误时禁止改测试迁就**（CLAUDE.md 规则 8），回退到对应 task 修实现。
5. **跑全量**：`cd frontend && pnpm test` 确认未破坏其他测试。
6. **跑 lint**：`cd frontend && pnpm lint` 确认测试文件无 eslint 告警。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | admin-org-tree.test.tsx T-01~T-08 全绿 | 组装树 / 只显 active / title 含 subtree_member_count / 点击 onSelect(null\|id) / 选中态 / 默认全展开 全部通过 |
| AC-02 | admin-user-drawer.test.tsx 现有 13 用例 + T-09~T-11 全绿 | create 预填 defaultOrganizationIds / create 无 prop 不勾 / edit 忽略 prop 用 user.organizations 全通过 |
| AC-03 | `cd frontend && pnpm test`（全量） | 全绿，未破坏既有测试 |
| AC-04 | `cd frontend && pnpm lint` | 无 eslint 告警 |
| AC-05 | 仅改两个 allowed_paths 文件（新增 admin-org-tree.test.tsx + 追加 admin-user-drawer.test.tsx），`git diff --stat` 不含其他文件 | true |
| AC-06 | makeOrg factory 含 subtree_member_count 字段 | 与 task-06 的 OrganizationRead 类型一致（否则 tsc 报错） |

## 11. 完成定义

- [ ] admin-org-tree.test.tsx 新增，T-01~T-08 全绿
- [ ] admin-user-drawer.test.tsx 追加 T-09~T-11（不删现有 13 用例），全绿
- [ ] makeOrg factory 补 subtree_member_count 字段
- [ ] §10 AC-01~AC-06 全部通过
- [ ] pnpm test 全量绿 + pnpm lint 绿
- [ ] git diff 仅含两个 allowed_paths 文件
