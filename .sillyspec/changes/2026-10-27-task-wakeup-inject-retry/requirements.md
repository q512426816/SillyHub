---
author: flow-machine-draft
created_at: 2026-10-27T00:54:57.791Z
---
# 需求规格（Requirements）— 2026-10-27-task-wakeup-inject-retry

## 功能需求

### FR-01: 唤醒注入失败后按退避计划重试（默认 5s/15s/30s/60s/120s/300s，总窗约 9.3 分钟盖住部署重建窗），注入成功即止

- `onTaskWakeupInject` 回调抛错（网络/HTTP 5xx/超时等任一形态）时，daemon **必须**按默认退避计划 `[5s,15s,30s,60s,120s,300s]` 逐次重试（首发 1 次 + 重试 6 次，总窗约 9.3 分钟）；任一次注入成功（含后端 queue_when_busy 排队成功）**必须**立即停止后续重试；重试链路**禁止**抛出异常打断宿主流程（现有 fire-and-forget 语义不变）。

#### 场景：首败重试成功（e132e9bf 实证形态）

- Given: 61s 后台任务终态触发唤醒注入，首次 `onTaskWakeupInject` reject（模拟 HTTP 504 DAEMON_RUNTIME_OFFLINE）
- When: 前进 5s（首个退避间隔）
- Then: 第二次注入执行且 resolve；回调总调用数=2；不再有第三次调度

#### 场景：全部重试耗尽

- Given: 回调恒 reject
- When: 前进全部退避间隔（5+15+30+60+120+300=530s）
- Then: 回调总调用数=7（首发+6 重试）；最终以 error 级日志留痕放弃

### FR-02: 重试等待期间会话已从 store 消失（终态/清理）时中止后续重试并留日志

- 每次退避等待结束、发起下一次注入前，daemon **必须**检查 `SessionManagerCore._store` 中该会话条目是否仍在；已消失（会话终态清理路径 `_store.delete` 已执行）时**必须**中止后续重试并以 warn 级日志留痕（含 sessionId 与已尝试次数），**禁止**对已终态会话继续注入。

#### 场景：重试中途会话终态

- Given: 首次注入 reject，5s 退避等待中会话被终态清理（`_store.delete`）
- When: 前进 5s
- Then: 不发起第二次注入（回调总调用数=1）；留「会话已终态中止重试」日志

### FR-03: 重试计划 env 可配可禁用（SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS 逗号列表，空/0=禁用回单发行为——对齐 SILLYHUB_TASK_WAKEUP_QUIET_MS 惯例）

- 重试退避计划**必须**可经 `SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS`（逗号分隔毫秒列表）覆写；值为 `0` 或空串时**必须**完全禁用重试（回到单发即弃的旧行为——止血开关）；非法项（非正整数）**必须**忽略该项且不致 crash（解析容错对齐 `taskWakeupQuietThresholdMs` 惯例）；未设置时用默认计划；env 逐次读取（运行期改 env 即生效）**SHOULD** 与 QUIET_MS 同款。

#### 场景：禁用开关

- Given: `SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS=0`，回调恒 reject
- When: 前进 600s
- Then: 回调总调用数=1（单发即弃，无重试）

### FR-04: 三方向评估结论落档：择退避重试（B 成功才清锚点不解决唤醒缺失；C 本地直投绕不开后端建 run 落库）；重试幂等性依据=后端忙轮排队合并恒≤1条

- 本变更**必须**在 design.md「边界与并发」节落档三方向评估：A 退避重试（选定）/ B 唤醒注入成功才清锚点 / C daemon 本地直投不经后端；含 B 不解决唤醒缺失（锚点只影响工具守卫、不产生新轮次）与 C 绕不开后端建 run/落库（前端时间线依赖）的落选理由，以及重试幂等性依据（backend 排队合并 `_merge_task_wakeup_prompt` 恒≤1 条 + prompt 自带「不要重复执行」指令）。无代码面（评估性 FR）。

### FR-05: 附带修复：turn_phase 观测记点 notePhaseEmit 增 per(point,session,run) 防重（有界512），TRACE 开启不再随 envelope 刷屏（daemon.log 323219-323256 同秒30+行实证）

- `notePhaseEmit` **必须**按 `(point, sessionId, runId)` 键防重——同键首次记点照常输出，后续静默跳过；防重集合**必须**有界（512 逐出最旧，对齐 `warnOncePhaseFailure` 惯例）并在 `resetTurnPhaseObservabilityForTest` 一并清零；TRACE 关闭时行为不变（门控在前）。观测记点**禁止**改变 fire-and-forget 语义（只读不拦截）。

#### 场景：同 run 多 envelope 记点去重

- Given: `SILLYHUB_TURN_PHASE_TRACE=1`，同 (point, session, run) 连续调用 notePhaseEmit 3 次
- Then: 日志仅输出 1 次

### FR-06: 既有唤醒用例（task-lifecycle.test.ts）与观测用例（turn-phase-observability.test.ts）全绿不回归

- 本变更后上述两测试文件既有用例**必须**全部通过（含既有 FR-01 恰一次注入、2s 窗口合并、短任务/静默阈值不注入、stopped 不注入、TRACE 三态、失败首警去重等）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「唤醒注入首败后按退避计划重试至成功（504 形态）」「唤醒注入全重试耗尽后以 error 留痕放弃」
FR-02: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「重试等待期会话终态（store 删除）中止后续重试」
FR-03: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS=0 禁用重试回单发行为」
FR-04: 不适用：评估性结论（无代码面），落档 design.md 边界并发节由收口文档门核验在场
FR-05: test/sillyhub-daemon/tests/turn-phase-observability.test.ts「notePhaseEmit 同 (point,session,run) 键防重仅首记输出」
FR-06: 不适用：回归面断言——两测试文件全量重跑绿即证据（flow done 实测门对账）
