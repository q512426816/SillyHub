---
author: flow-machine-draft
created_at: 2026-10-14T12:51:29.903Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-resize-observer

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：RO 高频回调性能（流式期间每 delta 触发）——rAF 合帧后每帧至多一次 scrollTo（与既有流式贴底同频，无增量）；MarkdownText memo 使未变行不重排，实际回调频率远低于帧率。放弃方案：①延长重申窗——时序赌注，图片加载时长无上界；②监听 img load 事件——只覆盖图片一类，markdown 迟渲染/注入仍漏；③MutationObserver——语义错位（观察结构不观察尺寸，且更贵）。
