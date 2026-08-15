---
id: task-04
title: ChangeStepBadge list step badge component + tests
title_zh: 列表徽章组件——step x/y 摘要行 + 迷你进度条 + 三态色 + waiting chip + 降级渲染 + 组件测试
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/changes/change-step-badge.tsx
  - frontend/src/components/changes/__tests__/change-step-badge.test.tsx
expects_from: task-03 已重生成 api-types——StepProgressSummary 类型含 step_total / steps_completed / current_step_name / current_step_status 四字段可供 props 消费
goal: >
  列表页阶段徽章升级为 step 级（design §5 Phase 2.1 + FR-01 + 原型列表徽章视觉）——
  stage 主行下增摘要副行：step x/y（全 stage 累计）+ 迷你进度条 + 当前步名；
  current_step_status 三态——active 蓝脉动 / waiting 黄 + 「等待用户决策」chip / done 绿；
  step_progress 缺失时降级只渲染 stage 主行，视觉与现状完全一致（D-003@v1）。
implementation:
  - 新建 change-step-badge.tsx——纯展示组件 props 只接 stage（string 或 null）与 stepProgress（StepProgressSummary 或 null，类型来自 api-types 禁止手写）；stage 主行沿用列表现有 stage 文案（中文标签可复用 change-stage-header 导出的 WORKFLOW_STAGE_LABELS）
  - stepProgress 非 null 且 step_total 大于 0 时渲染摘要副行——step x/y 文本 + 迷你进度条（宽度按 steps_completed 与 step_total 完成比）+ 当前步名，副行布局对齐原型 .step-sub（加载标记 / chip + 64px 迷你轨道 + 文本）
  - 三态色映射（徽章只吃摘要三值，不直接消费七值明细枚举）——active 蓝色脉动标记、waiting 黄色 + 「等待用户决策」chip、done 全完成绿色（current_step_status 与 current_step_name 均为 null 判全完成）
  - 降级——stepProgress 为 null 或 step_total 为 0 时不渲染摘要副行只渲染 stage 主行；stage 也为 null 时返回 null 不渲染
  - 新建 __tests__/change-step-badge.test.tsx——范式参照 change-stage-header.test.tsx 纯 render + screen 断言；覆盖 active（蓝标记 + step x/y + 当前步名）、waiting（黄 + chip 文案）、done（绿 + 无步名）、降级（stepProgress null 无副行）、进度条宽度按完成比、未知 current_step_status 兜底渲染不崩溃
acceptance:
  - active / waiting / done 三态摘要副行渲染正确——色标记、chip 文案、step x/y 计数、当前步名逐项可断言
  - stepProgress 为 null 时降级不渲染摘要副行，stage 主行视觉与现状一致
  - 迷你进度条宽度等于 steps_completed 除以 step_total 的完成比
  - 无 steps 数据、空字段、未知 status 值均零崩溃（防御式渲染）
verify:
  - cd frontend && pnpm exec vitest run src/components/changes/__tests__/change-step-badge.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints: 纯展示组件不拉数据不持状态（数据获取由 task-06 页面层 useQuery 提供）；UI 文案中文；样式参照 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md 简洁风与原型 prototype-change-step-visibility.html 列表徽章视觉；七值枚举色映射只在 task-05 时间线渲染，本组件不消费。
---
