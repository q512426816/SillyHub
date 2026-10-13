---
author: flow-machine-draft
created_at: 2026-10-13T06:41:24.731Z
---
# 决策记录（Decisions）— 2026-10-13-turn-nav-rail-overflow-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：jsdom 无法断真实 flex 布局，契约测试只能断 className（若未来有人改回 shrink-0 而同时改 testid/类名结构，断言可能失守）——已用 `data-testid="turn-nav-rail"` 命中容器并把「无 shrink-0 + min-h-0」写成显式用例降低静默回归概率；真实视觉验收（50+ 轮会话）留人工确认项记入 visual-evidence.md。 放弃的方案：① 沿用 turn-catalog 结构把 nav 直接提为行的 stretch 子项——需重排把手/浮层 DOM 层级，改动面大于收益；② 提高密集阈值或按容器高度自适应刻度尺寸——只缓解不治本（溢出仍在），且引入测量逻辑复杂度；③ root 加 overflow-hidden 裁切——会连把手/浮层一起裁，且不可滚动更差。
