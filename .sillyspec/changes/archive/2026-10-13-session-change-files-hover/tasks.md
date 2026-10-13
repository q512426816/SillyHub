---
author: qinyi
created_at: 2026-10-13T12:30:00+08:00
---
# 任务清单（Tasks）

- [x] task-01: 后端会话关联变更端点——`list_changes_for_session` 查询（link JOIN/deleted 排除/enrich 复用/未归档优先+created_at desc/limit 100）+ `GET /changes/-/by-session/{sid}` 端点（404 中文）+ pytest（排序/软删/404/隔离/空列表/投影） [target: backend/app/modules/change/router.py, backend/app/modules/change/service.py, NEW:backend/app/modules/change/tests/test_session_changes_endpoint.py]
- [x] task-02: 前端 ChangeFileTree 可选 `autoRefreshMs` prop（默认 undefined 不轮询，挂载起 setInterval 调 refreshTree/refreshPending、卸载清除）+ 回归与 fake timers 测试 [target: frontend/src/components/change-file-tree.tsx, NEW:frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx] (depends_on: 无)
- [x] task-03: gen:types 再生成 + `listSessionChanges`/`useSessionChanges`（打开时 15s refetchInterval）+ queryKeys 注册 [target: frontend/src/lib/api-types.ts, backend/openapi.json, frontend/src/lib/changes.ts, frontend/src/lib/query-keys.ts] (depends_on: task-01)
- [x] task-04: 悬浮变更文件组件——胶囊入口（显隐/进行中徽标/在跑呼吸）+ hover 下拉分组（进行中置顶/归档默认折叠）+ 大弹窗（Select 切换 + ChangeFileTree key 重挂载 + autoRefreshMs=15000）+ vitest [target: NEW:frontend/src/components/daemon/session-change-files-hover.tsx, NEW:frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx] (depends_on: task-02, task-03)
- [x] task-05: session-panel-page 挂载（workspaceId/sessionId/running）+ 聚焦测试全绿 + lint/tsc 过门 + 对照 design 文件清单核验 [target: frontend/src/components/daemon/session-panel/session-panel-page.tsx] (depends_on: task-04)
