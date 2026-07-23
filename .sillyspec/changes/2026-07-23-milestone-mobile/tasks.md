---
author: qinyi
created_at: 2026-07-23 10:21:07
---
# 任务清单（Tasks）— 里程碑明细移动端整页完整复刻

> brainstorm 粗粒度任务清单。详细 Wave 拆分、依赖、测试点在 plan 阶段产出 `plan.md`。
> design 自审指明 plan 需细化：三层钻取的状态管理（返回栈）、8 mode 各字段块精确 disabled、移动导入 3 步 UI、Wave 拆分。

## 实现路径
scale=large → 走完整 SillySpec 流程：`sillyspec run plan --change 2026-07-23-milestone-mobile` 拆 Wave → `sillyspec run execute` 逐 Wave 实现 → `sillyspec run verify` 对照 design 验收。

## 任务块（按 design 第 5 节文件清单 + 第 10 节 Wave 思路）

### 入口与骨架
- [ ] T-01：`app/m/ppm/milestone-details/page.tsx` 移动主页（读 searchParams.plan → getProjectPlan 取 project_id/can_edit + listPsPlanNodes，三层钻取状态管理 + 返回栈）
- [ ] T-02：项目计划移动卡片 `app/m/ppm/project-plans/page.tsx` actions 加「里程碑」入口 → /ppm/milestone-details?plan=planId

### 第一层 里程碑列表
- [ ] T-03：`components/mobile/mobile-milestone-list.tsx` 里程碑卡片列表（MobileCardList 渲染 PsPlanNode，序号/总体阶段/任务主题/责任人/工作量/周期/has_module 标识，actions：新建明细/编辑/删除）

### 第二层 模块列表（has_module）
- [ ] T-04：`components/mobile/mobile-module-list.tsx` 模块卡片列表（PlanNodeModule 卡片，顶部「新建模块」「导入模块」，actions：新建明细/编辑/删除）

### 第三层 明细列表
- [ ] T-05：`components/mobile/mobile-detail-list.tsx` 明细卡片列表（PsPlanNodeDetail 卡片，明细阶段/任务主题/角色/工时/周期/执行人/执行状态/状态徽标/变更版标识，actions：详情/编辑/变更/删除）

### 8 mode 表单
- [ ] T-06：`components/mobile/mobile-detail-form.tsx` 8 mode 表单分发（MobileDetailSheet，按 mode 控制字段块 disabled：baseEditable/audit/changeApprove）
- [ ] T-06a：MVP 优先实现 create / edit / changeInfo / view
- [ ] T-06b：预留 audit / approve / change / changeApprove（只读 + 审批块入口）

### 流程与履历
- [ ] T-07：审批流程 save / reject / change 表单内提交（Modal.confirm 二次确认 + 422/409 并发兜底）
- [ ] T-08：`components/mobile/mobile-timeline.tsx` 纵向 Timeline（染色 reject 红 / change 橙 / 其余绿）
- [ ] T-09：工作日联动（create/edit/changeInfo 用 addWorkingDaysDate 自动算 plan_complete_time）

### 版本与导入导出
- [ ] T-10：版本链展示（listPsPlanNodeDetailVersions，parent_id 关联）
- [ ] T-11：`components/mobile/mobile-import-module.tsx` 模块 Excel 导入 3 步（上传/预览/结果，importModulesPreview + importModulesCommit）
- [ ] T-12：明细导出（exportMilestoneDetails，downloadExcel）

### 权限与验收
- [ ] T-13：权限 readOnly 总开关 + 块级 mode/user 匹配（matchAnyUser）
- [ ] T-14：组件单测（钻取分发 / 工作日 / 权限 / 表单 mode）
- [ ] T-15：桌面 milestone-details 零回归（现有测试全绿）
- [ ] T-16：移动端集成验收（三层钻取闭环 + 流程 + 导入导出）

## Wave 建议（plan 阶段细化）
- W1 基础：三层钻取主页 + 里程碑列表（T-01~T-03）
- W2 明细 CRUD + 4 mode 表单（T-05, T-06a）
- W3 流程 + Timeline + 工作日（T-07~T-09）
- W4 模块 CRUD + 导入 + 版本链（T-04, T-10, T-11）
- W5 导出 + 8 mode 完整 + 权限（T-06b, T-12, T-13）
- W6 验收（T-14~T-16）
