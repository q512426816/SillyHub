---
id: task-02
title: workspace-stats-row-component
title_zh: 工作区详情页统计卡行组件 stats-row（四卡图标化，可点击性同现状）
author: qinyi
created_at: 2026-08-20 15:50:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-201, D-202]
allowed_paths:
  - frontend/src/components/workspace/stats-row.tsx
provides:
  - contract: WorkspaceStatsRow
    fields: [workspaceId, componentCount, activeChanges, archivedChanges, currentStage]
goal: >
  新增纯展示统计卡行组件 WorkspaceStatsRow（frontend/src/components/workspace/stats-row.tsx），
  为四段式段②——四统计卡升级为 lucide 图标+数值大字+标签版式（图标软底），
  可点击性与现状严格一致（page.tsx 470-487 行），供 task-04 替换原 Overview 统计区。
implementation:
  - 新建 stats-row.tsx 导出 WorkspaceStatsRow，"use client" 纯展示组件，四个数字全部由 props 传入，组件内无数据 hook 无 API 调用
  - props 五项按设计 §6——workspaceId（string）/ componentCount（number）/ activeChanges（number）/ archivedChanges（number）/ currentStage（string 或 null）
  - 四卡标签与现状一字不差——项目组组件/进行中变更/已归档变更/运行时阶段；数值大字+标签小字层级；currentStage 为 null 时显示长破折号（同现状兜底）
  - 可点击性同现状——项目组组件 Link 至 /workspaces/<workspaceId>/components、进行中变更 Link 至 /workspaces/<workspaceId>/changes、运行时阶段 Link 至 /workspaces/<workspaceId>/runtime；已归档变更为 div 不可点击（不升格 Link）
  - 每卡 lucide 图标置于软底圆角块 bg-brand-50 text-brand-600——选型按语义（执行时可等价替换）——项目组组件=Puzzle、进行中变更=GitBranch、已归档变更=Archive、运行时阶段=Activity
  - 卡行布局 grid grid-cols-2 lg:grid-cols-4（窄屏两列同现状）；悬浮抬升+主题化阴影 token（shadow 走主题 var 不写死）
acceptance:
  - tsc --noEmit 0 error 且 eslint 该文件 0 error
  - props 恰为五项且 componentCount/activeChanges/archivedChanges 均为 number，currentStage 可空
  - 可点击性矩阵与现状一致——组件/进行中变更/运行时三卡为 Link 且 href 与现状一字不差，归档卡为 div 无任何跳转
  - 图标软底统一 bg-brand-50 text-brand-600；组件无数据 hook 无 API 调用
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/workspace/stats-row.tsx
constraints:
  - 数字全部来自 props（统计查询留 page.tsx 既有 load），不新增任何 API 调用（设计 §2 承诺）
  - 归档卡保持 div 不可点（现状行为，仅升视觉不改交互）
  - 样式全走 brand 语义阶与主题化 shadow token，不硬编码 blue-* 色值
  - 本卡只新建组件文件，不改 page.tsx 与任何测试（接线与断言属 task-04/05）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
