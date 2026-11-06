---
author: flow-machine-draft
created_at: 2026-11-06T15:59:23.306Z
---
# 任务注册表（Tasks）— 2026-11-06-api-body-read-timeout

- [x] task-01: apiFetch 的超时保护覆盖到响应体读取完成：头已到但体在超时窗内未读完时按既有超时语义失败（ApiError code=timeout，走 reportApiFailure 熔断计数），不再无限 pending
- [x] task-02: 既有超时/网络错误/熔断短路行为不变（超时计时器对 fetch 阶段的语义与现状一致）
- [x] task-03: 外部 signal（调用方 abort）在读体阶段仍可中断请求
- [x] task-04: 相关单测覆盖：读体超时触发 timeout 错误、正常读取不受影响、既有用例零回归
- [x] task-05: 触及文件 tsc 零错
