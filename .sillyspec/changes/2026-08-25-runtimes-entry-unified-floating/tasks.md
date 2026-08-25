---
author: qinyi
created_at: 2026-08-25 15:30:00
---
# 任务（Tasks）— /runtimes 会话入口统一为智能会话助手 + 抽屉列表换工作区树

- [ ] task-01: stores/floating-session.ts 壳态 +lockedRuntime/openRuntimeSession/closeRuntimeLock + 单测
- [ ] task-02: session-list-panel.tsx +RuntimeScope/runtime_id 过滤/组头「＋」锁定禁用 + 单测
- [ ] task-03: floating-session-host.tsx 抽屉加宽 960px/锁定徽标/左栏换 SessionListPanel/新建钉死 + 测试 (depends_on: task-01, task-02)
- [ ] task-04: runtimes/page.tsx 接线改 store/删弹窗状态/?session= 恢复改 selectSession + 测试 (depends_on: task-01)
- [ ] task-05: 删除 runtime-session-dialog.tsx 及两个测试文件（死代码）(depends_on: task-04)
- [ ] task-06: 回归 pnpm -C frontend tsc + floating/sessions/runtimes 三组既有测试 (depends_on: task-03, task-04, task-05)
