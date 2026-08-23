---
id: task-04
title: 'pnpm gen:types 同步 openapi/api-types（gen:types:check 通过）+ 前端 readAgentLogMessages API 封装'
title_zh: 'pnpm gen:types 同步 openapi/api-types（gen:types:check 通过）+ 前端 readAgentLogMessages API 封装'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: ['task-03']
blocks: ['task-05']
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/agent-logs.ts
provides:
  - contract: readAgentLogMessages
    fields: [status, messages, truncated, total_segments, skipped_lines]
expects_from:
  task-03:
    - contract: AgentLogMessagesResponse
      needs: [status, messages, truncated, total_segments, skipped_lines]
goal: >
  前端类型与后端 schema 对齐——pnpm gen:types 再生成 api-types.ts 并同步提交 openapi.json（规则 21 / plan 全局验收 4），lib/agent-logs.ts 新增 readAgentLogMessages(entryId, beforeSeq?) 封装 GET /api/agent-logs/{entry_id}/messages，为 task-05 对话化渲染供给 KB 级归一化消息（design §6 / §7.2，FR-02 前端侧）。
implementation:
  - 前置确认 task-03 已完成——backend schema 含 AgentLogMessagesResponse {status, messages, truncated, total_segments, skipped_lines} 与 AgentLogMessageItem {seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts}，openapi.json 已含 GET /agent-logs/{entry_id}/messages；缺失则回 task-03 补齐，本卡不写后端
  - 规则 21 先确认前端 node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim；半坏先 pnpm install --force，防假的 CSSProperties / Cannot find module 类报错误判）
  - cd frontend && pnpm gen:types——src/lib/api-types.ts 出现 components.schemas.AgentLogMessagesResponse / AgentLogMessageItem 生成类型；backend/openapi.json 与 api-types.ts 一并纳入本次提交，不让类型落后后端形成债
  - agent-logs.ts 顶部新增导出 type AgentLogMessagesResponse = components["schemas"]["AgentLogMessagesResponse"]（对齐文件内 AgentLogContentResponse 既有导出惯例），文件头注释补 messages 端点一条（归一化消息、status 分层语义简述）
  - 新增 readAgentLogMessages(entryId, beforeSeq?)——apiFetch GET `/api/agent-logs/${encodeURIComponent(entryId)}/messages`，beforeSeq 非空时 query 传 before_seq；类型一律取生成 schema，snake_case 字段原样访问，禁止手写同名接口
  - 错误口径与 readAgentLogContent 一致——404 / 409 / 422 / 502 / 504 抛 ApiError 交调用方（task-05 判定静默回落），本卡不吞错误、不做 UI
acceptance:
  - api-types.ts 含 AgentLogMessagesResponse / AgentLogMessageItem 生成类型，字段 snake_case 与 backend schema 逐字一致（tool_use_id / tool_input / tool_result / is_error 等），git diff 无手写痕迹
  - readAgentLogMessages("x") 请求 /api/agent-logs/x/messages；readAgentLogMessages("x", 12) query 携带 before_seq=12
  - pnpm gen:types:check 通过（再生成零 diff，plan 全局验收 4）
  - 既有 readAgentLogContent / listAgentLogs 行为零改动（回落通道保留）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm gen:types && git diff --exit-code src/lib/api-types.ts
constraints:
  - 规则 21——api-types.ts 必须从 openapi 生成，禁止手写同名接口（文件头 X-06 惯例）；gen:types 前先确认 node_modules 健康
  - backend/openapi.json 内容以 task-03 的后端生成产物为准，本卡仅同步提交与校验一致性，不手改 openapi.json
  - 不改 readAgentLogContent / listAgentLogs 既有签名与行为；不做 UI / 组件改动（渲染升级归 task-05），不改 lib/query-keys.ts
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
