---
author: qinyi
created_at: 2026-10-02
plan_level: full
---

# 实现计划（Plan）

## 来源
用户需求（2026-10-02）：「目前本地 agent 这类信息不是也上报了 token 信息到平台吗，我想在变更中心可以展示对应的执行用量信息，跟在平台上执行展示的一致（反正数据都能获取到）」。brainstorm 四件套 + decisions D-001@v1/D-002@v1 为唯一直接来源，不重新扩写。

## Wave 1 — 后端存储层（无依赖）
- task-01

## Wave 2 — 摄取链路与聚合扩展（依赖 task-01；两任务文件正交可并行）
- task-02
- task-03

## Wave 3 — 前端展示与契约收口（依赖 task-03 聚合口径定稿）
- task-04

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | target_files | 说明 |
|---|---|---|---|---|---|---|---|
| task-01 | 存储层迁移 | W1 | P0 | — | FR-01, FR-04, D-002@v1 | NEW:backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py; backend/app/modules/platform_sync/model.py | alembic up/down + AgentSessionLogORM 5 列（四维 BigInteger NULL + usage_parsed_at DateTime NULL） |
| task-02 | 摄取链路（服务+接线+单测） | W2 | P0 | task-01 | FR-01, FR-04, D-002@v1 | NEW:backend/app/modules/platform_sync/usage_ingest.py; backend/app/modules/platform_sync/router.py; backend/app/modules/platform_sync/schema.py; NEW:backend/app/modules/platform_sync/tests/test_usage_ingest.py | 候选筛选/节流/Semaphore(3)/覆盖写/全降级；push_agent_logs commit 后 fire_background_task；scope 构造按 design Grill B-1 裁定；单测覆盖候选/节流/幂等/离线/method_not_found + test_agent_log_push 不回归锚定 |
| task-03 | 聚合本地段（三处+单测） | W2 | P0 | task-01 | FR-02, D-001@v1, D-002@v1 | backend/app/modules/change/usage_service.py; backend/app/modules/change/schema.py; backend/app/modules/change/tests/test_usage_stats.py | 详情/列表/quicklog 本地段（NOT EXISTS 会话级二选一 +「本地 CLI」桶 + totals=Σby_model 守恒 + 不贡献三元组/轮次/请求）；单测：纯本地/混合双计防护/共享会话/存量 NULL/quicklog/列表批量 |
| task-04 | 前端展示与契约收口 | W3 | P0 | task-03 | FR-03, FR-04, D-001@v1 | frontend/src/components/changes/detail/change-usage-card.tsx; frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx; frontend/src/lib/api-types.ts; backend/openapi.json | 「本地 CLI」绿阶桶 tag + 请求列「—」+ 注脚双 kind 更新 + hasNoExecution 纯本地行为验证；先跑 pnpm gen:types 复核零 diff（意外 diff 查明再同步）；组件测试补桶行用例；聚焦回归（tsc + 组件测试）并入本卡 acceptance |

## 关键路径
task-01 → task-02/task-03（并行）→ task-04（聚合测试并入 task-03 后即收口，无独立回归卡——各卡 acceptance 内联聚焦回归，全量留 CI）

## 执行模式
execution_mode 缺省 main（主代理直写）：单任务规模均 <30min、上下文无需分片；Wave 2 两任务文件正交但收益不抵派发税（R8 对撞实证）。

## 全局验收标准
1. 摄取：上报后 `platform_agent_logs` 候选 entry 出现非空四维快照 + usage_parsed_at；daemon 离线/method_not_found/超时/unsupported/too_large/null 全部静默跳过仅记日志，上报响应时延与语义不变；同 entry size+mtime 未变且 300s 内不重复解析（节流）；覆盖写幂等（重复摄取结果一致）。
2. 聚合：纯本地变更 totals 含本地量、by_model 出现「本地 CLI」桶（api_requests=0）、totals=Σby_model 守恒；同会话有 runs 时不双计（run 权威）；本地段不贡献时间三元组/轮次/请求次数；存量 NULL 快照不计入；quicklog 同口径；列表批量零 N+1。
3. 前端：用量卡明细表「本地 CLI」绿阶 tag 行（请求列「—」，命中率照常）；注脚声明本地 CLI 口径（change/quicklog 双 kind）；纯本地变更（三元组 None+totals 非 0）不触发「尚无关联执行」空态；列表「执行」列 token 总量自动并入；取数失败静默降级不回归。
4. 契约：gen:types 复核零 diff（或意外 diff 查明原因后同步提交）；`cd backend && uv run pytest app/modules/platform_sync app/modules/change -q --no-cov` 聚焦测试全绿；`cd frontend && pnpm test -- change-usage-card && pnpm exec tsc --noEmit` 通过。
5. 兼容：迁移可 downgrade；旧 daemon method_not_found 降级路径有测试锚定；DTO 结构不变、既有测试不回归。

## 全局硬约束（绑定所有 task，执行期子代理必读；逐字绑定 design.md）
- 摄取为 best-effort 异步（不阻塞上报响应、失败不抛）；解析口径全量幂等（每次覆盖写快照）。
- daemon 零改动（只复用既有 RPC method 与解析器）。
- 本地段不贡献轮次、请求次数、时间三元组（解析器无请求数/轮次数据；first/last_seen 是上报时间非执行时间，不掺和）。
- totals = Σ by_model 口径守恒（「本地 CLI」桶行 api_requests=0 保证不变量延续）。
- 聚合本地段会话级二选一：`NOT EXISTS (agent_runs WHERE agent_session_id = s.id)`——run 为权威终态，快照只补 run 缺失的会话，防双计。
- API 兼容：`/changes` 列表、`/changes/{cid}/usage`、quicklog 端点 DTO 结构不变（本地量并入既有字段），旧前端无破坏。
- 平台 MUST NOT 基于 provisional 事件内容做流程判定（仓库既有红线，本变更不触碰）。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04 | AC-2（本地 CLI 会话用量并入变更中心聚合）、AC-3（前端展示） |
| D-002@v1 | task-01, task-02, task-03 | AC-1（上报链路顺带解析落库 best-effort）、AC-2（聚合第二数据源段） |
