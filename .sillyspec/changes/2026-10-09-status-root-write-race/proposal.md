---
author: flow-machine-draft
created_at: 2026-10-09T00:15:12.376Z
---
# 提案书（Proposal）— 2026-10-09-status-root-write-race

## 动机

任务原话转写：动机：daemon-ci 在 ae49ccee 实跑红——daemon-status-root-persistence.test「切换 root」用例断言 beta 收到 alpha；机理为 _noteSillySpecStatusRoot 两次快速调用各自 fire 未串行的 writeFile，同文件竞态下旧值可后落盘（9 月既有缺陷，此前 CI 绿属运气，非本次任何变更引入；原用例本地 3 跑亦 1 红实证可复现）。

成功标准：
- 单槽位与映射槽位落盘均经 _statusRootPersistChain 串行链（fire-and-forget 改链式 then），最后一次 note 的值必最后落盘
- 新增 ×20 快速交替回归用例（放大窗口），与既有「切换 root」用例在新码下连跑全绿
- daemon tsc 0，相关面测试全绿；CI 重推转绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 单槽位与映射槽位落盘均经 _statusRootPersistChain 串行链（fire-and-forget 改链式 then），最后一次 note 的值必最后落盘
2. 新增 ×20 快速交替回归用例（放大窗口），与既有「切换 root」用例在新码下连跑全绿
3. daemon tsc 0，相关面测试全绿；CI 重推转绿

## 成功标准（可验证）

1. 单槽位与映射槽位落盘均经 _statusRootPersistChain 串行链（fire-and-forget 改链式 then），最后一次 note 的值必最后落盘
2. 新增 ×20 快速交替回归用例（放大窗口），与既有「切换 root」用例在新码下连跑全绿
3. daemon tsc 0，相关面测试全绿；CI 重推转绿
