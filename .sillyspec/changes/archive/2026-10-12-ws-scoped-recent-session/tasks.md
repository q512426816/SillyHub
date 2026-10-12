---
author: flow-machine-draft
created_at: 2026-10-12T07:27:53.013Z
---
# 任务注册表（Tasks）— 2026-10-12-ws-scoped-recent-session

- [x] task-01: sessions-portal.tsx recentSession useMemo 加 scope 过滤——workspace/change/quicklog 三入口先按 `s.workspace_id === scope.workspaceId` 过滤再排序，无 scope 不过滤（resolveDefaultMachineId 消费点不动）——验证：tsc 无新错
- [x] task-02: sessions-portal.test.tsx 新增两用例——① 三 scope 入口全局最近会话属 B 工作区时按钮取本工作区（ws-1）会话且点击直达选中；② 本工作区无会话时按钮不渲染——验证：vitest 新用例绿
- [x] task-03: 跑 sessions-portal.test.tsx 全文件回归——既有 ql-20260910-002 全局直达用例与 resolveDefaultMachineId 三级回退用例保持绿——验证：全文件绿
