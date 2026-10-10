---
author: flow-machine-draft
created_at: 2026-10-10T15:03:59.680Z
---
# 任务注册表（Tasks）— 2026-10-10-dialog-qa-inplace

- [x] task-01: 对话视图（v2 段路径）中，已答问答 ❓ 块按 dialog.created_at 与段 startedAt/ts 合并排序，穿插在对话流的时间正确位置（两段之间的提问渲染在两段之间）（convoTimeline memo + 用例「两段之间的提问渲染在两段之间」）
- [x] task-02: 问答块视觉样式逐字不变（复用同一标记），仅位置变化（DialogQaBlock 抽取，类名/文案逐字平移 + data-testid）
- [x] task-03: 旧回退路径（segments undefined 的孤儿轮）保持旧行为不回归（旧块门控收紧 + 用例「旧回退路径：❓ 块仍渲染」）
- [x] task-04: 全部视图穿插行为零改动（timeline memo 原样 + 用例「全部视图：轻量 ❓ 块不双画」）
- [x] task-05: 既有对话/弹窗相关测试（session-panel-dialog / dialog-minimize / conversation-file-card / turn-time-display / session-history-scroll）全部保持通过（5 文件 92/92 绿 + tsc 零错；本变更新用例 5/5 绿）
