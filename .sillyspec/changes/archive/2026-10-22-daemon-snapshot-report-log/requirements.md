---
author: flow-machine-draft
created_at: 2026-10-22T00:44:48.379Z
---
# 需求规格（Requirements）— 2026-10-22-daemon-snapshot-report-log

## 功能需求

### FR-01: 上述两处注释改为新口径（无数据不出卡 / 后端 capability=tool_only 语义保留），不再出现「前端走『仅工具编辑』降级卡」表述

- `sillyhub-daemon/src/hub-client.ts`（`notifyRunResult` 的 `file_changes` 映射段）与 `sillyhub-daemon/src/daemon.ts`（`_onTurnSnapshot` 方法头）**必须** 改为与 2026-10-22-file-card-hide-empty 一致的口径：缺 `file_changes` → 后端 `capability="tool_only"`，前端**无数据不出卡**；两处 **禁止** 再出现「前端走『仅工具编辑』降级卡」表述；后端 `capability` 字段语义 **必须** 保留说明（它仍是版本门控真相源）。

#### 场景：主路径

Given 两处注释已更新；When 全仓 grep「仅工具编辑」；Then `sillyhub-daemon/src` 下 0 命中，且注释仍说明 `capability="tool_only"` 的落库语义。

### FR-02: 每次快照上报都打一条结构化日志 turn_file_changes_reported，含 outcome=delivered|failed|enqueued|dropped、drop_reason、status、reason、file_count、collect_ms、elapsed_ms，失败另带 error

- `Daemon._onTurnSnapshot` **必须** 在四条出口（session 已收口 / 无 claimToken 且无 resilience 入箱 / 无 claimToken 但已入箱 / 真实上报成功或失败）各打一条 `turn_file_changes_reported` 结构化日志；`outcome` **必须** 是 `delivered|failed|enqueued|dropped` 之一；字段 **必须** 含 `session_id`、`run_id`、`status`、`file_count`、`collect_ms`、`elapsed_ms`，快照带 `reason` / `truncated` 时 **必须** 一并透传；失败路径 **必须** 带 `error`，丢弃路径 **必须** 带 `drop_reason`。日志级别：`delivered` / `enqueued` = info，`failed` / `dropped` = warn。

#### 场景：主路径（成功）

Given 会话态存在、`claimToken` 非空、`notifyRunResult` resolve；When 上报快照；Then 打一条 info 级 `[daemon.turn_file_changes_reported]`，`outcome=delivered` 且带 `file_count` / `status` / `collect_ms`。

#### 场景：上报失败

Given `notifyRunResult` reject（HTTP/网络）；When 上报；Then 打一条 warn 级同 tag，`outcome=failed` 且带 `error`，且**不向上抛**（best-effort 语义不变）。

#### 场景：丢弃（会话已收口 / 无 claimToken 且无 resilience）

Given 会话态不存在，或 `claimToken` 空且无 resilience 可入箱；When 上报；Then 打一条 warn 级同 tag，`outcome=dropped` 且带 `drop_reason=session_not_found|no_claim_token`。

#### 场景：入箱等重放

Given `claimToken` 空但注入了 resilience；When 上报；Then 打一条 info 级同 tag，`outcome=enqueued`（后续 drain 重放另算，不在本变更承诺面）。

### FR-03: 采集器既有 turn_file_changes_collected 日志与字段零变化（两条日志配对即可判「没采到」vs「采到没落库」）

- 采集器 `console.info('[turn-file-changes] turn_file_changes_collected', sample)` 的 tag 与 `TurnFileChangesTelemetrySample` 字段（`runId`/`collectMs`/`fileCount`/`subprocessCount`/`status`/`reason`/`truncated`/`lineCounts`）**必须** 零变化；新日志与它 **必须** 可按 `runId` 配对：只有 `collected` 无 `reported` ＝ 采到没落库（上报丢），两条都无 ＝ 没采到。

#### 场景：主路径

Given 一轮跑完；When grep `turn_file_changes_collected` 与 `turn_file_changes_reported`；Then 两条日志的 `runId` / `run_id` 相同，可据「有 collected 无 reported」判定上报环节丢失。

### FR-04: daemon tsc --noEmit 退出 0；新增上报收口日志用例全绿；既有 tests/interactive/turn-file-changes.test.ts 不回归

- `cd sillyhub-daemon && node node_modules/typescript/bin/tsc --noEmit` **必须** 退出 0；新增用例 **必须** 覆盖 FR-02 的四条出口；既有 `tests/interactive/turn-file-changes.test.ts`（含 `turn_file_changes_collected` 断言）**必须** 不回归。

#### 场景：主路径

Given 变更落盘；When 跑 daemon typecheck + `tests/daemon-turn-snapshot-report-log.test.ts` + `tests/interactive/turn-file-changes.test.ts`；Then 全部 exit 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯注释与文案更新，无运行时可观察行为（验收=grep「仅工具编辑」在 `sillyhub-daemon/src` 0 命中 + 代码评审）
FR-02: `sillyhub-daemon/tests/daemon-turn-snapshot-report-log.test.ts`「上报成功 → info 级 outcome=delivered，带 status/file_count/collect_ms」+「notifyRunResult reject → warn 级 outcome=failed 且带 error」+「会话已收口 → outcome=dropped + drop_reason=session_not_found」+「无 claimToken 且无 resilience → outcome=dropped + drop_reason=no_claim_token」+「无 claimToken 有 resilience → outcome=enqueued」
FR-03: `sillyhub-daemon/tests/interactive/turn-file-changes.test.ts`「每轮打一行 turn_file_changes_collected（runId/collectMs/fileCount/subprocessCount/status）」（既有用例零改动复跑）+ 新用例里按 `run_id` 配对的断言
FR-04: `sillyhub-daemon/tests/daemon-turn-snapshot-report-log.test.ts` + `sillyhub-daemon/tests/interactive/turn-file-changes.test.ts` + `cd sillyhub-daemon && node node_modules/typescript/bin/tsc --noEmit` exit 0
