---
id: task-03
title: 'ClaudeEventNormalizer 归一化器（完整展开/partial+override/depth 状态机/status 事件化）'
title_zh: 'ClaudeEventNormalizer 归一化器（完整展开/partial+override/depth 状态机/status 事件化）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-events.ts
  - sillyhub-daemon/tests/interactive/claude-events.test.ts
  - sillyhub-daemon/tests/fixtures/claude-sdk-messages
goal: >
  ClaudeEventNormalizer 有状态归一化器（每会话实例）：SDK 消息流 → AgentEvent[]。三块移植：
  ①完整消息展开（自 backend _extract_sdk_messages，run_sync/service.py:3446-3716——注意其对
  stream_event 恒返回空，partial 不在其中）②partial 流式/override 撤回（自 session-manager.ts
  4723-4736 缓冲、5864-5988 flush 链，[ASSISTANT_OVERRIDE] 等价语义）③depth 状态机（跨消息
  subagentDepth）。另吸收会话级信号为 status/subtype 事件（D-002@v1 / D-004@v1 / FR-02）。
implementation:
  - claude-events.ts：export class ClaudeEventNormalizer——构造注入 { onPartialFlush, flushIntervalMs }；normalizeMessage(msg) → AgentEvent[]（text/thinking block 展开、tool_use/tool_result 按 tool_use_id 配对、usage/session_id 提取、parent_tool_use_id/subagent_type 透传、Edit 工具 structuredPatch→edit_patch）；实例字段 subagentDepth: Map 维护跨消息 depth；normalizeOverrideSignal() → {override:true, segment_id, content} 撤回事件
  - partial：content_block_delta 节流缓冲 → onPartialFlush 吐 {is_partial:true, segment_id}；thinking/text 区分；缓冲与节流参数与 session-manager 现值一致
  - 会话级信号：system/init（agentSessionId，含 fork/子代理守卫）→ status/session_started（含 session_id）；bash_chunk/bash_status/plan_mode/agent_task_status/task_notification → 对应 status 事件；system/task_* 等纯 Claude 帧吸收或静默丢弃
  - tests/fixtures/claude-sdk-messages/：从本地 ~/.claude/projects 真实 jsonl 采样构造 fixture（text+tool_use 交错帧、stream_event partial 序列、override 帧、Task 子代理带 depth 帧、Edit 带 structuredPatch 帧）
  - tests/interactive/claude-events.test.ts：golden 用例——①完整消息：与 _extract_sdk_messages 现状输出逐字段等价（对照快照从 backend 现实现跑 fixture 生成）②partial→override→撤回链 ③depth 跨帧 ④status 信号映射
acceptance:
  - 完整消息用例与 backend _extract_sdk_messages 输出逐字段等价（golden 快照对照）
  - partial flush 吐 is_partial+segment_id；override 事件语义完整（D-004@v1）
  - depth 状态机跨帧正确（Task 子代理帧 depth+1，结束后回落）
  - 纯函数可测：不 spawn SDK 进程，fixture 驱动
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/claude-events.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 本 task 不改 session-manager.ts/claude-sdk-driver.ts（接线归 task-06/08）
  - 不 import @anthropic-ai/claude-agent-sdk 运行时（类型仅 type-only import）
  - 节流/缓冲参数与现状一致，禁止顺带调优
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
