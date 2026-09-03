---
id: task-01
title: 'AgentEvent v2 类型扩展与 zod schema（types.ts + agent-event-schema.ts）'
title_zh: 'AgentEvent v2 类型扩展与 zod schema（types.ts + agent-event-schema.ts）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/agent-event-schema.ts
  - sillyhub-daemon/tests/agent-event-schema.test.ts
goal: >
  把现有批量 AgentEvent（types.ts:36-70，5 型+开放 metadata）扩展为 v2 统一契约：类型联合扩 8 型、
  metadata 关键键提为一等可选字段，zod schema 同步（独立文件，types.ts 保持纯类型）。交互式与批量
  两条链路自此共用一份 IR（FR-01 / D-001@v1 双轨路线的契约基座）。
implementation:
  - types.ts：AgentEventType 联合扩为 text/thinking/tool_use/tool_result/status/error/turn_result/complete（complete 标注批量兼容别名）；新增 AgentStatusSubtype（session_started/bash_chunk/bash_status/plan_mode/agent_task_status/task_notification）与 AgentEventUsage；AgentEvent 增一等可选字段 subtype/seq/tool_name/call_id/session_id/usage/parent_tool_use_id/subagent_type/depth/segment_id/is_partial/override/edit_patch（JSDoc 注明来源：现 flat record 顶层字段与 metadata 键的合并提升）
  - 新建 agent-event-schema.ts：zod schema 与类型一字段对齐（zod inference 或显式双写+一致性测试）；export parseAgentEvent/dumpAgentEvent
  - 新建 tests/agent-event-schema.test.ts：合法事件（每型各一，含全一等字段）/非法（缺 type/未知 type/subtype 缺失于 status 型）用例；断言 schema 与 TS 类型字段集合一致
acceptance:
  - 8 型联合 + 一等字段与 design.md §7 接口定义逐字段一致
  - 批量 adapters 现有 5 型用法零破坏（pnpm run typecheck 全绿即证）
  - zod schema 与 TS 类型字段集合一致（测试断言）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/agent-event-schema.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - types.ts 保持纯类型文件（文件头自述"不含任何运行时代码"），zod 一律进 agent-event-schema.ts
  - ESM 导入带 .js 扩展名；不动 adapters/ 各 parse 实现（非目标）
provides:
  - contract: AgentEvent
    fields: [type, subtype, content, seq, tool_name, call_id, session_id, usage, parent_tool_use_id, subagent_type, depth, segment_id, is_partial, override, edit_patch, metadata]
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
