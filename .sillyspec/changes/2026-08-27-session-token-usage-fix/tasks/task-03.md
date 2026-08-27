---
id: task-03
title: 'daemon vitest: turn reset / ctx three-part main-bucket-only / subagent max aggregation / budget zero-regression'
title_zh: 'daemon vitest——跨轮清零 / ctx 三分量与 main 桶限定 / 子桶 max 聚合断言 / budget 与会话级折算零回归'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/tests/interactive/session-manager-turn-usage.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-usage-cache.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-budget.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-subagent-shrink.test.ts
expects_from:
  - provider: task-02
    contract: 'PartialFlushBuffer 新增 turnInputTokens/turnOutputTokens/lastCallCtxTokens；_onResult 清零 main 桶 turn 级计数器；pendingUsage input/output 轮级化 + ctx_tokens 仅 main 桶注入；会话级计数器与折算行为不变'
goal: >
  为 task-02 的 turn 级改动补齐并守护测试：跨轮清零、ctx 三分量与 main 桶限定、
  子桶 max 聚合断言（R-05）、budget 与会话级折算零回归（R-01/R-05，plan 全局验收 1）。
implementation:
  - 新增 sillyhub-daemon/tests/interactive/session-manager-turn-usage.test.ts（复用 usage-cache/budget 的 mock driver + stream_event fixture 模式）：① 同轮多次 message_start 累计、跨轮（emit result 后）turn 计数清零且新轮重新起算；② lastCallCtxTokens 三分量（input+cache_read+cache_creation）计算与 message_delta 携带 cache 时重算；③ ctx_tokens 仅出现在 main 桶 flush usage、子桶（parent_tool_use_id）flush usage 无该键；④ 轮内 run 实时值 ≥ max(主桶上报, 任一子桶上报)（max 聚合语义，复审 N3）
  - 扩展 session-manager-usage-cache.test.ts：既有用例补 ctx_tokens 断言（= 三分量和）；文件头与用例注释同步 cache 语义更正（per-call 最新快照 replace，非「会话级累计快照」）
  - session-manager-subagent-shrink.test.ts 补断言：折算仅并入会话级计数器，turn 级计数器与 lastCallCtxTokens 不折算进 main 桶；既有 sessionInputTokens 断言原样保留（零回归）
  - session-manager-budget.test.ts 补跨轮用例：≥2 个 turn result 后 _checkBudgetCutoff 聚合仍等于会话累计（跨轮不漏计，R-01 守卫）
acceptance:
  - 新用例覆盖 plan 全局验收 1 的四类断言（跨轮清零 / ctx 仅 main 桶 / 子桶 max / budget 会话级零回归）
  - 既有 usage-cache/budget/shrink 断言不删不改数值口径（仅补字段断言与注释同步）
  - 四个测试文件全绿且 pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm test -- --run tests/interactive/session-manager-turn-usage.test.ts tests/interactive/session-manager-usage-cache.test.ts tests/interactive/session-manager-budget.test.ts tests/interactive/session-manager-subagent-shrink.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只改测试文件：发现 task-02 实现缺陷退回 task-02 修，禁止在测试里绕过（CLAUDE.md 规则 9）
  - 既有断言不得删除或放宽数值口径
  - 不跑全量 pnpm test（CLAUDE.md 规则 0，留给 CI）
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
