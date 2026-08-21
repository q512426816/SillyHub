---
id: task-02
title: 'DS-2 存量迁移——Alembic 迁移取最后一轮 run session_id 回填（provider 限定 claude/codex，排除软删）+ 独立迁移测试；downgrade no-op；SQLite 兼容'
title_zh: 'DS-2 存量迁移——Alembic 迁移取最后一轮 run session_id 回填（provider 限定 claude/codex，排除软删）+ 独立迁移测试；downgrade no-op；SQLite 兼容'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, NFR-04]
decision_ids: []
allowed_paths:
  - backend/migrations/versions/20260821120000_backfill_session_agent_session_id.py
  - backend/tests/test_session_agent_session_id_migration.py
goal: >
  存量数据一次性迁移：为 agent_session_id 仍为 NULL 的 claude/codex 存量会话取
  最后一轮 run 的 session_id 回填，让 reopen 对历史会话也可用；无合格 run 的
  老会话保持 NULL（reopen 维持 409，预期内，design 风险表已登记）。
implementation:
  - '新建 backend/migrations/versions/20260821120000_backfill_session_agent_session_id.py：命名沿用 2026-08-05 起的 YYYYMMDDHHMMSS 前缀惯例；revision="20260821120000"（≤32 字符），down_revision="20260821100000"（当前 head 即 agent_mission_project_id_index——执行前 ls versions/ + alembic heads 复核 head 未变，变了则挂实际最新 head）。'
  - '仿 20260713_fix_session_zombie.py 数据迁移先例（docstring 写背景与取值规则 + 纯 data migration 零结构变更）：upgrade() 单条 op.execute raw SQL——UPDATE agent_sessions s SET agent_session_id = (SELECT r.session_id FROM agent_runs r WHERE r.agent_session_id = s.id AND r.session_id IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) WHERE s.agent_session_id IS NULL AND s.provider IN (''claude'',''codex'') AND s.deleted_at IS NULL。'
  - '子查询 ORDER BY r.created_at DESC LIMIT 1 取最后一轮 run 值（fork 场景取最新 id）；agent_runs.created_at 列由 202607050900_add_agent_run_created_at 迁移保证存在。'
  - 'downgrade() 为 no-op（pass）并注释说明不可逆理由：原 NULL 无法区分从未上报与回填后清空，本项目允许重置数据（CLAUDE.md 规则 11）。'
  - '新建独立测试 backend/tests/test_session_agent_session_id_migration.py：范式参照 backend/tests/test_session_zombie_migration.py——PG 方言 raw SQL 在 SQLite 跑不了完整 op.upgrade() 时，用 SQLite 兼容的等价 SQL replay 验证取值逻辑；真实 PG alembic upgrade head 列为 manual verify。'
  - '测试断言：多 run 取 created_at 最新一条的 session_id；provider 非 claude/codex 排除；deleted_at 非空（软删）排除；agent_session_id 已非空的行不动；子查询无合格 run（关联 run 的 session_id 全 NULL）时保持 NULL。'
acceptance:
  - 迁移 upgrade 后，符合条件的会话行 agent_session_id = 其 runs 中 created_at 最新且 session_id 非空那条的值。
  - provider 不在 claude/codex、软删行、agent_session_id 已非空的行均不被改动。
  - downgrade 为 no-op 不抛错，且注释说明不可逆理由。
  - SQLite 等价 replay 测试全绿；不破坏 alembic 单 head 链。
verify:
  - cd backend && uv run pytest tests/test_session_agent_session_id_migration.py -v
  - cd backend && uv run ruff check migrations/versions/20260821120000_backfill_session_agent_session_id.py
  - 'manual（PG 环境）：uv run alembic upgrade head 后抽查回填行数与取值（zombie 先例同款 evidence）。'
constraints:
  - '纯 data migration：无 add_column/drop_column/create_index（零结构变更）。'
  - '只回填 agent_session_id IS NULL 的行，绝不覆盖已有值（存量补空与 task-01 的增量最新值覆盖职责分离）。'
  - 不改 ORM 模型、不改业务代码；迁移文件与独立测试文件为本 task 仅有的两个新文件。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
