---
author: qinyi
created_at: 2026-09-11 21:40:00
plan_level: full
---

# 实现计划（Plan）— 工作区↔平台资产桥

> full：6 task / 跨 backend+daemon+frontend / 表列变更+partial 索引 / daemon 分发链。
> decisions：D-001~D-010 全 accepted。

## Spike 前置验证
不需要（锚点经 Grill 源码核验：manifest 签名/skill-manager 拉取点/表约束/写路径/解密先例全在案）。

## Wave 1（表+双 scope）

- task-01

## Wave 2（MCP import）

- task-02

## Wave 3（收编）

- task-03

## Wave 4（daemon 分发）

- task-04

## Wave 5（前端 skills 页）

- task-05

## Wave 6（前端 mcp 页+生成物）

- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 迁移+双 scope+toggle+D-010 谓词 | W1 | P0 | — | FR-01, D-003/D-010 | workspace_id 列+双 partial；四处 NULL 谓词各有回归 |
| task-02 | MCP import 端点 | W2 | P0 | task-01 | FR-02, D-004/D-009 | get_server_for_import(user)+三态契约 |
| task-03 | 收编两端点 | W3 | P0 | task-01 | FR-03, D-005/D-008 | 归一化+差集三源排除 |
| task-04 | daemon per-workspace 分发 | W4 | P0 | task-01 | FR-01, D-007 | manifest ?workspace_id+槽位+两路径选槽 |
| task-05 | workspace skills 页区块 | W5 | P1 | task-01, task-03 | FR-04 | 平台库启用+收编入口 |
| task-06 | mcp 页选入+gen:types | W6 | P1 | task-02, task-05 | FR-04 | 弹窗+双仓生成物 |

## 关键路径
task-01 → 02/03/04（三支并行）→ 05 → 06。W5 内 05→06 串行（共享生成物收口）。

## 全局验收标准
1. backend：uv run pytest app/modules/skill_source app/modules/workspace app/modules/mcp_registry app/modules/daemon/tests/test_skills_bundle.py -q（plan-review G-1：含 mcp_registry 回归与 version hash 零回归直接落点）
2. daemon：pnpm vitest run tests/skill-manager 相关+新增 per-workspace 用例+tests/task-runner-skill-detect.test.ts（A-2 连带）+ typecheck
3. 三零回归：user 维度 version hash 零变化（显式断言）；list_library/toggle/收集 NULL 谓词四处各有用例
4. 真注入：workspace 启用→manifest(?workspace_id) 并集含该技能（HTTP 实测）；daemon 槽位用例
5. import/adopt 契约：三态+归一化+409 各有测试
6. 前端：两页用例+tsc；gen:types 零漂移

## 覆盖矩阵

| ID | 覆盖任务 | 证据 |
|---|---|---|
| D-002/D-003 并集/单表 | 01,04 | AC-3/4 |
| D-007 daemon 分发 | 04 | AC-2/4 |
| D-008 归一化 | 03 | AC-5 |
| D-009 import 三态 | 02 | AC-5 |
| D-010 谓词 | 01 | AC-3 |
