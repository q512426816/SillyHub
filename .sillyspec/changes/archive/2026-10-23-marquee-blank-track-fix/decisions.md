---
author: flow-machine-draft
created_at: 2026-10-23T06:25:31.558Z
---
# 决策记录（Decisions）— 2026-10-23-marquee-blank-track-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险：offset 补偿瞬间若测量宽度为 0（字体未加载/隐藏容器），step 回退 208，可能有一次轻微跳动；已在 clamp 与 rAF 缓出下弱化。 - 放弃方案：① 每次滑动直接重置 offset=base（画面会瞬移一条，不流畅）；② 无限保留历史条目（DOM 无界增长）；③ 用 CSS 循环轨道（无法满足“只到最新不循环”）。
