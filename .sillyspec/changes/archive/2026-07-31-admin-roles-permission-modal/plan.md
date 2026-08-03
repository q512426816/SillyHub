---
author: WhaleFall
created_at: 2026-07-31T15:05:25
plan_level: full
---

# 实现计划（Plan）— /admin/roles 新建弹窗 + 权限左树右权

> 变更 `2026-07-31-admin-roles-permission-modal` · 方案 B · brainstorm 自审 passed

## Spike 前置验证

无。design 已核对代码引用(RoleDrawer :441-520、picker :29-31 默认全展开、menu-permissions 38 menu / MENU_SECTION_ORDER),grep 确认 picker 仅 /admin/roles 用(无共用兼容负担)。无技术不确定性,**跳过 Spike**。

## Wave 1 — 实现

- [x] task-01: `admin/roles/page.tsx` RoleDrawer(:441-520)抽屉 → antd Modal(居中 w-720),字段/校验/保存/只读逻辑迁移不变(覆盖 FR-01, D-001)
- [x] task-02: `admin-role-permission-picker.tsx` 重写为左树(section/menu 带选中数 n/m + 高亮)+ 右权限面板(全选/indeterminate + 权限列表),高度固定 h-420 左右滚动,默认选第一个 menu(覆盖 FR-02/03/04, D-002/003)

## Wave 2 — 测试

- [x] task-03: `admin-role-permission-picker` 左树右权测试(切换/全选/indeterminate/选中数/默认选/ disabled)(覆盖 FR-02/03/04)
- [x] task-04: RoleDrawer→Modal 测试(居中 Modal + 字段/保存/只读不变)(覆盖 FR-01)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | RoleDrawer 抽屉→Modal | W1 | P0 | — | FR-01, D-001 |
| task-02 | picker 重写左树右权 | W1 | P0 | — | FR-02/03/04, D-002/003 |
| task-03 | picker 左树右权测试 | W2 | P0 | task-02 | FR-02/03/04 |
| task-04 | RoleDrawer→Modal 测试 | W2 | P0 | task-01 | FR-01 |

## 关键路径

- **Modal 链路**:task-01(RoleDrawer→Modal 外壳 + 字段迁移)。
- **picker 链路**(核心):task-02(左树右权重写)→ task-03(测试)。复用 MENU_SECTION_ORDER/MENU_PERMISSION_GROUPS + togglePermission/toggleMenuAll。
- task-01 与 task-02 文件隔离可并行(page 改 drawer,picker 独立组件)。

## 全局验收标准

- [ ] 新建/编辑开居中 Modal(非右侧抽屉),字段/校验/保存/只读不变(task-01, 04)
- [ ] 权限区左树(section/menu 带选中数)+ 右面板(全选/indeterminate/权限列表),点节点切换(task-02, 03)
- [ ] 权限区高度固定(h-420),左右内部滚动,不随 menu 数拉长(task-02, 03)
- [ ] 右面板默认选第一个 menu,非空(task-02, 03)
- [ ] 后端 / menu-permissions 数据 0 改(FR-05)
- [ ] frontend vitest + typecheck 绿

## 覆盖矩阵（decisions）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（抽屉→Modal） | task-01, 04 | antd Modal w-720 居中 + 字段迁移 |
| D-002@v1（左树右权） | task-02, 03 | 左 section/menu 树 + 右权限面板 |
| D-003@v1（picker prop 契约不变） | task-02 | permissions/onChange/disabled 不变,仅 /admin/roles 用 |
| D-004@v1（后端/menu 数据 0 改） | — | 无后端 task |

## 风险对齐（design §8）

- **R1（共用兼容，已闭环）**：picker 仅 /admin/roles 用(grep 确认),无兼容负担。
- **R2（小屏拥挤）**：task-02 左树 200px 固定 + 右面板 flex-1,Modal 720 桌面足够。
- **R3（默认选 menu）**：task-02 默认选第一个非 pickerHidden menu。
- **R4（Modal vs 抽屉）**：task-01 保存/取消/onClose 逻辑复用,仅外壳换。
