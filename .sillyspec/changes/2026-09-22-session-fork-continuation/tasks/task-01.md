---
id: task-01
title: '数据模型迁移——agent_sessions fork 三列+origin=''fork''+agent_runs engine_anchor+索引（model.py+alembic+模型单测）'
title_zh: '数据模型迁移——agent_sessions fork 三列+origin=''fork''+agent_runs engine_anchor+索引（model.py+alembic+模型单测）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-07]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260922194500_add_session_fork_columns.py
  - backend/app/modules/agent/tests/test_session_fork_model.py
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20260922194500_add_session_fork_columns.py
  - NEW:backend/app/modules/agent/tests/test_session_fork_model.py
goal: >
  打地基：AgentSession 增 fork 三列+origin='fork' 值域、AgentRun 增 engine_anchor 锚点列（含索引），为 fork 记录与原生分叉定位提供数据面。
implementation:
  - backend/app/modules/agent/model.py:888-918 旁（parent_session_id/tree_depth 列定义后）增 fork_of_session_id/fork_at_run_id/engine_fork_anchor 三可空列 + ix_agent_sessions_fork_of 索引；origin 列（:817-828）注释补 'fork' 值域与「fork 会话不写 parent_session_id、tree_depth 恒 0」约束
  - AgentRun 列区（:263-306 附近）增 engine_anchor TEXT NULL（仅 claude 档回填，codex/pi 恒 NULL）
  - 新建 alembic 迁移 20260922194500_add_session_fork_columns.py（四新列+索引；项目未上线允许重置，仍按惯例写升级路径）
  - 新建 backend/app/modules/agent/tests/test_session_fork_model.py：列存在性/可空默认/origin 'fork' 容量（String(16)）断言
acceptance:
  - 迁移 up/down 幂等可跑（offline SQL 校验）
  - 新列全部可空零迁移兼容（存量行不动）
  - model 单测断言 fork 三列+engine_anchor 存在且默认 NULL
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_session_fork_model.py -q --no-cov
  - cd backend && uv run alembic upgrade head --sql 2>&1 | head -5（offline 生成校验）
constraints:
  - 不改既有列语义（parent_session_id/tree_depth 分身语义原样）
  - 不做数据回填（存量轮 engine_anchor 保持 NULL，入口灰处理属 task-07）
  - 禁跑全量测试，仅 scoped
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
