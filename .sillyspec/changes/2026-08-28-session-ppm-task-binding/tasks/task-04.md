---
id: task-04
title: 'Frontend API layer — gen:types regen + daemon.ts param passthrough + listItemSessions (W3, depends_on: task-02)'
title_zh: '前端 API 层——gen:types + lib/daemon.ts 参数透传 + listItemSessions（W3, depends_on: task-02）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  FR-01/FR-05 前端 API 层：task-01/02 后端 ppm 绑定 schema 落地后，用 pnpm gen:types
  重生成 api-types.ts（禁止手写），lib/daemon.ts 的 createSession/injectSession/
  listAgentSessions 三处透传新参数并新增 listItemSessions(kind, itemId)，为
  task-05/06 组件接线提供类型与调用契约。
implementation:
  - '前置自检 node_modules 健康（CLAUDE.md 规则 21）：frontend 目录 pnpm exec tsc --version 能跑、node_modules/.bin 有 openapi-typescript shim；半坏先 pnpm install --force 修复——半坏会报一堆假的 CSSProperties/模块缺失错误，避免误判成代码问题'
  - 'cd frontend && pnpm gen:types：脚本自带后端 openapi dump（在 backend 目录 uv run python scripts/dump_openapi.py 刷 backend/openapi.json，无需单独起后端服务）+ openapi-typescript 再生成 src/lib/api-types.ts；确认产物含 SessionCreateRequest.ppm_item_kind/ppm_item_id、SessionInjectRequest.bind_ppm_item_kind/bind_ppm_item_id、GET /api/daemon/sessions query 参数与 GET /api/ppm/item-sessions 端点类型'
  - 'lib/daemon.ts createSession：透传 ppm_item_kind/ppm_item_id（有值才带，对齐 quicklog_id 先例；kind+id 成对上送）'
  - 'lib/daemon.ts injectSession：SessionInjectOptions 透传 bind_ppm_item_kind/bind_ppm_item_id（有值才带，对齐 bind_change_key/bind_quick_id 先例）'
  - 'lib/daemon.ts listAgentSessions：AgentSessionListParams 新增 ppm_item_kind/ppm_item_id 过滤参（真值才下发，对齐 ql_id 先例）'
  - 'lib/daemon.ts 新增 listItemSessions(kind, itemId)：调 GET /api/ppm/item-sessions?kind=&item_id=，返回类型与 listChangeSessions 的 AgentSessionListItem[] 同构（design §5 Phase 1 响应同构）'
  - 'gen:types/tsc 暴露的与本次无关旧测试债（mock 缺字段等）按惯例顺手补字段修好，不为躲报错改回手写（CLAUDE.md 规则 21）'
acceptance:
  - 'pnpm gen:types 重跑后 git diff --stat src/lib/api-types.ts 有增量；再跑一次无 diff 残留（api-types.ts 与 backend/openapi.json 一致）'
  - 'api-types.ts 含 SessionCreateRequest.ppm_item_kind/ppm_item_id、SessionInjectRequest.bind_ppm_item_kind/bind_ppm_item_id、sessions 列表 query 与 /api/ppm/item-sessions 的生成类型；backend/openapi.json 与 api-types.ts 同变更提交'
  - 'createSession/injectSession/listAgentSessions 三处新参数透传（有值才带、缺省零回归，不改既有 payload 形态）'
  - 'listItemSessions(kind, itemId) 可调用且返回类型可供 task-05 关联会话卡片直接消费'
  - 'cd frontend && pnpm exec tsc --noEmit 通过'
verify:
  - 'cd frontend && pnpm gen:types && git diff --stat src/lib/api-types.ts（须有增量）'
  - 'cd frontend && pnpm exec tsc --noEmit'
constraints:
  - 'api-types.ts 禁止手写，必须由 gen:types 生成（CLAUDE.md 规则 21）'
  - 'backend/openapi.json 必须与 api-types.ts 同变更提交，不让类型落后后端形成债'
  - '先确认 node_modules 健康再排错（pnpm exec tsc --version 能跑；半坏 pnpm install --force）'
  - '不改组件层接线（session-panel/入口/mention 归 task-05/06）；本 task 不动后端代码（仅消费 task-01/02 已交付 schema）'
  - '无关旧测试债顺手补字段修复，不缩小断言躲报错'
provides:
  - contract: createSession ppm 参数
    fields: [ppm_item_kind, ppm_item_id]
  - contract: injectSession bind 参数
    fields: [bind_ppm_item_kind, bind_ppm_item_id]
  - contract: listAgentSessions ppm 筛选
    fields: [ppm_item_kind, ppm_item_id]
  - contract: listItemSessions
    fields: [kind, itemId]
expects_from:
  task-02:
    - contract: daemon_sessions_ppm_schema
      needs: [SessionCreateRequest.ppm_item_kind/ppm_item_id, SessionInjectRequest.bind_ppm_item_kind/bind_ppm_item_id, GET /api/daemon/sessions query ppm_item_kind/ppm_item_id]
  task-01:
    - contract: "GET /api/ppm/item-sessions"
      needs: [kind, item_id]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
