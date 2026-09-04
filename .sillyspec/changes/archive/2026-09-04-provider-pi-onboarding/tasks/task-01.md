---
id: task-01
title: 'PiEventNormalizer 归一化器+事件 fixture 与用例'
title_zh: 'PiEventNormalizer 归一化器+事件 fixture 与用例'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-events.ts
  - sillyhub-daemon/tests/interactive/pi-events.test.ts
  - sillyhub-daemon/tests/fixtures/pi-rpc-events
goal: >
  PiEventNormalizer：pi rpc 下行事件流 → AgentEvent v2 纯函数归一化（FR-02 / D-001@v1）。
  与批量 pi_json 词汇同源但输入是 rpc 事件（无 session 首帧；错误走 extension_error/
  response success:false）。
implementation:
  - 新建 pi-events.ts：export class PiEventNormalizer { normalizeRpcLine(line): AgentEvent[] }——纯函数逐行无跨行状态；映射：text_delta→text（逐 delta 直通，无 is_partial）；message content thinking part→thinking；tool_execution_start→tool_use（tool_name+call_id+args 对象）；tool_execution_end→tool_result（call_id 配对，无 edit_patch——pi 无结构化 patch）；error/extension_error→error；turn_end.message.usage→usage（input/output 直传；cacheRead→cache_read_tokens；cacheWrite→cache_creation_tokens——批量 pi-json.ts:341-344 已验证口径）；agent_settled 不在归一化器（driver 收敛信号）；未知事件→降级 {type:'status', content:'<原type>', metadata:{original_event_type,...}} 不丢不抛
  - fixture：tests/fixtures/pi-rpc-events/（多个 .jsonl，每行一个 rpc 事件序列）——用本机 pi -p --mode json 实跑采样真实事件（text_delta 流/tool_execution 两条/thinking 块/turn_end 带 usage/error），脱敏（无凭证/敏感路径）；无法采样的形状（extension_error）按 pi 包 dist 类型定义手工构造并注明
  - 新建 pi-events.test.ts：每事件型至少一例逐字段断言；usage 映射含 cache 两字段；未知降级例；全部产出过 safeParseAgentEvent；text_delta 逐条直通断言（不合并）
acceptance:
  - 每型事件映射正确且全部产出过 safeParseAgentEvent（zod 校验）
  - usage 四维+cache 映射与批量 pi_json 口径一致
  - 未知事件降级不丢不抛（fail-safe）
  - fixture 来源于真实采样并脱敏（README 说明）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-events.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 不改 types.ts/agent-event-schema.ts（契约不够用=停下报告）
  - 不动批量 adapters/pi-json.ts；不动 driver（task-02 消费）
  - ESM .js 后缀；注释中文标注映射依据（pi 文档/实跑）
expects_from:
  - task-01 前置：AgentEvent v2（types.ts，上游变更已合入 main）
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
