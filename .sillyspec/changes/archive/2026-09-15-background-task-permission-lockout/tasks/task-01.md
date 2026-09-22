---
id: task-01
title: 'daemon 后台锚点——onResult 注册表非空保留 currentRunId；task_notification 注销后注册表清空时清锚点；clearBackgroundTasks 同步清'
title_zh: 'daemon 后台锚点——onResult 注册表非空保留 currentRunId；task_notification 注销后注册表清空时清锚点；clearBackgroundTasks 同步清'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
goal: >
  建立后台锚点机制（FR-01）：events.ts onResult 收尾时若该会话后台任务注册表（mgr._backgroundTasks）非空，
  保留 currentRunId 作后台锚点（status 仍翻 active），让主轮收尾后存活的后台 Task 子代理保持写/审批通道可用；
  background-tasks.ts 在任务终态注销后注册表清空时清锚点、clearBackgroundTasks 同步清锚点，后台任务终态后自动收敛。
implementation:
  - events.ts onResult：清 currentRunId 前先检查 mgr._backgroundTasks.get(sessionId)，非空则保留 currentRunId（status 照常翻 active）；注册表为空行为与现状完全一致
  - events.ts 加注释说明锚点语义：锚点仅代表「后台任务群的派发轮次仍需通道」，是「仅通道存在性」——写策略（allowed_roots/policyEngine）与人审链路全程生效，不代表轮次仍在跑
  - background-tasks.ts handleTaskNotificationEvent：tasks.delete(taskId) 之后，若注册表已空且 state.status==='active' && state.currentRunId，清掉锚点（status=running 即新一轮在跑，不误清）
  - background-tasks.ts clearBackgroundTasks：会话终态清理时同步清锚点（兜底收敛，防注册表泄漏致锚点永不清）
  - 注释与 design.md Wave 1 语义一致（已知行为变化：provider/config switch 空闲判定推迟到下轮边界，方向保守可接受，不改）
acceptance:
  - 注册表非空时 onResult 保留 currentRunId 且 status 翻 active（锚点生效）
  - 注册表为空/不存在时 onResult 清 currentRunId，行为与现状一致
  - handleTaskNotificationEvent 注销后注册表空 + status==='active' + currentRunId 存在 → 清锚点；status=running 时不误清
  - clearBackgroundTasks 调用后锚点同步清除
  - 新增单测覆盖上述分支并全部通过
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/claude-events.test.ts tests/interactive/task-lifecycle.test.ts && pnpm typecheck
constraints:
  - 不改 status 翻转逻辑（running→active 照常，仅条件化 currentRunId 清空）
  - 不碰 inject 排队逻辑（events.ts 排队 flush 等既有路径不动）
  - 注释与实现一致（CLAUDE.md 规则18）
  - 不引入无关文件变更
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
