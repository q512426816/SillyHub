---
author: qinyi
created_at: 2026-09-17 10:05:00
---
# 任务清单（Tasks）

> 任务注册表唯一真相（plan.md Wave 段纯 ID 引用分组；TaskCard 细节在 tasks/task-NN.md，execute 阶段生成）。原 brainstorm 粗粒度清单已由 plan 阶段展开为本表。

- [x] task-01: backend 读侧 zone 化（parser 递归 + schema/service 透传 + openapi/api-types 再生成）
- [x] task-02: KNOWLEDGE_WRITE 权限枚举 + 角色-权限播种 migration
- [x] task-03: 前端知识库页 zone 分组树 + 待审核徽标 + 既有 knowledge-page.test.tsx 适配 (depends_on: task-01)
- [x] task-04: backend 写侧 writer + 写端点（两段式 merge + dupRe 幂等守卫 + 409 契约；落地后重跑 pnpm gen:types） (depends_on: task-01,task-02)
- [x] task-05: 前端沉淀弹层手工 tab + entry-editor 编辑态 + 权限渲染 + lib/knowledge.ts 写侧 API 封装 (depends_on: task-03,task-04)
- [x] task-06: 前端 merge-dialog 合并预览/确认 + 拒绝流 (depends_on: task-05)
- [x] task-07: backend distill 派发服务 + 端点（AgentRun metadata_/源校验/任务列表；落地后重跑 pnpm gen:types） (depends_on: task-02,task-04)
- [x] task-08: 前端从记录提炼 tab + distill-task-bar 轮询 (depends_on: task-05,task-07)
- [x] task-09: 端到端集成验证（deployment-critical 证据：录入→合并→CLI validate/search；派发→候选回流；权限负例） (depends_on: task-06,task-08)
- [x] task-10: 模块文档增量 + 相邻面回归 + 原型对照复核 (depends_on: task-09)
