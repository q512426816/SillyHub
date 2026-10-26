---
author: flow-machine-draft
created_at: 2026-10-26T07:07:30.293Z
---
# 任务注册表（Tasks）— 2026-10-26-subagent-card-width-unify

- [x] task-01: turn-segment-views.tsx 五组件根容器限宽——SubagentBlockView 两分支与 TeamWorkerBlockView 改 `w-full max-w-[calc(100%-120px)] self-start`、ToolRowView/ThinkingRowView 根 div 加限宽、StderrRowView 根加限宽；验证：tsc 零错
- [x] task-02: turn-segment-views.test.tsx 补五组件根容器 max-w-[calc(100%-120px)] 断言（含 self-start），核对既有断言不冲突；验证：vitest run 该测试文件全绿
- [ ] task-03: 回归核对——跑受影响测试面（turn-segment-views + turn-timeline 宽度相关套件）确认全绿，git 显式 pathspec 提交（消息带 task-01/02/03）
