---
author: qinyi
created_at: 2026-08-22 17:18:00
---

# 模块影响分析（Module Impact）— 会话门户三入口统一

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend/components-sessions | 修改 | 新建 sessions-portal.tsx（自 sessions/page.tsx 提取）；session-list-panel.tsx scope 化（数据源/仅本人过滤/筛选隐藏/降级）；new-session-form.tsx 锁定绑定；三个测试文件适配 + sessions-portal.test 新增 |
| frontend/app-sessions-pages | 修改 | /sessions 页薄壳化；/workspaces/[id]/sessions 改渲染门户；新路由 /workspaces/[id]/changes/[cid]/sessions |
| frontend/components-changes | 修改 | change-sessions-card.tsx 入口卡形态 + 其测试适配；change-session-section.tsx 退役删除 |
| frontend/components-daemon | 依赖变更 | SessionPanel 本体零改动（消费面重组）；workspace-session-section.tsx 退役删除；dialog 模式消费面收敛为 /runtimes 弹窗唯一 |
| backend / sillyhub-daemon | 依赖变更 | 无（三列表端点 listAgentSessions/listWorkspaceAgentSessions/listChangeSessions 既有，createSession 双绑定参数既有） |

## 未匹配文件

无（design §5 全部 16 路径落入上述模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| docs/frontend/modules/components-sessions.md | 归档时更新：SessionsPortal 契约 + list-panel scope + form 锁定绑定 | pending |
| docs/frontend/modules/app-sessions-pages.md | 归档时更新：三路由装配（薄壳×2 + 新路由） | pending |
| docs/frontend/modules/components-daemon.md | 归档时更新：退役组件条目划线 + dialog 消费面收敛说明 | pending |
| docs/frontend/modules/_module-map.yaml | 无变化（未增删模块） | skipped |
