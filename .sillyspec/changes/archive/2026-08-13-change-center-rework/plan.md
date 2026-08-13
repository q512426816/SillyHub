---
author: qinyi
created_at: 2026-08-13 10:29:09
plan_level: full
---

# 实现计划（Plan）— 变更中心列表页整体重做

> change: `2026-08-13-change-center-rework`
> 数据源决策 D-008：列表 pending_review 走 PG `latest_progress` 镜像 + `_map`，**不读 sillyspec.db**。
> 设计依据：design.md §5/§6；需求：requirements.md FR-01~13；决策：decisions.md D-001~D-008。

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | `latest_progress`（serializeForSync 六表 JSON）里 `stages` 表的确切 JSON 路径（顶层 `stages` vs `changes[0].stages`）+ completed 判定字段（`status='completed'`）—— 读 `backend/app/modules/platform_sync` 的 serializeForSync 序列化逻辑 + 真实 latest_progress 样例 | task-01 的 `_extract_completed_stages` 解析路径需按实证调整；design 已备防御式降级（解析失败→空 set→`_map` 返 None→不显徽标不崩，R-07） |

> spike-01 在 task-01 开工时先做（读 serializeForSync + 抓一条真实 latest_progress 样例确认结构），10 分钟级，不阻塞 Wave 推进。

## Wave 1（后端 service 核心，无依赖，独占 service/schema/projection）
- [x] task-01: ChangeSummary 加 pending_review + service 解析 latest_progress.stages 经 _map 算 pending_review（D-008 PG 镜像）

## Wave 2（后端 list 排序/筛选，依赖 task-01；共享 service.py 故串行不并行）
- [x] task-02: list 默认排序 updated_at desc + sort 参数 + pending_review_only 筛选 + router 透传

## Wave 3（后端测试 + 前端类型，依赖 task-02；互不共享文件可并行）
- [x] task-03: 后端测试（_extract_completed_stages + _map + 排序/筛选/字段）
- [x] task-04: gen:types 同步 api-types.ts + openapi.json（ChangeSummary 多 pending_review）

## Wave 4（前端 API，依赖 task-04）
- [x] task-05: lib/changes.ts listChanges 加 sort/pendingReviewOnly 参数

## Wave 5（前端页面，依赖 task-05）
- [x] task-06: page.tsx 列表页整体重做（主tab+聚焦开关+徽标+排序+负责人列+查询区+空状态+新建按钮+副标题+删GATE_LABELS）

## Wave 6（前端测试，依赖 task-06）
- [x] task-07: 前端测试（视图/徽标/聚焦开关/空状态/tab计数；列表页 __tests__/ 为新建，不涉及详情页 page-team-toggle）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | ChangeSummary 加 pending_review + service PG 镜像解析+_map | W1 | P0 | — | FR-03, D-003, D-008 | 不读 sillyspec.db |
| task-02 | list 排序 updated_at desc + sort + pending_review_only + router | W2 | P0 | task-01 | FR-02, FR-04, D-004 | 默认排序行为变化；与 task-01 共享 service.py 故分 Wave |
| task-03 | 后端测试 test_service/test_router | W3 | P0 | task-02 | FR-02~04 | 含 spike-01 结构验证 |
| task-04 | gen:types api-types.ts + openapi.json | W3 | P0 | task-02 | FR-13 | 主仓跑，先验 node_modules；与 task-03 不共享可并行 |
| task-05 | lib/changes.ts listChanges 加参数 | W4 | P0 | task-04 | FR-02, FR-04 | 透传 sort/pendingReviewOnly |
| task-06 | page.tsx 列表页整体重做 | W5 | P0 | task-05 | FR-01, FR-05~12, D-007 | 含删 GATE_LABELS 死代码 |
| task-07 | 前端测试（列表页 __tests__/ 新建） | W6 | P0 | task-06 | FR-01~12 | tsc 0；不涉及详情页 page-team-toggle |

## 关键路径

task-01 → task-02 → task-04 → task-05 → task-06 → task-07（后端字段 → API → 类型 → 前端 API → 页面 → 测试，线性，决定交付周期）

## 全局验收标准

- [ ] 后端 `cd backend && uv run pytest app/modules/change -q --no-cov` 全绿（含 _extract_completed_stages/_map/排序/筛选/pending_review 字段）
- [ ] 前端 `cd frontend && pnpm test` 全绿 + `pnpm exec tsc --noEmit` 0 error
- [ ] `api-types.ts` 与 `openapi.json` 同步（ChangeSummary 含 pending_review），`pnpm gen:types` 可重现
- [ ] 列表进页面默认 = 进行中 + 「只看待我处理」聚焦勾上，显示 pending_review 非空变更；取消聚焦看全部进行中
- [ ] 每行待办徽标正确（proposal_review/plan_review/human_test/archive_confirm/blocked）；GATE_LABELS 死代码已删
- [ ] 默认排序最近活动优先（updated_at desc），列头可切
- [ ] （brownfield）ChangeSummary.pending_review optional，旧前端不传 sort/pending_review_only 时行为兼容（sort 默认 updated_at_desc、筛选默认 False）
- [ ] latest_progress 缺失/解析失败时 pending_review 降级 None，列表不崩（NFR-02）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 范围=列表层做透 | task-06 | page.tsx 重做，不改详情页 |
| D-002@v1 待我处理=全局待人工 | task-02, task-06 | pending_review_only 筛选 + 聚焦开关 |
| D-003@v1 ChangeSummary 加 pending_review 零 migration | task-01 | schema.py 加字段，DTO 非列 |
| D-004@v1 默认排序 updated_at desc | task-02 | list ORDER BY + sort 参数 |
| D-005@v1 方案B 批量（数据源→D-008） | task-01 | 批量 PG join 复用 _project_current_stage |
| D-006@v1 title 归 sillyspec 不加工 | —（非目标 NG-04） | 平台不动 title 逻辑 |
| D-007@v1 待我处理=进行中聚焦筛选 | task-06 | 主tab 进行中/已归档 + 聚焦开关默认勾 |
| D-008@v1 pending_review 走 PG 镜像 | task-01 | latest_progress.stages + _map，不读 sillyspec.db |

| FR | 覆盖任务 |
|---|---|
| FR-01 主tab+聚焦筛选 | task-06 |
| FR-02 待我处理筛选 | task-02, task-05, task-06 |
| FR-03 ChangeSummary pending_review | task-01 |
| FR-04 默认排序+sort | task-02, task-05, task-06 |
| FR-05 待办徽标 | task-06 |
| FR-06 负责人列 | task-06 |
| FR-07 查询区消留白 | task-06 |
| FR-08 新建主按钮 | task-06 |
| FR-09 空状态CTA | task-06 |
| FR-10 tab计数 | task-06 |
| FR-11 副标题 | task-06 |
| FR-12 删GATE_LABELS | task-06 |
| FR-13 gen:types 同步 | task-04 |

---

## task-01

```yaml
id: task-01
title: ChangeSummary 加 pending_review + service 走 PG 镜像算 pending_review（D-008）
goal: 让列表 ChangeSummary 携带 pending_review，数据来自 PG latest_progress 镜像（非 sillyspec.db），与 current_stage 同源
implementation: |
  1. schema.py: ChangeSummary 加 `pending_review: PendingReview | None = None`
  2. service.py: 新增 `_extract_completed_stages(latest_progress) -> set[str]`（对齐 _extract_current_stage:1298 防御式风格，从 latest_progress 解析 stages 表 status=completed 集合；spike-01 先确认 stages JSON 路径）
  3. service.py: 扩展 `_project_current_stage`/`enrich_summaries`，复用现有批量 join latest_progress，同时取 (current_stage, completed_stages)，调 `StageProjectionService._map`（projection.py:175 纯函数 staticmethod）算 pending_review 填 ChangeSummary
  4. projection.py 仅复用 _map，不改（不新增 sillyspec.db 读取）
acceptance:
  - ChangeSummary 含 pending_review 字段（optional，default None）
  - pending_review 由 latest_progress.stages + _map 算出，service 无 sillyspec.db 直读
  - latest_progress 缺失/解析失败时 pending_review=None（不抛）
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov（test_service 加 _extract_completed_stages + _map 用例）
constraints:
  - 零 migration（pending_review 是 DTO 计算字段，非 changes 表列）
  - 不改 projection.py 的 sillyspec.db 读取逻辑（仅 import 用 _map）
  - spike-01 先确认 latest_progress.stages 路径
depends_on: []
allowed_paths:
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/projection.py
provides:
  - contract: ChangeSummary.pending_review
    fields: [pending_review]
    desc: 列表项携带 pending_review（PG 镜像算出）
expects_from: []
```

## task-02

```yaml
id: task-02
title: list 默认排序 updated_at desc + sort 参数 + pending_review_only 筛选 + router 透传
goal: 列表默认最近活动优先，支持待我处理筛选
implementation: |
  1. service.py list: 默认排序 change_key ASC（service.py:149）→ updated_at DESC；加 sort 参数（默认 updated_at_desc）
  2. service.py list: 加 pending_review_only 筛选（True 时过滤 pending_review 非空；在 enrich_summaries 填充后过滤，或 service 层标记）
  3. router.py: list 端点加 sort、pending_review_only query 参数透传 service
acceptance:
  - 默认排序 updated_at DESC（取代 change_key ASC）
  - list 支持 sort 参数；pending_review_only=True 只返待我处理
  - router 透传两个新 query 参数
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov（test_router list 排序/筛选）
constraints:
  - 默认排序变化属有意行为变化（R-05），更新测试断言
  - pending_review_only 过滤需在 pending_review 填充后（依赖 task-01）
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
provides:
  - contract: list_sort_filter_api
    fields: [sort, pending_review_only]
    desc: list API 支持 sort + pending_review_only
  - contract: ChangeSummary.pending_review
    fields: [pending_review]
    desc: 由 task-01 提供，task-02 在此基础上加筛选
expects_from:
  - contract: ChangeSummary.pending_review
    provider: task-01
    fields: [pending_review]
```

## task-03

```yaml
id: task-03
title: 后端测试（_extract_completed_stages + _map + 排序/筛选/字段）
goal: 覆盖 task-01/02 的行为，含 spike-01 latest_progress.stages 结构验证
implementation: |
  1. test_service.py: _extract_completed_stages（正常/缺失/类型异常）+ _map 算 pending_review 各映射（proposal/plan/human_test/archive_confirm/None）+ enrich_summaries 填充
  2. test_router.py: list 默认排序 updated_at desc、sort 参数、pending_review_only 筛选、ChangeSummary 含 pending_review 字段
  3. 用真实/构造的 latest_progress 样例验证 stages 路径（spike-01 落地）
acceptance:
  - test_service/test_router 新增用例全绿
  - 覆盖 latest_progress 正常 + 缺失降级
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov
constraints:
  - 不改测试逻辑绕过（真实断言）
depends_on: [task-02]
allowed_paths:
  - backend/app/modules/change/tests/test_service.py
  - backend/app/modules/change/tests/test_router.py
provides:
  - contract: backend_tests_green
    desc: 后端 change 模块测试全绿
expects_from:
  - contract: list_sort_filter_api
    provider: task-02
```

## task-04

```yaml
id: task-04
title: gen:types 同步 api-types.ts + openapi.json
goal: 前端类型与后端 schema 同步（ChangeSummary 多 pending_review）
implementation: |
  1. 主仓根目录跑 pnpm gen:types（先 pnpm exec tsc --version 确认 node_modules 健康，R-02）
  2. 确认 frontend/src/lib/api-types.ts ChangeSummary 含 pending_review
  3. 同步 backend/openapi.json
acceptance:
  - api-types.ts ChangeSummary 含 pending_review
  - openapi.json 同步
  - pnpm gen:types 可重现（无无关 drift）
verify:
  - cd frontend && pnpm exec tsc --noEmit（确认类型可用，0 error）
constraints:
  - 主仓根目录跑（规则21，不 cd worktree）
  - 若暴露无关旧债按惯例顺手补
depends_on: [task-02]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: api_types_synced
    fields: [ChangeSummary.pending_review]
    desc: 前端类型含 pending_review
expects_from:
  - contract: ChangeSummary.pending_review
    provider: task-02
```

## task-05

```yaml
id: task-05
title: lib/changes.ts listChanges 加 sort/pendingReviewOnly 参数
goal: 前端 API 客户端支持排序与待我处理筛选透传
implementation: |
  lib/changes.ts listChanges params 加 sort?（"updated_at_desc" 等）+ pendingReviewOnly?，透传 query（sort、pending_review_only）
acceptance:
  - listChanges 支持 sort + pendingReviewOnly 可选参数
  - 透传到后端 query
verify:
  - cd frontend && pnpm test（如有 changes.ts 单测）+ pnpm exec tsc --noEmit
constraints:
  - 参数 optional，不破坏既有调用
depends_on: [task-04]
allowed_paths:
  - frontend/src/lib/changes.ts
provides:
  - contract: listChanges_params
    fields: [sort, pendingReviewOnly]
expects_from:
  - contract: api_types_synced
    provider: task-04
```

## task-06

```yaml
id: task-06
title: page.tsx 列表页整体重做（主tab+聚焦开关+徽标+排序+负责人列+查询区+空状态+新建按钮+副标题+删GATE_LABELS）
goal: 列表页从干表格→待办指挥台，对齐原型方案①
implementation: |
  1. 主 tab 维度统一 location：进行中/已归档（删原 active/archive 之外无谓项）
  2. 进行中视图顶部聚焦开关「☑ 只看待我处理(N)」默认勾上，勾选时调 listChanges(pendingReviewOnly=true)
  3. 每行「待办状态」徽标（proposal_review/plan_review/human_test/archive_confirm→warning；blocked→error），删冗余旧「状态」列
  4. 排序：默认 updated_at desc，列头可切
  5. 新增「负责人」列（owner_id→用户名，空显 —）
  6. 查询区 grid-cols-4 → grid-cols-2 消留白
  7. 「+新建变更」升主按钮（primary）；副标题改 workspace 名 + 待处理计数
  8. 空状态：分场景文案 + 新建 CTA
  9. tab 挂数量
  10. 删死代码 GATE_LABELS（page.tsx:48-59），由真实徽标映射替代
acceptance:
  - 进页面默认进行中+聚焦勾上，显示待我处理变更
  - 徽标/排序/负责人列/查询区/空状态/新建按钮/副标题/tab计数全部到位
  - GATE_LABELS 死代码删除
verify:
  - cd frontend && pnpm test + pnpm exec tsc --noEmit
constraints:
  - 不改详情页（NG-03）
  - 不加工 title（NG-04，维持 fallback change_key 现状）
  - 不做行内审核（NG-06）
  - 文案中文（NFR-04）
depends_on: [task-05]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
provides:
  - contract: changes_page_reworked
    desc: 列表页重做完成
expects_from:
  - contract: listChanges_params
    provider: task-05
  - contract: api_types_synced
    provider: task-04
```

## task-07

```yaml
id: task-07
title: 前端测试（视图/徽标/聚焦开关/空状态/tab计数；列表页 __tests__/ 新建）
goal: 覆盖 task-06 列表页重做行为（新建列表页测试，不涉及详情页）
implementation: |
  1. __tests__/ 新增：主tab切换、聚焦开关默认勾+取消、待办徽标渲染（各 pending_review 值）、空状态CTA、tab计数、排序
acceptance:
  - 新增/更新测试全绿
  - tsc 0
verify:
  - cd frontend && pnpm test + pnpm exec tsc --noEmit
constraints:
  - 不改测试逻辑绕过
depends_on: [task-06]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/
provides:
  - contract: frontend_tests_green
expects_from:
  - contract: changes_page_reworked
    provider: task-06
```
