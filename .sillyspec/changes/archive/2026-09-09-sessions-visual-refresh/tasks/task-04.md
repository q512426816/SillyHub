---
id: task-04
title: 共享构件 RoundDivider（六态）+ 桶导出
title_zh: 轮次分隔胶囊构件（六态）
allowed_paths:
  - frontend/src/components/chat/round-divider.tsx
  - frontend/src/components/chat/index.ts
  - frontend/src/components/chat/__tests__/round-divider.test.tsx
depends_on:
  - task-01
goal: FR-04（D-010@v1）：轮次分隔胶囊构件，status 覆盖轮尾实际六态
implementation: |
  1. round-divider.tsx 实现 design.md 接口：label + status（六态判别联合）+ meta；结构=两侧渐变细线（from transparent 经 var(--border)）+ 居中胶囊（--glass-heavy 底 + backdrop-blur + --border-soft 描边 + shadow-sm）。
  2. 六态着色映射：completed→success 绿「✓ 已完成」；failed/killed→error 红；running→info 青；pending/interrupting→neutral 灰；文案沿用 turn-timeline 现有六态文案。
  3. index.ts 桶导出 ChatMessageAvatar/RoundDivider/useAvatarSrc。
  4. 单测：六态各自渲染着色类名；meta/label 文本渲染；status 缺省（不渲染状态段）。
acceptance: 六态映射与设计一致且都有用例；桶导出可用；tsc 判别联合穷尽（非法 status 编译错）
verify: pnpm -C frontend exec vitest run src/components/chat 通过；tsc --noEmit 0 错
constraints:
  - 胶囊描边/底色走 task-01 新 token，不硬编码
  - 数字用 tabular-nums（meta 内 token 数）
---

## 说明

文案与 TurnStatusBadge 现状对齐，避免双口径。
