---
author: qinyi
created_at: 2026-08-13 09:41:17
---

# 任务清单 — 变更中心列表页整体重做

> 初步任务清单，plan 阶段将细化为 `plan.md`（Wave/Task/依赖/验收）。
> 对应需求见 `requirements.md`（FR-01~FR-13），设计见 `design.md`。

## Wave 1 · 后端：列表投影 + 排序（零 migration）

- task-01 [FR-03] `service.py` 扩展 `_project_current_stage`（:1266）批量 join `latest_progress` 时，新增 `_extract_completed_stages`（对齐 `_extract_current_stage:1298` 防御式风格）解析 stages 表 completed 集合；`enrich_summaries` 调 `StageProjectionService._map`（projection.py:175 纯函数）算 pending_review 填 ChangeSummary。**不读 sillyspec.db**（D-008）。
- task-02 [FR-03] `schema.py` `ChangeSummary` 加 `pending_review: PendingReview | None = None`。
- task-03 [FR-04] `service.py` list 默认排序 `change_key ASC` → `updated_at DESC`；加 `sort` 参数。
- task-04 [FR-02] `service.py` + `router.py` 加 `pending_review_only` 筛选；pending_review 填充由 task-01（latest_progress + _map）完成。
- task-05 [测试] 后端：`test_service.py` 加 `_extract_completed_stages` + `_map` 算 pending_review 用例；`test_router.py` list 排序/筛选/pending_review 字段测试；gen:types 后 openapi 字段核验。

## Wave 2 · 前端 API + 类型（依赖 Wave 1）

- task-06 [FR-13] 主仓跑 `pnpm gen:types`，同步 `frontend/src/lib/api-types.ts`（ChangeSummary 多 pending_review）+ `backend/openapi.json`，提交。
- task-07 [FR-04/FR-02] `lib/changes.ts` `listChanges` 加 `sort?` / `pendingReviewOnly?` 参数透传 query。
- task-08 [FR-12] 删 `page.tsx` 死代码 `GATE_LABELS`（由 task-10 真实徽标映射替代）。

## Wave 3 · 前端列表页重做（依赖 Wave 2）

- task-09 [FR-01] 主 tab 改为「进行中/已归档」（location 维度）；「进行中」视图加聚焦开关 `☑ 只看待我处理(N)`，默认勾上，勾选时筛选 pending_review 非空。
- task-10 [FR-05] 每行「待办状态」徽标（5 种 pending_review + blocked），删冗余旧「状态」列。
- task-11 [FR-04] 排序列头可切换（默认 updated_at↓）。
- task-12 [FR-06] 新增「负责人」列（owner_id）。
- task-13 [FR-07/FR-08/FR-10/FR-11] 查询区 grid-cols-2 消留白；「+新建变更」升主按钮；tab 挂计数；副标题改 workspace 名 + 待处理计数。
- task-14 [FR-09] 空状态分场景文案 + 新建 CTA。
- task-15 [测试] 前端 vitest：视图切换/聚焦开关/徽标/空状态/tab 计数；更新既有 `page-team-toggle.test.tsx`；tsc 0。

## 依赖

- Wave 2 依赖 Wave 1（gen:types 需后端 schema 改完）。
- Wave 3 依赖 Wave 2（前端类型/API 就绪）。
- task-10 依赖 task-08（删旧 GATE_LABELS 后建真实映射）。
