---
author: flow-machine-draft
created_at: 2026-10-13T03:20:05.999Z
---
# 任务注册表（Tasks）— 2026-10-13-session-taskwakeup-hide

- [x] task-01: session-log-assembler.ts 新导出 `TASK_WAKEUP_PROMPT_PREFIX` / `isTaskWakeupInjection`，extract/stripPreambleText 内部改用同一判定；session-log-assembler.test.ts 补谓词用例——验证：vitest 跑 session-log-assembler.test.ts 绿
- [x] task-02: runtime-session-helpers.tsx 回放路径 preamble 建段跳过唤醒注入（开轮占位槽逻辑不动）；runtime-session-helpers.test.tsx 新增「不产出 preamble 段」用例，既有占位槽三用例与前导双写用例不回归——验证：vitest 跑 runtime-session-helpers.test.tsx 绿
- [x] task-03: session-panel-page.tsx 实时 SSE 路径 preamble 建段跳过唤醒注入（prompt 补写与幂等守卫不动）——验证：tsc 编译过 + steered-usermsg-guard.test.tsx 回归绿
- [ ] task-04: message-queue-bar.tsx 删本地前缀常量改 import，TASK_WAKEUP 条目 chip 摘要与展开正文剥前缀；message-queue-bar.test.tsx 新增去前缀显示用例——验证：vitest 跑 message-queue-bar.test.tsx 绿
- [ ] task-05: 汇总跑本变更全部相关测试文件（session-log-assembler / runtime-session-helpers / message-queue-bar / steered-usermsg-guard）确认全绿；共享脏文件（session-log-assembler.ts / session-panel-page.tsx）选择性暂存仅提交本变更 hunk
