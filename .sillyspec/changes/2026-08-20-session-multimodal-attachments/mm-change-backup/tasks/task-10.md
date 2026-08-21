---
id: task-10
title: map-user-turn-input-to-sdk-block-array
title_zh: mapUserTurnInputToSdk 块数组改造
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [FR-2, FR-5]
decision_ids: [D-1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver-blocks.test.ts
provides:
  - contract: SdkUserContentBlocks
    fields: [text_block, image_block, document_block]
expects_from:
  task-09:
    - contract: UserTurnInputAttachments
      needs: [blocks]
goal: >
  mapUserTurnInputToSdk 在 UserTurnInput 带 blocks 时把 content 由纯字符串改为
  ContentBlockParam 块数组（text 块 + image/document 块），无 blocks 时保持纯字符串
  路径零回归，并落地 spike-01 真实 SDK 实收 ImageBlock 用例。
implementation:
  - 分支判定 turn.blocks——非空时 content 组块数组；为空或 undefined 时 content 仍为 turn.text 原纯字符串（形态与改造前逐字节等价）
  - 块数组组装——text 非空时首位 text 块，随后按原序映射 blocks；空文本且仅有块时直接输出块数组不产空 text 块（对齐 D-7 纯附件消息）
  - image 块映射 SDK ImageBlockParam（type image + source 为 base64 形态，media_type 取自 mediaType，data 取自 base64）；document 块映射 DocumentBlockParam（source 同为 base64，media_type 固定 application/pdf）——块形态以 SDK 0.3.181 的 sdk.d.ts 为准
  - SDK 专属 ContentBlockParam 类型收敛在 driver 内部，不外泄到 driver.ts/types.ts（维持 D-009 SDK 类型隔离边界）
  - spike-01 用例——daemon 本地起真实 SDK query 喂含 1×1 png ImageBlock 的块数组，断言 turn 正常收敛不报错；本地无可执行环境时用例显式 skip 并注明原因（不允许假绿）
  - 新用例并入既有 claude-sdk-driver.test.ts 或新建 claude-sdk-driver-blocks.test.ts；既有纯文本断言（content 为字符串的用例）保持原样不动
acceptance:
  - 无 blocks 的 UserTurnInput 经 mapUserTurnInputToSdk 后 content 为纯字符串且与改造前完全一致（既有用例零改动全绿，零回归为 P0 约束）
  - 带 image 与 document blocks 时输出块数组——text 块在前、块序保持、source 为 base64 形态、mediaType 到 media_type 字段名转换正确
  - 空文本纯附件 turn 输出仅块数组（无空 text 块）
  - spike-01 通过——真实 SDK query 实收 ImageBlockParam 块数组（1×1 png）turn 不报错；不通过则按 plan.md 触发回退预案（prompt 内 base64 转译）并升级
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - codex driver 不读 blocks（flat 协议，天然静默忽略兜底），本任务不触碰 codex-app-server-driver.ts
  - 不改 mapUserTurnInputToSdk 的对外签名（AsyncIterable UserTurnInput 进、SDKUserMessage 出），不缓冲不丢消息语义不变
  - 不改 UserTurnInput 类型本身（blocks 字段归 task-09 所有），本任务只消费
related_tests:
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
---
