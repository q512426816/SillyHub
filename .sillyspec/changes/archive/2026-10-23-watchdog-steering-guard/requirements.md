---
author: flow-machine-draft
created_at: 2026-10-23T08:09:55.208Z
---
# 需求规格（Requirements）— 2026-10-23-watchdog-steering-guard

## 功能需求

### FR-01: inject 时 runId === 当前 currentRunId（mid-turn steering）不得 stale-reset、不得布防看门狗

- 当 backend mid-turn steering 复用活跃 run 的 run_id 时，daemon `inject()` 必须跳过 >60s stale-running 自愈，并且禁止为该 run 布防轮启动看门狗；该注入必须按「当前轮追加输入」的排队语义处理（pendingInjectCount 递增），不得把 status 翻成 active。

#### 场景：忙轮 steering 同 runId

- Given 会话 status=running、currentRunId=run-A，且 lastActiveAt 已超过 60 秒
- When daemon 收到 runId=run-A 的 inject
- Then status 保持 running，staleRunResetAt 不被写入，看门狗未布防，pendingInjectCount 为 1；推进 90 秒后 onTurnStartTimeout 不被调用

### FR-02: stale 判定改用最后轮内事件时间（onMessage 更新），不再用上次 inject 时间

- daemon 的 >60s stale-running 自愈必须以「最后一次轮内事件时间」作为静默基准，禁止仅以最近一次 inject/result 时间为基准；onMessage 每收到一个 envelope 必须刷新该时间戳。

#### 场景：轮内事件新鲜时 inject

- Given 会话 status=running，lastActiveAt 为 120 秒前，但 lastTurnEventAt 为 5 秒前
- When daemon 收到一个新 runId 的 inject
- Then 不触发 stale-reset（staleRunResetAt 不写入，status 保持 running），该注入按排队处理

#### 场景：onMessage 刷新最后事件时间

- Given 任意活跃会话
- When onMessage 收到一个 envelope
- Then lastTurnEventAt 被刷新为当前时间，且当前 currentRunId 被记入 observedRunIds

### FR-03: 看门狗不得对已经产生过事件的 run 布防

- 轮启动看门狗禁止对已经产生过任何轮事件的 run 布防；首轮启动路径布防前必须检查 observedRunIds，命中即跳过布防。

#### 场景：已观测 run 再次 inject

- Given 会话 status=active、currentRunId 为空，但 observedRunIds 已包含 run-B
- When daemon 收到 runId=run-B 的 inject
- Then 不布防看门狗；推进 90 秒后 onTurnStartTimeout 不被调用

#### 场景：真僵尸轮仍触发

- Given 会话 status=active，run-C 从未产生事件且不在 observedRunIds
- When daemon 收到 runId=run-C 的 inject 且 90 秒内零事件
- Then 看门狗必须触发并回调 onTurnStartTimeout（2026-10-21-daemon-zombie-turn 既有行为不回归）

### FR-04: 回归测试：同 runId steering + 静默 90s 不触发；新 runId 真吞消息仍触发

- 测试矩阵必须同时覆盖「同 runId steering + 静默 90 秒不触发」与「新 runId 零事件 90 秒仍触发」两种形态，并保持既有看门狗用例全部通过。

#### 场景：测试矩阵

- Given `turn-start-watchdog.test.ts` 现有 9 个用例
- When 追加同 runId steering、已观测 run、事件新鲜 stale 判定三类回归用例
- Then 新增用例与既有用例全部通过，且真僵尸轮触发路径仍被断言

### FR-05: daemon 现有测试与 tsc 通过

- 本变更交付前，daemon 相关 vitest 用例与 `tsc --noEmit` 必须全部通过，零类型错误。

#### 场景：验证命令面

- When 运行 daemon 相关测试与类型检查
- Then 全部通过，无新增告警或类型错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「mid-turn steering（同 runId）不 stale-reset、不布防看门狗」
FR-02: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「轮内事件新鲜时 inject 不触发 stale-reset」/「onMessage 刷新最后事件时间并记录 observedRunIds」
FR-03: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「已观测事件的 run 不再布防看门狗」/「新 runId 零事件仍触发（真僵尸轮不回归）」
FR-04: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts（上述用例矩阵 + 既有 9 用例）
FR-05: 不适用：本条是验证命令面（daemon vitest + tsc --noEmit），无独立用例
