---
id: task-11
title: '模块文档更新（sillyhub-daemon.md + backend.md）'
title_zh: '模块文档更新（sillyhub-daemon.md + backend.md）'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P1
depends_on: ['task-09']
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
target_files:
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
goal: >
  把本变更新增契约（daemon 侧 sillyspec_conflict_snapshot RPC 与 ql_id 心跳补报、backend 侧 compare 端点与 DTO 增量）同步进两份模块文档，保持模块卡片与代码一致。
implementation:
  - sillyhub-daemon.md 契约摘要或关键逻辑补 sillyspec_conflict_snapshot RPC（conflictSnapshot、四道截断护栏、realpath 防逃逸）与 collectStatusOnce pending_conflicts 投影补 ql_id
  - backend.md 契约摘要补 compare 端点（GET sillyspec-conflicts compare，权限与裁决同集合越权 404、离线 504）与 DaemonHeartbeatSillySpecConflict 加 ql_id 可选字段
  - 遵循模块卡片约定，H1 保持中文名（module-id）格式，frontmatter 结构与既有段落不动
acceptance:
  - 两份文档新增条目与 design §7 接口定义一致（方法名、端点路径、字段名逐字对齐）
  - H1 保持「中文名（module-id）」约定，frontmatter 字段不被破坏
  - 文档内代码锚点引用真实存在，文档失效引用校验不产生新基线违例
verify:
  - python scripts/scan-drift-check.py
constraints:
  - 只增量补条目，不重写既有段落与 frontmatter
  - 不改 frontend.md 等其他模块文档（超范围不动）
  - 文档行内引用代码锚点须真实存在，不许编造行号
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
