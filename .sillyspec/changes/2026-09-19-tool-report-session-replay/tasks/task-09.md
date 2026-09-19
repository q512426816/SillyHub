---
id: task-09
title: '前端适配器 buildReplayTurns 纯函数 + 单测'
title_zh: '前端适配器 buildReplayTurns 纯函数 + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-08']
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1, D-004@v1, D-005@v1]
blocks: ['task-11']
expects_from:
  task-08:
    - contract: AgentLogMessagesResponse
      needs: [total_usage, usage, turn_id, model, duration_ms, sender]
provides:
  - contract: buildReplayTurns
    fields: [processItems, inputTokens, outputTokens, ctxTokens]
allowed_paths:
  - NEW:frontend/src/lib/agent-log-turns.ts
  - NEW:frontend/src/lib/__tests__/agent-log-turns.test.ts
target_files:
  - NEW:frontend/src/lib/agent-log-turns.ts
  - NEW:frontend/src/lib/__tests__/agent-log-turns.test.ts
goal: >
  新建纯函数适配器 buildReplayTurns——把 messages 端点归一化消息数组映射成 TurnTimeline
  的 SessionTurnView 数组（frontend/src/components/daemon/turn-timeline.tsx:220），FR-01
  会话样式回放与 FR-03 轮级 token 的数据装配层；纯函数零渲染依赖，task-11 直接消费。
implementation:
  - 新建 frontend/src/lib/agent-log-turns.ts——export function buildReplayTurns(messages) 返回 SessionTurnView 数组；输入类型从 api-types 生成 schema 派生导出（agent-log-card.tsx:120 NonNullable 派生先例，禁手写同名接口）
  - 切轮——turn_id 变化或 sender=human 的 user_input 开新轮（sender 缺省视为 human，D-005）；轮起点真人文本作 prompt，无真人文本的轮 prompt 留空、由系统事件行标记（不伪造 CLI 命令文本）
  - 段映射——thinking → processItems thinking 项；reply → 按序拼接 output（runtime-session-helpers.tsx:445 legacy.output 拼接先例）；tool_use 按 tool_use_id 显式 Map 配对 tool_result → tool 项（raw=tool_input、result=tool_result、is_error 映射 ok/deny）
  - system_event 承载——sender=system_event 的 user_input → processItems 追加 system_event 项（kind 由 task-10 在 turn-timeline.tsx:190 SessionProcessItem 扩展提供，本卡只产数据不做渲染）；孤儿 tool_result → raw 空串 tool 项（SessionToolEvent 语义 turn-timeline.tsx:210）；未配对 tool_use → tool 项 result 缺省 status=running（DTO 对无结果的规范编码，非假运行断言）
  - token 轮级聚合——轮内各调用 usage 先去重再求和 inputTokens/outputTokens（同一次调用产出的多段共享同一 usage，按段直加会重复计数）；ctxTokens 取该轮末次调用 usage 的 inputTokens；轮内无 usage → 三值 null（未知不显 0 不伪造）
  - 视图常量——每轮 status=completed（历史轮先例 runtime-session-helpers.tsx:231）、seenLogIds 空 Set、runId 伪 id 按 __replay_N__ 形态（__attach_history_N__ 先例 runtime-session-helpers.tsx:439）、turn 取 1 起轮序
  - 单测新建 frontend/src/lib/__tests__/agent-log-turns.test.ts——用例覆盖真人切轮与 sender 缺省、system_event 进 processItems 不切轮、turn_id 变化切轮、工具配对 is_error → deny、孤儿 tool_result raw 空串、usage 去重聚合与 ctxTokens 末次口径、无 usage 全 null 兜底、常量字段断言
acceptance:
  - 真人 user_input 开新轮且 prompt 取原文；system_event 不开轮、进 processItems 的 system_event 项
  - turn_id 变化独立切轮（D-005）；thinking/reply 映射与工具配对/孤儿规则断言全过
  - 轮级 inputTokens/outputTokens 为去重后求和、ctxTokens 等于该轮末次 inputTokens；无 usage 轮三值 null
  - 纯函数零副作用——不改入参、不 import React/渲染层；定向单测与 tsc 通过
verify:
  - cd frontend && pnpm test -- src/lib/__tests__/agent-log-turns
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只新建两个文件——不动 turn-timeline.tsx（system_event kind 渲染归 task-10）与挂载层（归 task-11）
  - 全会话累计 total_usage 由 daemon 返回、task-11 展示——适配器不做全局求和（窗口化下前端求和必算少）
  - 类型一律取 api-types 生成 schema（task-08 gen:types 产物）；禁跑全量测试仅定向本文件
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
