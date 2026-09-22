---
id: task-04
title: 'CodexAppServerDriver flat message → AgentEvent 映射'
title_zh: 'CodexAppServerDriver flat message → AgentEvent 映射'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
goal: >
  CodexAppServerDriver 的 flat message（{event_type, content, metadata, session_id}，现
  toFlatMessage 已半具备）映射为 AgentEvent——event_type→type 映射表 + session_id/usage
  提取，使 codex 与 claude 走同一事件契约（FR-02）。
implementation:
  - codex-app-server-driver.ts：event_type→AgentEventType 映射表（agent_message→text、工具事件→tool_use/tool_result、thread_started→status/session_started、turn 终态→turn_result、error→error 等，以现 flat message 消费面为准补全）；flat message 构造处直接产 AgentEvent（toFlatMessage 改造或新增 toAgentEvent）；usage/token 从 metadata 提取进 usage 一等字段
  - tests/interactive/codex-app-server-driver.test.ts：补事件映射断言（每已知 event_type 至少一例；session_started 含 session_id；未知 event_type 降级 status 事件带原值 metadata，不丢弃不抛错）
acceptance:
  - 全部已知 event_type 有映射；未知 event_type 降级 status 事件（metadata 保留原值）
  - thread_started 映射 status/session_started（与 claude 侧 system/init 同型）
  - 既有 codex driver 测试零回归 + typecheck 绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/codex-app-server-driver.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 只做 flat message→AgentEvent 映射，不动 app-server JSON-RPC 握手/审批桥
  - 未知 event_type 降级 fail-safe，禁止抛错中断会话
expects_from:
  - task-01: AgentEvent（类型联合+一等字段）
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
