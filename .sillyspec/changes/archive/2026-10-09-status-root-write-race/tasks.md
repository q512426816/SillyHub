---
author: flow-machine-draft
created_at: 2026-10-09T00:15:12.376Z
---
# 任务注册表（Tasks）— 2026-10-09-status-root-write-race

- [x] task-01: 单槽位与映射槽位落盘均经 _statusRootPersistChain 串行链（fire-and-forget 改链式 then），最后一次 note 的值必最后落盘
- [x] task-02: 新增 ×20 快速交替回归用例（放大窗口），与既有「切换 root」用例在新码下连跑全绿
- [x] task-03: daemon tsc 0，相关面测试全绿；CI 重推转绿
