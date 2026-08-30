---
author: qinyi
created_at: 2026-08-30 19:10:20
---

# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS WITH NOTES

10/10 任务完成、六个探针机械项全过、主仓 apply 后复测全绿（后端 20 用例/前端 63 用例/tsc 0 错）、真实启动冒烟通过（Runtime Evidence 见专节）。两条 NOTE 均非本变更缺陷：①探针 6 报两处未声明删除（docs/sillyspec 两个 md）系并行会话 daemon-self-heal 的目录搬迁（docs/sillyspec → finished，会话开始前已存在），与本变更无关；②主仓 frontend node_modules 半坏系环境问题，已按 CLAUDE.md 规则 21 pnpm install --force 修复。

## 任务完成度

| task | 状态 | 证据 |
|---|---|---|
| task-01 DTO 契约 | ✅ | schema.py 四 DTO + 两 usage 字段（c1666eed）；pydantic schema 解析冒烟过 |
| task-02 聚合服务 | ✅ | usage_service.py ChangeUsageQueryService 四方法；SQL 语义与 design 逐字对齐（execute 验收审查 pass） |
| task-03 批量投影接线 | ✅ | enrich_summaries 尾段 + quicklog 组装处；test_enrich_projection 32 passed 零回归 |
| task-04 两端点 | ✅ | router.py 492/1283；404/403/401 用例全过（含 deleted 200 修正口径） |
| task-05 聚合测试 | ✅ | test_usage_stats.py 20 用例（主仓复测 20 passed） |
| task-06 契约生成 | ✅ | gen:types 幂等（两跑哈希一致）；api-types/openapi 四 schema+两字段+两端点 |
| task-07 用量卡组件 | ✅ | change-usage-card.tsx + 7 用例全绿 |
| task-08 列表执行列 | ✅ | page.tsx「执行」列 + quicklog-table 同款；52/52 绿（含 page.test 断言收敛修正） |
| task-09 详情接线 | ✅ | [cid]/page.tsx:351 + drawer:240；drawer 4/4 + 详情页 18/18 |
| task-10 回归收口 | ✅ | plan 全局验收 6 条逐条 PASS；497 passed 2 skipped 零回归 |

完成率 10/10 = 100%。

## 设计一致性

与 design.md 一致，两处 execute 期已文档化修正（design 同步改，非未声明偏离）：
1. **deleted 变更 usage 端点 = 200 非 404**：原设计「对齐既有详情端点防复活口径→404」前提经 task-04 核实不成立（既有 GET /changes/{cid} 对 deleted 返回 200，防复活是 enrich 投影层过滤）。design.md 边界口径段/requirements FR-03/task-04/05 卡已同步修正，测试 test_deleted_change_200 按修正口径锁定并以既有详情端点为互锚。
2. **摘要 token 口径与详情严格同源**：design 只写「UNION 后 GROUP BY」，实现补齐「每 run 有明细→明细 SUM，无→run 四维列」CASE（保证列表摘要与详情卡数字严格一致），属保守扩展不违反任何决策。
其余（去重集合 SQL、两段聚合、时间三元组、批量投影零 N+1、命中率公式、四态组件、双主题）逐项与 design 一致。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx

#### 探针 2：设计关键词覆盖
- ✅ 关键词覆盖（agent grep 复核）：usage_service.py（ChangeUsageQueryService/summarize_changes/summarize_quicklogs/get_change_usage/get_quicklog_usage）、schema.py（ChangeUsageRead/UsageSummaryRead/UsageTotalsRead/UsageByModelItemRead/usage 字段×2）、router.py（两端点装饰器）、change-usage-card.tsx（ChangeUsageCard/cacheHitRate）、quicklog-table.tsx+page.tsx（「执行」列/UsageExecCell）——design 全部能力关键词在源码命中，无未实现。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-02: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-03: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-04: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-05: 模块目录（backend/app/modules/change/tests）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-06: 模块目录（backend、frontend/src/lib）找到 59 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-07: 模块目录（frontend/src/components/changes/detail、frontend/src/components/changes/detail/__tests__）找到 10 个测试文件（frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-review-history-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx …）
- ✅ task-08: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/changes、frontend/src/components/changes、frontend/src/components/changes/__tests__）找到 18 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx …）
- ✅ task-09: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]、frontend/src/components/changes）找到 13 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx、frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-review-history-card.test.tsx …）
- ✅ task-10: 模块目录（frontend/src/lib、backend、frontend/src/components/changes/detail）找到 69 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
- ✅ 决策闭环（agent 复核）：D-001→FR-01→task-02/05（时间三元组用例）✓；D-002→FR-02→task-02/05（并集去重/共享会话用例）✓；D-003→FR-04→task-01/02/03（零迁移+批量投影）✓；D-004→FR-04/05→task-08/09（列表+详情）✓；D-005→FR-03→task-04/06（独立端点+契约）✓；D-006→FR-02→task-02/05（软删计入用例）✓；D-007→FR-05→task-07（useQuery）✓。无未闭环决策，无 P0/P1 unresolved。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 4016 backend endpoints (live [scan-root 525] + artifact 3675), 0 frontend calls [scope: change-diff (25 files @ scan-root)] | 1288 backend endpoints unused by frontend
- ⚠️ 1288 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-08-29-endpoints-extract-worktree-pitfalls.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-08-29-pre-commit-stash-busy-tree-silent-nocommit.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果

| 命令（主仓 apply 后复测） | 结果 |
|---|---|
| cd backend && uv run pytest app/modules/change/tests/test_usage_stats.py -q --no-cov -n auto | 20 passed（18.4s） |
| cd backend && uv run pytest app/modules/change -q --no-cov -n auto（worktree execute 期） | 497 passed, 2 skipped（既有 skip：propose stage 移除标记） |
| cd frontend && pnpm exec vitest run change-usage-card + quicklog-table/drawer + page.test（4 文件） | 63 passed（14.6s） |
| cd frontend && pnpm exec tsc --noEmit | 0 错误 |
| cd backend && uv run ruff check/format app/modules/change + mypy app | 0 问题（mypy 806 文件 Success） |

known_failures 豁免：无需引用（本次全部真实通过，无失败行）。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 执行时间口径 | FR-01 | task-02, task-05 | usage_service.py MIN/MAX/SUM；test_time_triple_null_combinations 四组合 | 闭环 |
| D-002@v1 并集去重 | FR-02 | task-02, task-05 | union(dispatched, linked) 子查询；test_union_dedup_dual_anchor + shared_session 两用例 | 闭环 |
| D-003@v1 实时聚合零迁移 | FR-04 | task-01/02/03 | 无 migrations 文件；DTO 计算字段批量单查询 | 闭环 |
| D-004@v1 列表+详情 | FR-04/05 | task-08, task-09 | 两「执行」列 + 两渲染点接线 + 测试 | 闭环 |
| D-005@v1 独立端点 | FR-03 | task-04, task-06 | 两 GET 端点 + api-types 路径；真实启动 401 守卫 | 闭环 |
| D-006@v1 软删计入 | FR-02 | task-02, task-05 | SQL 无 deleted_at 过滤；test_soft_deleted_session_runs_counted | 闭环 |
| D-007@v1 useQuery | FR-05 | task-07 | change-usage-card useQuery（queryKey 三要素） | 闭环 |

## 技术债务

探针 1：design 清单文件 0 命中 TODO/FIXME。遗留观察（非债务）：①变更列表 page.test 对「执行」列仅断言列头存在（quicklog 侧有数值断言），可后续补强；②口径注脚仅随明细展开可见（对齐原型布局，FR-05 未要求常显）。

## 变更风险等级

显式声明 = contract-required（design frontmatter）。理由成立：DTO/API 契约变更（两新端点+两列表字段）驱动前后端联动。design 命中 daemon/backend/session 关键词均为**读侧聚合**语境（SELECT agent_runs/agent_sessions），紧邻「不涉及生命周期契约」豁免（纯只读零状态变更、不改 daemon 代码）——集成证据以真实启动冒烟 + AsyncClient 端到端用例补足（见 Runtime Evidence），未静默降级。

## Runtime Evidence

真实集成（本变更代码 + 本地真实 PG/Redis，2026-08-30 19:10 本地）：

- 启动命令：cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8765（真实启动一次本变更触及的服务入口）
- GET /api/health → 200 {"status":"ok","db":"ok","redis":"ok","environment":"dev"}
- GET /api/workspaces/<uuid>/changes/<uuid>/usage（无鉴权）→ **401**（登录状态已失效，request_id=056cae9d…，HTTP_401_AUTH_TOKEN_MISSING）——端点真实挂载且鉴权守卫生效
- GET /api/workspaces/<uuid>/quicklog-entries/ql-smoke/usage（无鉴权）→ **401** 同上
- GET /api/openapi.json → 200，live schema 含 usage 路径（grep 命中）
- 日志片段：INFO: "GET /api/workspaces/…/changes/…/usage HTTP/1.1" 401 Unauthorized；quicklog 同款；slow.request/openapi 200
- 鉴权后 200 路径：pytest AsyncClient 端到端用例（test_usage_stats.py 端点族——真实 app+真实 DB 造数精确对账，含 200/403/404/401 全矩阵）
- 生命周期终态断言：不涉及（纯只读，无状态变更）
- 失败模式排除：取数失败/404 → 前端渲染「暂无用量数据」边界态（组件用例⑥）；无执行 → 引导文案（用例⑦）
- commit 链：57361720（spec brainstorm+plan）→ c1666eed（feat 实现 17 文件）→ 9a7c5b34 附近（execute 收尾 spec + 注释修正 890eca31 在 worktree 分支）

## 代码审查

- execute 独立验收审查（10 项核验）pass/pass：FR-01~05/D-001~007/契约/兼容/越界审计（1 处有据越界已复核最小意图保持）/测试真实执行抽查
- 注释笔误 1 处已修（quicklog.ts D-007→D-006，worktree 890eca31）
- 探针 6 两处未声明删除属并行会话搬迁（非本变更），git 事实已核对
- 总体评价：实现与设计高度一致，SQL 聚合语义有精确对账测试锁定，无 P0/P1 问题
