---
author: WhaleFall
created_at: 2026-08-19 18:33:16
---

# 任务清单（Tasks）

> 骨架——plan 阶段展开为 Wave 分组 + 依赖关系 + 每任务四件套。

- [ ] task-01: 共享装配器模块（session-log-assembler.ts）：输入归一 + 分类 + 归属路由 + 分段装配
- [ ] task-02: 装配器 override 撤回与去重（segmentId 前缀路由 / 跨段撤回 / log_id + seenText 双路去重 / 兜底 stub 合并）
- [ ] task-03: 装配器单测（分段/嵌套/撤回/归属桶配对/兜底/历史实时一致性）
- [ ] task-04: SessionStreamEnvelope 补归属字段类型声明（lib/daemon.ts）
- [ ] task-05: 段渲染组件族（turn-segment-views.tsx：TextSegment/ThinkingRow/ToolRow/SubagentBlock/StderrRow）
- [ ] task-06: TurnTimeline v2 重构（segments 消费 + 视图两态 + 内置 TurnStatusBar + 旧路径回退）
- [ ] task-07: 轮级状态条组件（turn-status-bar.tsx：计时锚点/计数/当前活动派生）
- [ ] task-08: 子代理目录组件（subagent-catalog.tsx：下拉清单 + tick 时长 + 定位跳转）
- [ ] task-09: sessions 页接入（applyLogToTurn 副本替换为装配器 + 挂 SubagentCatalog + 计时锚点接线）
- [ ] task-10: runtimes 弹窗接入（interactive-session-panel 副本替换为装配器）
- [ ] task-11: 历史路径接入（logsToTurns 内部改走装配器 + 兼容投影）
- [ ] task-12: 段渲染与消费方测试适配（新单测 + 既有测试「全部→进度」等断言更新）
