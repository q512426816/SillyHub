---
id: task-01
title: capture-pi-turn-final-text-into-success-result
title_zh: 'PI driver 轮终 assistant 全文进 success result（turnFinalText 截获 + 轮重置 + error 轮不带）'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: []
blocks: ['task-03', 'task-09']
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - NEW:sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts
provides:
  - contract: PiTurnResult.result
    fields: [result]
goal: >
  PI driver 成功轮 turn result 补 result 字段（轮终 assistant 全文 turnFinalText），修复 backend result_summary 与 AgentRun.output_redacted 空洞，并为 task-03 mission_worker 代报提供 summary 全文（design §5.1 / FR-02）。
implementation:
  - 轮状态重置区（pi-rpc-driver.ts:1334-1340，与 pendingTurnError 同点）新增轮级 let turnFinalText（string|null）并每轮置 null
  - 事件循环 override 截获点（:1258-1267）命中 ev.type==='text' && ev.override===true && typeof ev.content==='string' 时 turnFinalText=ev.content，轮内最后一条 override 全文胜出
  - success reportTurnResult（:1379-1386）追加 ...(turnFinalText!==null?{result:turnFinalText}:{})；error 轮（:1369-1377）不动，已有 result=错误信息
  - 新增 tests/interactive/pi-rpc-driver-turn-result.test.ts 覆盖 override 事件驱动、轮重置、error 轮不带全文、无 override 成功轮缺 result 键
acceptance:
  - 轮内出现过 override text 事件的成功轮 reportTurnResult 含 result 字段，值为轮内最后一条 override 全文
  - 每轮开始 turnFinalText 重置 null，上轮全文不泄漏进下轮 result
  - error 轮 result 仍为错误信息；无 override 事件的成功轮不带 result 字段
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver-turn-result.test.ts && pnpm typecheck
constraints:
  - 不改变既有事件流分发与 usage 累计逻辑（含 :1265-1267 pendingTurnError 清除语义不动）
  - error 轮语义不变（result=错误信息，不掺全文）
  - turnFinalText 不落日志
---
