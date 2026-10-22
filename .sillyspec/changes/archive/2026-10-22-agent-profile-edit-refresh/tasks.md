---
author: flow-machine-draft
created_at: 2026-10-22T02:35:37.287Z
---
# 任务注册表（Tasks）— 2026-10-22-agent-profile-edit-refresh

- [x] task-01: 新增 lib 单测 frontend/src/lib/__tests__/agent-profiles.test.tsx（renderHook+真 QueryClient+mock apiFetch：成功失效两桶/失败零失效）——先红后绿
- [x] task-02: useCreateAgentProfile/useUpdateAgentProfile onSuccess 补 mineList 失效（保留 workspaceList(wid)）；task-01 用例转绿
- [x] task-03: 实页验证：3001 全局页编辑/新建保存后卡片墙自动刷新；工作区内页刷新路径回归确认；tsc/lint 基线
