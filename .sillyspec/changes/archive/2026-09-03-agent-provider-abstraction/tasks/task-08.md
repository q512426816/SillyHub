---
id: task-08
title: 'SessionManager status 分发改造与瘦身 + cli.ts 类型接线（raw 依赖清零）'
title_zh: 'SessionManager status 分发改造与瘦身 + cli.ts 类型接线（raw 依赖清零）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/interactive
goal: >
  SessionManager 消费侧改造：_onMessage 从解析 raw SDK 形状改为消费中性 AgentEvent（status
  subtype 分发表承载现 10+ 类会话级逻辑，建立对账表）；partial 缓冲/depth 状态机移除（已下沉
  task-03 归一化器）；seq 补号/usage lift；cli.ts SDKMessage 类型接线改为 AgentEvent。raw 依赖
  清零（FR-02 / D-002@v1 / D-003@v1）。
implementation:
  - session-manager.ts：_onMessage（:4557-4866）重写为事件分发——text/thinking/tool_use/tool_result/error/turn_result 直通；status 按 subtype 分发：session_started→agentSessionId 提取（保留 fork/子代理守卫语义）、bash_chunk/bash_status/plan_mode/agent_task_status/task_notification→现 onSessionEvent 通道各处理函数（Bash 追踪/plan 状态/审批队列语义不变）；移除 stream_event partial 缓冲（:400-500）与 subagentDepth 内联状态机（已由归一化器产出 depth 字段）；usage lift（对齐现 daemon.ts:3564-3586 语义的会话侧部分）；turn 边界 seq 重置
  - 代码内注释保留"对账表"：现 _onMessage 每类消费（10+ 项）与新分发项一一映射的清单（R-02 要求）
  - cli.ts：752-771 SDKMessage 类型消费改为 TurnMessageEnvelope/AgentEvent（调试日志形态随改）
  - tests/interactive/ 下既有 session-manager-*.test.ts：mock 从 SDK 消息形状改为 AgentEvent fixture（fixture 复用 task-03）；行为断言语义不弱化
acceptance:
  - 对账表完整：现 _onMessage 全部消费类型在新分发中有着落（code review 对照）
  - SessionManager/cli.ts 无 @anthropic-ai/claude-agent-sdk 类型 import（grep 验证）
  - tests/interactive/ 全部既有测试（改造后）全绿——准入判据（R-02）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 会话级语义零变化：Bash 追踪/plan 模式/审批队列/resume 等待回执行为与现状一致
  - 分支下沉逐块进行，既有测试语义不得弱化（改 mock 不改断言意图）
  - 不动 daemon.ts（接线归 task-09）；不动 driver（task-06 已完成）
expects_from:
  - task-06: TurnMessageEnvelope（events 通道）
  - task-04: codex 事件映射（thread_started→status/session_started 同型消费）
related_tests:
  - sillyhub-daemon/tests/interactive/（session-manager-*.test.ts 系列随 mock 形态迁移）
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
