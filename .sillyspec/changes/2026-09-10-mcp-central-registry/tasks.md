---
author: qinyi
created_at: 2026-09-10 10:50:06
---
# 任务清单（Tasks）

> plan 阶段展开版（13 task，13 Wave 串行——共享文件拆 Wave 防 execute 并行覆盖；分组与依赖见 plan.md 任务总表）。

## Wave 1：数据层

- [x] task-01: 数据层——Alembic 迁移 + 三表 ORM + DTO

## Wave 2：service 层

- [x] task-02: service 层——CRUD + 可见性 + binding 约束 + 加密读写 (depends_on: task-01)

## Wave 3：router 层

- [x] task-03: router 层——/api/mcp-servers* 端点 + 权限 (depends_on: task-02)

## Wave 4：渲染与诊断

- [x] task-04: render.py——注入集渲染 + 诊断预检五项 (depends_on: task-01)

## Wave 5：daemon 端点换源

- [x] task-05: daemon 端点换源 + user_id 授权 (depends_on: task-04)

## Wave 6：claim 透传链

- [x] task-06: claim 透传链——user_id 下发与消费 (depends_on: task-05)

## Wave 7：契约测试

- [x] task-07: 契约测试——golden + 授权三态 + 回落 (depends_on: task-05, task-06)

## Wave 8：JSON 导入

- [ ] task-08: importer——JSON 粘贴导入 (depends_on: task-02)

## Wave 9：workspace 扫描导入

- [ ] task-09: importer——workspace 扫描 + 去重 + cmd 归一化 (depends_on: task-08)

## Wave 10：模板

- [ ] task-10: 模板——seed 预置 + 存为模板 (depends_on: task-02)

## Wave 11：前端框架

- [ ] task-11: 前端——api 层 + 页面框架 (depends_on: task-03)

## Wave 12：前端导入与诊断

- [ ] task-12: 前端——导入入口 + 诊断面板 (depends_on: task-11, task-08, task-09, task-10)

## Wave 13：收尾

- [ ] task-13: 收尾——旧端点移除 + 旧调用切换 + 文档 (depends_on: task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12)
