---
author: qinyi
created_at: 2026-09-11 21:30:00
---
# 任务清单（Tasks）

> brainstorm 展开版（6 task/5 Wave）；plan 细化。

## Wave 1：表+双 scope 查询+toggle

- [ ] task-01: 迁移（workspace_id 列+双 partial）+model ORM+toggle 双维度+D-010 四处谓词

## Wave 2：MCP import

- [ ] task-02: get_server_for_import helper+import-from-registry 端点（D-009 三态） (depends_on: task-01)

## Wave 3：收编

- [ ] task-03: adoptable/adopt 两端点（D-008 归一化+差集三源排除） (depends_on: task-01)

## Wave 4：daemon per-workspace 分发

- [ ] task-04: manifest 端点 ?workspace_id+skill-manager per-workspace 槽+会话/任务选槽（D-007） (depends_on: task-01)

## Wave 5：前端+生成物

- [ ] task-05: workspace skills 页两区块（平台库启用+收编） (depends_on: task-01, task-03)
- [ ] task-06: workspace mcp 页选入弹窗+gen:types 联动 (depends_on: task-02, task-05)
