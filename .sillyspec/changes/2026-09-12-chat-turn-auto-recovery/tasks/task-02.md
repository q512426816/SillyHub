---
id: task-02
title: 'Wave 1 daemon：pi 静默中断检测'
title_zh: 'Wave 1 daemon：pi 静默中断检测'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: []
blocks: ['task-07']
requirement_ids: ['FR-2.1','FR-2.2','FR-2.3']
decision_ids: ['D-003']
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts
goal: >
  design §5.2（Grill v2 P1-1/P1-2 定稿）：①lastWasFinalText 标记翻转两入口——raw message_end
  拦截处（与 usage 累计钩同位 pi-rpc-driver.ts:1289-1307）按 content parts 是否含非空 text part
  得 hasText 收口（[text,thinking] 同消息终值 true）；归一化事件循环内仅 tool_result 翻 false
  （thinking/override/partial 不动标记）；②settle 收敛（pendingTurnError===null 分支）判定仅
  !lastWasFinalText → 合成 error result（subtype=error_during_execution、is_error=true、
  result='[silent stream truncation] 上一轮输出流中断，未产生收尾回复'、usage/modelUsage 照常带）；
  ③零活动轮/usage-only 轮标记恒 false 自然命中；空载荷轮 E1 跳过不受影响；④每 inject 重置标记。
implementation: >
  按 goal 实施；归类经 session-manager 既有 classifyModelError 关键词命中（依赖 task-01 断流关键
  词，集成面留 task-07）。测试 pi-rpc-driver-turn-result.test.ts 增五组正反例：零活动轮报 error、
  [text,thinking] 同消息 success、末事件 tool_result 报 error、thinking-only 末消息报 error、
  正常全文 success；pi-events.test.ts 未触碰——实现收口在 driver 侧（raw message_end 拦截 + 归一化事件循环），归一化器零改动，无需配合用例（执行期偏差，review changedFiles 一致）。
acceptance: >
  sillyhub-daemon pnpm test（interactive 套件）+ typecheck 绿；五组正反例全过；既有 pi driver
  用例零回归。
constraints: >
  driver 不直接挂 modelError（events.ts:96-104 会覆写——design §5.2）；标记翻转只允许两入口；
  禁止把检测挪到 normalizer（正常 success 轮零打扰）。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

interactive 套件 + typecheck 绿；零活动/[text,thinking]/tool_result 尾/thinking-only 尾/正常全文五组正反例过；既有零回归。
