---
author: flow-machine-draft
created_at: 2026-11-06T15:59:23.306Z
---
# 需求规格（Requirements）— 2026-11-06-api-body-read-timeout

## 功能需求

### FR-01: apiFetch 的超时保护覆盖到响应体读取完成：头已到但体在超时窗内未读完时按既有超时语义失败（ApiError code=timeout，走 reportApiFailure 熔断计数），不再无限 pending

- 带超时窗（显式 timeoutMs 或 GET 缺省 30s）的请求，其超时保护**必须**覆盖到 `resp.text()` 读取完成：头已到但体在窗内未读完时**必须**按既有超时语义失败（ApiError status=0 code=timeout + reportApiFailure 熔断计数），**禁止**无限 pending。

#### 场景：代理半开（头到体断流）→ 超时失败

Given 请求带 30s 超时窗且 fetch 已 resolve（响应头到达）但响应体永不完成；When 窗满；Then 抛 ApiError{status:0, code:"timeout"} 且走熔断计数（与 fetch 阶段超时同语义）。

### FR-02: 既有超时/网络错误/熔断短路行为不变（超时计时器对 fetch 阶段的语义与现状一致）

- fetch 阶段的超时/外部 abort/熔断短路行为**必须**与改动前逐语义一致（fetch 挂起超时、外部 abort→network_error、circuit_open 短路、写请求无默认超时豁免）；既有测试面**必须**零回归。

#### 场景：主路径

Given 既有 timeout describe 全部用例；When 运行；Then 全绿（fetch 挂起超时 / 通用文案 / 外部 abort→network_error / GET 缺省 30s / POST 无默认超时）。

### FR-03: 外部 signal（调用方 abort）在读体阶段仍可中断请求

- 外部 signal 的 abort 传导**必须**持续到响应体读取完成（fetch 完成后不得提前移除监听）：读体阶段外部 abort → 请求以 network_error 失败（timedOut 未置位），**禁止**切断传导导致挂死。

#### 场景：读体阶段外部 abort → network_error

Given fetch 已 resolve 且体读取挂起、调用方传入 signal；When 调用方 abort；Then 抛 ApiError{status:0, code:"network_error"}（非 timeout）。

### FR-04: 相关单测覆盖：读体超时触发 timeout 错误、正常读取不受影响、既有用例零回归

- **必须**以单测固化读体超时与读体外部 abort 两形态（挂起流 mock 手动桥接 signal→stream.error，复现真 fetch abort 语义）；正常读取（既有 JSON 解析用例）**必须**不受影响。

#### 场景：主路径

Given 新两用例 + 既有 api.test.ts / api-circuit.test.ts 全量；When 运行；Then 18+9 用例全绿。

### FR-05: 触及文件 tsc 零错

- frontend 触及文件（api.ts / api.test.ts）**必须** tsc 零错误（并行会话 untracked prototype 文件错误不属本变更面）。

#### 场景：主路径

Given 改动完成；When 全量 tsc --noEmit；Then 错误清单仅含并行会话的 prototype 文件（本变更文件零错）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/api.test.ts「头已到但体在超时窗内未读完 → code='timeout'（不再永久 pending）」
FR-02: frontend/src/lib/__tests__/api.test.ts「apiFetch timeout（ql-20260831-006-6d67）」describe 既有 5 用例 + api-circuit.test.ts 9 用例
FR-03: frontend/src/lib/__tests__/api.test.ts「读体阶段调用方外部 abort → network_error（timedOut 未置位）」
FR-04: 不适用：FR-04 为测试执行约束，成立性由 FR-01~03 测试绑定与执行结果承载
FR-05: 不适用：静态检查命令非测试用例，执行结果见 tasks.md 收口记录
