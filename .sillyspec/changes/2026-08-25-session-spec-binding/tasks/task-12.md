---
id: task-12
title: 'quicklog 抽屉关联会话卡（含既有 drawer 测试更新；门户路由集成由 task-13 走查）'
title_zh: 'quicklog 抽屉关联会话卡（含既有 drawer 测试更新；门户路由集成由 task-13 走查）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P1
depends_on: ['task-07', 'task-09']
blocks: []
requirement_ids: [FR-04, D-006@v1]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/changes/quicklog-sessions-card.tsx
  - frontend/src/components/changes/quicklog-drawer.tsx
  - frontend/src/components/changes/__tests__/quicklog-sessions-card.test.tsx
  - frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx
expects_from:
  - 'task-09 contract ListQuicklogSessions needs [workspaceId, qlId]——抽屉关联会话卡数据源（快速修复级会话列表端点的客户端封装，返回 AgentSessionListItem 列表，task-07 服务端供数）'
goal: >
  FR-04 快速修复侧展示——新建 QuicklogSessionsCard 镜像变更会话卡先例
  （detail/change-sessions-card.tsx）：listQuicklogSessions 取数、客户端仅
  本人过滤、last_active_at 倒序前 3 条预览、条目深链快速修复门户选中态、
  卡尾「打开会话工作台」入口；挂载进 quicklog-drawer 详情底部——快速修复
  详情从此有会话入口（前端零会话 UI 的空白补齐）。
implementation:
  - '新建 quicklog-sessions-card.tsx——props 为 workspaceId 加 qlId；useQuery 调 listQuicklogSessions（queryKey 为 agentSessions 前缀加 quicklogSessionsCard 加双 id，门户前缀失效 invalidate 全覆盖）'
  - '过滤与排序——客户端仅本人过滤（author 缺失视为本人保留，同变更卡口径）后 last_active_at 倒序取前 3 条；条目渲染 id 短码（井号加 slice 前 8 位）、状态中文（SESSION_STATUS_LABELS 五态同口径）、相对时间（复用 session-list-panel 导出的 formatRelativeTime）'
  - '条目深链——每条 Link 到快速修复门户路由并带 session 参数（encodeURIComponent 编码）；卡尾「打开会话工作台」Link 同路由不带参（buttonVariants outline sm 同变更卡）'
  - '空态与加载态对齐变更卡——加载中文案、空态提示暂无本人会话可打开工作台新建'
  - 'quicklog-drawer.tsx 挂载——结构化视图底部（关联变更 section 之后）渲染 QuicklogSessionsCard（workspaceId 用 props、qlId 用 entry.ql_id）；原始 md 切换视图不渲染（对齐既有 section 门控）'
  - '新建 quicklog-sessions-card.test.tsx——渲染（本人过滤/倒序前 3）、深链 href 断言、空态文案、加载态；mock 范式照 quicklog-drawer.test（importActual 部分 mock 加 QueryClientProvider）'
  - '既有 quicklog-drawer.test.tsx 更新——mock listQuicklogSessions，补卡片挂载断言（结构化视图出现、原始 md 视图不出现）'
acceptance:
  - '抽屉打开条目后底部渲染关联会话卡——仅本人会话、last_active_at 倒序前 3 条、条目点击深链快速修复门户选中态'
  - '无绑定或无本人会话时空态文案降级不报错；卡尾按钮进入快速修复门户路由'
  - '既有抽屉用例（四段正文/原始 md 切换/降级/错误态）更新后全绿'
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- --run src/components/changes
constraints:
  - '卡片只做预览与跳转不做新建（新建入口在门户组头，归 task-10）；与 task-10 门户路由的运行时集成（深链可达性）由 task-13 走查覆盖，同 Wave 无构建依赖'
  - '仅本人过滤在客户端（端点跨成员可见，同变更卡口径——他人会话 attach 必 404，展示只会误导点击）；复用 AgentSessionListItem 不新建 DTO'
  - 'quicklog-drawer.tsx 仅追加挂载与 import——四段正文/原始 md/关联变更既有结构不动'
related_tests:
  - path: frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx
    reason: 抽屉挂载新卡后既有用例需 mock listQuicklogSessions 并补挂载断言（结构化视图出现、原始 md 视图不出现）
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
