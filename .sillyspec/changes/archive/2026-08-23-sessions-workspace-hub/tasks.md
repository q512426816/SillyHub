---
author: qinyi
created_at: 2026-08-23 04:27:30
---

# 任务清单（Tasks）

- [x] task-01: 后端列表端点 owner_name join users + limit 上限 le=100→500（session/service.py SQL + schema.py DTO + router.py Query）+ pytest 用例 (depends_on: —)
- [x] task-02: 前端 pnpm gen:types 同步 owner_name（api-types.ts + backend/openapi.json 提交） (depends_on: task-01)
- [x] task-03: SessionPanel 预会话态（page 分支 null 同构空态渲染 + null 守卫清单逐项 + 首句 createSession 链路：runtime_id 参数、失败保留输入 + R-01 专项测试） (depends_on: —)
- [x] task-04: pre-session-picker 两步轻选择浮层（在线机器→智能体）组件 + 测试 (depends_on: —)
- [x] task-05: SessionListPanel 工作区树重构（两层筛选 tab + 分组手风琴 + 机器小节 + owner chip + 状态筛选/批量删除保留 + 组内截断兜底）+ 测试 (depends_on: task-02)
- [x] task-06: SessionsPortal 双态接线（preContext 状态机 + 上下文优先级解析 tab>绑定>D-005 + ?session= 深链保留 + workspace 入口预展开）+ 测试 (depends_on: task-03, task-04, task-05)
- [x] task-07: change 入口 preContext（workspaceId+changeId 显式双传）+ NewSessionForm 退役（组件+测试迁移清单）+ 三页面薄壳调整 (depends_on: task-06)
- [x] task-08: 全量回归（vitest/tsc/lint）+ Docker 重建部署 + 三入口浏览器实证（原型对照留档） (depends_on: task-07)
