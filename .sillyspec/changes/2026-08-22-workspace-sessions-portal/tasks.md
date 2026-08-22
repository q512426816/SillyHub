---
author: qinyi
created_at: 2026-08-22 16:56:30
---
# 任务清单（Tasks）

> 任务名唯一真相源；plan.md Wave 段纯 ID 引用。task-XX 卡片在 tasks/task-NN.md 由蓝图步骤展开。

- [ ] task-01: 新建 SessionsPortal 共享门户组件（自 sessions/page.tsx 整块提取 + scope 派生 + ?session= 深链 + PageContainer/PageHeader 进组件） (depends_on: task-04, task-05)
- [ ] task-02: /sessions 页薄壳化 + /workspaces/[id]/sessions 改渲染门户（workspace scope） (depends_on: task-01)
- [ ] task-03: 新路由 /workspaces/[id]/changes/[cid]/sessions（change scope 薄壳页） (depends_on: task-01)
- [ ] task-04: SessionListPanel 加 scope（数据源切换/仅本人过滤/隐藏服务端筛选保留本地搜索/瘦字段降级矩阵/删除回调按 scope invalidate） (depends_on: —)
- [ ] task-05: NewSessionForm 加锁定绑定（bindWorkspaceId 隐藏选择器直传 / bindChangeId 双传 change_id+workspace_id） (depends_on: —)
- [ ] task-06: 变更入口卡（listChangeSessions 仅本人前 3 条预览 + 打开工作台 + ?session= 直达；change-sessions-card.test 同波适配保绿） (depends_on: task-01)
- [ ] task-07: 退役 workspace-session-section / change-session-section 及其测试 + 全仓 dangling 守护 (depends_on: task-02, task-03, task-06)
- [ ] task-08: 测试适配与新增（sessions-portal.test 三 scope+过滤+深链+绑定用例；list-panel/new-session-form/sessions 页测试适配；card 测试已归 task-06） (depends_on: task-07)
- [ ] task-09: 全量回归（vitest/tsc/lint）+ 3001 重建部署 + 三入口浏览器实证 (depends_on: task-08)
