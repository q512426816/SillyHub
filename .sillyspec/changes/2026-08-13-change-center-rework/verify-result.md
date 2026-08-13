---
author: qinyi
created_at: 2026-08-13 13:25:00
change: 2026-08-13-change-center-rework
risk_level: unit-sufficient
---

# 验证报告 — 变更中心列表页整体重做

> change: `2026-08-13-change-center-rework`（commit 549d42b5 进 main）
> verify 执行者：QA 视角（主代理 + execute 独立 stage review QA 子代理）
> design frontmatter `risk_level: unit-sufficient`；§7.5 明确不涉及生命周期契约

## 结论

**PASS WITH NOTES**

7 task 全部实现并 commit（549d42b5），测试全绿（backend 241 passed / frontend 26 passed / mypy ruff tsc 全 0），设计一致性 22 checklist 19 pass + 3 gap（P2 文档/边界级，不阻断）。3 gap 已如实记录，建议后续 quick 评估 gap② 分页精度。

## 任务完成度（7/7 = 100%）

| task | 内容 | 状态 |
|---|---|---|
| task-01 | ChangeSummary 加 pending_review + service 走 PG latest_progress 镜像 + _map（D-008 不读 sillyspec.db） | ✅ |
| task-02 | list 默认排序 updated_at desc + sort 白名单防注入 + pending_review_only 筛选 + router 透传 | ✅ |
| task-03 | 后端测试（_extract_completed_stages 8 分支 + _map 7 分支 + 排序/筛选/字段） | ✅ |
| task-04 | gen:types 同步 api-types.ts + openapi.json（ChangeSummary pending_review） | ✅ |
| task-05 | lib/changes.ts listChanges 加 sort/pendingReviewOnly 参数 | ✅ |
| task-06 | page.tsx 列表页重做（主tab挂数量+聚焦开关默认勾+待办徽标+排序列头+负责人列+查询区grid-cols-2+空状态CTA+新建主按钮+删GATE_LABELS） | ✅ |
| task-07 | 前端测试 18 用例（视图/徽标/聚焦开关/空状态/tab计数/排序/负责人） | ✅ |

## 探针报告（6 探针全通过）

1. **未实现标记**：变更文件无真 TODO/FIXME/HACK/XXX（grep 命中 key:"todo"=待办列 key、api-types generated 的 PPM workbench todos 端点、既有 .change.xxx 手写注释，均非技术债标记）
2. **关键词齐全**：design 核心概念（pending_review / latest_progress.stages 顶层数组 / _map / 聚焦开关 / 徽标）全实现
3. **测试覆盖**：test_enrich_projection 25 + test_router 17 + page.test.tsx 18 + mypy/ruff/tsc 0
4. **决策闭环**：decisions D-001~008 全 accepted，无 P0/P1 unresolved，无 superseded 被下游误引
5. **API 契约**：endpoints.json（task-02）GET /api/workspaces/{workspace_id}/changes + sort/pending_review_only query；openapi/api-types 含 pending_review（3 处）
6. **代码删除对账**：GATE_LABELS（baseline page.tsx:48）+ TYPE_KIND/TYPE_LABEL + 旧 status 列已删（FR-12），无意外删除

## 设计一致性（execute stage review 22 checklist）

独立 QA 子代理（tier=independent，未参与实现）对照 design.md 逐项核验：19 pass + 3 gap。核心不变量坐实：
- **D-008**：enrich_summaries 调 StageProjectionService._map（@staticmethod 纯函数，仅基于 (current_stage, completed_stages) 映射不触 db）；列表 READ 全程不读 sillyspec.db（R-03 消除）
- **D-003**：零 migration（model.py/alembic 未动，pending_review 是 DTO 计算字段）
- **D-007**：聚焦开关 focusMine=useState(true) 默认勾 + pendingReviewOnly 透传
- **NG-03**：enrich_with_workspace_ids 详情只取 stage_info[0]，pending_review 恒 None（test_enrich_detail_read_pending_review_stays_none 显式验证）

## 决策追踪矩阵

| 决策 | FR | task | evidence |
|---|---|---|---|
| D-001 列表层做透 | FR-01 | task-06 | page.tsx 重做不改详情页 |
| D-002 全局待人工 | FR-02 | task-02/06 | pending_review_only + 聚焦开关 |
| D-003 零 migration | FR-03 | task-01 | schema pending_review optional |
| D-004 排序 updated_at desc | FR-04 | task-02 | list ORDER BY + sort 白名单 |
| D-005 方案B 批量投影（呈现→D-007 / 数据源→D-008 supersede） | FR-03 | task-01 | enrich_summaries 批量 _project_current_stage 复用单次 PG join |
| D-006 title 归 sillyspec | NG-04 | — | 平台不动 title |
| D-007 聚焦筛选默认勾 | FR-01 | task-06 | 主tab + 聚焦开关 |
| D-008 PG 镜像 | FR-03 | task-01 | latest_progress.stages + _map |

## 质量扫描

- backend ruff check app/modules/change：All checks passed
- backend mypy app/modules/change：Success, no issues found in 30 source files
- frontend eslint：只 Warning（预存 use-agent-run-stream.test/kanban no-unused-vars，非本 change）
- frontend tsc --noEmit：exit 0
- 测试：backend change 241 passed / 2 skipped / 1 failed（唯一 fail = test_dispatch test_all_expected_stages_present 预存债，STAGE_AGENT_CONFIG quick key 来自 2026-08-12-quick-independent-stage commit，git ancestry 证明 baseline 320bf97a 即 fail，非本变更回归）；frontend vitest changes 26 passed

## Runtime Evidence（集成/部署证据）

**N/A**。本变更 `risk_level: unit-sufficient`，design §7.5 明确「不涉及生命周期契约：不新增/修改 session/lease/agent_run/daemon/lifecycle/state_transition」。pending_review 是对 PG latest_progress 镜像的只读解析 + _map 纯函数映射，列表排序/筛选是只读查询，不改变任何运行时状态机；变更推进/审核仍走既有详情页 review 端点（NG-03 不改详情）。无需 daemon↔backend 真实集成 e2e，单元测试（含 latest_progress 构造样例 + _map 边界 + enrich 各映射）验证充分。

## 代码审查

7 commits / 10 代码文件 / 1294+152-。projection.py 复用未改（design 要求）。代码风格（CONVENTIONS：Service _session/list_/防御式/double quote）+ 安全（_resolve_order_by 白名单防注入）+ 错误处理（latest_progress 缺失降级 None fail-closed）+ 冗余清理（GATE_LABELS/TYPE_*/旧 status 列）+ 架构（monorepo 分层）全 OK。详见 execute step 13 + stage review reviewerNotes。

## Gap / 风险（3 条，P2，不阻断）

1. **测试文件落位**：design §6 标 `tests/test_service.py`，实现落 `tests/test_enrich_projection.py`（投影测试既有家 + 复用 fixture，test_service.py 不存在）。功能完全覆盖，仅文件名与清单不符。
2. **pending_review_only 过滤层级 + 待我处理(N) 计数精度**：design §7 service.list 签名列 pending_review_only，实现因 pending_review 是计算字段（非 SQL 列）改为 router 层 Python post-filter（技术合理）。副作用：SQL 先取 page_size 条再 filter，当待处理条目 > page_size（默认 20）时「待我处理(N)」+ 副标题 N 偏低、分页偏移；典型 workspace（待处理 < 20）准确。design §9 未严格定分页精度。建议后续 quick 评估 SQL 子查询/两阶段计数。
3. **design §8 措辞瑕疵**：称 enrich_with_workspace_ids「不调投影」，实际它调 _project_current_stage（仅取 current_stage，不设 pending_review）。NG-03 不变量成立且有测试，非实现缺陷。

## 技术债标注（CONCERNS）

本 change 触碰 frontend（列表页重做），沿用既有 UI 库（antd 6 + Tailwind 3.4 + Radix，CLAUDE.md rule19），**未新增技术债**。预存 frontend 技术债（antd+Tailwind 混合 / playwright+puppeteer 重叠 / next 14.2.5 硬钉 / Docker healthcheck 误报）与本变更无关，不在本次范围。

## 下一步

PASS WITH NOTES → `sillyspec run archive --change 2026-08-13-change-center-rework` 归档。
gap②（分页精度）建议后续 quick 评估。
