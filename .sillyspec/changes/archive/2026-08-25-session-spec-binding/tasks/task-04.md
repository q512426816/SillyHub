---
id: task-04
title: 'daemon sessions 列表筛选升级（change_id→M:N 子查询 + 新增 ql_id）'
title_zh: 'daemon sessions 列表筛选升级（change_id→M:N 子查询 + 新增 ql_id）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-01']
blocks: [task-09, task-10]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_sessions_list_filters.py
provides:
  - contract: AgentSessionsQueryParams
    fields: [ql_id]
goal: >
  GET /api/daemon/sessions（daemon/router.py L2015）的 change_id 筛选从单 FK 精确匹配升级为
  change_session_links M:N 子查询命中，并新增 ql_id 查询参数走 quicklog_session_links 子查询
  （FR-05 / D-002@v1），为前端会话列表关联筛选提供服务端过滤。
implementation:
  - daemon/router.py list_sessions 新增 ql_id 查询参数（str | None 的 inline Query 声明，照
    workspace_id 模式）并透传 service 层
  - daemon/session/service.py list_agent_sessions 的 change_id 分支（L3892 附近）从
    AgentSession.change_id == change_id 改为子查询命中
    AgentSession.id IN (SELECT session_id FROM change_session_links WHERE change_id = 传入值)
  - ql_id 分支同理走 AgentSession.id IN (SELECT session_id FROM quicklog_session_links
    WHERE ql_id = 传入值)，与 workspace_id 等其余筛选 AND 交集组合
  - service 层 docstring 更新 change_id 语义（单 FK 精确扩为 M:N 命中，播种后向后兼容）与 ql_id 说明；
    schema.py 如查询参数声明需同步则一并调整（GET 参数当前在 router 层 inline Query）
  - test_sessions_list_filters.py 更新 change_id 断言（M:N 命中含仅 link 无单 FK 的会话与播种行），
    新增 ql_id 用例（命中/空结果/与 workspace_id 交集）
acceptance:
  - change_id 筛选命中所有 link 关联会话（含仅 link 无单 FK），参数名与类型不变
  - ql_id 筛选命中 quicklog links 关联会话，不传时查询与现状一致（零回归）
  - change_id 与 ql_id 同传取交集，与 status/runtime/provider 等既有筛选组合正确
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sessions_list_filters.py -q
constraints:
  - change_id 参数名与类型不变（语义扩大为向后兼容，design §9，原命中集是新命中集子集）
  - SessionCreateRequest.quicklog_id 与创建落绑定归 task-08，本 task 不动创建链路
  - 不改 GET sessions 既有其余筛选（status/runtime/machine/provider/q/workspace/archived）语义
related_tests:
  - path: backend/app/modules/daemon/tests/test_sessions_list_filters.py
    reason: change_id 筛选断言基于单 FK 语义，M:N 升级后断言与用例 setup 需同步更新
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
