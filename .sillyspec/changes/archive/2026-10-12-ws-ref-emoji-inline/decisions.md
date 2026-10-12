---
author: flow-machine-draft
created_at: 2026-10-12T01:38:59.921Z
---
# 决策记录（Decisions）— 2026-10-12-ws-ref-emoji-inline

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：emoji 宽度在不同平台字体下的渲染差异（Windows/macOS/Linux 不一致）——但占位文本与 textarea 用同一字符同一字体栈，两侧永远同宽（同源对齐），风险仅剩视觉观感，可接受。放弃的方案：lucide inline 图标内嵌（撑宽背景块→后续 token 漂移，否决）；图标 absolute 悬浮在文字前（遮挡前文字符且盖住【，观感差，否决）。
