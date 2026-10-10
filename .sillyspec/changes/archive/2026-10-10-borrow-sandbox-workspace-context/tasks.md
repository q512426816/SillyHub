---
author: qinyi
created_at: 2026-10-10T15:45:00+08:00
---
# 任务清单（Tasks）— 2026-10-10-borrow-sandbox-workspace-context

- [x] task-01: backend placement 借用上下文 loader + 三标记点写 borrow_workspace_context + 借用集成测试扩展（含空 dict 归一 None、Workspace 模型字段存在性核验）
- [x] task-02: backend context.py claim payload interactive 分支白名单透传 + 透传单测 (depends_on: task-01)
- [x] task-03: daemon LeaseCtx 字段 + 归一化双读 + borrow-sandbox-context.ts 渲染纯函数 + 纯函数单测
- [x] task-04: daemon marker 分支 AGENTS.md 落盘（fail-open）+ daemon-borrow-sandbox 集成测试扩展 (depends_on: task-03)
