---
id: task-01
title: add-session-tree-columns-and-mission-resolution
title_zh: 数据模型迁移加会话树两列与 mission 归属环检测解析
author: qinyi
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-07, task-08]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260825210000_agent_session_parent_worker_done.py
provides:
  - contract: agent_session_worker_columns
    fields: [worker_done_at, parent_session_id, mission_id]
  - contract: mission_resolution_helpers
    fields: [mission_worker_sessions, resolve_mission_for_session]
goal: >
  落会话树数据模型地基——agent_sessions 加 parent_session_id（自引用 FK + 索引）与
  worker_done_at 两列，并提供 mission_worker_sessions 一层枚举与
  resolve_mission_for_session 环检测解析（design §5.A），让分身子会话可挂载、
  mission 归属可解析，供本变更全部后续任务消费。
implementation:
  - 新增迁移 20260825210000_agent_session_parent_worker_done.py（revision 20260825210000，down_revision 接当前 head 20260825160000，文件头注释惯例对齐同目录 20260825160000 迁移）——agent_sessions 加 parent_session_id uuid NULL 自引用 FK 与 worker_done_at timestamptz NULL，建 ix_agent_sessions_parent 索引，附 downgrade。
  - model.py AgentSession 加两列（Field + sa_column，注释注明语义——parent 为 NULL 即非分身会话；worker_done_at 可重复置位取最新，非分身会话恒 NULL），__table_args__ 同步补 Index 声明（对齐 ix_agent_runs_mission_id 补声明惯例，防 autogenerate 漂移）。
  - model.py 新增辅助查询 mission_worker_sessions(mission_id)——按 mission.session_id 取根会话，查 parent_session_id 等于根的直接子会话（P1 深度 2 只查一层），供 task-09/13 枚举分身。
  - model.py 新增 resolve_mission_for_session(db, session_id)——沿 parent 链逐级爬到根（visited 集合环检测，环或脏数据截断返回 None 不抛），根会话按 get_active_mission_for_session 既有口径命中 mission。
acceptance:
  - alembic upgrade head 后两列与 ix_agent_sessions_parent 存在且 downgrade 可回退；model 与迁移声明一致无 autogenerate drift。
  - 构造主控与分身 parent 关系后 mission_worker_sessions 只返回分身会话行，不含主控轮 run 与追问轮次 run。
  - resolve 正常链路命中根 mission；构造 parent 环（parent 指向后代）时返回 None 且不死循环。
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_agent_session_model.py app/modules/agent/tests/test_mission_session_id.py
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - 两列均 nullable 不回填——存量 mission 不迁子会话形态，双判据兼容由后续任务负责（design §3 非目标）。
  - P1 只查一层直接子会话，不做递归 CTE 与树深上限（P2 递归派发时再放开，design §5.A）。
  - 不动 derive_status 纯函数、不动 get_active_mission_for_session 既有签名与语义；resolve 默认只匹配活跃 mission，include_terminal 扩展归 task-07。
  - 环检测用 visited 集合逐级爬；脏数据截断返 None 不抛异常；新增单测归 task-15。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
