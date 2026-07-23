---
author: qinyi
created_at: 2026-07-23 10:50:00
---
# 实现计划（Plan）— 里程碑明细移动端整页完整复刻

## 0. 分级结果
```
plan_level: full
reason: 预计 16+ 任务、8 文件（移动新增 7 + 入口改 1）+ 桌面抽取重构；需并行 sub-agent 调研 + 人工审查
estimated_files: 8（移动）+ 桌面抽取（重构非新功能）
cross_module: false（全在 frontend/ 模块内）
has_schema_change: false（纯前端，无后端）
has_state_machine_change: false（明细业务状态由后端 fsm.py 管，前端不改状态机）
needs_parallel_execution: false（Wave 间串行依赖）
needs_human_review: true
```

## 1. 加载的上下文
- 四件套：design.md / proposal.md / requirements.md / tasks.md
- scan：CONVENTIONS.md / TESTING.md / ARCHITECTURE.md
- modules/_module-map.yaml（frontend 模块）/ modules/frontend.md（Next.js 14 + Antd 6 + React Query + Zustand + Vitest）
- local.yaml：frontend test = `cd frontend && pnpm test`；test_strategy: module
- 代码深度调研（2 sub-agent）：
  - 桌面 `milestone-details/page.tsx`（实测 **3049 行**）三层/8mode/权限/流程/Timeline/工作日/版本链/导入导出
  - `lib/ppm/plan.ts`（21+ API 签名）/ `types.ts`（5 类型字段）/ `workday.ts` / `components/mobile`（5 组件 props）/ `project-plans` 入口

## 2. 关键调研发现（D-007，影响方案）

**桌面 milestone-details 所有核心 UI 子组件是 page.tsx 内部私有，未抽到 `@/components/`**（与 project-plans 不同——后者桌面已抽 `PpmProjectPlanForm/Detail` 到 `@/components/` 故移动端能复用）：
- **已具名导出可直接 import**：`modeForStatus`(page.tsx:159)、`ImportModuleModal`/`ImportModuleModalProps`(1087/1095)
- **内部私有需先抽出才能复用**：`DetailDrawer`(8 mode 表单核心,2046)、`PsPlanNodeDrawer`(里程碑表单,2842)、`ModuleFormDrawer`(模块表单,1541)、`ModuleLevelTable`(781)、`DetailLevelTable`(1693) + 辅助 `FormSection`/`processColor`/`toDay`/`fromDate`/`ModuleReadText`/`recomputeComplete`/`handleSubmit`

### 决策 D-007：抽出桌面核心组件 → 移动端复用（对齐 project-plans 范式 D-006）
- **W1** 把桌面私有组件 + 辅助从 page.tsx 抽到 `@/components/ppm/milestone/`（纯位置重构，不改逻辑）
- **移动端 import 复用**：表单（DetailDrawer/PsPlanNodeDrawer/ModuleFormDrawer）、导入（ImportModuleModal）、纯函数（modeForStatus/processColor/matchAnyUser/addWorkingDaysDate）、流程逻辑（handleSubmit）
- **移动端重写（竖屏适配）**：三层钻取列表（桌面是表格行内展开 → 移动端改 `MobileCardList` 卡片钻取，不复用表格组件）

### 对 design 的修正（需用户确认）
design 第 3 节「❌ 改桌面 milestone-details（零回归）」澄清为「桌面**行为**零回归」——W1 抽取是纯重构（移代码位置不改逻辑），桌面现有测试（`milestone-details.test.tsx` / `ImportModuleModal.test.tsx`）全绿即证零回归。文件层面 page.tsx 会因抽取改动，但行为不变。
> 若用户坚持「桌面文件零改动」，改走「移动端完全重写」策略（W1 变为移动端重写 8 mode 表单，工作量约 +40%）。

## 3. 数据层复用（100%，零改 lib/ppm）
- 顶层：`getProjectPlan(planId)`→can_edit/can_delete；**`getProjectPlanThreeLevel(planId)`→一次拿全树（plan/nodes/details/tasks，省 N+1，移动三层钻取首选）**
- 里程碑：`listPsPlanNodes` / `create` / `update` / `delete`
- 模块：`listPlanNodeModules` / `create` / `update` / `delete` / `listModulesByProject`（module_id 选项）
- 明细：`listPsPlanNodeDetails` / `create` / `update` / `delete`（列表前端按 module_id 过滤）
- 流程：`save` / `reject` / `changePlanNodeDetailProcess` / `listPlanNodeDetailProcesses`
- 版本：`listPsPlanNodeDetailVersions`（parent_id 关联）
- 导入：`importModulesPreview`(FormData) / `importModulesCommit`(JSON)
- 导出：`exportMilestoneDetails(planId)`
- helper：`addWorkingDaysDate`(workday.ts) / `matchAnyUser`(ppm-status-actions.tsx) / `modeForStatus`·`processColor`（桌面抽）

## 4. 移动组件复用（components/mobile）
- `MobileCardList<T>`（renderCard/actions/onItemPress/headerActions/pagination）—— 三层列表
- `MobileDetailSheet` 或直接用抽出的 DetailDrawer（antd Drawer，wrapper maxWidth:480 居中）—— 8 mode 表单
- `MobileExportButton` —— 导出；`MobileFilterDrawer` —— 筛选（如需）
- `Modal.confirm`（antd）—— 删除二次确认

## 5. Wave 拆分（6 Wave）

### W1 桌面组件抽取（纯重构，行为零回归）
**目标**：page.tsx(3049行)内部私有组件抽到 `@/components/ppm/milestone/`，桌面测试全绿。
- W1-T1：抽 `DetailDrawer`（8 mode 表单 + 字段块显隐 + footer + submit 逻辑 2206-2786）→ `detail-drawer.tsx`
- W1-T2：抽 `PsPlanNodeDrawer`（里程碑 7 字段表单 2842-3048）→ `ps-plan-node-drawer.tsx`
- W1-T3：抽 `ModuleFormDrawer`（模块 5 字段表单 1541-1653）→ `module-form-drawer.tsx`
- W1-T4：抽辅助纯函数 `processColor`/`toDay`/`fromDate`/`FormSection`/`ModuleReadText`/`recomputeComplete`/`handleSubmit` → `milestone-helpers.ts`
- W1-T5：page.tsx 改 import 抽出组件（删内部定义），行为不变
- W1-T6：桌面测试 `milestone-details.test.tsx` + `ImportModuleModal.test.tsx` 全绿
**依赖**：无（前置）。**测试**：桌面现有测试零回归 + typecheck。**验收**：桌面行为不变，抽出组件可被移动端 import。

### W2 移动主页 + 里程碑列表（第一层）+ 入口
**目标**：进入里程碑明细页，看里程碑卡片列表。
- W2-T1：`app/m/ppm/milestone-details/page.tsx` 主页（读 searchParams.plan → getProjectPlan 取 project_id/can_edit/readOnly；getProjectPlanThreeLevel 拿全树）
- W2-T2：`mobile-milestone-list.tsx`（MobileCardList 渲染 PsPlanNode：序号 no/总体阶段 overall_stage/任务主题 task_theme/责任人/工作量 plan_workload/周期；has_module 标识）
- W2-T3：`project-plans/page.tsx` buildActions 加「里程碑」入口（紧跟 detail）→ 路由 `/ppm/milestone-details?plan=planId`
- W2-T4：readOnly 显隐（新建/编辑/删除里程碑按钮）
**依赖**：W1（PsPlanNodeDrawer）。**测试**：`mobile-milestone-list.test.tsx`。**验收**：手机点「里程碑」→ 里程碑卡片列表；readOnly 看不到写入按钮。

### W3 明细卡片列表（第三层）+ 8 mode 表单（MVP）
**目标**：钻取看明细，新建/编辑/查看明细。
- W3-T1：`mobile-detail-list.tsx`（明细卡片：明细阶段/任务主题/角色/工时/周期/执行人/执行状态 task_execute_status 徽标/变更版 parent_id 标识）
- W3-T2：三层钻取状态管理（里程碑→模块(has_module)→明细，返回栈）
- W3-T3：8 mode 分发（复用 modeForStatus + 列表覆盖 done→changeInfo）；MVP 实现 create/edit/changeInfo/view（复用 W1 DetailDrawer）
- W3-T4：明细 CRUD（create draft/done；update；delete 带 Modal.confirm）
**依赖**：W1（DetailDrawer/modeForStatus）。**测试**：`mobile-detail-list.test.tsx`（卡片/mode 分发/CRUD）。**验收**：里程碑→明细钻取；新建/编辑/查看；done 点变更进 changeInfo。

### W4 审批流程 + Timeline + 工作日 + 版本链
**目标**：明细审批、履历、工作日联动、版本链。
- W4-T1：审批 save/reject/change 表单内提交（复用 handleSubmit；Modal 二次确认；422/409 并发 toast+reload）
- W4-T2：`mobile-timeline.tsx`（纵向 Timeline，复用 listPlanNodeDetailProcesses + processColor 染色 reject红/change橙/其余绿）
- W4-T3：工作日联动（复用 recomputeComplete + addWorkingDaysDate；create/edit/changeInfo 模式 begin+workload→complete）
- W4-T4：版本链（listPsPlanNodeDetailVersions，parent_id 关联）
**依赖**：W3。**测试**：`mobile-timeline.test.tsx`（染色）+ 工作日单测。**验收**：提交/驳回/变更；履历染色；工作日自动算；版本链展示。

### W5 模块 CRUD + Excel 导入 + 明细导出 + 权限完善
**目标**：模块层管理、批量导入、导出、权限块级。
- W5-T1：`mobile-module-list.tsx`（模块卡片：模块名/计划类型/责任人/工作量/周期；顶部新建/导入模块；CRUD 复用 ModuleFormDrawer）
- W5-T2：模块 Excel 导入（复用 ImportModuleModal 3 步：上传/预览/结果；仅 has_module 里程碑）
- W5-T3：明细导出（MobileExportButton + exportMilestoneDetails(planId)）
- W5-T4：权限块级（baseEditable/auditEditable/changeApproveEditable/matchAnyUser；readOnly 总开关）
**依赖**：W1（ModuleFormDrawer/ImportModuleModal）。**测试**：`mobile-module-list.test.tsx`。**验收**：模块 CRUD；导入 3 步；导出；权限块级正确。

### W6 8 mode 完整 + 验收
**目标**：预留 mode 落地 + 全面验收。
- W6-T1：audit/approve/changeApprove 预留（只读 + 审批块入口，复用 DetailDrawer 对应字段块）
- W6-T2：组件单测补全（钻取分发/工作日/权限/表单 mode）
- W6-T3：桌面 milestone-details 零回归（现有测试全绿）
- W6-T4：移动端集成验收（三层钻取闭环 + 流程 + 导入导出 + 权限）
- W6-T5：移动端 typecheck + lint + build 绿
**依赖**：W2-W5。**测试**：全量 `cd frontend && pnpm test` + typecheck + lint + build。**验收**：8 mode 完整；桌面零回归；移动闭环；CI 全绿。

## 6. 依赖关系
```
W1（抽取）→ W2（主页+里程碑）→ W3（明细+表单 MVP）→ W4（流程+Timeline+工作日+版本）
W1 → W5（模块+导入+导出+权限，建议 W3 后）
W2-W5 → W6（验收）
```
关键路径：W1→W2→W3→W4→W6（W5 并入）。

## 7. 测试策略
- 框架：vitest + @testing-library/react + jsdom（`cd frontend && pnpm test`）
- 策略：module（test_strategy:module 命中 frontend）
- 重点：
  - **W1 抽取后桌面 `milestone-details.test.tsx` + `ImportModuleModal.test.tsx` 全绿**（行为契约）——抽取零回归的权威证明，不绿不进 W2
  - 移动组件单测：列表渲染/权限显隐/mode 分发/工作日/Timeline 染色
  - 镜像桌面测试关键用例（modeForStatus 断言）
- typecheck（tsc --noEmit）+ lint（next lint）+ build（next build）全绿
- 桌面零回归：W1 抽取是唯一动桌面步骤，靠现有测试守护

## 8. 风险与应对
| 风险 | 等级 | 应对 |
|---|---|---|
| R-01 W1 抽取 3049 行文件破坏桌面行为 | P1 | 纯位置重构不改逻辑；桌面现有测试是契约，W1 必须全绿才进 W2 |
| R-02 DetailDrawer 桌面 antd Drawer 移动竖屏适配 | P2 | Drawer 表单 wrapper maxWidth:480 居中（对齐 mobile 规范）；字段 grid 改单列 |
| R-03 三层钻取竖屏状态管理（返回栈） | P1 | 本地 state（level+selectedNode/Module），每层独立视图 |
| R-04 getProjectPlanThreeLevel 全树 vs 按需加载 | P2 | 首选 three-level 一次拿（省 N+1）；数据量大改按层加载 |
| R-05 工作日 2026 节假日表硬编码跨年 | P3 | 复用 addWorkingDaysDate（纯函数），跨年维护由 workday.ts 统一（本变更不扩） |
| R-06 D-007 抽取策略需用户确认（动桌面） | P1 | plan 审查确认；否决则改移动端重写策略 |

## 9. 决策记录
- D-001~D-006：见 design.md 第 10 节（整页复刻/钻取式/mode 分发/表单内流程/MVP 优先/数据复用）
- **D-007（plan 新增）**：桌面核心组件抽出复用策略（修正 design 零回归为「行为零回归」）。理由：桌面 UI 组件私有，抽出复用对齐 project-plans 范式，省移动端重写且行为一致。**需用户确认。**

## 10. 自审
- 章节齐全 ✓；Wave 覆盖 design 全部功能（三层/8mode/CRUD/流程/Timeline/工作日/版本/导入导出/权限）✓
- 数据层 100% 复用 ✓；移动组件复用 ✓；桌面抽取纯重构 ✓
- W1 抽取是相对 design 的补充（D-007），已标注需确认 ✓
- 测试策略覆盖（桌面零回归 + 移动单测 + 集成）✓
- ⚠️ execute 注意：W1 抽取严格保持行为不变（桌面测试守护）；移动竖屏适配 DetailDrawer 的 grid/Drawer wrapper
