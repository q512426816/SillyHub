---
author: WhaleFall
created_at: 2026-07-14T10:20:00
---

# decisions.md — /ppm/projects 样式规范化决策台账

> 变更 `2026-07-14-ppm-projects-style-redesign`
> 本文件是本次变更的实现/验收级决策台账，非长期术语表。

## D-001@v1 — 改造范围含两个共享组件

- **type**: scope
- **status**: accepted
- **source**: brainstorm Step6/Step7 用户确认
- **question**: `/ppm/projects` 视觉 90% 在共享组件里，范围只含本页还是含共享组件？
- **answer**: 连同 `PpmResourceTable` 与 `PpmProjectMembersTable` 两个共享组件一起改。
- **normalized_requirement**: 改造覆盖 5 个页面（项目/客户/干系人/项目成员/成员管理抽屉）+ 2 个共享组件。
- **impacts**: `ppm-resource-table.tsx`、`ppm-project-members-table.tsx`、`projects/page.tsx`；客户/干系人/项目成员页自动受益。
- **evidence**: Step6 AskUserQuestion「连共用组件一起改(推荐)」；Step7「成员表一起改」。
- **priority**: high

## D-002@v1 — 浮层用 antd Drawer/Modal（不新增 shadcn Sheet）

- **type**: tech-choice
- **status**: accepted
- **source**: brainstorm Step8 用户选择
- **question**: 编辑表单/删除确认/成员管理弹窗的浮层实现路线？
- **answer**: 用 antd Drawer（侧边抽屉承载表单）+ antd Modal（删除确认）。不新增 shadcn Sheet 组件。
- **normalized_requirement**: 消除 `bg-black/30` 手写遮罩 + `✕` emoji + 原生 `<select>`/`<input>` 浮层；统一 antd Drawer/Modal。
- **impacts**: 不引入新 npm 依赖（antd 6 已装）；ppm 模块浮层与 Table/Form/Select 同属 antd，模块内更内聚；antd 浮层自动消费 ConfigProvider 主题 token（主色 #2563EB）。
- **evidence**: Step8 AskUserQuestion「B. 用 antd Drawer/Modal」；`frontend/package.json` antd ^6.4.4。
- **priority**: high
- **note**: 覆盖 Step6 浮层方案「新增 Sheet」的暗示；Step8 在看到完整 trade-off 后改选 antd，更贴合 ppm 模块「antd 业务组件」定位。

## D-003@v1 — 状态用 StatusBadge，类型用 antd Tag

- **type**: visual-convention
- **status**: accepted
- **source**: brainstorm Step9 设计确认
- **question**: 项目状态与项目类型都用同一种标签形态吗？
- **answer**: 状态（语义性）用现成 `StatusBadge`（带圆点 pill）；类型（分类性，非语义）用 antd `Tag` 分类色块。两者视觉区分。
- **normalized_requirement**: select 字段渲染支持两种模式：有 `statusKind` → StatusBadge；有 `color` → antd Tag。
- **impacts**: `PpmFieldOption` 新增可选 `statusKind?: StatusKind` 字段；`PpmResourceTable` select 渲染分支；复用 `components/ui/status-badge.tsx`（无需新建组件）。
- **evidence**: `components/ui/status-badge.tsx` 已是 rounded-full + 圆点 + 5 语义色；Step9 确认。
- **priority**: medium

## D-004@v1 — 状态/类型色彩语义映射

- **type**: color-mapping
- **status**: accepted
- **source**: brainstorm Step7 澄清 + Step9 确认
- **question**: projects 页状态/类型枚举的 antd 预设色如何映射到 token 语义？
- **answer**:
  - 项目状态：进行中=info(blue)、已完成=success(emerald)、已暂停=warning(amber)。
  - 项目类型：研发=blue、实施=cyan、运维=default(灰，原 geekblue 非 token 色)。
- **normalized_requirement**: 枚举 color 不写 hex，用 antd 预设色名（blue/cyan/default）或 statusKind 语义键。
- **impacts**: `projects/page.tsx` 的 `PROJECT_TYPE_OPTIONS` / `PROJECT_STATUS_OPTIONS` 改写；`PpmFieldOption.color="default"` 约定为默认灰 Tag。
- **evidence**: `styles/tokens.ts` 语义色定义；`components/ui/status-badge.tsx` KIND_STYLES。
- **priority**: medium

## D-005@v1 — 不引入新 npm 依赖

- **type**: constraint
- **status**: accepted
- **source**: 纯样式调整范围约束
- **question**: 是否需要新增 shadcn Sheet / 其他 UI 库依赖？
- **answer**: 不引入任何新 npm 依赖。Sheet 不新增（走 antd Drawer，见 D-002）；StatusBadge 已存在。
- **normalized_requirement**: `package.json` 不新增 dependencies；本次改造完全基于已有 tokens/ui/layout/antd。
- **impacts**: 降低构建/Docker 风险；plan/execute 不含 pnpm add 步骤。
- **evidence**: `frontend/package.json` 已含 antd ^6.4.4、@radix-ui/* 、lucide-react、class-variance-authority。
- **priority**: low

## D-006@v1 — 浮层遮罩点击不关闭 + 搜索条件布局不变

- **type**: interaction
- **status**: accepted
- **source**: brainstorm Step13 用户反馈
- **question**: 编辑抽屉/确认弹窗点击遮罩层是否关闭?搜索条件排列是否调整?
- **answer**: ① 所有 ppm 浮层(antd Drawer 编辑表单/成员管理 + antd Modal 删除确认)设 `maskClosable={false}`,点遮罩不关(防误关丢失输入);ESC 与右上角关闭按钮照常。② 搜索区布局**完全保持现状**:操作按钮行在字段**上方右对齐**,分两组——**数据组**(导出/新增)在左、**基础组**(查询/重置/展开)在最右、中间分隔;字段 4 列网格在下(≤4 + 展开收起),`visibleSearchFields` 逻辑不改;撤销「导出/新增上移标题右侧」,PageHeader 仅标题。
- **normalized_requirement**: 浮层 maskClosable={false};PpmResourceTable 搜索区布局完全保持现状(按钮行在字段上方右对齐 + 4 列网格 + 展开收起),撤销导出/新增上移 PageHeader。
- **impacts**: `design.md` §5 W1④ / §7 浮层签名;execute 时所有 antd Drawer/Modal 调用点。
- **evidence**: Step13 用户反馈「点击遮罩层不要关闭。确认弹窗也是」+「查询条件排列按现在逻辑,单行≤4 + 展开收起」。
- **priority**: medium
