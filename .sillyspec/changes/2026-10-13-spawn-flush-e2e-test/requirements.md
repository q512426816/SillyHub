---
author: flow-machine-draft
created_at: 2026-10-12T23:37:51.941Z
---
# 需求规格（Requirements）— 2026-10-13-spawn-flush-e2e-test

## 功能需求

### FR-01: 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列

- 新测试必须直调 `spawnAndStream(runner, params)` 全函数（非 handleLine/组合件单测），必须沿用仓内既有先例 mock `node:child_process.spawn` 返回 `tests/helpers/fake-child.ts` 的 FakeChild，让流经真实 readline/decodeStream/收尾序列；禁止只测组合件而绕过 attempt 边界（评审 P3 留债的守护缺口本体）。本变更禁止修改任何 src 代码（纯测试新增）。

#### 场景：执行级驱动

- Given：mock spawn 返回 FakeChild，fake runner 的 `_eventToMessages` 委托真实 `eventToSubmitMessages(ev, coalescer)`，`client.submitMessages` 捕获批次
- When：直调 spawnAndStream 并以 FakeChild 推流/abort/exit 驱动完整生命周期
- Then：测试覆盖到收尾序列（flushAll → forwardSubmitMessages → await pendingForwards），未来重构该段时测试会红

### FR-02: 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled

- 取消路径必须断言：delta 已入缓冲且零直发（abort 前 submitMessages 零调用）→ abort + exit 后，残留缓冲被冲刷为单行（内容为 delta 拼接、`event_type='text'`、`channel='stdout'`、带字符串 `timestamp`）经 client.submitMessages 转发恰好一批，且 result.status 必须等于 `'cancelled'`。

#### 场景：取消 break 残留冲刷

- Given：一条流式 delta（message_id 固定）已入缓冲
- When：AbortController.abort() 后 FakeChild 发 exit（SIGTERM）
- Then：收尾冲刷单行转发 + status=cancelled

### FR-03: 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout

- 超时路径必须断言：小数 timeoutSeconds（如 0.05s）武装看门狗并触发 timedOut → break 出循环后残留缓冲同 FR-02 口径冲刷转发，result.status 必须等于 `'timeout'`；禁止用真实长等待（必须毫秒级看门狗）。

#### 场景：看门狗超时残留冲刷

- Given：delta 已入缓冲，ctx.timeoutSeconds=0.05
- When：等待看门狗触发后 FakeChild 发 exit
- Then：残留冲刷转发 + status=timeout

### FR-04: 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed

- 正常收尾路径必须断言：stdout 正常关闭（push null）+ exit 0、消息始终未收到完结行 → 残留缓冲冲刷转发单行，result.status 必须等于 `'completed'`、exitCode=0。

#### 场景：正常关闭残留冲刷

- Given：两条同 id delta 已入缓冲
- When：FakeChild _endStdout() + _emitExit(0)
- Then：合并内容单行转发 + status=completed

### FR-05: 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量

- 验收必须只跑定向：新测试文件 + `tests/task-runner/spawn-stream-coalescer.test.ts` + `tests/task-runner.test.ts` + `pnpm typecheck`；禁止跑全量（全量留给 CI）。

#### 场景：定向验收

- Given：FR-01~04 用例完成
- When：执行定向 vitest + typecheck
- Then：全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「直调 spawnAndStream 驱动真实收尾序列（文件级 mock spawn + FakeChild）」
FR-02: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「取消（AbortSignal）break → 残留缓冲收尾冲刷转发 + status=cancelled」
FR-03: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「超时（看门狗）break → 残留缓冲收尾冲刷转发 + status=timeout」
FR-04: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「正常流关闭 → 残留缓冲收尾冲刷转发 + status=completed」
FR-05: 不适用：本条即验收执行项（定向 vitest + typecheck 命令与结果见 tasks 勾选证据）
