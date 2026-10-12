---
author: flow-machine-draft
created_at: 2026-10-12T03:02:57.150Z
---
# 决策记录（Decisions）— 2026-10-12-ws-ref-hover-tip-flip

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：风险：TIP_EST_HEIGHT=48 是粗估（实际两行文本≈42px）——翻转判定略保守（早翻），只影响翻转时机不影响可见性。放弃的方案：渲染后读实际高度再翻（useLayoutEffect 二段定位）——复杂度不值（估高误差只导致提前翻转，无功能影响）。
