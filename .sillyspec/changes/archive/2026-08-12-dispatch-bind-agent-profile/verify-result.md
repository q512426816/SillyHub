---
author: WhaleFall
created_at: 2026-08-12T14:50:00
change: 2026-08-12-dispatch-bind-agent-profile
verdict: PASS WITH NOTES
---

# 验证报告：变更详情页阶段操作区接入智能体档案

## 结论

**PASS WITH NOTES** — 代码层验证全通过（修复了首轮 verify 发现的 page-team-toggle.test.tsx 回归）。剩余 note：端到端集成（rebuild + 部署 + 前端选档案触发 dispatch 实测 lease.metadata）未执行，留部署阶段。

> 本变更为 deployment-critical（lease/agent_run 字段透传到 daemon spawn）。PASS WITH NOTES 需真实 Runtime Evidence，下方已列代码层证据；端到端实测留部署后补，属已知 note 非 blocker（改动复用已实现的 claim 消费链路，无 daemon 代码变更）。

## 首轮 verify 发现的回归（已修复）

首轮 verify 发现 `page-team-toggle.test.tsx` 漏改（task-13 遗漏）：
- tsc 报 8 处 TS2739（ChangeStageActions Props 缺 workspaceId/stageProfileId/onStageProfileChange）
- vitest 8 测试失败（AgentProfileSelect 内部 react-query hook 需 QueryClientProvider）

**修复**（回 execute 补）：
1. makeProps 去旧 stageProvider/stageModel 4 字段，加 workspaceId/stageProfileId/onStageProfileChange
2. 加 `vi.mock("@/components/agent-profile-select")` 避免 react-query 依赖
3. design §5 补列 page-team-toggle.test.tsx（原漏列）

修复后：tsc 全过、vitest 26 测试全过（page-team-toggle 8 + stage-team-config 9 + change-stage-actions 9）。

## 任务完成度

15/15 task 全部完成：

| task | 状态 |
|---|---|
| task-01~04 | ✅ 后端单 agent 透传（schema/service/dispatch/router）|
| task-05 | ✅ test_dispatch_agent_profile.py 4 测试 |
| task-06 | ✅ MCP advance_change_stage 加 agent_profile_id |
| task-07 | ✅ worker_preset schema 注释 |
| task-08 | ✅ dispatch_worker 补调 _apply_profile_to_lease（修 GAP-6）|
| task-09~12 | ✅ 前端 UI 重构 |
| task-13 | ✅ 前端组件测试更新（含首轮漏的 page-team-toggle.test.tsx 已补）|
| task-14 | ✅ gen:types（api-types.ts/openapi.json 含 agent_profile_id）|
| task-15 | ✅ 验收 |

## 设计一致性

对照 design.md §5（17 文件清单，含补列的 page-team-toggle.test.tsx）+ §8（8 条验收）：

- D-001~D-005 全遵循（每次操作单独选档案 / UI 方案 A / 后端方案 B 全透传 / system_prompt 排除 / 团队主 agent + 每 worker 选档案）。
- 复用契约：未改 agent/service.py（start_stage_dispatch 形参 :1224 复用）、未改 daemon、_apply_profile_to_lease（:638）复用未重写。
- §8 八条验收全过（UI 合并 / 零回归 / lease.metadata 字段 / 团队选档案 / MCP 双入口 / gen:types / 测试 / FR-08 提示文案）。

## 探针结果

- 探针 1（未实现标记）：无新增 TODO/FIXME。✅
- 探针 2（关键词覆盖）：全覆盖。✅
- 探针 3（测试覆盖）：齐全；⚠️ 集成盲区（路由端到端未集成测，单测覆盖透传）。
- 探针 4（决策闭环）：D-001~D-005 全闭环，无 P0/P1。✅
- 探针 5（API 契约）：前后端 agent_profile_id 对齐。✅
- 探针 6（代码删除）：无删除。✅

## 测试结果

| 套件 | 结果 |
|---|---|
| 后端 test_dispatch_agent_profile.py | 4 passed |
| 后端 test_dispatch_worker_profile.py | 3 passed |
| 后端 test_dispatch_profile.py（回归）| 16 passed |
| 后端 ruff（change/agent/mcp）| All passed |
| 后端 mypy（6 改动文件）| Success, no issues |
| 前端 vitest change-stage-actions | 9 passed |
| 前端 vitest stage-team-config | 9 passed |
| 前端 vitest page-team-toggle | 8 passed（修复后）|
| 前端 tsc typecheck（全量）| exit=0（修复后）|
| 前端 eslint | 1 warning（stage-team-config.tsx:52 interface 参数 `next` 未用，pre-existing 非本次引入）|
| 后端 change/agent 全量 pytest | 未跑（大测试超时，留部署后）|

## 变更风险等级

**deployment-critical**（lease/agent_run 字段透传到 daemon spawn agent）。

daemon 代码本变更未改（复用现有 claim 消费），但 agent_profile_id 入口字段流转到 daemon 侧影响 agent 实际跑起来的 provider/凭证/allowed_roots。

## Runtime Evidence（deployment-critical 自报告）

⚠️ 端到端集成未执行（未 rebuild + 部署 + 实测）。代码层证据：

1. **后端透传链路**：test_dispatch_agent_profile.py（4 测试）mock 验证 agent_profile_id 从 dispatch() 透传到 start_stage_dispatch；test_dispatch_worker_profile.py（3 测试）验证 dispatch_worker 补调 _apply_profile_to_lease。
2. **lease.metadata 写入**：_apply_profile_to_lease（service.py:638，复用未改）由 test_dispatch_profile.py::TestApplyProfileToLease 覆盖（写 effective_allowed_roots/mcp_refs/skill_refs/profile_version/llm_provider_id 五键）。
3. **claim payload 消费**：daemon/lease/context.py:build_claim_payload 读 metadata（本变更未改 daemon，前序已实现 + 测试覆盖）。
4. **MCP 双入口**：advance_change_stage tool 加 agent_profile_id（tools.py:966）。
5. **前端契约**：api-types.ts TransitionRequest 含 agent_profile_id（gen:types 验证）；前端 vitest 26 测试过。

**端到端待办**（部署后）：rebuild backend+frontend → 前端选档案触发 dispatch → 查 lease.metadata 含档案字段 → agent 实际用档案 provider 跑起来。

## Notes

1. **system_prompt/skill/mcp 本次不生效**（D-004 排除）：选了档案后生效字段 = provider/model/凭证/allowed_roots；system_prompt/skill/mcp 链路修复放下个变更。UI 已标注提示文案。
2. **eslint pre-existing warning**：stage-team-config.tsx:52 interface 参数 `next` 未用（原版 HEAD 同签名，非本次引入）。
3. **后端全量 pytest 未跑**：change/agent 模块大测试超时，跑的是 profile 相关 23 测试 + 改动文件 ruff/mypy。全量回归留部署后。
