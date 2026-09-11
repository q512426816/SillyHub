---
id: task-05
title: 'backend legacy attribution data cleanup migration'
title_zh: 'backend 存量清理数据迁移'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: ['D-004@v2']
allowed_paths:
  - backend/migrations/versions/
target_files:
  - NEW:backend/migrations/versions/20260912050000_agent_log_attribution_reset.py
goal: >
  新增 Alembic 数据迁移一次性清空错配时代归属数据（agent_session_id 置 NULL、
  tool_report 会话软删、两张 links 表全清），正确归属由 CLI 升级后重推重建
  （FR-05 / D-004@v2）。
implementation:
  - '新建 backend/migrations/versions/20260912050000_agent_log_attribution_reset.py：revision="20260912050000"，down_revision 接执行时唯一 head（本卡生成时 alembic heads 实测 5e295549e20f，执行前复核）；docstring 风格对齐 20260911100000_add_skill_source_tables.py（变更名 + 决策引用 + author/created_at）'
  - 'upgrade 四条 op.execute（sa.text 写法对齐 202606220900_backfill_spec_workspaces.py 先例）：① UPDATE platform_agent_logs SET agent_session_id=NULL（行保留）；② UPDATE agent_sessions SET deleted_at=now() WHERE origin=tool_report AND deleted_at IS NULL（旧 {harness}|{ctx} 聚合键会话防僵尸）；③ DELETE FROM change_session_links（全表——无来源列，污染行与合法行不可区分，用户裁决全清）；④ DELETE FROM quicklog_session_links（同上）'
  - 'downgrade no-op（数据可由重推重建，D-004@v2 明示）；docstring 写明执行时机：backend 发布并 CLI 升级后作为一次性运维动作执行，不随 backend 发布自动前滚（DG-03 解耦）'
  - '开发库演练：upgrade head 后断言 platform_agent_logs.agent_session_id 全 NULL、origin=tool_report 会话 deleted_at 非空、两张 links 表零行；downgrade -1 验证 no-op 不报错；fresh 库整链复跑 upgrade 通过'
acceptance:
  - 'cd backend && uv run alembic heads 单 head；开发库 upgrade 后四项清理状态断言成立'
  - 'alembic downgrade -1 no-op 通过；二次 upgrade 不报错（可重入演练）'
  - '迁移零 schema 变更，platform_sync 归属相关测试零回归'
verify:
  - 'cd backend && uv run alembic heads && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_push.py -q --no-cov'
  - 'cd backend && uv run ruff check migrations/versions/20260912050000_agent_log_attribution_reset.py'
constraints:
  - '纯数据迁移零 schema 变更（D-005@v1）；不删 platform_agent_logs 行；agent_sessions 只软删不硬删（R-07 可逆）'
  - '不写迁移专项单测文件（一次性运维动作，开发库演练即验收），不预建空测试'
  - 'downgrade 不做反向回填（no-op 是设计而非缺失，D-004@v2）'
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
