---
id: task-07
title: '新端点 GET /workspaces/{wid}/quicklog-entries/{ql_id}/sessions'
title_zh: '新端点 GET /workspaces/{wid}/quicklog-entries/{ql_id}/sessions'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_quicklog_sessions_api.py
expects_from:
  - 'task-03 contract SessionTitleHelper needs [session_ids, titles]——首条 user_input 标题 window-function 提取共享 helper（实际落点 router.py _fetch_session_titles(db, session_ids)，无 workspace_id 死参数），本端点与 list_change_sessions 同源复用（X-013）'
  - 'task-01 contract QuicklogSessionLink needs [workspace_id, ql_id, session_id]——自然键多对多绑定表 ORM（无 FK 到 quicklog_entries，D-001），本端点数据源'
provides:
  - contract: QuicklogSessionsEndpoint
    fields:
      - items
goal: >
  新端点 GET /api/workspaces/{workspace_id}/quicklog-entries/{ql_id}/sessions
  （FR-04 数据源）——读 quicklog_session_links JOIN agent_sessions（软删过滤、
  last_active_at 倒序），复用 task-03 标题共享 helper 与既有 AgentSessionListItem
  响应 schema，跨成员可见；为快速修复抽屉会话卡与门户路由（W4/W5）提供数据面。
implementation:
  - 'change/router.py 新增 list_quicklog_sessions 路由——quicklog-entries 单条下的 sessions 子列表（路径参数 workspace_id 与 ql_id），response_model 为 AgentSessionListItem 列表，require_permission(Permission.CHANGE_READ) 门控对齐 list_change_sessions 与 quicklog 既有端点'
  - '查询——按 workspace_id 与 ql_id 匹配 QuicklogSessionLink，JOIN agent_sessions 过滤 deleted_at 为空，会话按 last_active_at 倒序；无绑定时返回空列表不 404（快速修复先无会话是常态）'
  - '组装与变更侧同构——作者展示名批量查 User；标题经 task-03 的 SessionTitleHelper（workspace_id 加 session_ids 产出 titles 映射）同源复用（X-013 禁止复制 window-function 代码），条目取标题前 30 字'
  - '跨成员可见——不加 user_id 过滤（对齐 list_change_sessions 现状——列表跨成员、stream owner-only 不变）'
  - '若共享 helper 需 service 层承载则落 change/service.py（以 task-03 实际落点为准，两端点共用同一 helper 为硬要求）'
  - '新建 test_quicklog_sessions_api.py——绑定命中返回列表（含 title 与 author 展示名）；无绑定空列表；软删会话过滤；跨 workspace 隔离；跨成员可见（非 owner 成员可读）'
acceptance:
  - '预置 workspace 加 ql_id 加 session 的绑定行后，端点返回该会话的 AgentSessionListItem，按 last_active_at 倒序，title 为首条 user_input 前 30 字、author 含展示名'
  - '软删会话不出现在结果；无绑定 ql_id 返回空数组；其他 workspace 的绑定行不可见'
  - '任一具备 CHANGE_READ 权限的成员（非会话 owner）可读该列表（跨成员可见）'
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_sessions_api.py -q
constraints:
  - 'change/router.py 与 task-03 同文件但分属 W3 / W2 两 Wave 允许——本卡只追加新端点，不改 list_change_sessions 本体（改读 links 归 task-03）'
  - '禁止新建标题查询——必须复用 task-03 提取的 SessionTitleHelper（X-013 同源）；响应复用 AgentSessionListItem 不新建 DTO'
  - '不加分页 / 搜索参数（对齐变更侧 sessions 端点形态）；不动 quicklog-entries 既有列表 / 详情端点与 QuicklogQueryService'
  - 'openapi.json 与前端 api-types.ts 再生成归 task-09，本卡不跑 gen:types'
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
