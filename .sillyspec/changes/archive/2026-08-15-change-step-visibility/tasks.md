---
author: qinyi
created_at: 2026-08-16 00:38:00
---
# 任务清单（Tasks）

> 以 plan.md 为准（本骨架与其同步；执行细节见 plan.md 任务总表）。

- [x] task-02: schema 新模型与 optional 字段（StepProgressSummary / StepTimelineEntry）——W1 先行
- [x] task-01: 后端提取器与投影扩展（三元组+两处解包适配+_extract_step_progress+enrich 填充）
- [x] task-03: gen:types 重生成 api-types.ts + backend/openapi.json
- [x] task-04: 前端 ChangeStepBadge 组件 + 测试
- [x] task-05: 前端 ChangeStepTimeline 组件（替换 SillySpecStepProgress + git rm + 引用清理）+ 测试
- [x] task-06: 列表页 useQuery+refetchInterval(30s) 改造 + ChangeStepBadge 接入 + 测试适配
- [x] task-07: 详情页 useQuery+refetchInterval(10s) 改造 + ChangeStepTimeline 接入 + 测试适配
- [x] task-08: 全量回归——pytest + vitest + tsc + 不乱跳/停轮/后台暂停冒烟
