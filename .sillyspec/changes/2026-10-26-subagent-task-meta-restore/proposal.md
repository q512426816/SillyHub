---
author: flow-machine-draft
created_at: 2026-10-26T07:18:49.445Z
---
# 提案书（Proposal）— 2026-10-26-subagent-task-meta-restore

## 动机

任务原话转写：子代理任务元数据装配竞态修复
动机：生产会话 83a96b92 实证 + 本地真实数据复现——同一毫秒批量落库的四行（[TOOL_USE]/tool_call/[TASK_STARTED]/[TOOL_RESULT]）在历史回放装配中顺序不定，[TASK_STARTED] 行先于派发段建立时被丢弃，导致子代理卡片失去徽章/走秒元数据，暴露 async 回执假终态（假完成绿点+假时长），用户看到并行子代理卡片时间状态冻结。
成功标准：
- 装配器对 parent 未命中段的 [TASK_*] 行不再丢弃——悬挂暂存，派发段建立时回填元数据
- 同毫秒四行任意排列顺序装配，三个子代理段均获得 taskStatus/taskAsync 元数据，回执假终态被 metaStatus 优先级压住
- 回归测试覆盖乱序排列（含 TASK 行最先、TOOL_RESULT 先于 TASK 行等形态）全绿，既有装配器套件全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 装配器对 parent 未命中段的 [TASK_*] 行不再丢弃——悬挂暂存，派发段建立时回填元数据
2. 同毫秒四行任意排列顺序装配，三个子代理段均获得 taskStatus/taskAsync 元数据，回执假终态被 metaStatus 优先级压住
3. 回归测试覆盖乱序排列（含 TASK 行最先、TOOL_RESULT 先于 TASK 行等形态）全绿，既有装配器套件全绿

## 成功标准（可验证）

1. 装配器对 parent 未命中段的 [TASK_*] 行不再丢弃——悬挂暂存，派发段建立时回填元数据
2. 同毫秒四行任意排列顺序装配，三个子代理段均获得 taskStatus/taskAsync 元数据，回执假终态被 metaStatus 优先级压住
3. 回归测试覆盖乱序排列（含 TASK 行最先、TOOL_RESULT 先于 TASK 行等形态）全绿，既有装配器套件全绿
