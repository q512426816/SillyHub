---
id: task-01
title: 'Extend daemon agent-log contracts with optional usage and replay fields'
title_zh: 'daemon 契约扩展——NormalizedLogMessage 增可选 usage/turn_id/model/duration_ms/sender + AgentLogMessagesResult 增 totalUsage'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/src/agent-log/registry.ts
target_files:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/src/agent-log/registry.ts
provides:
  - contract: NormalizedLogMessage
    fields: [sender, turn_id, model, duration_ms, usage]
  - contract: AgentLogMessagesResult
    fields: [totalUsage]
goal: >
  为 Wave 2 解析器补字段（task-02~05）与 Wave 3 平台 schema（task-08）钉死共用契约锚点——NormalizedLogMessage 增五项可选字段、AgentLogMessagesResult 增可选 totalUsage，纯类型层改动。
implementation:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66 NormalizedLogMessage 增五项可选字段 sender、turn_id、model、duration_ms、usage——形状与 design.md 接口定义逐字一致；usage 为 inputTokens/outputTokens/totalTokens/cacheReadTokens/cacheWriteTokens 五项计数对象；sender 枚举 human 与 system_event 两值，JSDoc 注明仅 user_input 段有意义且缺省 human；其余字段数据源缺失时为 undefined 不伪造
  - sillyhub-daemon/src/agent-log/registry.ts:37 AgentLogMessagesResult 增可选 totalUsage（inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens 四项计数对象，可空）——JSDoc 注明由解析器全量过一遍后顺带求和返回，本 task 不实现求和
acceptance:
  - 两接口既有字段（NormalizedLogMessage 的 seq/kind/text 等 9 项与 AgentLogMessagesResult 的 status/messages/truncated/totalSegments/skippedLines）逐字保留，新增字段全部可选，既有消费方零破坏
  - cd sillyhub-daemon && pnpm typecheck 零错误
  - sillyhub-daemon/tests/agent-log 既有四份测试全绿不回归（可选字段不改变既有消息形状断言）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test -- tests/agent-log
constraints:
  - 新字段全部可选零破坏——老 daemon 不返回即缺省；unsupported/parse_error/too_large 回落语义逐字保留
  - 不实现任何解析器与求和逻辑——字段附着与 totalUsage 计算归 task-02~05，本 task 仅改类型契约与默认值
  - 卡片 YAML 列表项为 plain scalar——禁冒号+空格、禁花括号
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
