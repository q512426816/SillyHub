---
id: task-05
title: ChangeStepTimeline detail timeline + replace SillySpecStepProgress
title_zh: 详情步骤时间线组件 + 替换旧组件与引用清理
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-03]
blocks: [task-07]
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-step-timeline.tsx
  - frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  - frontend/src/components/sillyspec-step-progress.tsx
  - frontend/src/components/changes/detail/change-agent-run-log.tsx
  - frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx
expects_from:
  task-03:
    - contract: StepTimelineEntry
      needs: [name, stage, status, output, completed_at, wait_reason, ordering]
goal: 新建 ChangeStepTimeline 垂直时间线（stage 分组 + 七值状态色 + entry 级稳定 diff），git rm 旧组件并清理三处引用与测试 mock，配组件测试。
implementation:
  - 新建 change-step-timeline.tsx——props 接 steps 可空（null/undefined 渲染空态不炸），按 stage 分组（STAGE_ORDER 序，quick 与未知 stage 追加在后），组内按 ordering
  - 七值状态色映射——completed 绿 / in-progress 蓝脉动 / pending 灰 / waiting 黄 / failed 红 / blocked 与 stale 橙 / 未知值按灰；completed 步显示 completed_at ISO 时间与 output 摘要，waiting 步显示 wait_reason
  - entry 列表 key 用 stage 与 ordering 组合做稳定 diff，仅变化节点重渲染，不整列重挂
  - git rm sillyspec-step-progress.tsx（execute 流程允许删除）；清理 change-agent-run-log.tsx 的 import(:7-9) 与挂载(:91)，其测试 mock(:9) 同步改新依赖或内联
  - 写 __tests__/change-step-timeline.test.tsx——七值色 / stage 分组排序 / steps null 空态 / completed 时间与 output / waiting 显示 wait_reason
acceptance:
  - 七值状态色渲染正确（含未知值灰兜底）
  - completed 步显示 ISO 时间与 output 摘要，waiting 步显示 wait_reason
  - steps null 渲染空态不抛错
  - 旧组件引用 grep 全 src 零残留
  - change-agent-run-log 测试适配通过
verify:
  - cd frontend && pnpm exec vitest run src/components/changes/detail
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && grep -r sillyspec-step-progress src/ 无结果
constraints: [删除走 git rm, "[cid]/page.tsx 挂载点替换归 task-07 本 task 只做组件与引用文件清理", entry 级 diff 不整列重挂]
---

# TaskCard — 详情步骤时间线组件 + 替换 SillySpecStepProgress

## 依据

- design.md §5 Phase 2.2（ChangeStepTimeline 替换 SillySpecStepProgress，D-005@v1）、§6 文件清单（新增 change-step-timeline.tsx / 删除 sillyspec-step-progress.tsx 及三处引用清理）、§7 StepTimelineEntry 形状、R-04 entry 级 diff、R-08 引用残留风险
- requirements.md FR-02（stage 分组垂直时间线 + 七值状态色 + wait_reason + 旧组件替换引用清理）
- plan.md task-05（W3，依赖 task-03，阻塞 task-07）
- 原型 prototype-change-step-visibility.html 第②段（timeline / tl-item done-active-wait / stage-group 结构与状态色）

## 被删组件的三个引用点（现状实证）

- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:23 import type StepInfo + :181-206 steps 派生（从 change.stages）——挂载点替换归 task-07，本 task 不改此文件
- frontend/src/components/changes/detail/change-agent-run-log.tsx:7-9 import SillySpecStepProgress 与 StepInfo、:91 挂载（onRefresh/refreshing 透传）——本 task 清理
- frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx:9 vi.mock("@/components/sillyspec-step-progress") 捕获 props 验 onDispatch 不传——本 task 适配

## 旧组件全部导出（git rm 影响面）

- SillySpecStepProgress（组件）、SillySpecStepProgressProps、StepInfo（类型）——grep 全 src 仅上述三处 import，无其它文件引用
