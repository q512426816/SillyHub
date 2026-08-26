---
author: qinyi
created_at: 2026-08-26 19:32:00
---
# 任务清单（Tasks）

> 骨架版——plan 阶段展开细节并写回本文件。

- [x] task-01: 后端 skills 写路径（service 5 方法 + 路径安全 helper + pydantic 模型 + AppError 族 + 审计）(depends_on: —)
- [x] task-02: 后端 5 REST 端点（router 装配 + WorkspaceWriter 权限）(depends_on: task-01)
- [x] task-03: 后端全分支测试（CRUD/路径穿越变体/白名单/二进制/超限/SKILL.md 保护/审计/中文）(depends_on: task-02)
- [x] task-04: 前端类型重生成（gen:types + 提交）(depends_on: task-02)
- [x] task-05: 前端数据层（5 fetch + hooks + queryKeys 扩展）(depends_on: task-04)
- [x] task-06: 前端页面双栏改造（skill 列表+文件树+编辑器+新建对话框+删除确认，对照原型）及测试（更新既有只读断言）(depends_on: task-05)
