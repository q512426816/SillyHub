---
id: task-01
title: add-mission-session-id-column-and-active-unique-index
title_zh: agent_missions 加 session_id 列、索引与活跃态部分唯一索引（model+alembic）
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
provides:
  - contract: AgentMission.session_id
    fields: [session_id]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260822090000_mission_session_id.py
goal: >
  建立 mission 绑定发起会话的数据基础（design §5 Phase1/§8，D-006@v1）——agent_missions
  新增 session_id 列与索引，并用活跃态部分唯一索引保证一个会话同时至多一个未收敛未取消
  的 mission（R-07 与 Grill NEW-3 并发守卫）。
implementation:
  - model.py AgentMission 新增 session_id 字段（Uuuid、FK agent_sessions.id、NOT NULL、index=True，写法仿 project_id 字段）；__table_args__ 加部分唯一索引 uq_agent_missions_session_active（postgresql_where 条件 converged_at IS NULL AND cancelled_at IS NULL，design §8）
  - 新建 alembic 迁移 20260822090000_mission_session_id.py（down_revision 取执行时当前 head，格式仿 20260819100000_mission_cross_workspace.py）——add_column + create_foreign_key + create_index（ix_agent_missions_session_id）+ create_index（uq_agent_missions_session_active 带 postgresql_where）
  - 迁移头注释说明存量行允许清库重建、不做回填（CLAUDE.md 规则 11 / design §9 回退路径）；downgrade 对称 drop 唯一索引、普通索引、FK、列
acceptance:
  - cd backend && uv run alembic upgrade head 可执行，agent_missions 出现 session_id 列与两个新索引
  - 唯一索引生效——同 session 插入两个 converged_at 与 cancelled_at 均为 NULL 的 mission，第二条报唯一约束冲突；converge/cancel 置位后同 session 可再建新 mission
  - agent_sessions / agent_runs / daemontaskleases 等其它表结构不变（design §8 不改变的表）
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 不做存量 mission 数据迁移回填（未上线允许清库重建，design §3 非目标）；objective 列保持 NOT NULL 不动（占位回填属 task-04）
  - 仅改模型与新增迁移文件，不触碰 inject/mcp_tools 等消费链路（属后续 Wave 任务）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
