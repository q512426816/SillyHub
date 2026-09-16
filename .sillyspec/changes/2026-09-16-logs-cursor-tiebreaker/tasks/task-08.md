---
id: task-08
title: 'verify——proposal 成功标准逐条对账（150 行批两页取尽/缺省逐字节回归/422/gen:types:check/双端相关测试绿）+ R-02 执行计划观察（分页测试耗时无显著回退）'
title_zh: 'verify——proposal 成功标准逐条对账（150 行批两页取尽/缺省逐字节回归/422/gen:types:check/双端相关测试绿）+ R-02 执行计划观察（分页测试耗时无显著回退）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: ['task-03', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-16-logs-cursor-tiebreaker/verify-result.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/frontend/changelog.md
target_files: []
depends_on: [task-03, task-07]
goal: >
  验收对账：proposal 成功标准逐条核验（AC-01~06）+ R-02 执行计划观察 + 模块文档增量同步。
implementation:
  - 跑双端相关面测试并记录（backend test_group_logs_pagination / frontend session-history-scroll+page）
  - AC-06 diff 核对：ORDER BY 与 logsToTurns 零改动
  - R-02 观察：150 行批用例耗时无显著回退（对照改动前基线跑一次）
  - gen:types:check + ruff/format/mypy + tsc/eslint 增量核对
  - 模块文档增量（backend daemon.md 游标复合语义一行 + frontend changelog 条目）
acceptance:
  - proposal 成功标准 6 条逐条 pass 并记证据（测试输出/命令回显）
  - verify-result.md 落档（verify-probes --init 骨架）
verify:
  - sillyspec run verify --change 2026-09-16-logs-cursor-tiebreaker
constraints:
  - 只跑相关面（规则 0 禁全量）
  - 已知 HEAD 既有测试债如实标注非本变更回归
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
