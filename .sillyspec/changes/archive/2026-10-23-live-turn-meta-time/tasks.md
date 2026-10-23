---
author: flow-machine-draft
created_at: 2026-10-23T02:25:19.310Z
---
# 任务注册表（Tasks）— 2026-10-23-live-turn-meta-time

- [x] task-01: page-helpers.tsx 活跃 run（running/pending/pending_approval）replyAt 禁止回退快照 started_at（终态回退链不动）——验证：runtime-session-helpers.test.tsx 新用例「活跃 run 快照不再伪造 replyAt」+ 既有 enrich 用例全绿
- [x] task-02: turn-timeline.tsx metaDetail 三分支（isLiveTurn+锚点 → 开始+实时历时；终态 replyAt 三段保持；缺锚点不显示）+ TurnLiveElapsedText 每秒局部 tick；round-divider.tsx detail prop 类型放宽 ReactNode——验证：tsc 0 错
- [x] task-03: turn-time-display.test.tsx 新增用例：进行中轮底部只显「开始+历时」无「结束」且 fake timers 走秒递增；运行中→完成切换恢复三段（走秒组件卸载）；既有三段显示用例零回归全绿
- [x] task-04: 全量回归：vitest 跑 turn-time-display / runtime-session-helpers / page-helpers-enrich / turn-timeline 相关套件 + eslint 改动文件 0 错
