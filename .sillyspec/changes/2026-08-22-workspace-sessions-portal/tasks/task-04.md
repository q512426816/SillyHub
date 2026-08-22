---
id: task-04
title: add-scope-to-session-list-panel
title_zh: 会话列表面板 scope 化
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: []
blocks: [task-01]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
provides: [{contract: list-panel-scope, fields: [scope-workspace-change-switch, author-self-filter, local-search-only-in-scope]}]
goal: >
  给 SessionListPanel 增加可选 scope 判别联合入参，workspace/change 级把列表数据源切为整列单页并按作者仅本人过滤、隐藏服务端筛选保留本地标题搜索、瘦字段降级渲染，缺省全局真分页路径零变化
implementation:
  - 在本文件定义并导出 scope 判别联合类型（workspace 形态含 workspaceId，change 形态含 workspaceId 与 changeId），供 task-01 的 sessions-portal 复用
  - props 增加可选 scope；缺省分支零变化（listAgentSessions + serverParams 真分页、queryKey、加载更多全部现状保留）
  - scope 时 queryFn 按 kind 切换，workspace 调 listWorkspaceAgentSessions 且 include_ended 传 true，change 调 listChangeSessions；整列返回值合成单页喂 useInfiniteQuery，getNextPageParam 恒返回 undefined，加载更多按钮隐藏
  - scope 模式客户端按 AgentSessionListItem.author 过滤仅本人，语义沿用旧 workspace-session-section 的 useSession 取 currentUserId 且 author 缺失视为本人保留
  - scope 模式隐藏服务端筛选条三控件（状态/机器/引擎），保留本地标题搜索做客户端过滤；全局模式筛选条现状零动
  - 瘦字段降级，SessionRow 对缺失的 runtime_id/config_snapshot/workspace_id 跳过对应 chips 渲染，时间列回退 last_active_at 相对时间
  - onDeleteSessions 语义不动，仍由父层 props 接管（软删后按 scope invalidate 归 task-01 门户）
acceptance:
  - 全局缺省模式行为零变化，session-list-panel.test.tsx 现有用例全绿
  - scope 三用例（对应 API 调用/仅本人过滤/筛选条隐藏搜索保留）由 task-08 补，本任务先手跑组件现有测试保绿
  - pnpm exec tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动全局缺省路径的真分页行为与 queryKey 结构
  - 不做服务端筛选语义扩展（D-003@v1 定案 scope 模式客户端过滤），不改删除链语义
  - 不新增/改动测试文件（scope 用例归 task-08）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
