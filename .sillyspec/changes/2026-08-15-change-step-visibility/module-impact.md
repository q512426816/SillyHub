---
author: qinyi
created_at: 2026-08-16 01:20:00
---

# 模块影响分析（Module Impact）— 2026-08-15-change-step-visibility

## 影响模块清单

| 模块 | 影响等级 | 变更内容 | 回归风险 |
|---|---|---|---|
| backend/change | 中 | service.py 读侧投影扩展（`_project_current_stage` 三元组 + `_extract_step_progress` 提取器 + enrich 填充）；schema.py 新增两 DTO + 三 optional 字段 | 低——查询形状不变（同一条批量 IN SQL），新增纯函数 + additive 字段；两处二元组解包适配（:1471/:1501）有守护测试 |
| frontend/changes 变更中心 | 中 | 列表/详情页数据获取从裸 useEffect 改 useQuery+refetchInterval；新组件 ChangeStepBadge / ChangeStepTimeline；删除 SillySpecStepProgress | 中——页面数据层改造（R-07）是主要回归面，靠 page.test.tsx / page-team-toggle.test.tsx 适配 + task-08 冒烟兜底 |
| frontend/api-types | 低 | gen:types 重生成（新类型 + 新字段） | 低——生成器产物，无手写 |
| backend/platform_sync | 无 | 不触碰（latest_progress 写入侧原样） | 无 |
| sillyspec CLI / sillyhub-daemon | 无 | 不触碰（数据已上行） | 无 |

## 模块文档同步点（archive 时）

- `modules/backend.md`：change 模块读侧投影新增 step 级提取（enrich_summaries / enrich_with_workspace_ids 行为说明 + 新 DTO）。
- `modules/frontend.md`：变更中心列表/详情新增 step 徽章与时间线组件；数据层统一 react-query 轮询范式；sillyspec-step-progress.tsx 移除。

## 对外契约变更

- API 响应 additive：`ChangeSummary.step_progress`、`ChangeRead.step_progress` + `steps`（全 optional，旧客户端零影响）。
- openapi.json + api-types.ts 同步重生成（task-03）。
- 无数据库 migration、无 CLI 契约变更、无端点增删。

## 并行/多 agent 影响

- 读侧纯函数 + additive 字段，与其它并行变更在 change 模块的写侧冲突面小；service.py 是热点文件（task-01 改动集中在 :1433-1597 投影区，避开 reparse/写入区）。
