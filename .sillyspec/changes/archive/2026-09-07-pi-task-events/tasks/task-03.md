---
id: task-03
title: 'session-manager 分派集成用例（pi 任务事件经 _dispatchStatusEvent 正确 emit）'
title_zh: 'session-manager 分派集成用例（pi 任务事件经 _dispatchStatusEvent 正确 emit）'
author: 'qinyi'
created_at: 2026-09-07 13:17:55
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
expects_from:
  - task-01: agent_task_status_events 派生事件契约（running/terminal）
allowed_paths:
  - sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts
goal: >
  新增 pi-task-dispatch.test.ts 集成用例（D-004 定名），证明 PiEventNormalizer 产出的 agent_task_status 事件经 session-manager _dispatchStatusEvent 正确 emit——pi envelope 无 Task/Agent tool_use，envelopeHasTaskToolUse=false 走 _handleAgentTaskStatusEvent 注册表口径，实证 FR-02/D-002 零侵入复用链路。
implementation:
  - 复用 tests/interactive/session-manager.test.ts harness 范式（makeMockDriver/makeDeps 改编）+ session-manager-provider-routing.test.ts 的 deps.drivers 注册表注入先例：fake InteractiveDriver（start/consume/interrupt + captured 回调手柄）以 drivers:{pi:...} 注入，create({ ...BASE_INPUT, provider: 'pi' })；deps 增 onSessionEvent: vi.fn() 观测 _emitSessionEvent 产出（session-manager.ts:4960 消费点）
  - 事件源用真实 PiEventNormalizer：逐行喂 turn_start/tool_execution_start/turn_end JSONL，把 normalizeRpcLine 产出的 envelope 经捕获的 onTurnMessage 回调 emitMessage 注入（producer 契约真实，不经手写 status 事件）
  - 断言：turn_start → running emit（kind agent_task_status，task_id=pi-t1，task_name='执行任务'）+ 注册表登记；tool_execution_start → 刷新 emit（last_tool_name/tool_uses）；turn_end(stop) → completed 终态 emit；turn_end(error) → failed+summary emit
  - 断言路由口径：pi envelope 无 Task/Agent tool_use → envelopeHasTaskToolUse=false，agent_task_status 走 _handleAgentTaskStatusEvent（session-manager.ts:4788-4804 的 tool_use 派生特判分支不命中）
acceptance:
  - running/刷新/终态三类 agent_task_status 均经 _dispatchStatusEvent 到达 deps.onSessionEvent，session-manager 对 pi 零 provider 特判（FR-02）
  - 全部经手事件过 safeParseAgentEvent
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-task-dispatch.test.ts
constraints:
  - session-manager.ts 与 pi-events.ts 源码零改动（纯新增测试文件；发现链路缺陷回设计/task-01 层定夺，不在本卡顺手修）
  - 禁跑全量测试；ESM import 带 .js；文件名恒为 tests/interactive/pi-task-dispatch.test.ts（D-004）
  - 测试环境 Windows 兼容（路径跨平台写法，参照 BASE_INPUT cwd='C:\\work' 先例）
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
