---
id: task-02
title: 'daemon turn-level counters + lastCallCtxTokens (main bucket only) + turn reset + pendingUsage turn semantics'
title_zh: 'daemon turn 级计数器 + lastCallCtxTokens（仅 main 桶）+ 轮边界清零 + pendingUsage 轮级化与 ctx_tokens 注入 + cache 注释修正（含 batch 错引）'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: []
blocks: ['task-03']
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v2, D-004@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: >
  在 session-manager.ts 新增 turn 级/调用级计数与 ctx_tokens 指标（会话级计数器原样保留），使 pendingUsage 上报轮级 input/output 与 main 桶 ctx_tokens，消除实时/终态跨语义跳变并为上下文环提供 last-call 口径分子（design §5 Phase 1）。
provides:
  - consumer: task-05
    contract: daemon flush 消息顶层 usage dict
    fields:
      - input_tokens：轮级，本轮至今累计（消跳变核心）
      - output_tokens：轮级，本轮至今累计
      - cache_read_tokens：快照，最新 per-call 值（语义不变）
      - cache_creation_tokens：快照，最新 per-call 值（语义不变）
      - ctx_tokens 仅 main 桶携带
      - 老 daemon 缺键兼容
related_tests:
  - sillyhub-daemon/tests/interactive/session-manager-usage-cache.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-budget.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-subagent-shrink.test.ts
implementation:
  - PartialFlushBuffer（~:405-484）新增 turnInputTokens / turnOutputTokens / lastCallCtxTokens 字段；PartialUsageSnapshot（~:398-403）加 ctx_tokens?: number；_getOrCreateBuffer（~:5087-5123）新字段初始化为 0
  - _bufferPartial（~:5301-5397）：message_start 所有桶 turnInputTokens += input_tokens、main 桶（parentKey==='main'）lastCallCtxTokens = input+cache_read+cache_creation；message_delta turnOutputTokens += output 差分（复用 lastCallOutputTokens 差分）、携带 cache_* 时用最新 cache 值重算 lastCallCtxTokens（仅 main 桶）、cache replace 快照不动；pendingUsage 组装（~:5390-5396）input/output 改取轮级值、cache_* 保持快照、main 桶附加 ctx_tokens（子桶不含该键）
  - _onResult 轮边界（~:4128-4136 completedSegments 重置处）：清零 main 桶 turnInputTokens/turnOutputTokens/lastCallCtxTokens 并置 pendingUsage=null（防上轮残留 usage 注入新 run）；确认 _shrinkSubagentBuffers（~:5149-5177）不折算 turn 级字段（子桶随删桶销毁，会话级折算照旧，R-05/B3）
  - 注释修正（~:5313-5315、~:5379-5382）：cache_*_input_tokens 改述为「本调用缓存前缀量的最新快照（replace）」，更正对 batch stream-json.ts:552/1143-1148 的错引（batch 实为 :498-511 逐调用累加）；行为零改动
acceptance:
  - main 桶 flush usage 含 ctx_tokens = 最近一次调用三分量和；子桶 flush usage 无 ctx_tokens 键
  - 跨轮（_onResult 后）turn 级计数器清零、pendingUsage 不再携带上轮值；会话级计数器跨轮不清零（budget 数据源不变）
  - cache 快照 replace 语义与既有行为一致（usage-cache/budget/shrink 既有断言零回归）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test -- --run tests/interactive/session-manager-usage-cache.test.ts tests/interactive/session-manager-budget.test.ts tests/interactive/session-manager-subagent-shrink.test.ts
constraints:
  - 不动会话级计数器语义与 _checkBudgetCutoff 聚合口径（R-01：误改即预算漏计）
  - 不改 close/onTurnResult 终态上报行为（终态覆盖与 fallback 归 task-05）
  - _shrinkSubagentBuffers 会话级折算与删桶逻辑零改动（turn 级「不折算」= 不新增折算代码）
  - 不改 batch stream-json.ts（错引仅在 session-manager.ts 注释内更正）；不写新测试（归 task-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
