---
id: task-02
title: ChangeReviewHistoryCard component
title_zh: 审核历史组件 ChangeReviewHistoryCard
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on: []
blocks: []
allowed_paths:
  - frontend/src/components/changes/detail/change-review-history-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-review-history-card.test.tsx
goal: >
  新增审核历史卡 ChangeReviewHistoryCard，从 change.stages.review_history 渲染真实审核留痕，
  替换永远空的旧「审查记录」区块（FR-03/FR-03b）。组件消费归一化后的 ReviewHistoryItem 数组
  （归一化在 page.tsx 完成，task-06），本组件只负责展示：倒序、中文标签、颜色语义、空态。
implementation:
  - 新建 change-review-history-card.tsx，导出 ReviewHistoryItem 接口与 ChangeReviewHistoryCard 组件
  - ReviewHistoryItem 字段 kind/label/tone/comment/at/fromStage，对齐 design.md §7 定义
  - props 仅 reviewHistory 数组（page.tsx 已按时间倒序归一化后传入），组件不做再排序
  - 按 tone 映射颜色 success绿 warning琥珀 danger红 neutral中性，用既有 Badge 或 ui 样式
  - 列表项渲染 label 徽标 + comment 意见 + at 时间（来自 submitted_at 或 at）+ fromStage 来源阶段
  - reviewHistory 为空或缺省时渲染空态文案「暂无审核历史」
  - 沿用本页 @/components/ui（shadcn 风格），不引入 antd（D-005）
  - 不改后端不改 api-types，纯前端展示组件
acceptance:
  - gate 形状元素渲染 decision 对应中文标签与正确 tone 颜色
  - rerun 形状元素渲染「重跑 stage」中性标签
  - 空数组与缺省均显示「暂无审核历史」空态
  - 时间缺失元素宽容兜底显示，不崩溃
  - 组件测试覆盖各 decision 映射/颜色/空态，全部通过
verify: cd frontend && pnpm exec tsc --noEmit && pnpm test change-review-history-card
constraints:
  - 仅改 allowed_paths 内文件，不碰 page.tsx 与后端
  - review_history 双形状归一化逻辑放 page.tsx（task-06），本组件只消费归一化结果
  - 颜色与标签映射需与 design.md §5.4 渲染规则一致
  - 中文 UI 文案，禁止英文标签
provides:
  - contract: ChangeReviewHistoryCard
    fields:
      - reviewHistory
  - contract: ReviewHistoryItem
    fields:
      - kind
      - label
      - tone
      - comment
      - at
      - fromStage
---
