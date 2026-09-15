---
id: task-06
title: '用量标注——daemon.ts run 结果上报处 hasLiveBackgroundTasks 为真时向收口 runId 追加 [USAGE_NOTE] stdout 日志行'
title_zh: '用量标注——daemon.ts run 结果上报处 hasLiveBackgroundTasks 为真时向收口 runId 追加 [USAGE_NOTE] stdout 日志行'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
goal: >
  用量差分记账归属误导的 P2 标注（FR-04）：SDK modelUsage/total_cost_usd 是会话级跨轮累计快照，
  两次 run 收口之间的后台任务消耗全部差分错记给无辜 run（线上实证 19 秒 run 被记 $24.10）。
  daemon 按相邻快照差分记账维持现状（SDK 无 per-task 数据源，明确不按任务拆分），
  改为在「本 run 收口时后台任务仍在跑」场景向正在收口的 runId 追加 [USAGE_NOTE] 日志行，如实告知该数字含后台任务消耗。
implementation:
  - daemon.ts run 结果上报路径（notifyRunResult payload 组装处，与 _deltaModelUsage 差分同一路径，daemon.ts:3912 附近）在 hasLiveBackgroundTasks(sessionId) 为真时，向正在收口的 runId 追加一条 stdout 日志行
  - 日志行内容：`[USAGE_NOTE] 本轮上报用量含仍在运行的后台任务消耗（SDK 为会话级累计快照，无法按任务拆分）`
  - 复用该处既有 [TASK_*] 行写入通道/格式（SessionManager _writeTaskLine legacy flat 通道，已有向终态 run 写行先例）
  - 挂到正在收口的 runId（而非后台任务自身 runId）
acceptance:
  - 收口时 hasLiveBackgroundTasks 为真 → 收口 run 的 stdout 含 [USAGE_NOTE] 日志行
  - 无存活后台任务时不追加该行
  - 日志行走与 [TASK_*] 相同的写入通道与格式（seq/legacy flat 语义不被破坏）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-interactive-bridge.test.ts && pnpm typecheck
constraints:
  - 仅追加日志行，不改用量数值本身（差分记账逻辑不动）
  - 不引入无关文件变更
  - 注释与实现一致（CLAUDE.md 规则18）
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
