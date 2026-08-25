---
author: qinyi
created_at: 2026-08-25 15:35:00
---
# 模块影响分析（Module Impact）— /runtimes 会话入口统一为智能会话助手 + 抽屉列表换工作区树

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | stores/floating-session.ts 壳态 +lockedRuntime/openRuntimeSession/closeRuntimeLock（+测试） |
| frontend | 修改 | components/sessions/session-list-panel.tsx +RuntimeScope/runtime_id 过滤/组头＋锁定禁用（+测试） |
| frontend | 修改 | components/floating/floating-session-host.tsx 抽屉加宽/锁定徽标/左栏换树/新建钉死（+测试） |
| frontend | 修改 | app/(dashboard)/runtimes/page.tsx 接线改 store/删弹窗状态/?session= 恢复改 selectSession（+测试） |
| frontend | 删除 | components/daemon/runtime-session-dialog.tsx 及两个测试文件（死代码） |

## 未匹配文件

无（全部命中 frontend 模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 更新 frontend 模块卡（悬浮助手锁定入口 + SessionListPanel runtime scope 能力） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
