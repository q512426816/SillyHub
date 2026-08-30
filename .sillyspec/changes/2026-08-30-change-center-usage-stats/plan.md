---
author: qinyi
created_at: 2026-08-30 16:58:33
plan_level: full
---

# 实现计划（Plan）

## 来源
用户需求（2026-08-30）：「变更中心 变更和快速修复 都要补充个 开始时间 结束时间 耗时 字段信息，能不能把消耗的token 信息（输入、输出、缓存、调用次数、轮次）也记录上去呢？」brainstorm 四件套 + decisions D-001~D-007 为唯一直接来源，不重新扩写。

## Wave 1 — 后端 DTO 契约（无依赖）
- task-01

## Wave 2 — 后端聚合服务（依赖 task-01）
- task-02

## Wave 3 — 批量摘要投影接线（依赖 task-02；与 task-04 共用 router.py，按共享文件分 Wave 铁律拆开）
- task-03

## Wave 4 — 两个 usage 端点（依赖 task-02）
- task-04

## Wave 5 — 后端聚合测试（依赖 task-03、task-04）
- task-05

## Wave 6 — 契约生成与前端 API 封装（依赖 task-05：openapi.json 需端点就绪）
- task-06

## Wave 7 — 前端组件与列表（依赖 task-06；07/08 文件互不冲突可并行）
- task-07
- task-08

## Wave 8 — 详情渲染点接线（依赖 task-07）
- task-09

## Wave 9 — 契约收口与回归（依赖 task-05、Wave 7、task-09）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 usage DTO 契约 | W1 | P0 | — | FR-02, FR-04, D-003@v1 | schema.py 四 DTO + 两列表 optional 计算字段（惯例注释） |
| task-02 | 后端聚合服务 | W2 | P0 | task-01 | FR-01, FR-02, D-001@v1, D-002@v1, D-006@v1 | usage_service.py 去重集合 + 详情两段聚合 + 批量摘要 |
| task-03 | 批量摘要投影接线 | W3 | P0 | task-02 | FR-04 | enrich_summaries 尾段 + quicklog 列表组装处，零 N+1 |
| task-04 | 两个 usage 端点 | W4 | P0 | task-02 | FR-03, D-005@v1 | CHANGE_READ + 404 resource-hiding |
| task-05 | 后端聚合测试 | W5 | P0 | task-02, task-03, task-04 | FR-01~FR-04 | 并集去重/兜底桶/时间 NULL 组合/404/批量投影/deleted 行 |
| task-06 | gen:types + 前端 API 封装 | W6 | P0 | task-05（传递含 task-01~04） | FR-03 | pnpm gen:types + lib/changes.ts + lib/quicklog.ts |
| task-07 | 用量卡组件 | W7 | P0 | task-06 | FR-05, D-007@v1 | change-usage-card.tsx（useQuery + 折叠明细 + 口径注脚 + 边界态）+ 组件测试 |
| task-08 | 两个列表「执行」列 | W7 | P0 | task-06 | FR-05, D-004@v1 | changes/page.tsx + quicklog-table.tsx + 测试补充 |
| task-09 | 详情渲染点接线 | W8 | P0 | task-07 | FR-05, D-004@v1 | 变更详情页 + quicklog 抽屉挂用量卡 |
| task-10 | 契约收口与回归 | W9 | P0 | task-05, task-07, task-08, task-09 | 全 FR | api-types/openapi 复核 + change/frontend 模块测试回归 + tsc |

## 关键路径
task-01 → task-02 → task-03/04 → task-05 → task-06 → task-07 → task-09 → task-10（线性链，前端测试收口为末端）

## 全局验收标准
1. 后端：`GET /changes/{cid}/usage` 与 `GET /quicklog-entries/{ql_id}/usage` 聚合数字与 DB 手工 SUM 一致——并集去重（同 run 双锚点计一次）、跨变更共享会话各变更各计一次、兜底桶四维并入且 api_requests=0、`ctx_tokens` 不参与、软删会话执行计入、时间三元组三种 NULL 组合正确（D-001/D-002/D-006）。
2. 列表：`ChangeSummary.usage` / `QuicklogEntryListItem.usage` 批量填充零 N+1（单查询 GROUP BY）；deleted 变更行 usage 恒 None；无执行条目 usage=None。
3. 端点鉴权：缺权限 403 / 他人工作区或不存在的变更/快速修复/deleted 变更 → 404 resource-hiding。
4. 前端：两列表「执行」列（无执行「—」、进行中标记、悬浮起止时间）；详情/抽屉用量卡五指标+轮次+时间三元组+命中率（分母 0 →「—」）+分模型折叠明细+口径注脚；取数失败渲染边界态不弹错。
5. 契约：`api-types.ts` + `openapi.json` 与后端同步提交（gen:types 产物入 git）；`cd backend && uv run pytest app/modules/change -q --no-cov -n auto` 全绿；frontend 相关测试全绿、tsc 0 错。
6. 兼容：零迁移；新字段全 optional，既有测试（test_enrich_projection 等）不回归。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-05 | AC-1（时间三元组 NULL 组合） |
| D-002@v1 | task-02, task-05 | AC-1（并集去重/共享会话） |
| D-003@v1 | task-01, task-02, task-03 | AC-2（计算字段零迁移批量填充） |
| D-004@v1 | task-08, task-09 | AC-4（列表+详情展示） |
| D-005@v1 | task-04, task-06 | AC-1/AC-3（独立端点） |
| D-006@v1 | task-02, task-05 | AC-1（软删会话计入） |
| D-007@v1 | task-07 | AC-4（useQuery 自取数） |
