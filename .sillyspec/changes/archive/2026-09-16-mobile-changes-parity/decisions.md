---
author: qinyi
created_at: 2026-09-16 21:16:01
---

# 决策记录 — 2026-09-16-mobile-changes-parity

## D-001@v1: 对齐范围 = 变更中心列表页 + 详情页的功能补齐
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 「手机端，变更中心内容要跟 pc 端页面功能保持一致」覆盖哪些页面？
- answer: 变更中心在 PC 端由两个路由承载——列表页 `/workspaces/[id]/changes`（含 quicklog tab）与详情页 `/workspaces/[id]/changes/[cid]`；移动端对应 `/m/workspaces/[id]/changes` 与 `/m/workspaces/[id]/changes/[cid]`。对齐范围为这两对页面。
- normalized_requirement: 移动端两页面呈现的信息与可执行操作与 PC 端逐项对齐；布局/交互形态允许按移动范式适配（抽屉、底部菜单、折叠卡），功能不得缺。
- impacts: [FR-1, FR-2, FR-3]
- evidence: frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx 与 m/ 段两页面源码比对（2026-09-16 精读）

## D-002@v1: 任务看板 / 任务执行页维持桌面引导，不在本次对齐
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: PC 变更详情还链到任务看板（changes/[cid]/tasks）与任务执行页（tasks/[tid]），移动端是否本次移植？
- answer: 不移植。原变更 2026-08-26-mobile-workspace-page D-002 已明确将任务域裁剪出移动端核心版，移动详情页保留「任务区桌面引导条」；任务看板+执行页是独立大块功能（非列表/详情的信息呈现），用户指令针对「变更中心内容」，未点名任务域。
- normalized_requirement: MobileChangeDetail 桌面引导条（m-change-desktop-guide）保留；本变更不创建 /m/ 任务路由。
- impacts: [scope]
- evidence: mobile-change-detail.tsx X-03 #7/#10 注释（D-002 裁剪清单）
- 故障面: 用户若预期任务看板也上手机端，本决策遗漏该预期——汇报中显式列为可否决项

## D-003@v1: 列表页补齐清单（逐项对 PC 差异）
- type: premise
- priority: P0
- status: accepted
- source: code
- question: 移动列表页相对 PC 缺哪些功能？
- answer: ①重新扫描按钮 + 解析统计/警告反馈（PC PageHeader 唯一 action，移动端完全没有）；②卡片信息缺：负责人（owner_name → owner_id 前 8 位 → —，PC renderOwner 三态）、执行用量（usage：耗时 + 进行中标记 + token·次数 + title 起止悬浮，PC UsageExecCell；移动端无 hover，起止时间改为次行或点进详情看）、活动徽标（ChangeActivityBadge 进行中/停滞/空闲）、影响组件（affected_components join）；③排序切换（PC 更新时间 ↑↓ 可点表头，移动固定 desc）；④URL 参数 ?tab= / ?search= 初始化；⑤quicklog tab 筛选（PC QuicklogTable 有状态 4 态/作者/显示空壳占位开关，移动只有搜索）。
- normalized_requirement: 五项全部补齐；排序与 quicklog 筛选收进 MobileFilterDrawer（移动范式），重新扫描入口放列表工具栏区域。
- impacts: [FR-1, task-1, task-2]
- evidence: PC page.tsx :406-423（handleReparse）、:445-457（renderOwner）、:139-184（UsageExecCell）、:399-404（toggleSort）、:233-239（URL 参数）、quicklog-table.tsx :388-419（状态/作者/占位筛选）

## D-004@v1: 详情页补齐清单（逐项对 PC 差异）
- type: premise
- priority: P0
- status: accepted
- source: code
- question: 移动详情页相对 PC 缺哪些功能？
- answer: ①ChangeUsageCard 执行用量卡（kind=change，组件自取数）；②ChangeLastSignal 最后信号行（lastSignalFromSteps 纯前端派生）；③ScopeAuditCommandCard 范围对账卡（kind=change）；④删除入口（PC PageHeader 危险按钮 + DeleteChangeConfirm，移动 ⋯ 菜单没有删除项）；⑤阶段步骤条节点点击 → 时间线 focusStage 筛选联动（PC ql-20260821-017）。
- normalized_requirement: 五项全部补齐；前三个为既有组件直接挂载（复用优先），删除入 ⋯ 菜单（danger 项 + 确认弹层 + 成功跳回列表），StageStepper 增加可点节点与清除 chip。
- impacts: [FR-2, task-3, task-4]
- evidence: PC [cid]/page.tsx :314-338（三卡挂载）、:299-310（删除）、:313-323+368-395（focusStage 联动）；移动 [cid]/page.tsx ⋯ 菜单仅重解析/复制

## D-005@v1: 实现方案 = 方案 A「既有组件复用挂载 + 移动壳适配」
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 对齐实现走哪条路线？（方案 A 复用挂载 / 方案 B 移动端重写一套组件 / 方案 C 废弃 /m/ 页面改 PC 页面响应式适配）
- answer: 选方案 A。三案对比：A=PC 既有卡组件（ChangeUsageCard/ChangeLastSignal/ScopeAuditCommandCard/ChangeActivityBadge）布局无 lg 依赖可直接挂载，数据层函数与 query key 全部复用，移动壳（筛选抽屉/⋯菜单/折叠卡）沿用本页既有范式；B=每卡重写移动版，违反移动端代码明文约束「数据层 100% 复用桌面（禁止复制第二份实现）」（每份移动页头部注释均载），制造双实现漂移面；C=废弃 /m/ 路由体系改响应式，推翻 2026-08-26-mobile-workspace-page 整个架构决策，牵连 m/layout 钻取路由、MobileWorkspaceHeader、底部 Tab 等全部移动基建。A 是仓库惯例的直接推论，非开放取舍。
- normalized_requirement: 新增功能优先 import 既有组件/数据函数；仅当组件布局硬耦合桌面（如 antd Table 列）才重绘移动壳，且数据层必须复用。
- impacts: [全部 task]
- evidence: 决策轮次：brainstorm step 4（自主模式，用户未在场选择；A 为代码约束唯一解，汇报中列为可否决项）
- 故障面: 若某桌面组件在小屏实测溢出（如 ScopeAuditCommandCard 明细表），需就地加移动断点而非重写——执行时验证
- 退役判据: 若未来移动端整体转向响应式单套页面（方案 C 复活），本决策随之退役
