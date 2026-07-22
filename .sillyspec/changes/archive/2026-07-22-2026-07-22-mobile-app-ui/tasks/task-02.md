---
id: task-02
title: frontend/src/styles/tokens.ts 新增 breakpoint token（mobile ≤768）
title_zh: 样式 token 新增移动断点（≤768px）
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/styles/tokens.ts
provides:
  - contract: BreakpointToken
    fields: [breakpointMobile]
expects_from: {}
goal: >
  在 styles/tokens.ts（design §6 文件清单 / FR-09）新增 breakpoint token，定义移动端断点 mobile=768（D-005），
  供后续移动组件与 tailwind screens 消费；保持现有 token 值与 as const 语义不变（桌面零回归）。
implementation:
  - 在 tokens 对象新增 breakpoint 段，breakpoint.mobile = 768（px，对应 D-005 仅手机 ≤768px）
  - 以 contract 字段名 breakpointMobile 代表该移动断点阈值，供消费方引用（值即 tokens.breakpoint.mobile = 768）
  - 维持 tokens 的 as const 与既有 color / radius / shadow / font / spacing 段不变；断点为逻辑阈值，不强制注入 cssVars
  - 文件头注释补「breakpoint 段供移动端判定（FR-09）」，守住「新增维度经本文件入口」边界（tokens.ts 注释 #5）
acceptance:
  - tokens.breakpoint.mobile === 768（D-005）
  - 现有 token 路径（color / radius / shadow / font / spacing）值与键不变
  - tsc 通过；既有 tokens 相关单测零回归
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 桌面零回归：仅新增 breakpoint 段，不改既有值与 cssVars
  - 断点阈值锁定 768（D-005），平板 >768 走桌面
  - 遵守 tokens.ts「新增维度经本文件入口」边界（文件头注释 #5），不在别处散落断点魔数
---

# task-02 · 断点 token

依据 design §6 / FR-09 / D-005。tokens.ts 是 design token 单一源；本次仅追加 breakpoint.mobile=768，为后续 task-07 通用组件及各移动视图的 matchMedia / 响应式判定提供阈值常量。本任务不接线消费方。
