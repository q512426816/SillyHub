---
author: qinyi
created_at: 2026-08-14 15:18:40
revised_at: 2026-08-14 15:21:00
plan_level: full
---

# 实现计划（Plan）— 变更中心会话驱动化

> 修订记录：plan-review 独立审查双 pass（1P0/7P1 无）；按 P2-1/P2-2 把 task-05、task-10 依赖拉直为 5 Wave（原 4 Wave 中二者与 task-04 同层会抢跑）；P2-3/4/5 为蓝图级说明补入任务说明列与蓝图提示。

## Spike 前置验证

无 Spike。技术方案已经 Design Grill 两轮独立审查（round-1 1P0+7P1 全部修订，round-2 双 pass），无未验证集成或新技术栈。

## 前置已钉死的事实（供各 task 直接引用）

**审批四端点真实路由**（change/router.py:718-838）：`POST /changes/{cid}/proposal-review | /plan-review | /human-test | /archive-confirm`；四端点响应均含 `agent_dispatch` 字段（D-004 删派发后的契约变更点）。

**审批卡按钮 → action/decision 映射**（对齐 frontend lib/changes.ts:567 submitStageReview 分发；human_test 请求字段名为 `result` 非 decision）：

| 阶段(pending_review) | 「通过」→ | 「打回」→ |
|---|---|---|
| proposal_review | proposal_approve（approve） | proposal_revise（revise） |
| plan_review | plan_approve（approve） | plan_replan（replan） |
| human_test | test_pass（pass） | test_bug（bug） |
| archive_confirm | archive_confirm（无 decision，仅 comment） | —（无打回） |

## Wave 1（并行，无依赖）
- [x] task-01: daemon 增量同步 change_dirs 标注（spec-sync.ts 前缀分组 + hub-client.ts:966 postSpecSyncIncremental 签名/body）（覆盖：FR-01a, D-005@v1）
- [x] task-03: 审批不派发 + 投影收敛（review 四方法删派发；推进时 upsert platform_change_progress）（覆盖：FR-05c, D-004@v1）
- [x] task-06: agent-sessions 端点扩展 include_ended + lib/daemon.ts 列表调用加参数（覆盖：FR-03c）
- [x] task-07: 删 change_writer create/proxy-create/execute/documents 端点 + backend 引用清理（覆盖：FR-04b, D-001@v1）

## Wave 2（依赖 Wave 1）
- [x] task-02: backend 增量触发 + scoped reparse 零删除 + 变更-会话绑定（SpecIncrementalSyncRequest 加 change_dirs / apply_ops 事务外触发含兜底与归档走全量 / parser 过滤 / reparse(scope) 零删除守卫 / ChangeSessionLink 模型+migration+绑定查询）（依赖 task-01 契约）（覆盖：FR-01b/c/d, FR-02, D-005@v1, D-007@v1）
- [x] task-08: 前端工作区会话页（workspace-tabs 加 tab + sessions/page.tsx + 抽 WorkspaceSessionSection）（依赖 task-06）（覆盖：FR-03a/b, D-002@v1）
- [x] task-09: 前端去表单（列表页删按钮/CTA + 空态引导会话 + 删 create-change 页 + **删 create-change/__tests__/page.test.tsx** + lib/changes.ts 清理 createChange/proxyCreateChange/executeChange）（依赖 task-07）（覆盖：FR-04a/b, D-001@v1）

## Wave 3（依赖 Wave 2）
- [x] task-04: 审批服务身份注入绑定会话（notify_session 参数 / 后端服务身份注入绕会话归属校验 / notified_session+notify_error 响应 / 三类降级语义）（依赖 task-02 绑定 + task-03）（覆盖：FR-05d, D-006@v2）

## Wave 4（依赖 Wave 3）
- [x] task-05: MCP submit_stage_review docstring/返回契约同步（含 agent_dispatch 契约变更）（依赖 task-03 + task-04）（覆盖：FR-05f, D-004@v1）
- [x] task-10: 详情页退化 + 审批卡（删全部执行控制含 quick 分支 / 保留只读区 / 审批卡按上方映射表 + 三类降级 UI / lib/changes.ts submitStageReview 加 notify_session 透传 / lib/daemon.ts injectSession 不再由审批卡直调）（依赖 task-02、task-03、task-04 响应契约）（覆盖：FR-05a/b/e, D-003@v1, D-006@v2）

## Wave 5（依赖 Wave 1-4）
- [x] task-11: gen:types + 全端测试验收（pnpm gen:types 提交 api-types.ts+openapi.json；pytest 重点用例全绿：scoped 零删除/双兜底路径/绑定 SQL/审批不派发/投影收敛/注入三类降级/端点删除回归；vitest：会话页/空态/详情页/审批卡）
- [x] task-12: 模块文档同步 + 在途基线核对（change/spec_workspace/agent/mcp_gateway/change_writer/daemon/frontend + _module-map.yaml；核对不回退 2026-08-13-spec-sync-visibility 已 commit 改动）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon change_dirs 标注 | W1 | P0 | — | FR-01a, D-005@v1 | spec-sync.ts + hub-client.ts:966 |
| task-02 | backend 增量触发+scoped reparse+绑定 | W2 | P0 | task-01 | FR-01b/c/d, FR-02, D-005@v1, D-007@v1 | 命门全链，零删除守卫为验收红线；**蓝图阶段拆 02a(schema+apply_ops触发+兜底)/02b(parser过滤+reparse零删除守卫)/02c(ChangeSessionLink模型+migration+绑定查询)** 三步 |
| task-03 | 审批不派发+投影收敛 | W1 | P0 | — | FR-05c, D-004@v1 | change/service.py review 四方法 |
| task-04 | 审批服务身份注入 | W3 | P0 | task-02, task-03 | FR-05d, D-006@v2 | 绕会话归属校验，best-effort |
| task-05 | MCP 契约同步 | W4 | P1 | task-03, task-04 | FR-05f, D-004@v1 | mcp_gateway/tools.py:1029 |
| task-06 | agent-sessions include_ended | W1 | P1 | — | FR-03c | agent/router.py:544 扩展非新增 |
| task-07 | 删 change_writer 端点 | W1 | P0 | — | FR-04b, D-001@v1 | 含 documents/* 五端点 + 引用清理 |
| task-08 | 前端会话页 | W2 | P0 | task-06 | FR-03a/b, D-002@v1 | 复用 InteractiveSessionPanel |
| task-09 | 前端去表单 | W2 | P0 | task-07 | FR-04a/b, D-001@v1 | 含删 create-change 测试 |
| task-10 | 详情页退化+审批卡 | W4 | P0 | task-02, task-03, task-04 | FR-05a/b/e, D-003@v1, D-006@v2 | quick 分支一并删除 |
| task-11 | gen:types+全端测试验收 | W5 | P0 | task-01~10 | FR-06a | TDD 用例随各 task 先行，此处收口 |
| task-12 | 模块文档+基线核对 | W5 | P1 | task-01~10 | FR-06b | 含 spec-sync-visibility 共存核对 |

## 关键路径

task-01 → task-02 → task-04 → task-10 → task-11（同步链 → 绑定 → 注入 → 前端审批卡 → 测试收口；为最长路径，5 Wave）。

## 全局验收标准
- [ ] agent 在会话里经 sillyspec 新建变更 → 增量同步后自动出现在平台列表（新 daemon 标注路径 + 旧 daemon 前缀兜底路径双验证）
- [ ] scoped reparse 零删除（范围外/范围内消失均不删；删除仅全量/手动）——测试红线
- [ ] 变更中心无任何「新建变更」入口；工作区一级「会话」tab 可发起/回看会话（含已结束）
- [ ] 详情页无任何执行控制按钮（含 quick 分支）；审批通过/打回按映射表落库、投影立即收敛、绑定会话收到注入消息
- [ ] 注入三类降级（turn 冲突/会话非 active/异常）不回滚审批
- [ ] cd backend && uv run pytest -q --no-cov 全绿（含新用例）；frontend pnpm test 全绿；pnpm gen:types diff 干净
- [ ] 2026-08-13-spec-sync-visibility 已 commit 改动零回退（git diff 核对）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-07, task-09 | 全局验收第 3 条 |
| D-002@v1 | task-08 | 全局验收第 3 条 |
| D-003@v1 | task-10 | 全局验收第 4 条 |
| D-004@v1 | task-03, task-05 | 全局验收第 4 条 |
| D-005@v1 | task-01, task-02 | 全局验收第 1/2 条 |
| D-006@v2 | task-04, task-10 | 全局验收第 4/5 条 |
| D-007@v1 | task-02 | FR-02 绑定 SQL 测试 |
| FR-01~FR-06 | task-01~task-12 | 见任务总表覆盖列 |
