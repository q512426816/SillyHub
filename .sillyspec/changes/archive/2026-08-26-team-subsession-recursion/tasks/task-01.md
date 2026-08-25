---
id: task-01
title: 'add-tree-depth-column-and-full-tree-cte'
title_zh: '数据模型 tree_depth 列与 mission_worker_sessions_tree 全树递归 CTE'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: []
blocks: [task-03, task-04, task-02, task-08]
requirement_ids: [FR-01, FR-08]
decision_ids: [D-001@v1, D-003@v2]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260826020000_agent_session_tree_depth.py
  - backend/app/modules/agent/tests/test_agent_session_model.py
  - backend/app/modules/agent/tests/test_mission_session_id.py
provides:
  - contract: session_tree_depth_model
    fields: [tree_depth, mission_worker_sessions_tree]
goal: >
  落深度治理数据模型（design §5.A）——agent_sessions 加 tree_depth（int NOT NULL
  DEFAULT 0，迁移全表 CASE 回填 parent NULL→0/非空→1），新增
  mission_worker_sessions_tree 递归 CTE 从根会话沿 parent_session_id 展开全树
  （UNION 去重防环 + MAX_TREE_DEPTH=4 截断），给派发门 O(1) 深度读与治理口径
  含孙层的分身全集（D-003@v2 方案A 双源之 DB 源），供 task-02/03/04/08 消费。
implementation:
  - '新增迁移 20260826020000_agent_session_tree_depth.py（revision 20260826020000，down_revision 接当前 head 20260825230000）——agent_sessions 加 tree_depth int NOT NULL server_default 0，建 ix_agent_sessions_tree_depth 索引，附全表回填 UPDATE agent_sessions SET tree_depth = CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END 与 downgrade'
  - 'model.py AgentSession 加 tree_depth 列（Field + sa_column，Integer NOT NULL default 0，注释注明主控/普通会话 0、分身 1、孙 2 与派发 parent+1 落库口径），__table_args__ 同步补 Index 声明防 autogenerate 漂移'
  - 'model.py 新增 mission_worker_sessions_tree(db, mission_id)——递归 CTE 以 mission.session_id 为根沿 parent_session_id 展开全树，UNION 去重防环 + 深度截断常量 MAX_TREE_DEPTH=4（model.py 单源）防脏数据深环，created_at 升序稳定枚举；mission 不存在 / external mission（session_id NULL）/ 无子树均返回空列表'
  - 'P1 的 mission_worker_sessions（一层枚举）原样保留——热路径一层最快，全树版供治理口径消费；机械更新 test_agent_session_model.py / test_mission_session_id.py 严格字段集断言（25→26 字段）'
acceptance:
  - 'alembic upgrade head 后 tree_depth NOT NULL DEFAULT 0 且全表回填无 NULL 读值（存量主控/普通=0、存量分身=1），索引存在，downgrade 可回退，model 与迁移声明一致无 autogenerate drift'
  - '构造主控→分身→孙三层树后 mission_worker_sessions_tree 返回分身+孙全树且不含主控行；无孙时与 mission_worker_sessions 一层结果逐行等价（FR-08 零回归）'
  - '构造 parent 成环或指向不存在行的脏数据时 CTE 去重截断不死循环不重复行；深度超过 MAX_TREE_DEPTH 的脏链被截断'
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_agent_session_model.py app/modules/agent/tests/test_mission_session_id.py
  - cd backend && uv run ruff check app/modules/agent/model.py && uv run mypy app/modules/agent/model.py
related_tests:
  - path: backend/app/modules/agent/tests/test_agent_session_model.py
    reason: 严格字段集断言（P1 后 25 字段），加列必然失效，机械更新
  - path: backend/app/modules/agent/tests/test_mission_session_id.py
    reason: 同上（字段清单断言）
constraints:
  - '迁移数据回填是硬要求（Grill B1）——NOT NULL 保证迁移后无 NULL，不写任何「NULL 按 1 计」运行时兜底规则'
  - '不动 mission_worker_sessions 一层语义与 resolve_mission_for_session 环检测逻辑；不动 AgentMission 表（budget_force_ended_at 标记走 constraints JSON，无新列）'
  - '递归 CTE 需双方言可测（SQLite 测试方言 + PG 生产）；全树枚举不做 status/deleted 过滤，过滤语义归调用方（P1 口径）'
  - 'MAX_DISPATCH_DEPTH 派发门常量不在本卡定义（归 task-02 消费）；新枚举单测随断言机械更新落在两个既有字段测试文件，不另建新测试文件'
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
