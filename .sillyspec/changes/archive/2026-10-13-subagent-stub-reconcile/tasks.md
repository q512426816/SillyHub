---
author: flow-machine-draft
created_at: 2026-10-13T03:00:28.585Z
---
# 任务注册表（Tasks）— 2026-10-13-subagent-stub-reconcile

- [x] task-01: use-session-tasks.ts 视图行补 toolUseId(快照映射+事件合并) + buildSubagentTaskLookup 纯函数(终态优先序)——验证:subagent-task-reconcile.test.ts 索引用例跑绿
- [x] task-02: turn-segment-views.tsx subagentHeaderOf 第三参 reconciled + SubagentBlockView/DetailPanel 消费(徽章/状态点/时长/名称)——验证:stub 命中终态/名称/优先级用例跑绿
- [x] task-03: turn-timeline.tsx TurnTimelineProps.subagentTaskLookup + TurnRow 透传 + session-panel-page.tsx 页面级 useSessionTasks 实例与 useMemo Map 接线——验证:tsc 零错误 + 既有 session-panel/turn-segment-views 套件跑绿
- [x] task-04: 跑前端触达模块全部相关测试确认零回归——验证:src/components/daemon/ 套件退出码 0
