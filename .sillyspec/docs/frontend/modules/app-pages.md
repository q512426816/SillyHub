---
schema_version: 1
doc_type: module-card
module_id: app-pages
author: qinyi
created_at: 2026-06-10T16:55:00
---

# app-pages

## 定位
所有 Next.js App Router 页面组件。负责 UI 渲染和用户交互，是整个前端的视图层入口。不包含业务逻辑——所有数据获取通过 `lib/*` API 客户端完成。

## 契约摘要
- `/` — 首页（健康检查 + 入口链接）
- `/login` — 登录页（表单提交 → lib/auth.login）
- `/workspaces` — 工作空间列表页（扫描、创建、删除）
- `/workspaces/[id]` — 工作空间详情页
- `/workspaces/[id]/changes` — 变更列表页
- `/workspaces/[id]/changes/[cid]` — 变更详情页（含文档查看、阶段流转、人工审批）
- `/workspaces/[id]/changes/[cid]/tasks` — 任务看板页
- `/workspaces/[id]/changes/[cid]/tasks/[tid]` — 任务详情页
- `/workspaces/[id]/agent` — Agent 控制台
- `/workspaces/[id]/components` — 组件列表页
- `/workspaces/[id]/components/topology` — 拓扑图页
- `/workspaces/[id]/scan-docs` — 扫描文档页
- `/workspaces/[id]/runtime` — 运行时进度页
- `/workspaces/[id]/knowledge` — 知识库 & Quicklog 页
- `/workspaces/[id]/releases` — 发布管理页
- `/workspaces/[id]/approvals` — 审批中心页
- `/workspaces/[id]/audit` — 审计日志页
- `/workspaces/[id]/incidents` — 事件列表页
- `/workspaces/[id]/incidents/[iid]` — 事件详情页
- `/workspaces/[id]/create-change` — 创建变更页
- `/settings` — 平台设置页（Settings + Users 管理）
- `/settings/git-identities` — Git 身份管理页
- `/runtimes` — Daemon 运行时页

## 关键逻辑
- 所有页面均为 `"use client"` 组件
- 数据获取模式统一使用 `useEffect` + `useState`（非 SWR/React Query）
- 路由参数通过 Next.js `useParams()` 或路径参数获取
- 错误处理统一使用 `ApiError` 类型区分网络错误和业务错误

## 注意事项
- 页面数量多（23+），维护时注意 lib 层接口变更对页面的影响
- 新增页面需遵循现有的 useEffect + useState 数据获取模式
- workspace 子页面均嵌套在 `(dashboard)` 路由组下，需要 accessToken 才能访问

## 人工备注

<!-- MANUAL_NOTES_START -->

- 2026-06-19-runtimes-layout：`/runtimes` 的运行时卡片列表限制为 680px、会话列表限制为 520px，超出后在各自区域内滚动；已结束/失败会话提供带确认的删除入口，活动会话不显示删除按钮。
- 2026-06-19-ql007：`/runtimes` 会话列表选中任意会话（含 active）均进入只读历史回看（`getAgentSessionLogs` 跨 run 聚合，按 run_id 分组）。此前仅 ended/failed 回看、active 走 live 空白分支导致选中 active 会话右侧无回显；现统一只读回看。active 会话的 live 续看/追问需 LivePanel 支持「打开已有会话」resume，属后续 task。

<!-- MANUAL_NOTES_END -->
