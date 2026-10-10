---
author: flow-machine-draft
created_at: 2026-10-10T15:03:59.680Z
---
# 提案书（Proposal）— 2026-10-10-dialog-qa-inplace

## 动机

任务原话转写：会话「对话」视图中，同一轮内多个断点问答（AskUser 提问记录 ❓ 块）全部固定渲染在轮头部、agent 回复正文之前（turn-timeline.tsx 677-701 按 run_id 过滤后整组前置渲染），用户实测一轮 7 问全部堆在轮次顶部，提问与答复的时序完全丢失；「全部」视图早已按时间戳穿插（650-676/1546-1561），对话视图是遗留旧路径。
成功标准：
- 对话视图（v2 段路径）中，已答问答 ❓ 块按 dialog.created_at 与段 startedAt/ts 合并排序，穿插在对话流的时间正确位置（两段之间的提问渲染在两段之间）
- 问答块视觉样式逐字不变（复用同一标记），仅位置变化
- 旧回退路径（segments undefined 的孤儿轮）保持旧行为不回归
- 全部视图穿插行为零改动
- 既有对话/弹窗相关测试（session-panel-dialog / dialog-minimize / conversation-file-card 等）全部保持通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 对话视图（v2 段路径）中，已答问答 ❓ 块按 dialog.created_at 与段 startedAt/ts 合并排序，穿插在对话流的时间正确位置（两段之间的提问渲染在两段之间）
2. 问答块视觉样式逐字不变（复用同一标记），仅位置变化
3. 旧回退路径（segments undefined 的孤儿轮）保持旧行为不回归
4. 全部视图穿插行为零改动
5. 既有对话/弹窗相关测试（session-panel-dialog / dialog-minimize / conversation-file-card 等）全部保持通过

## 成功标准（可验证）

1. 对话视图（v2 段路径）中，已答问答 ❓ 块按 dialog.created_at 与段 startedAt/ts 合并排序，穿插在对话流的时间正确位置（两段之间的提问渲染在两段之间）
2. 问答块视觉样式逐字不变（复用同一标记），仅位置变化
3. 旧回退路径（segments undefined 的孤儿轮）保持旧行为不回归
4. 全部视图穿插行为零改动
5. 既有对话/弹窗相关测试（session-panel-dialog / dialog-minimize / conversation-file-card 等）全部保持通过
