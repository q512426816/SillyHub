---
author: qinyi
created_at: 2026-05-31T14:20:00+08:00
---

# 实现计划 — 变更中心流程改造

## Wave 1（并行，无依赖）

- [ ] task-01: 后端 schema 增强 — ChangeCreateRequest 增加 description + scope 字段
- [ ] task-02: 后端 service 增强 — create_change 写 proposal.md + 设 current_stage="created"

## Wave 2（依赖 Wave 1）

- [ ] task-03: 后端 router 透传 — router 传递 description + scope 到 service + Response 增加 current_stage
- [ ] task-04: 前端 API 函数 — changes.ts 新增 createChange()

## Wave 3（依赖 Wave 2）

- [ ] task-05: 前端新建变更页 — create/page.tsx 表单
- [ ] task-06: 后端 Agent 调度 — execute 端点 + SillySpec 命令调度

## Wave 4（依赖 Wave 3）

- [ ] task-07: 前端变更列表改造 — 阶段 Badge + 新建按钮
- [ ] task-08: 前端详情页增强 — 启动按钮 + 文档 Tab + 执行状态

## Wave 5（依赖 Wave 4）

- [ ] task-09: E2E 联调验证

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 schema 增强 | W1 | P0 | 0.5h | — | ChangeCreateRequest +2 字段 |
| task-02 | 后端 service 增强 | W1 | P0 | 1h | — | create_change 写文件 + 设 stage |
| task-03 | 后端 router 透传 | W2 | P0 | 0.5h | task-01,02 | 透传 + Response 增加 |
| task-04 | 前端 API 函数 | W2 | P0 | 0.5h | task-01 | createChange() |
| task-05 | 前端新建变更页 | W3 | P0 | 1.5h | task-03,04 | 表单页 |
| task-06 | 后端 Agent 调度 | W3 | P0 | 2h | task-02 | execute 端点 + CC 调度 |
| task-07 | 前端变更列表改造 | W4 | P1 | 1h | task-05 | Badge + 按钮 |
| task-08 | 前端详情页增强 | W4 | P1 | 1.5h | task-06 | 启动按钮 + 文档 + 状态 |
| task-09 | E2E 联调 | W5 | P0 | 1h | task-07,08 | 端到端验证 |

## 依赖关系图

```
graph LR
  task-01 --> task-03
  task-01 --> task-04
  task-02 --> task-03
  task-03 --> task-05
  task-04 --> task-05
  task-02 --> task-06
  task-05 --> task-07
  task-06 --> task-08
  task-07 --> task-09
  task-08 --> task-09
```

## 关键路径

task-02 → task-06 → task-08 → task-09（最长路径，约 5.5h）

## 全局验收标准

- [ ] 后端测试通过（`.venv/bin/python -m pytest`）
- [ ] 前端构建通过（`npm run build`）
- [ ] 新建变更 → DB + 文件系统同步创建 ✅
- [ ] 列表展示阶段 Badge ✅
- [ ] 详情页启动执行 → Agent 调度成功 ✅
- [ ] 未配置新功能时已有行为不变 ✅
