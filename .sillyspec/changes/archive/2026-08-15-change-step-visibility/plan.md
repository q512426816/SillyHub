---
author: qinyi
created_at: 2026-08-16 00:42:00
plan_level: full
---

# 实现计划（Plan）— 变更中心 step 级进度展示

## Wave 1（后端读侧扩展，schema 模型先行，Wave 内串行：task-02 → task-01——提取器/填充需 import schema 新模型）
- [x] task-02: schema 新模型与 optional 字段——`StepProgressSummary` / `StepTimelineEntry`；`ChangeSummary.step_progress` / `ChangeRead.step_progress`+`steps`（覆盖：FR-04）
- [x] task-01: 后端提取器与投影扩展——`_project_current_stage` 三元组返回 + 两处二元组解包适配（`_resolve_pending_change_keys`:1501 与 `enrich_summaries`:1471）+ `_extract_step_progress` 提取器（STAGE_ORDER 排序 / completed_at ISO 归一化 / 七值透传 / 防御判型）+ `enrich_summaries`/`enrich_with_workspace_ids` 填充（覆盖：FR-04, D-002@v1, D-003@v1；依赖 task-02）

## Wave 2（依赖 Wave 1：后端字段先落，openapi 才有新形状）
- [x] task-03: gen:types 重生成 api-types.ts + backend/openapi.json 提交（覆盖：FR-04）

## Wave 3（前端，依赖 Wave 2：组件 props 类型来自新生成 api-types）
- [x] task-04: `ChangeStepBadge` 列表徽章组件（七值色映射 + waiting chip + 降级渲染）+ 组件测试（覆盖：FR-01, D-003@v1）
- [x] task-05: `ChangeStepTimeline` 详情时间线组件（stage 分组 + entry 级 diff）+ 替换 `SillySpecStepProgress`（sillyspec-step-progress.tsx 由本 task git rm，execute 流程允许删除；引用清理：[cid]/page.tsx、change-agent-run-log.tsx、其测试 mock）+ 组件测试（覆盖：FR-02, D-005@v1）

## Wave 4（页面接线与全量回归，依赖 Wave 3 组件）
- [x] task-06: 列表页 useQuery+refetchInterval(30s) 改造 + `ChangeStepBadge` 接入 + page.test.tsx 适配（覆盖：FR-03, D-001@v1, D-004@v1）
- [x] task-07: 详情页 useQuery+refetchInterval(10s) 改造 + `ChangeStepTimeline` 接入 + page-team-toggle.test.tsx 适配（覆盖：FR-03, D-001@v1, D-004@v1）
- [x] task-08: 全量回归——backend pytest（change 模块 + 全量）+ frontend vitest 全量 + tsc 0 error + 不乱跳冒烟（轮询期间滚动/选中保留）（覆盖：FR-03, R-04, R-07）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端提取器与投影扩展 | W1 | P0 | task-02 | FR-04, D-002, D-003 | service.py；含 :1501/:1471 两处解包守护测试 |
| task-02 | schema 新模型与字段 | W1 | P0 | — | FR-04 | schema.py；全 optional 零 breaking，先行落地供 task-01 import |
| task-03 | gen:types 重生成 | W2 | P0 | task-01,02 | FR-04 | openapi.json + api-types.ts 同 commit；worktree 注记：junction 主仓 node_modules，dump 后 grep api-types 含 step_progress/steps 防加载主仓旧契约 |
| task-04 | 列表徽章组件 + 测试 | W3 | P0 | task-03 | FR-01, D-003 | 新组件；降级态必须有测试 |
| task-05 | 详情时间线组件 + 替换旧组件 | W3 | P0 | task-03 | FR-02, D-005 | 含引用清理与旧测试适配 |
| task-06 | 列表页接线（轮询+徽章） | W4 | P0 | task-04 | FR-03, D-001, D-004 | useQuery 改造保持请求/错误语义 |
| task-07 | 详情页接线（轮询+时间线） | W4 | P0 | task-05 | FR-03, D-001, D-004 | 同上 |
| task-08 | 全量回归 + 冒烟 | W4 | P0 | task-06,07 | FR-03, R-04, R-07 | pytest + vitest + tsc + 手动冒烟清单 |

## 关键路径
task-02 → task-01 → task-03 → task-04/05 → task-06/07 → task-08（W1 内串行：schema 模型先行；W2 是类型瓶颈；W3 组件并行；W4 收口）

## 全局验收标准
- [ ] backend：change 模块测试全绿 + 全量 pytest 无回归（4278 基线）
- [ ] frontend：vitest 全绿 + tsc 0 error
- [ ] gen:types：api-types.ts 与后端 schema 一致（无手写）
- [ ] 降级：无 steps 数据的变更视觉与现状一致（列表不显示徽章副行、详情不显示时间线）
- [ ] 不乱跳冒烟：变更中心列表开启 30s 轮询，滚动到中部等待两轮刷新，滚动位置/选中/展开保留；纯 step 推进不重排行序
- [ ] 停轮：全部变更终态后网络面板无周期请求；切后台 tab 无周期请求
- [ ] （brownfield）未接入新字段的旧客户端不受影响（optional 契约测试）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-06, task-07, task-08 | 不乱跳冒烟 + refetchInterval 停轮/暂停 |
| D-002@v1 | task-01 | 提取器单测（数据源=latest_progress.steps） |
| D-003@v1 | task-01, task-04 | 缺数据降级单测 + 组件降级渲染测试 |
| D-004@v1 | task-06, task-07 | useQuery+refetchInterval 接线；task-08 冒烟含可断言项（数据不变时行渲染计数不增） |
| D-005@v1 | task-05 | 旧组件删除 + 引用清理 grep 0 残留 |
| FR-01 | task-04, task-06 | 徽章组件测试 + 列表集成 |
| FR-02 | task-05, task-07 | 时间线组件测试 + 详情集成 |
| FR-03 | task-06, task-07, task-08 | 轮询行为 + 冒烟 |
| FR-04 | task-01, task-02, task-03 | 提取器/字段/types 三层落地 |
