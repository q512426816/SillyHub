---
id: task-09
title: 'daemon.ts 接线 + hub-client agent_event 载荷 + SILLYHUB_LEGACY_TEXT_EVENTS 回退开关'
title_zh: 'daemon.ts 接线 + hub-client agent_event 载荷 + SILLYHUB_LEGACY_TEXT_EVENTS 回退开关'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/daemon-agent-event-report.test.ts
goal: >
  daemon 上报接线：AgentEvent 包装为 {"kind":"agent_event","event":{...},"dedup_key":...}
  经 hub-client.submitMessages 上报（与旧文本 dict 共存）；usage lift 对齐现链路；
  SILLYHUB_LEGACY_TEXT_EVENTS=1 回退开关强制走旧透传形态（FR-01 / D-001@v1 回退路径）。
implementation:
  - daemon.ts：onTurnMessage 接线处把 SessionManager 透传的 AgentEvent 包装 kind:'agent_event' 消息（dedup_key 注入规则对齐现状：Claude msg.id 或 runId:seq）；usage lift（对齐现 :3564-3586——任意携带 usage 事件提升到 submit 请求级字段/summary 通道，保 SSE 实时 token）；env SILLYHUB_LEGACY_TEXT_EVENTS=1 时跳过新形态走旧路径（默认关）
  - hub-client.ts：submitMessages 入参类型扩展支持 agent_event 形态（运行时载荷不变，纯类型层）；JSDoc 注明与 LeaseMessagesRequest list[dict] 的共存契约
  - tests/daemon-agent-event-report.test.ts：mock hub-client 断言消息形态（kind/event/dedup_key）；legacy 开关两态；usage lift 字段
acceptance:
  - 新形态消息与旧 dict 在同一 messages 数组共存（OpenAPI 零变化）
  - SILLYHUB_LEGACY_TEXT_EVENTS=1 时行为与改造前一致（回退路径可用）
  - dedup_key 注入规则与现状一致（重复上报幂等）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-agent-event-report.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 不动 SessionManager（task-08 已完成消费侧）；不动 backend
  - 开关默认关闭；开启仅影响 daemon 上报形态（本地回退用）
  - ESM .js 后缀；现有 resilience 重试链路（submitWithRetry）不感知形态差异
expects_from:
  - task-08: SessionManager 透传 AgentEvent
  - task-01: AgentEvent 类型
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
