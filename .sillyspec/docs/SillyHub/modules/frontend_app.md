---
schema_version: 1
doc_type: module-card
module_id: frontend_app
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 前端页面路由层（frontend_app）

## 定位
SillyHub 前端的 Next.js App Router 页面路由层（frontend/src/app/** + middleware.ts）。只做「路由骨架 + 布局守卫 + SSE 透传」，业务取数下沉 frontend_lib、可复用 UI 下沉 frontend_components。产品视角是用户入口：登录 → dashboard，桌面与移动（/m/）双形态，服务端按 UA 自动分流。

## 契约摘要
- 根级装配：`layout.tsx`（RootLayout，lang=zh-CN + suppressHydrationWarning + 全局 CSS + AntdProviders + AppProviders）、`error.tsx` / `global-error.tsx` / `loading.tsx`、首页 `page.tsx`。
- 桌面路由组：
  - `(auth)/login` — 登录页（无 dashboard 守卫）
  - `(dashboard)/workspaces` — 工作区列表（选择器页）+ `[id]` 详情（列表带类型徽标+词表筛选/未分类；
    详情含 type/role/description 基本信息编辑区，2026-08-18-workspace-role-type）
  - `(dashboard)/runtimes` — daemon 运行时管理（列表 + `[id]` 详情/审计）
  - `(dashboard)/sessions` — 智能体会话总入口（平台级跨工作区，两栏布局；2026-08-19-session-stream-ux：SSE 走装配器 + 头部子代理目录 + viewMode「进度」视图）
  - `(dashboard)/agent-profiles` — 智能体档案全局页（跨工作区聚合，独立一级菜单）
  - `(dashboard)/settings` / `admin` / `account` / `ppm` — 设置 / 管理台 / 个人中心 / 独立项目管理系统（/ppm redirect 到 /ppm/projects）
- `workspaces/[id]/` 嵌套布局（含 layout.tsx + error.tsx），子路由按域分组：
  - 执行与产物：`agent`（agent 控制台）、`missions`、`runtime`（阶段进度/产出物）、`sessions`
  - 变更域：`changes`（列表+详情）、`approvals`、`audit`
  - spec 域：`components`、`scan-docs`、`knowledge`、`skills`
  - 平台配置：`agent-profiles`、`members`、`mcp`、`mcp-tokens`、`files`、`incidents`、`releases`
- 移动端 `m/`：`login` / `account` / `workspaces`（列表）
  （workspaces 筛选换词表+未分类、创建提交体补 type:other，最小收口）
  - `ppm/{workbench, project-plans, milestone-details, task-plans, problem-list}` — ppm 移动五页。
- `app/api/` 三个 SSE 透传 route handler（防 Next.js 代理缓冲）：
  - `api/daemon/sessions/[sessionId]/stream` — 交互会话事件流
  - `api/daemon-chat/[runId]/stream` — quick-chat 流
  - `api/workspaces/[workspaceId]/agent/runs/[runId]/stream` — workspace 维度 agent run 日志流
- `middleware.ts`：移动设备分流——轻量 UA 正则判「手机」，服务端 rewrite 到 /m/（地址栏 URL 不变、无首屏 FOUC）。

## 关键逻辑
`(dashboard)/layout.tsx` 三层客户端守卫：
```
1. 登录守卫: !hydrated → return null（等 persist rehydrate）；
   !accessToken → replace("/login")
2. fetchMe() best-effort（失败静默，交由后续 API 调用处理）
3. 工作区守卫（CB-3 顺序不能反）:
   先判 /^\/workspaces\/[^/]+/（有 wsId 一律放行）
   → 再判 WORKSPACE_WHITELIST 前缀（/workspaces /admin /settings
     /ppm /runtimes /account /agent-profiles /sessions，精确或带 / 前缀）
   → 其余依赖工作区但无 wsId → replace("/workspaces")
```
middleware 移动分流（纯函数，不读 cookie）：
```
UA 空/异常 → false（默认桌面）→ 先排平板（明文 ipad / Android 无 Mobile）
→ 再匹手机（iphone / android+mobile / windows phone / blackberry）
仅 /ppm/*、/workspaces/*、/login 命中 rewrite；matcher 天然排除 /api、/_next、静态资源
```
sessions 页（会话总入口）数据流：
```
左栏 SessionListPanel（筛选+虚拟滚动+紧凑两行条目）
右两态: 未选 = NewSessionForm（四选择器）；选中 = TurnTimeline
  + SessionInputBar + CtxUsageBar + SessionConfigBar
历史 turn = 预取 getAgentSessionLogs → logsToTurns（防 SSE 订阅前丢事件）
实时 turn = streamSession 单条 SSE（turn_started/log/turn_completed/tokens/
  session_ended/permission_*）；发送 = injectSession
whoLine: attach 时并发拉 listSessionRuns，按 realRunId??runId 匹配注入
  profileName/providerName/agentName（llm_provider_id null = 本机默认）
```

## 注意事项
- 工作区守卫顺序不能反：`/workspaces/xxx` 若先被 `/workspaces` 白名单前缀吞掉会重定向循环（代码注释明确 CB-3）。
- 新增平台级路由必须同步 `WORKSPACE_WHITELIST`——/agent-profiles、/sessions 都是事后补的（部署实测被守卫踢回选择器才发现）。
- 平板（iPad/Android Tablet）一律走桌面；iPadOS 13+ 伪装 Macintosh 的 UA 无法可靠识别，只按明文 ipad 排除。
- SSE route handler 是唯一合法流式出口，页面直连后端会被 Next 代理缓冲；三个 stream handler 均带鉴权（token 走 header，fetch-sse 实现）。
- URL 是工作区上下文真相源：`[id]` 页经 hooks 取参，不依赖 store 持久值（store 仅缓存）。
- 页面样式遵循 FRONTEND_PAGE_STYLE.md：PageContainer size=full + PageHeader + antd Table 服务端分页（bordered / scroll y calc(100vh-Npx) / showTotal / showSizeChanger）+ 查询区 grid-cols-4。
- 移动页与桌面页是两套路由（m/ 镜像子集），新增桌面页若需移动形态要同步建 m/ 页 + middleware 白名单确认覆盖。
- (dashboard)/layout 在 hydrated===false / 无 token 时 return null，避免守卫闪烁。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 变更索引

- ql-20260820-006-9e18 | 「我的供应商」页移除启动/停止（set-default）功能——供应商生效改 /sessions 会话级选择，本页纯 CRUD（后端端点保留待后续清理）
- ql-20260819-002-9167 | /sessions 页移除「结束会话」按钮（结束走自然超时；runtimes 弹窗入口保留；已结束横幅/重新开启保留）
