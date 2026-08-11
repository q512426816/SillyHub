---
author: qinyi
created_at: 2026-08-11 11:07:09
---

# 决策记录（Decisions）

## D-001@v1: 布局形态 = 左主右辅右栏侧栏
- type: architecture
- priority: P0
- status: confirmed
- source: 用户三选一确认（AskUserQuestion）
- question: 次线区（文件/会话/历史/任务）用侧栏还是顶部 Tab？
- answer: 右栏侧栏（左主右辅）。桌面宽屏主线常驻左、次线常驻右；移动端 <1024px 单列折叠。
- normalized_requirement: 详情页采用两栏网格 `lg:grid-cols-[1fr_320px]`，次线侧栏 320px 常驻。
- impacts: design.md §5.1 布局骨架、§5.3 移动端策略；FR-01
- evidence: 原型 prototype-change-detail-layout.html

## D-002@v1: 会话定位 = 进次线侧栏，主线只留执行日志
- type: boundary
- priority: P0
- status: confirmed
- source: 用户确认
- question: 「会话」和「智能体执行日志」如何区分（重叠根源）？
- answer: 主线只留流程自动跑的「智能体执行日志」；用户主动发起的「会话调试」移入次线侧栏，视觉/定位彻底分离。
- normalized_requirement: ChangeSessionSection 包入次线 ChangeSessionsCard；主线 ChangeAgentRunLog 独占日志呈现。
- impacts: design.md §5.1/§5.2(②)；FR-02
- evidence: 用户反馈「会话和智能体日志重叠」

## D-003@v1: 旧区块处理 = 删审批状态 + 审查记录改读真实 review_history
- type: consistency
- priority: P0
- status: confirmed
- source: 用户确认 + 后端源码核实
- question: 「审查记录」「审批状态」两个旧版遗留区块怎么处理？
- answer: 「审批状态」删除（信息并入审核历史）；「审查记录」改为新「审核历史」组件，前端从 `change.stages.review_history` 读真实数据，零后端改动。
- normalized_requirement: 新增 ChangeReviewHistoryCard 读 stages.review_history（兼容 gate/rerun 两种形状）；删除审批状态区块；不再引用 listReviews/ChangeReview 死表。
- impacts: design.md §5.2(①)/§5.4/§7；FR-03、FR-04
- evidence: change_reviews 表全后端零写入（仅 model.py 定义 + spec_guardian/service 两处读）；review_history 由四个 gate 端点真实写入

## D-004@v1: 实现深度 = 全量重写（7 组件 + 测试，page.tsx 瘦身）
- type: architecture
- priority: P1
- status: confirmed
- source: 用户三选一确认
- question: 实现深度选单文件重组 / 关键区抽组件 / 全量重写？
- answer: 全量重写。详情页所有区块拆成独立组件，page.tsx 只留数据加载+布局编排，每组件配测试。
- normalized_requirement: 新增 7 个组件到 components/changes/detail/，各配 vitest；page.tsx 瘦身为编排层。
- impacts: design.md §6 文件变更清单；FR-05、FR-06
- evidence: 用户选「最干净，长期最好维护」

## D-005@v1: 不换组件库，沿用本页 @/components/ui
- type: compatibility
- priority: P1
- status: confirmed
- source: 规范交叉核对（Design Grill minor → 补免责依据）
- question: 是否借本次重做切换到 antd（对齐 FRONTEND_PAGE_STYLE）？
- answer: 不换。FRONTEND_PAGE_STYLE.md 自限定「列表/管理页」、基准 /ppm/projects CRUD；本页是详情编排页，沿用现有 @/components/ui 不构成违反。antd 全量切换另立 change。
- normalized_requirement: 本变更所有新组件沿用 @/components/ui（Badge/Button 等）+ tailwind 布局，不引入 antd。
- impacts: design.md §3 非目标、§9 兼容策略
- evidence: FRONTEND_PAGE_STYLE.md §0/§1
