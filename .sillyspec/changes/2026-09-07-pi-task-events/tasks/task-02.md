---
id: task-02
title: 'pi-events 既有用例 expected 适配 + 新状态机用例（轮生命周期/工具刷新/防御/时钟）'
title_zh: 'pi-events 既有用例 expected 适配 + 新状态机用例（轮生命周期/工具刷新/防御/时钟）'
author: 'qinyi'
created_at: 2026-09-07 13:17:55
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
expects_from:
  - task-01: agent_task_status_events 派生事件契约（running/terminal，status 先行）
allowed_paths:
  - sillyhub-daemon/tests/interactive/pi-events.test.ts
goal: >
  适配 pi-events.test.ts 既有用例 expected（追加派生 status 事件——R-01 预期适配非破坏）并新增独立状态机 describe（轮生命周期/工具刷新/防御补终态/error→failed/now 注入走秒），守护 FR-01 派生规则与 FR-04 既有行为零回归。
implementation:
  - 既有用例 expected 适配（R-01/D-004：追加派生事件，语义仍「原事件照旧 + 派生追加」，不得弱化断言）：'产出全集恰为预期序列'（6 事件 → 追加 turn_start/工具刷新/turn_end 的 status）；'已知生命周期型零产出'（silent 15 行 → turn_start 不再静默，行数与注释同步修正）；real-error-turn '实跑事件序'（['error','text'] → 前插 failed status）；'usage 非数值字段按 0 容错'（turn_end(stop) 追加 completed status）
  - '缺字段的畸形已知事件不抛' 的孤立 turn_end 断言保持 []（无前序 turn_start → 无 running 行防御跳过）——转为守护防御语义
  - 新增状态机 describe（独立于既有 fixture describe，每测试注入 now 时钟）：①完整轮 turn_start→tool_execution_start×2→turn_end(stop)：running(task_id=pi-t1, task_name='执行任务')→刷新(last_tool_name/tool_uses=2/summary='正在调用 X')→completed，elapsed_ms 用注入时钟断言走秒；②turn_end stopReason='error'→failed+summary=errorMessage（D-004 无 aborted 路径）；③FR-03 防御：上轮缺 turn_end 时新 turn_start 先补 completed(pi-t1) 再开 running(pi-t2)；④task_id 实例内递增 + tool_execution_end 零任务事件 + 派生事件全部过 safeParseAgentEvent
acceptance:
  - 既有用例全部绿，原字段级断言（tool_use/tool_result/thinking/usage/降级桶）零弱化零删除（FR-04）
  - 新 describe 覆盖 design 派生规则表全部行与 FR-03 两条防御（FR-01）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-events.test.ts
constraints:
  - 只改本测试文件；禁止为过测改实现或弱化既有断言（CLAUDE.md #9）
  - 禁跑全量测试；ESM import 带 .js；不引新依赖
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
