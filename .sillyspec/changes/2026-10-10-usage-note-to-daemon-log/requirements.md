---
author: flow-machine-draft
created_at: 2026-10-10T02:08:40.013Z
---
# 需求规格（Requirements）— 2026-10-10-usage-note-to-daemon-log

## 功能需求

### FR-01: hasLiveBackgroundTasks=true 的 run 收口不再向 submitMessages 发 [USAGE_NOTE] 行

- daemon.onTurnResult 在会话仍有存活后台任务时，**禁止**向会话消息流（onTurnMessage → submitMessages 通道）追加 [USAGE_NOTE] 标注行；该提示对用户是每轮必触发的噪音。

#### 场景：收口时有存活后台任务

- Given：会话存在未结束的后台任务（hasLiveBackgroundTasks=true）
- When：onTurnResult 收口并上报终态
- Then：submitMessages 的所有批次中不含 content 以 `[USAGE_NOTE]` 开头的消息

### FR-02: 排障意图保留：daemon 结构化日志记录存活后台任务标记 + 本轮 cost 差分（cost_delta_usd）

- 同一触发条件（存活后台任务）下，daemon **必须**输出一条结构化 info 日志，事件名 `run_cost_may_include_bg_tasks`，字段含 `session_id`、`run_id`、`cost_delta_usd`（取本轮快照差分，与 payload.total_cost_usd 同值同口径）。

#### 场景：有存活后台任务且带成本快照

- Given：hasLiveBackgroundTasks=true，result.total_cost_usd=24.10，会话基线 totalCostUsd=0
- When：onTurnResult 收口
- Then：logger info 输出事件 `run_cost_may_include_bg_tasks`，其中 cost_delta_usd=24.1、session_id/run_id 与收口 run 一致

### FR-03: total_cost_usd 缺失时日志安全降级（字段 null，不抛错）

- result.total_cost_usd 缺失或非有限数时，该日志**必须**仍输出且 `cost_delta_usd=null`，**禁止**因日志抛错或阻断终态上报（notifyRunResult 照常调用）。

#### 场景：成本快照缺失

- Given：hasLiveBackgroundTasks=true，result 无 total_cost_usd 字段
- When：onTurnResult 收口
- Then：日志 cost_delta_usd=null，notifyRunResult 正常调用，无异常抛出

### FR-04: daemon-usage-note.test.ts 改写为两态断言（无消息流行 + 有日志），先红后绿

- 覆盖本变更的测试**必须**改写为：hasLive=true → 无 [USAGE_NOTE] 消息流行 + 有替代日志；hasLive=false → 无消息流行且无该日志；并**必须**在改实现前先跑出红（旧实现下新断言失败），改后转绿。

#### 场景：先红后绿

- Given：daemon.ts 仍是旧实现（发 [USAGE_NOTE] 行、无日志）
- When：运行改写后的测试
- Then：断言失败（红）；实现落地后同命令转绿

### FR-05: 相关面（daemon-interactive-bridge 等）合跑通过 + tsc --noEmit 0 错

- 本变更**必须**通过相关面回归：`sillyhub-daemon` 下 `vitest run tests/interactive/daemon-usage-note.test.ts tests/interactive/daemon-interactive-bridge.test.ts` 全绿，且 `pnpm typecheck`（tsc --noEmit）0 错。

#### 场景：改动后合跑

- Given：daemon.ts 与测试已改
- When：合跑上述测试与 typecheck
- Then：全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=true → 无 [USAGE_NOTE] 行，改发 run_cost_may_include_bg_tasks 日志」
FR-02: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=true 且 total_cost_usd=24.10 → 日志 cost_delta_usd=24.1 挂收口 run」
FR-03: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「total_cost_usd 缺失 → 日志 cost_delta_usd=null 且终态照常上报」
FR-04: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=false → 无 [USAGE_NOTE] 行且无该日志」+ 先红后绿流程记录（verify 留档）
FR-05: sillyhub-daemon/tests/interactive/daemon-interactive-bridge.test.ts「相关面合跑回归」
