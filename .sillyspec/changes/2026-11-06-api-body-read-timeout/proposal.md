---
author: flow-machine-draft
created_at: 2026-11-06T15:59:23.305Z
---
# 提案书（Proposal）— 2026-11-06-api-body-read-timeout

## 动机

任务原话转写：前端链路梳理（2026-11-06 会话分叉事故排查的副产物）发现 apiFetch 结构洞：frontend/src/lib/api.ts 的超时计时器在响应头到达（fetch resolve）时即被 finally 清除，随后 await resp.text() 读响应体无任何超时与 abort 保护——当连接在头之后、体之前断流（代理半开、后端卡在序列化后）时请求 promise 永不 settle，react-query 层表现为页面永久转圈不报错（会话详情全屏 Spin 即此形态，Explore 代理已核实为前端唯一无界挂起点）。本次修复把响应体读取纳入超时保护。

成功标准：
- apiFetch 的超时保护覆盖到响应体读取完成：头已到但体在超时窗内未读完时按既有超时语义失败（ApiError code=timeout，走 reportApiFailure 熔断计数），不再无限 pending
- 既有超时/网络错误/熔断短路行为不变（超时计时器对 fetch 阶段的语义与现状一致）
- 外部 signal（调用方 abort）在读体阶段仍可中断请求
- 相关单测覆盖：读体超时触发 timeout 错误、正常读取不受影响、既有用例零回归
- 触及文件 tsc 零错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. apiFetch 的超时保护覆盖到响应体读取完成：头已到但体在超时窗内未读完时按既有超时语义失败（ApiError code=timeout，走 reportApiFailure 熔断计数），不再无限 pending
2. 既有超时/网络错误/熔断短路行为不变（超时计时器对 fetch 阶段的语义与现状一致）
3. 外部 signal（调用方 abort）在读体阶段仍可中断请求
4. 相关单测覆盖：读体超时触发 timeout 错误、正常读取不受影响、既有用例零回归
5. 触及文件 tsc 零错

## 成功标准（可验证）

1. apiFetch 的超时保护覆盖到响应体读取完成：头已到但体在超时窗内未读完时按既有超时语义失败（ApiError code=timeout，走 reportApiFailure 熔断计数），不再无限 pending
2. 既有超时/网络错误/熔断短路行为不变（超时计时器对 fetch 阶段的语义与现状一致）
3. 外部 signal（调用方 abort）在读体阶段仍可中断请求
4. 相关单测覆盖：读体超时触发 timeout 错误、正常读取不受影响、既有用例零回归
5. 触及文件 tsc 零错
