# 视觉证据（visual-evidence）— 2026-10-09-thin-hide-step-timeline

## 变更性质

既有页面（变更详情页，桌面 + 移动端）的负向条件渲染：thin 出身变更不再挂载「步骤时间线」卡。非新页面 / 非新形态 / 非布局改版——不改任何卡片内部结构与样式，仅在挂载条件前加 `!isThinLineageChange(change)` 排除（谓词与页面既有顶部轻量流程条同源）。

## 视觉方案与 token 依据

不适用：本变更零新增视觉元素、零样式 token——隐藏一张对 thin 只有归档补种 3 行同时间戳步骤的噪音卡，页面剩余布局（审批卡 / 真实留痕时间线卡 / 沉淀资产卡等）由既有流式布局自然收拢，无占位空洞。

## 验证方式

- 渲染对照采用页面级 DOM 断言（改动是纯条件渲染增删，无像素级样式变化面，实页截图对本变更无增量信息）：
  - `page-restore-assets.test.tsx`「共存→隐藏（2026-10-09-thin-hide-step-timeline）」：thin fixture（change_type=quick + 3 行 stage=archive 补种 steps）断言 `change-step-timeline-card` 缺席、`change-timeline-card` 在场——隐藏后页面仍有主线叙事卡，无空窗。
  - `page-restore-assets.test.tsx`「共存（厚变更）」：厚 fixture（steps 含 execute/verify 标准阶段痕迹）断言两卡同屏——厚变更视觉行为零变化。
  - `mobile-change-detail.test.tsx`「归档 thin」：补 `m-change-timeline-card` 缺席断言（移动端同款）。
- 测试结果：page-restore-assets 11/11、mobile-change-detail 18/18、回归面（page-team-toggle + page-last-signal + change-step-timeline 组件）37/37 全绿。

## 降级裁决

无降级——实现与方案一致（整卡隐藏，非「过滤补种行」的结构收敛变体）。隐藏范围由用户在对话中明确拍板（「变更详情页隐藏 步骤时间线 吧」，2026-10-09 会话，对应本变更 FR-01）。
