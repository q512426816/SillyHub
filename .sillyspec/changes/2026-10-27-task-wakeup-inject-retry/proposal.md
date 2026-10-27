---
author: flow-machine-draft
created_at: 2026-10-27T00:54:57.790Z
---
# 提案书（Proposal）— 2026-10-27-task-wakeup-inject-retry

## 动机

任务原话转写：动机：后台任务终态唤醒注入经后端中转单发无重试，撞后端短暂不可用窗（部署重建/502/504）即 interactive_inject_send_failed 永久失败不补发，会话楔死至用户手动来消息（2026-10-26 会话 e132e9bf 实证，活跃坑 task-wakeup-inject-backend-relay-single-shot）。

成功标准：
- 唤醒注入失败后按退避计划重试（默认 5s/15s/30s/60s/120s/300s，总窗约 9.3 分钟盖住部署重建窗），注入成功即止
- 重试等待期间会话已从 store 消失（终态/清理）时中止后续重试并留日志
- 重试计划 env 可配可禁用（SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS 逗号列表，空/0=禁用回单发行为——对齐 SILLYHUB_TASK_WAKEUP_QUIET_MS 惯例）
- 三方向评估结论落档：择退避重试（B 成功才清锚点不解决唤醒缺失；C 本地直投绕不开后端建 run 落库）；重试幂等性依据=后端忙轮排队合并恒≤1条
- 附带修复：turn_phase 观测记点 notePhaseEmit 增 per(point,session,run) 防重（有界512），TRACE 开启不再随 envelope 刷屏（daemon.log 323219-323256 同秒30+行实证）
- 既有唤醒用例（task-lifecycle.test.ts）与观测用例（turn-phase-observability.test.ts）全绿不回归

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 唤醒注入失败后按退避计划重试（默认 5s/15s/30s/60s/120s/300s，总窗约 9.3 分钟盖住部署重建窗），注入成功即止
2. 重试等待期间会话已从 store 消失（终态/清理）时中止后续重试并留日志
3. 重试计划 env 可配可禁用（SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS 逗号列表，空/0=禁用回单发行为——对齐 SILLYHUB_TASK_WAKEUP_QUIET_MS 惯例）
4. 三方向评估结论落档：择退避重试（B 成功才清锚点不解决唤醒缺失；C 本地直投绕不开后端建 run 落库）；重试幂等性依据=后端忙轮排队合并恒≤1条
5. 附带修复：turn_phase 观测记点 notePhaseEmit 增 per(point,session,run) 防重（有界512），TRACE 开启不再随 envelope 刷屏（daemon.log 323219-323256 同秒30+行实证）
6. 既有唤醒用例（task-lifecycle.test.ts）与观测用例（turn-phase-observability.test.ts）全绿不回归

## 成功标准（可验证）

1. 唤醒注入失败后按退避计划重试（默认 5s/15s/30s/60s/120s/300s，总窗约 9.3 分钟盖住部署重建窗），注入成功即止
2. 重试等待期间会话已从 store 消失（终态/清理）时中止后续重试并留日志
3. 重试计划 env 可配可禁用（SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS 逗号列表，空/0=禁用回单发行为——对齐 SILLYHUB_TASK_WAKEUP_QUIET_MS 惯例）
4. 三方向评估结论落档：择退避重试（B 成功才清锚点不解决唤醒缺失；C 本地直投绕不开后端建 run 落库）；重试幂等性依据=后端忙轮排队合并恒≤1条
5. 附带修复：turn_phase 观测记点 notePhaseEmit 增 per(point,session,run) 防重（有界512），TRACE 开启不再随 envelope 刷屏（daemon.log 323219-323256 同秒30+行实证）
6. 既有唤醒用例（task-lifecycle.test.ts）与观测用例（turn-phase-observability.test.ts）全绿不回归
