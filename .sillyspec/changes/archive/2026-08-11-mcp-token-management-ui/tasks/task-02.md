---
id: task-02
title: MCP tokens management page full (body + 403 empty + revoke + dialog wiring)
title_zh: McpToken 管理主页完整实现（主体 + 403 无权限空态 + 吊销交互 + 签发弹窗接入）
author: qinyi
created_at: 2026-08-11 15:08:00
priority: P0
depends_on: [task-01, task-03]
blocks: [task-08]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx
expects_from:
  task-01:
    needs: [listMcpTokens, revokeMcpToken, McpTokenRead]
  task-03:
    needs: [McpTokenCreateDialog]
goal: >
  新增 mcp-tokens 管理主页完整实现：复刻 settings/api-keys 结构（PageHeader 加 3 StatCard 加 SectionCard 表格加 EmptyState，
  手写 useState 与 useEffect 加载），加 GET 403 无权限空态兜底、吊销二次确认、签发弹窗接入。
  合并自原 task-02/03/04/06（同改 page.tsx，须单 task 串行避免 execute 并行覆盖）。覆盖 FR-01/02/03/05/06 与 D-001@v1。
implementation:
  - 从 @/lib/mcp-tokens 引入 listMcpTokens 与 revokeMcpToken 与 McpTokenRead，workspaceId 取自路由动态参数 id
  - 复刻 api-keys load 模式，useState 维护 tokens 与 loading 与 pageError，useEffect 初次拉取 listMcpTokens(workspaceId)
  - 内联复制 api-keys 的 StatCard 本地组件（非 @/components/layout 共享），渲染全部与活跃与已吊销三张卡
  - SectionCard 表格列名称附 id 尾号、scope 徽章、状态（revoked_at 存在则已吊销否则活跃）、最近使用、创建时间、吊销操作
  - 捕获 listMcpTokens 抛 403 渲染无权限空态，不泄漏 token 存在性（D-001@v1）
  - 未吊销行吊销按钮 confirm 二次确认后调 revokeMcpToken 再刷新 load
  - 引入 McpTokenCreateDialog（task-05），签发按钮触发显示并传 workspaceId，onCreated 回调刷新列表
acceptance:
  - 首次挂载调 listMcpTokens(workspaceId) 渲染表格，三张 StatCard 数值随 tokens 变化
  - GET 403 渲染无权限空态且不显示任何 token 信息
  - 吊销二次确认成功后该行标已吊销，已吊销行无吊销按钮
  - 签发按钮打开弹窗，提交成功后明文在弹窗内展示并刷新列表
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- mcp-tokens
constraints:
  - StatCard 从 api-keys 页内联复制，该组件是 api-keys 本地组件非 @/components/layout 共享
  - 手写 useState 与 useEffect 加载，不用 react-query，与 api-keys 页一致
  - D-001@v1 tab 全可见，viewer 由 GET 403 兜底，前端不预判权限隐藏内容
  - 状态判定仅看 revoked_at（无 expires 概念），brownfield 兼容已存在数据
---
