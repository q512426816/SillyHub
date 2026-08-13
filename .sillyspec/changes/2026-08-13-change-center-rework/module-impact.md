---
author: qinyi
created_at: 2026-08-13 13:32:00
change: 2026-08-13-change-center-rework
---

# 模块影响分析（Module Impact）— 变更中心列表页重做

## 变更范围

变更中心列表页整体重做：后端 `change` 模块（ChangeSummary 加 pending_review 走 PG latest_progress 镜像 + list 排序/筛选）+ 前端 `changes`（列表页重做 + listChanges 参数 + gen:types 同步）。7 task，commit 549d42b5。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|--------------|
| backend / change 子模块 | 数据结构变更 + 接口变更 + 逻辑变更 | backend/app/modules/change/schema.py | ChangeSummary 加 `pending_review: PendingReview \| None = None`（DTO 计算字段，**零 migration**，D-003） | false |
| backend / change 子模块 | 逻辑变更 + 数据结构变更 | backend/app/modules/change/service.py | 新增 `_extract_completed_stages`（防御式解析顶层 `latest_progress.stages`）+ `_project_current_stage` 改返回 tuple 复用单次 PG join（R-01）+ `enrich_summaries` 调 `StageProjectionService._map` 填 pending_review（**D-008 不读 sillyspec.db**）+ `list_` 加 `_resolve_order_by` 白名单排序（防注入，D-004） | false |
| backend / change 子模块 | 接口变更 | backend/app/modules/change/router.py | list_changes 端点加 `sort` + `pending_review_only` query 参数；pending_review_only 在 enrich 后 Python filter（计算字段非 SQL 列） | false |
| backend / change 测试 | 新增 + 逻辑变更 | backend/app/modules/change/tests/{test_enrich_projection,test_router}.py | `_extract_completed_stages` 8 防御分支 + `_map` 7 分支 + list 排序/筛选/pending_review 字段（42 passed） | false |
| backend / openapi（gen:types 产物） | 接口变更 | backend/openapi.json | gen:types 同步 ChangeSummary pending_review + list sort/pending_review_only query（364 paths/436 schemas） | false |
| frontend / changes 列表页 | 逻辑变更 + 接口变更 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 列表页重做：主tab挂数量 + 待我处理聚焦开关默认勾 + 待办徽标（blocked/pending_review 5 值）+ 排序列头切换 + 负责人列 + 查询区 grid-cols-2 + 空状态分场景 CTA + 新建主按钮 + 副标题计数；**删 GATE_LABELS 死代码**（FR-12） | false |
| frontend / API 客户端 | 接口变更 | frontend/src/lib/changes.ts | listChanges 加 `sort?` + `pendingReviewOnly?` optional 参数透传 query | false |
| frontend / 类型（gen 产物） | 接口变更 | frontend/src/lib/api-types.ts | gen:types 同步 ChangeSummary pending_review + pending_review_only query | false |
| frontend / changes 测试 | 新增 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | 18 用例覆盖列表页重做行为（主tab/聚焦/徽标/空状态/排序/负责人） | false |

## 未匹配文件

无。所有 10 个变更文件均匹配到 backend（change 子模块 + openapi）或 frontend（列表页 + lib + 类型 + 测试）。

## 三重交叉验证

- **声明范围**（design.md §6 文件变更清单）：schema / service / projection（复用不改）/ router / tests / api-types / openapi / lib changes.ts / page.tsx / __tests__
- **任务范围**（plan.md task-01~07）：同上
- **真实变更**（git show 549d42b5 --name-only，排除 spec）：10 文件，与声明一致
- **一致性**：真实 = 声明；`projection.py` 复用 `_map` 未改（design 要求 ✓）；测试落 `test_enrich_projection.py`（design §6 标 test_service.py 不存在，gap① 已记录）

## 备注

- `pending_review` 走 PG `latest_progress` 镜像 + `_map` 纯函数，**只读 + 列表查询，不改运行时状态机**（design §7.5 不涉及生命周期契约），无需 daemon↔backend 集成证据（risk_level: unit-sufficient）
- `openapi.json`/`api-types.ts` 为 gen:types 产物，含本 change（ChangeSummary pending_review）+ 已归档 ql-003（install.ps1 charset）合并
- 预存技术债（frontend antd6+Tailwind 混合等，CONCERNS）本 change 沿用既有 UI 库未新增
