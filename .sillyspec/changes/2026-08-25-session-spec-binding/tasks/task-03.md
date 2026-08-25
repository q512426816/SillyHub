---
id: task-03
title: 'list_change_sessions 改读 links + 标题共享 helper'
title_zh: 'list_change_sessions 改读 links + 标题共享 helper'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-01']
blocks: [task-07]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/daemon/tests/test_change_session.py
provides:
  - contract: SessionTitleHelper
    fields: [workspace_id, session_ids, titles]
goal: >
  list_change_sessions（change/router.py L310）数据源从 AgentSession.change_id 单 FK 切换为
  change_session_links M:N 绑定（FR-03 / D-002@v1，存量单 FK 由 task-01 播种保证不丢），并把
  窗口函数标题提取提为共享 helper 供 task-07 快速修复会话端点同源复用（X-013）。
implementation:
  - list_change_sessions 第 1 步查询改为 change_session_links JOIN agent_sessions
    （deleted_at IS NULL，取 link 命中的全部会话），不再按 AgentSession.change_id 单 FK 过滤
  - 标题提取的 ROW_NUMBER 窗口函数逻辑（L355-383 首条 channel=user_input 摘要）提取为共享 helper，
    放 router.py 同文件（本端点与 task-07 新端点两消费方同在此文件，不落 service.py），签名按
    provides 契约 workspace_id 与 session_ids 进、titles 会话到标题映射出
  - 作者批量展示名映射与 last_active_at desc 的 Python 排序保持现状（规避 PG/SQLite 方言差异）；
    响应 schema AgentSessionListItem 与跨成员可见语义不变（ChangeSessionsCard/门户零改动）
  - test_change_session.py 既有 list_change_sessions 断言（L380/411/455/489/528/544/581）改为造
    link 行的数据源，并补仅 link 无单 FK 会话命中、软删会话过滤、播种行命中的 M:N 用例
acceptance:
  - 变更下会话列表返回全部 link 命中会话（含仅 link 无单 FK 的），软删会话不出现
  - 标题（前 30 字）/作者/排序与改造前语义一致（window-function 行为不变）
  - AgentSessionListItem 响应字段零变化（OpenAPI 不漂移）；change 模块与 test_change_session.py 全绿
verify:
  - cd backend && uv run pytest app/modules/change -q
  - cd backend && uv run pytest app/modules/daemon/tests/test_change_session.py -q
constraints:
  - AgentSession.change_id 列继续写入不动（D-002@v1 冻结语义，删列不在本变更）
  - 新端点 GET quicklog-entries/{ql_id}/sessions 的实现归 task-07，本 task 只交付共享 helper
  - 不改审批通知 _notify_bound_session 与 mcp_gateway/tools.py 取最新 link 的消费逻辑（行为不变）
related_tests:
  - path: backend/app/modules/daemon/tests/test_change_session.py
    reason: list_change_sessions 断言依赖单 FK 数据源，切 links 后 setup 需改造成 link 行并补 M:N 用例
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
