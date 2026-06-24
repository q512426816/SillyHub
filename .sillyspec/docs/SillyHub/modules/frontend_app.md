---
schema_version: 1
doc_type: module-card
module_id: frontend_app
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# frontend_app

## 定位
SillyHub 前端的 Next.js 14 App Router 页面路由层。定义所有页面与布局结构，用 RSC + Client Component 混合模式。是产品功能的「页面骨架」：按路由组 `(auth)` / `(dashboard)` 组织，dashboard 下承载 workspaces / settings / runtimes / admin / ppm 五大产品域页面，每页组合 frontend_lib 取数 + frontend_components 渲染。

产品视角：这是用户接触 SillyHub 的入口。登录后进入 dashboard，左侧导航按产品域分组（主平台 vs ppm 隔离），主区渲染对应页面。workspaces 是核心（详情页聚合 spec/变更/任务/agent/审批/审计），runtimes 管理 daemon 会话，settings/admin 是运维台，ppm 是独立项目管理系统。布局层做认证守卫，未登录跳登录页。

## 契约摘要
- 路由组：
  - `(auth)/login` 登录页（无认证守卫）
  - `(dashboard)/{workspaces,settings,runtimes,admin,ppm}` 五大产品域
  - `api/` Next.js route handler（agent 日志 SSE / quick-chat SSE 透传，60s 回退 GET 兜底）
- workspaces 子路由：列表 / `[id]` 详情 / scan-docs / components / topology / changes / create-change / changes/`[cid]` / tasks / `[tid]` / agent / approvals / audit / runtime / incidents / knowledge / releases
- 布局：`layout.tsx`（RootLayout，Server Component，lang=zh-CN + 全局 CSS + AntdProviders + metadata）→ `(dashboard)/layout.tsx`（Client Component，认证守卫 + AppShell）
- 页面动态路由：`[id]` / `[cid]` / `[tid]` / `[iid]`
- 依赖：`frontend_components`（AppShell 等）、`frontend_lib`（取数）、`frontend_stores`（useSession）
- 跨组件协作：每页组合 lib 取数 + components 渲染；runtimes 卡片管理 daemon 会话；ppm 作为独立入口 redirect 到 /ppm/projects

## 关键逻辑
认证守卫（`(dashboard)/layout.tsx`）：
```
const { hydrated, accessToken } = useSession()
if (!hydrated) return null              // 等 persist rehydrate 避免闪烁
if (!accessToken) router.replace("/login")
return <AppShell>{children}</AppShell>
```
- 页面内调 `lib/*` 取数 → 组合 components 渲染
- ppm 与主平台菜单隔离：AppShell 按 `usePathname()` 过滤 section
- 列表页统一模式：PageContainer size=full + PageHeader + SectionCard + grid-cols-4 查询条件 + antd Table（bordered/scroll y calc(100vh-430px)/showTotal/showSizeChanger）+ 服务端分页 + searchNonce 兜底搜索
- 导出 Excel 走 lib downloadExcel（含 401 自动刷新）

### 页面模式约定
dashboard 页面遵循统一模式：
- 容器：PageContainer size=full + PageHeader + SectionCard(bodyPadding=p-2)
- 查询：grid-cols-4 垂直 Field，选择型 onChange 即查、文本型回车提交，searchNonce 兜底
- 表格：antd Table bordered + scroll y calc(100vh-430px) + showTotal + showSizeChanger，服务端分页
- 按钮：顶部右对齐 ui Button（搜索 primary/重置 outline/分隔/导出 outline/新建 primary）
- 操作列：width 具体数字或 max-content + whitespace-nowrap + fixed=right

## 注意事项
- `(dashboard)/layout.tsx` 在 `hydrated===false` 返回 null，等待 Zustand persist rehydrate
- 根布局用 `suppressHydrationWarning` 避免暗色模式 class 水合警告
- ppm 作为独立入口，`/ppm/page.tsx` redirect 到 `/ppm/projects`
- SSE 流式接口（agent 日志 / quick-chat）经 `api/` route handler 透传后端避免缓冲
- metadata title 为 "Multi-Agent Platform"
- ppm 列表页统一默认查 20 条，page_size 上限 200 对齐后端
- 查询条件文本输入型走 commitSearch/回车，选择型 onChange 即查（searchNonce 同帧合并）
- 前端样式系统统一：Design Token 主色 #2563EB + antd ConfigProvider + shadcn 视觉组件 + 共享布局
- runtimes 快速对话改用 SSE 流式（EventSource 订阅）
- workspaces/[id] 详情页含上一次 Bootstrap 运行结果摘要
- 变更详情页文档实时刷新 + Gate 面板突出显示
- agent 控制台日志区无 max-width 限制撑满主区
- 页面动态路由 [id]/[cid]/[tid]/[iid] 经 useWorkspaceId 等 hook 取参
- api/ route handler 透传 SSE，60s 回退 GET 兜底防连接断开
- workspaces/[id] 含 Bootstrap 日志区（复用 AgentLogViewer 深色样式）
- 变更列表 human_gate 状态列 + draft 兜底 + 类型颜色映射 + 影响组件标签
- 用户/角色管理表格用 antd Table（columns + showSizeChanger + pageSizeOptions）
- work-hour-statistics 聚合表+明细表 pagination 默认 20 条
- plan-nodes 模板树形展开 pagination=false，无查询条件
- milestone-details 主表 scroll 去 y 仅留 x，避免展开子表被切割
- 页面统一 Design Token 主色 #2563EB，Inter 字体
- RootLayout 设 lang=zh-CN + suppressHydrationWarning
- DashboardLayout 用 useSession 做 SSR 安全的客户端守卫
- api/ route handler 透传后端 SSE，避免 Next.js 缓冲
- ppm/problem-list/problem-changes/task-plans 等列表页统一服务端分页模式
- runtimes 页卡片含移除/会话按钮 + 运行环境信息
- 登录页与主平台同色系（主色 #2563EB）
- 页面取数在 Client Component 内 useEffect 或事件回调触发
- antd Table 服务端分页 onChange 重查并回到对应页
- 查询按钮点击即使条件未变也触发查询（searchNonce 兜底）
- kanban 看板主体改为时间轴甘特图(自研 KanbanGantt/KanbanActualGantt + kanban-gantt-helpers 纯函数+14单测),纵轴人员多行泳道(贪心)+横轴日期+任务条形绝对定位(start→deadline/actual_start→end)+今天竖线/周末高亮,只读+点击详情,计划/实际两 tab;删除旧 KanbanMatrix/KanbanActualMatrix/kanban-actual-cell
- kanban 外壳对齐 project-plans:PageContainer size=full h-full(px-6 py-6 边距)+PageHeader+SectionCard p-2(查询区);KanbanSearchBar 改 grid-cols-4 垂直 Field + 顶部按钮右对齐

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
