---
author: flow-machine-draft
created_at: 2026-10-15T02:27:13.850Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-grace-window

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：非输入型让权路径（如浏览器自动滚动/读屏器）在窗内被拉回一次——真实用户四类输入覆盖 99% 场景，10s 窗口短且只在内容变化时动作。放弃方案：①继续追凶（19 轮 1 复现，取证成本失控，用户在等）；②near 被清后无限复活（用户真滚后内容更新会被反复拉回，破坏让权语义）。
