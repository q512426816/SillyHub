---
id: task-06
title: 'driver.ts 契约演进（TurnMessageEnvelope）与 ClaudeSdkDriver 接入归一化器'
title_zh: 'driver.ts 契约演进（TurnMessageEnvelope）与 ClaudeSdkDriver 接入归一化器'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
goal: >
  InteractiveDriver 契约演进：onTurnMessage 入参改 TurnMessageEnvelope{events, raw?}（raw 仅
  SILLYHUB_DEBUG_RAW_EVENTS=1 携带），InteractiveDriverResult 增结构化 usage/session_id；
  ClaudeSdkDriver 接入 ClaudeEventNormalizer，SDK 消息经归一化后吐 AgentEvent（FR-02 / D-002@v1）。
implementation:
  - driver.ts：TurnMessageEnvelope 接口 + onTurnMessage 签名演进；InteractiveDriverResult 增 usage?/session_id? 字段（宽松可选，兼容现形状）；JSDoc 注明 raw 禁止下游依赖
  - claude-sdk-driver.ts：start() 实例化 ClaudeEventNormalizer（注入 onPartialFlush 转发 onTurnMessage）；consume() for-await SDK 流——完整消息经 normalizeMessage、override 信号经 normalizeOverrideSignal、partial 经 onPartialFlush 回调，全部包装 envelope.events 上报；env SILLYHUB_DEBUG_RAW_EVENTS=1 时 envelope.raw 携带原消息（默认 undefined）；canUseTool/onUserDialog 审批桥不动
  - tests/interactive/claude-sdk-driver.test.ts：mock SDK 流（fixture 复用 task-03 的 claude-sdk-messages）断言 envelope.events 形态；raw 默认不携带、开关开启时携带
acceptance:
  - onTurnMessage 收到的 events 全部为合法 AgentEvent（zod parse 通过）
  - raw 默认 undefined；SILLYHUB_DEBUG_RAW_EVENTS=1 时携带
  - 既有 claude-sdk-driver 测试（除消息形状断言外）零回归；typecheck 绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/claude-sdk-driver.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 只改契约与 Claude driver；SessionManager 消费侧改造归 task-08
  - 审批桥（canUseTool/dialog）与 SDK query 参数组装不动
  - 既有消息形状断言失效的测试随改（related_tests），语义不得弱化
expects_from:
  - task-03: ClaudeEventNormalizer
  - task-01: AgentEvent
related_tests:
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
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
