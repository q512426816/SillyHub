---
author: qinyi
created_at: 2026-09-10 09:30:00
change: 2026-09-10-auto-resume-interrupted-turn
---

# 任务注册（Tasks）— daemon 重启后自动续跑被中断的交互轮

- [x] task-01: Wave 1 数据层——migration 两列 + model 同步（P0，无依赖）
- [x] task-02: Wave 2 入队——auto_resume.py 守卫+模板 + recovery 接线 + 守卫矩阵测试（P0，依赖 task-01）
- [x] task-03: Wave 3 派发——queue G10 派发时守卫 + origin 解析 + inject 打标 + SessionRunRead metadata 出口 + 队列 UI 语义（P0，依赖 task-02）
- [x] task-04: Wave 4 开关端点——DTO + PATCH /sessions/{id}/auto-resume + config merge（P1，依赖 task-01 保守串行）
- [x] task-05: Wave 5a 前端——gen:types + PATCH 客户端 + 手写 interface 同步 + SessionConfigBar 开关（P1，依赖 task-04）
- [x] task-06: Wave 5b 前端——失败卡 hint 注入 + 续跑轮徽标（P1，依赖 task-03/task-05）
- [x] task-07: Wave 6 收尾——模块文档 + 全链集成验证（P1，依赖全部）

> 任务详情（goal/implementation/acceptance/constraints/allowed_paths）见 tasks/task-NN.md
> 任务卡；Wave 结构/依赖图/验收对照见 plan.md。
