---
schema_version: 1
doc_type: module-card
module_id: components-shared
author: qinyi
created_at: 2026-06-10T16:55:00
---

# components-shared

## 定位
业务级共享组件。包含页面中复用的业务组件，区别于纯 UI 原子组件（components-ui）。

## 契约摘要
- `app-shell.tsx` — 应用外壳：侧边栏导航 + 内容区。含三组导航（Overview/Management/System）、认证状态、折叠/展开、用户信息、登出
- `workspace-card.tsx` — 工作空间卡片：展示工作空间信息，支持删除、重新扫描、激活等操作
- `health-card.tsx` — 健康检查卡片：展示后端服务状态（DB/Redis/version/commit_sha）
- `workspace-scan-dialog.tsx` — 工作空间扫描对话框：输入根路径、扫描、激活
- `component-detail-drawer.tsx` — 组件详情抽屉：展示组件元数据和关联关系
- `sillyspec-step-progress.tsx` — SillySpec 步骤进度条：展示阶段步骤执行状态

## 关键逻辑
- AppShell 从 URL 路径中提取 workspaceId 来构建导航链接
- 折叠状态持久化到 localStorage
- 所有组件都是 `"use client"`

## 注意事项
- AppShell 的导航分组（OVERVIEW_NAV / MANAGEMENT_NAV / SYSTEM_NAV）是新增页面时需要同步更新的地方
- 组件依赖 `@/lib/api` 的 ApiError 进行错误展示

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
