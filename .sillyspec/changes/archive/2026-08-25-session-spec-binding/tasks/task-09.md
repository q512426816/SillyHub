---
id: task-09
title: 'pnpm gen:types + lib/daemon.ts API 客户端扩展（ql_id 筛选/quicklog_id 创建/listQuicklogSessions + 客户端测试）'
title_zh: 'pnpm gen:types + lib/daemon.ts API 客户端扩展（ql_id 筛选/quicklog_id 创建/listQuicklogSessions + 客户端测试）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-04', 'task-07', 'task-08']
blocks: [task-10, task-11, task-12]
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon.test.ts
expects_from:
  - 'task-04 contract AgentSessionsQueryParams needs [ql_id]——GET /api/daemon/sessions 新增 ql_id 查询参（quicklog links M:N 子查询命中），本卡 listAgentSessions 透传 ql_id 的服务端落点'
  - 'task-07 contract QuicklogSessionsEndpoint needs [items]——GET quicklog-entries 单条下 sessions 子列表端点返回 AgentSessionListItem 数组，本卡 listQuicklogSessions 的数据源'
  - 'task-08 contract SessionCreateRequest needs [quicklog_id]——创建会话请求可选 quicklog_id 短码字段（创建即落绑定），本卡 createSession 透传的后端落点'
provides:
  - contract: ListAgentSessionsOptions
    fields: [ql_id]
  - contract: CreateSessionInput
    fields: [quicklog_id]
  - contract: ListQuicklogSessions
    fields: [workspaceId, qlId]
goal: >
  W4 前后端契约分界卡——先 pnpm gen:types 把 W3 全部 schema 变更（task-04
  ql_id 查询参、task-07 新端点、task-08 quicklog_id 字段）再生成为
  api-types.ts 加 backend/openapi.json，再扩展 lib/daemon.ts 客户端三入口
  （FR-04/05/06 前端数据面）：listAgentSessions 加 ql_id 透传、createSession
  加 quicklog_id、新增 listQuicklogSessions——为 W5 三张前端卡提供唯一客户端
  封装（客户端层独立成卡避免前端并行冲突）。
implementation:
  - '前置健康检查与类型再生成——cd frontend 后先 pnpm exec tsc --version 确认 node_modules 健康（CLAUDE.md 规则 21，异常先 pnpm install --force 修复），再 pnpm gen:types 重新生成 api-types.ts 并同步 backend/openapi.json（覆盖 W3 全部 schema 变更，禁止手写类型）'
  - 'daemon.ts AgentSessionListParams 加 ql_id 可选字段（按快速修复短码过滤，走 quicklog links M:N 命中），listAgentSessions 组装段照 change_id 既有模式真值才下发 query.ql_id，缺省零回归'
  - 'daemon.ts createSession body 组装段（L855-883）补 input.quicklog_id 条件展开——有值才带进请求体（对齐 change_id 既有形态），input 参数类型补 quicklog_id 可选字段'
  - 'daemon.ts 新增 listQuicklogSessions(workspaceId, qlId)——请求 GET /api/workspaces 下 quicklog-entries 与 sessions 子资源路径（workspaceId 与 qlId 各自 encodeURIComponent），返回既有 AgentSessionListItem 数组（与变更级端点同源 schema，挂 2026-08-25 变更来源注释）'
  - 'daemon.test.ts 客户端测试更新——listAgentSessions 带 ql_id 断言 query 含 ql_id 且缺省不带；createSession 带 quicklog_id 断言请求体含该字段且缺省不含；listQuicklogSessions 断言请求 URL 路径含 workspaceId 与 qlId 双段编码'
acceptance:
  - 'pnpm gen:types 后 api-types.ts 与 backend/openapi.json 含 ql_id 查询参、quicklog_id 请求字段与 quicklog sessions 端点，零手写漂移'
  - 'listAgentSessions 传 ql_id 时请求 query 带 ql_id、不传零回归；createSession 传 quicklog_id 时请求体带该字段、不传零回归'
  - 'listQuicklogSessions 按 workspaceId 加 qlId 请求新端点返回 AgentSessionListItem 列表——task-10/11/12 的唯一数据面入口'
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- --run src/lib
constraints:
  - 'W3 与 W5 的分界卡——只动 lib/daemon.ts 与生成物，不动组件/store/路由（QuicklogScope 门户归 task-10、preContext 归 task-11、抽屉卡归 task-12）'
  - 'api-types.ts 只经 pnpm gen:types 生成禁止手改（CLAUDE.md 规则 21）；gen:types 暴露的无关旧测试债按惯例顺手补齐，不为躲报错回退手写'
  - 'ql_id 与 quicklog_id 均为短码字符串不做 UUID 与存在性校验（D-001 自然键，条目行允许后到）；客户端纯透传不加业务过滤（命中集全在服务端）'
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
