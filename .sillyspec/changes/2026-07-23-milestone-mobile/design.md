---
author: qinyi
created_at: 2026-07-23 09:25:00
updated_at: 2026-07-23 09:50:00
scale: large
---
# 设计文档（Design）— 里程碑明细移动端整页完整复刻

> 经独立 Grill + 桌面完整调研修正。桌面 milestone-details 实为**三层结构**（里程碑主表 + 模块中间层 + 明细）+ **8 mode 表单**，本 design 据此完整复刻。

## 1. 背景

桌面 `app/(dashboard)/ppm/milestone-details/page.tsx`（2988 行）是 PPM 最复杂页：三层嵌套（里程碑 PsPlanNode → 模块 PlanNodeModule(仅 has_module) → 明细 PsPlanNodeDetail）+ 8 mode 表单（create/edit/changeInfo/audit/approve/change/changeApprove/view）+ save/reject/change 审批流程 + Timeline 履历 + 工作日联动 + 版本链 + 模块 Excel 导入 + 明细导出。

用户要求**整页完整复刻**到移动 APP UI（功能不多不少），展示适配**手机竖屏**（表格改卡片/钻取式，不要求横屏）。

架构基础已落地（mobile-app-ui 归档）：middleware `/m/` + components/mobile 通用件 + route-guard + 底部 5 Tab。数据层 `lib/ppm/plan.ts` 21 个 API 全有（不新写）。

## 2. 设计目标

- **三层钻取**：里程碑列表 →（has_module 时）模块列表 → 明细列表，竖屏钻取（非桌面行内展开）
- **8 mode 表单**：create/edit/changeInfo/audit/approve/change/changeApprove/view，按 mode + status 控制字段块显隐/disabled
- **全 CRUD**：里程碑主表 + 模块 + 明细 各自建/改/删
- **审批流程**：save/reject/change（表单内提交，非行内按钮——对齐桌面）
- **Timeline** + **工作日联动** + **版本链** + **模块 Excel 导入** + **明细导出**
- **权限**：readOnly=!(plan.can_edit) 总开关 + 块级 mode/user 匹配（对齐桌面）
- 桌面 `(dashboard)/ppm/milestone-details/**` 零回归

## 3. 非目标

- ❌ 改桌面 milestone-details（零回归）
- ❌ 新写后端 API / 数据模型（全复用 lib/ppm/plan.ts）
- ❌ 横屏表格

## 4. 总体方案（竖屏钻取式 + 8 mode 底部表单）

### 4.1 路由 + 入口
- `app/m/ppm/milestone-details/page.tsx`（读 searchParams.plan → getProjectPlan 取 project_id/can_edit + listPsPlanNodes）
- middleware `/ppm/:path*` 已覆盖（rewrite），route-guard `/ppm` 放行
- 入口：项目计划卡片 actions 加「里程碑」→ /ppm/milestone-details?plan=planId

### 4.2 三层钻取（竖屏）
- **第一层 里程碑列表**：MobileCardList 渲染 PsPlanNode 卡片（序号/总体阶段/任务主题/责任人/工作量/计划周期/has_module 标识）。卡片 actions：新建明细/编辑/删除（readOnly 显隐）
- **第二层 模块列表**（仅 has_module 里程碑，点进）：MobileCardList 渲染 PlanNodeModule 卡片（模块名/计划类型/责任人/工作量/周期）。actions：新建明细/编辑/删除/+顶部「新建模块」「导入模块」
- **第三层 明细列表**：MobileCardList 渲染 PsPlanNodeDetail 卡片（明细阶段/任务主题/角色/工时/周期/执行人/执行状态/状态徽标/变更版标识）。actions：详情/编辑(draft,rejected)/变更(done→changeInfo)/删除

### 4.3 8 mode 表单（MobileDetailSheet 全屏，按 mode 分发）
| mode | 触发 | 可编辑 | 提交 |
|---|---|---|---|
| create | 新建明细 | 开立信息全字段 | 保存(create draft)+提交(create done) |
| edit | draft/rejected 编辑/详情 | 开立信息全字段 | 保存(update)+提交(update+save) |
| changeInfo | done 变更 | 开立信息全字段(不改状态/不出版本) | 提交(update→sync task) |
| audit | review 详情(预留) | 开立只读+审核块(audit_user) | 提交(save/reject) |
| approve | approve 详情(预留) | 开立只读+审核只读 | 提交(save/reject) |
| change | 预留(列表无入口) | 开立只读+变更原因 | 提交变更(change→新版本) |
| changeApprove | change_pending(预留) | 开立只读+变更审批块 | 提交(save/reject) |
| view | done/archived 详情 | 全只读 | 无 |

**开立信息字段**：detailed_stage/task_theme/task_description/requirements/role_name/achievement/plan_workload/plan_begin_time/plan_complete_time/module_id(实施阶段必填)/execute_user_id/file_urls

### 4.4 审批流程（表单内提交，对齐桌面）
- save（提交/推进）/ reject（驳回，带 handle_info）/ change（变更新版本，带 change_reason）
- 表单内提交按钮（非行内）+ Modal.confirm 二次确认
- 并发乐观锁：422/409 → 提示"已被他人处理"+reload
- API：save/reject/changePlanNodeDetailProcess

### 4.5 Timeline（纵向）
- listPlanNodeDetailProcesses → 纵向时间线
- 染色：reject→红 / change→橙 / 其余→绿

### 4.6 工作日联动
- addWorkingDaysDate（lib/ppm/workday.ts，含 2026 节假日表）
- create/edit/changeInfo 模式：plan_begin_time + plan_workload → plan_complete_time 自动算

### 4.7 版本链
- listPsPlanNodeDetailVersions → 变更版本链展示（parent_id 关联）

### 4.8 模块 Excel 导入
- importModulesPreview（FormData）+ importModulesCommit（JSON），3 步（上传/预览/结果）
- 仅模块层（has_module 里程碑）

### 4.9 明细导出
- exportMilestoneDetails（downloadExcel）

### 4.10 权限
- readOnly = !(plan.can_edit)（getProjectPlan，后端按项目成员角色）
- readOnly=true → 全页禁写入（建/改/删/导入），导出/查询不禁
- 块级：baseEditable(create/edit/changeInfo) / auditEditable(audit+audit_user 匹配) / changeApproveEditable(changeApprove+approve_user 匹配)
- matchAnyUser（逗号串用户匹配，ppm-status-actions）

### 4.11 数据层（100% 复用 lib/ppm/plan.ts，21 API）
getProjectPlan / listPsPlanNodes+CRUD / listPlanNodeModules+CRUD / listPsPlanNodeDetails+CRUD / save-reject-changeProcess / listVersions / listProcesses / importModulesPreview+Commit / exportMilestoneDetails + helper(addWorkingDaysDate/matchAnyUser/fmtDate)

## 5. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | app/m/ppm/milestone-details/page.tsx | 移动主页（三层钻取 + 状态管理） |
| 新增 | components/mobile/mobile-milestone-list.tsx | 里程碑卡片列表（第一层） |
| 新增 | components/mobile/mobile-module-list.tsx | 模块卡片列表（第二层，has_module） |
| 新增 | components/mobile/mobile-detail-list.tsx | 明细卡片列表（第三层） |
| 新增 | components/mobile/mobile-detail-form.tsx | 8 mode 表单分发（MobileDetailSheet） |
| 新增 | components/mobile/mobile-timeline.tsx | 纵向 Timeline（染色） |
| 新增 | components/mobile/mobile-import-module.tsx | 模块 Excel 导入（3步） |
| 修改 | app/m/ppm/project-plans/page.tsx | 卡片 actions 加「里程碑」入口 |

**不动**：桌面 milestone-details/**、PpmSubTable、所有桌面组件（零回归）。

## 6. 接口定义（前端内部）

```ts
// 三层钻取主页
interface MilestoneDetailsMobilePageProps { /* searchParams.plan */ }
// 8 mode 表单
interface MobileDetailFormProps { detail?: PsPlanNodeDetail; mode: DrawerMode; plan: PsProjectPlan; onSaved: () => void }
type DrawerMode = "create"|"edit"|"changeInfo"|"audit"|"approve"|"change"|"changeApprove"|"view"
```

## 7. 数据模型

无后端变更。复用 PsPlanNode/PlanNodeModule/PsPlanNodeDetail/PsPlanNodeDetailProcess（lib/ppm/types）。

## 8. 兼容策略

桌面 milestone-details 零改动；middleware/route-guard 已覆盖；数据 100% 复用 lib；8 mode 权限/字段严格对齐桌面。

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 三层钻取竖屏（里程碑→模块→明细）层级管理 | P1 | 钻取式（非行内展开），每层独立列表页/视图，返回栈管理 |
| R-02 | 8 mode 表单字段块控制复杂 | P1 | MobileDetailSheet 按 mode 控制块(baseEditable/audit/changeApprove) disabled；MVP 优先 create/edit/changeInfo/view，audit/approve/changeApprove 预留 |
| R-03 | 工作日联动（2026 节假日表移植） | P2 | 复用 addWorkingDaysDate（纯函数，不需移植表，import 即可） |
| R-04 | 模块 Excel 导入移动端（FormData+预览+提交 3步） | P2 | 移动端 3 步全屏向导 |
| R-05 | 流程并发乐观锁（422/409） | P2 | catch + reload |
| R-06 | 工程量大（三层+8mode+导入导出+流程+Timeline） | P1 | plan 分 Wave：W1 基础(三层钻取+列表)→W2 明细 CRUD+4 mode→W3 流程+Timeline+工作日→W4 模块CRUD+导入→W5 导出+8mode完整+权限→W6 验收 |

## 10. 决策追踪

- D-001：整页完整复刻（三层+8mode），用户确认（Grill B-01）
- D-002：三层钻取式（非行内展开），竖屏适配
- D-003：8 mode 按 modeForStatus 分发 + 列表显式覆盖（done→changeInfo 非 view）
- D-004：流程在表单内提交（对齐桌面，非行内按钮）
- D-005：MVP 优先 create/edit/changeInfo/view（audit/approve/changeApprove 当前线上很少触达，预留）
- D-006：数据 100% 复用 lib（21 API + helper）

## 11. 自审

- 章节齐全 ✓；无后端变更 ✓；桌面零回归 ✓；三层+8mode 覆盖（对齐桌面调研）✓
- 21 API 清单完整 ✓；权限 readOnly+块级 ✓；流程 save/reject/change 表单内 ✓
- scale=large（超大工程，plan 分 6 Wave）
- ⚠️ 交 plan 细化：三层钻取的状态管理（返回栈）、8 mode 各字段块精确 disabled、移动导入 3 步 UI、Wave 拆分
