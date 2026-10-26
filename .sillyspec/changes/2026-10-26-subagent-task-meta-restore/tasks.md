---
author: flow-machine-draft
created_at: 2026-10-26T07:18:49.446Z
---
# 任务注册表（Tasks）— 2026-10-26-subagent-task-meta-restore

- [x] task-01: session-log-assembler.ts 悬挂回填实现——PENDING_TASK_METAS symbol/carrier/attachInternals/transfer 携带 + task 分支悬挂暂存（无 parent 维持丢弃）+ tool_use 建段两处（新建/stub 合并）查表回填；验证：tsc 零错
- [x] task-02: task-line-assembler.test.ts 乱序用例——同毫秒四行三排列（TASK 最先/回执在前/常态）断言 taskStatus/taskAsync 落段与悬挂清空 + 无 parent 行丢弃零回归；验证：vitest run 该文件全绿
- [ ] task-03: turn-segment-views.test.tsx 显示层用例——回填段经 subagentHeaderOf 派生 running 徽章/走秒锚（压回执假终态）；验证：vitest run 该文件全绿 + session-log-assembler.test.ts 回归全绿，git 显式 pathspec 提交（消息带 task-01/02/03）
