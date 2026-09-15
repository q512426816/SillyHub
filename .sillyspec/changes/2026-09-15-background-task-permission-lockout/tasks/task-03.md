---
id: task-03
title: '守卫放行——writeChannelGuardDeny 新增 hasBackgroundTaskGrace（active+currentRunId+注册表非空）；两处 deny 文案加 PLATFORM_NO_RUNNING_TURN: 前缀'
title_zh: '守卫放行——writeChannelGuardDeny 新增 hasBackgroundTaskGrace（active+currentRunId+注册表非空）；两处 deny 文案加 PLATFORM_NO_RUNNING_TURN: 前缀'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
goal: >
  写通道守卫锁死后台任务的 P0 修复（FR-01）：writeChannelGuardDeny 对 status≠running 一律 fail-closed deny，
  主轮正常收尾后后台 Task 子代理的工具调用全被拒（线上实证重试 94.5 分钟/1030 次）。
  新增 hasBackgroundTaskGrace 放行（注册表=「后台工作确定存活」的权威信号），与 withinStaleFlipGrace 并列为第二宽限源；
  守卫残留 deny 带稳定平台故障码前缀 PLATFORM_NO_RUNNING_TURN:（FR-02 扩展，agent 可区分平台故障与用户拒绝）。
implementation:
  - permission.ts 新增导出函数 hasBackgroundTaskGrace(mgr, state)：state.status==='active' && !!state.currentRunId && 注册表非空（经门面 hasLiveBackgroundTasks 判定）
  - writeChannelGuardDeny 在现有两放行（status=running / withinStaleFlipGrace）之后追加 hasBackgroundTaskGrace 放行，命中即 return null
  - '两处守卫 deny message（permission.ts:169 带状态 parts 处与 :191/:327 "session not in running turn" 文案处）加前缀 "PLATFORM_NO_RUNNING_TURN: "，存量文案信息保留'
  - 主轮进行中的普通人审 deny 文案不动（那是用户决策、非平台故障）
acceptance:
  - 三态单测：注册表空（active+currentRunId）→ deny；注册表非空（active+currentRunId）→ 放行；currentRunId 缺失（active+注册表非空但锚点已清）→ deny
  - '守卫 deny message 以 "PLATFORM_NO_RUNNING_TURN: " 开头'
  - 主轮普通人审 deny 文案不含该平台故障码前缀、与现状一致
  - status=running 与 withinStaleFlipGrace 放行行为不变
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager-permission.test.ts && pnpm typecheck
constraints:
  - 主轮普通人审 deny 文案不改（仅守卫残留 deny 加前缀）
  - 不改变既有放行逻辑语义（running / stale-flip 宽限窗照常）
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
