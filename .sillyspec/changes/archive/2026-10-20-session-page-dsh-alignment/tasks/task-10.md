---
id: task-10
title: 'Daemon TTFT/attempt capture with capability gating'
title_zh: 'daemon TTFT / attempt 采集与版本门控'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: [task-09]
blocks: [task-12]
requirement_ids: [FR-11, FR-15]
decision_ids: [D-022@v1, D-024@v1, D-025@v1, D-026@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/turn-timing.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/
target_files:
  - NEW:sillyhub-daemon/src/interactive/turn-timing.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - NEW:sillyhub-daemon/tests/interactive/turn-timing.test.ts
goal: >
  给模型泳道补真实时序（D-025@v1 更正：TTFT/attempt 采集在范围内、不得缓发）：每轮派生
  `TurnTimingSnapshot`（per-attempt 起点 / 首 token 延迟 / 终点 / model / tokens），有采样时前端把模型条从
  「整段空档近似」改成真实占用区间；无采样字段时保持单色近似（版本门控，禁止假装有数据）。
  同一接线点与 task-09 共用 `session-manager.ts`，故本卡必须在其后执行。
implementation:
  - '首步跑 spike-02：用真实 claude / codex 驱动事件流确认能否稳定切出「模型请求起点 → 首个 delta → 终点」。无起点信号时按 plan 的降级口径：TTFT 用「轮首或工具结果之后 → 首个 text/thinking delta」近似，attempt 只记终点 + model，不承诺起点区间，并在快照里标 `basis: "observed" | "approx"`'
  - 'NEW:sillyhub-daemon/src/interactive/turn-timing.ts：纯函数 `deriveTurnTiming(events, opts)`——输入本轮事件序列（kind / atMs / model? / tokens?），输出 `{ runId, basis, attempts: [{ index, startedAt, firstTokenAt, endedAt, model, inputTokens, outputTokens }], totalMs, ttftMs }`；零事件或时间戳缺失 → 返回 null（不伪造 0）'
  - '接线（sillyhub-daemon/src/interactive/session-manager.ts，**在 task-09 已改过的 `_runConsume` :1175 / `_onResult` :1567 同一区**）：`_runConsume` 的事件回调里累积本轮事件时间戳（只在内存，不落盘、不改事件协议）；`_onResult` 的 async 采集块里追加 timing 上报（与 file-changes 快照合并为一次 payload，runId 幂等）'
  - '版本门控：**不新增独立开关字段**——口径由 `TurnTimingSnapshot.basis`（"observed" | "approx"）承载（design「1b 承载面与读模型字段」已定）；无事件/无驱动时间戳时**整体省略 timing 字段**（既不是空对象，也不传 basis="approx" 的壳）→ backend 落 null → 前端保持单色近似'
  - '契约纪律（2026-10-21 独立评审 gap① 处置）：payload 只允许 design 已定的字段，**禁止新增 `timingCapability` 之类旁路键**——它与 `TurnTimingSnapshot.basis` 语义重复，且不在 task-08 的 provides 与侧表列内，落库会被丢弃或迫使契约改动'
  - '测试 NEW:sillyhub-daemon/tests/interactive/turn-timing.test.ts：①首 token 锚点（请求起点 + 两条 delta → ttft 正确）②同一轮多次 attempt（工具切分）③空流 / 无 delta → null ④时间戳缺失 → basis="approx" 且不伪造 ttft ⑤工具时间不计入模型占用（attempt 区间与 tool 区间零重叠）'
acceptance:
  - 上述 5 例单测绿；`tsc --noEmit` 零错
  - '零事件轮返回 null（不是 `{ttftMs: 0}`）：断言 `deriveTurnTiming([], ...) === null`'
  - 'attempt 区间与工具区间零重叠；`basis="approx"` 时 UI 可据此标注（由 task-12 消费）'
  - 'payload 键集合 == design「1b 承载面与读模型字段」+ `TurnTimingSnapshot` 定义的字段集合（断言不出现任何 design 之外的新增键；与 task-08 的 provides 三字段对齐）'
  - '上报不阻塞轮终态：`_onResult` 的采集仍是 fire-and-forget，且与 file-changes 同一次 payload（断言 hub 调用次数不增加）'
verify:
  - cd sillyhub-daemon && node node_modules/vitest/vitest.mjs run tests/interactive/turn-timing.test.ts tests/interactive/turn-file-changes.test.ts
  - cd sillyhub-daemon && node node_modules/typescript/bin/tsc --noEmit
constraints:
  - 必须排在 task-09 之后（同文件 session-manager.ts 的轮终态接线区，禁并发改）
  - 不改驱动/事件协议，不新增事件类型；时间戳只从既有事件对象取
  - UI 不做 TTFT/decode 双色切分（design 非目标首条仍成立）；本卡只产数据
  - 无采样一律省略字段（版本门控），禁止用 0 或猜测值填充
related_tests:
  - path: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts
    reason: 两卡共用 `_onResult` 的异步采集块；timing 接入若改变上报次数或顺序，task-09 的断言必须先红
---
