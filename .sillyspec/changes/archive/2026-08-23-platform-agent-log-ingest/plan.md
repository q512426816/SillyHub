---
author: qinyi
created_at: 2026-08-23 05:15:00
plan_level: light
---

# 实现计划（Plan）— 平台承接 Agent 日志上报

## Spike 前置验证
无——方案确定性高：鉴权/upsert/迁移/测试四范式全部有 quicklog-entries 逐字同构先例，Design Grill 20 交叉点源码实证通过（review-2026-08-23-093126，pass/pass）。

## Wave 1（无依赖）
- task-01

## Wave 2（依赖 W1）
- task-02

## Wave 3（依赖 W2）
- task-03

## Wave 4（依赖 W3）
- task-04

## Wave 5（依赖 W4）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端模型层：AgentSessionLogORM + 迁移 + conftest 建表 | W1 | P0 | — | FR-02, D-002/D-003/D-007 | model.py 新 ORM（18 列 + uq (workspace_id, log_path)）；alembic 20260823090000 接 20260822090000；tests/conftest.py 建表清单扩建 |
| task-02 | 后端接口层：schema + service + router 双端点 + pytest | W2 | P0 | task-01 | FR-01/02/03, D-001/D-004/D-005 | POST（_write_auth fail-closed，entries≤50，log_path max_length 1024）+ GET（_read_auth scope 组合过滤 + NULLS LAST + limit≤100）+ upsert 单事务批量；鉴权矩阵/幂等/隔离/422/排序全用例 |
| task-03 | 前端类型同步 gen:types | W3 | P0 | task-02 | FR-05 | api-types.ts + openapi.json 生成提交（先确认 node_modules 健康） |
| task-04 | 前端面板：agent-logs lib + agent-log-card + SessionPanelPage 挂载 | W4 | P0 | task-03 | FR-04, D-006 | query-keys 工厂 agentLogs 键；三态卡片（列表/空态/折叠）+ 复制交互 + dayjs.extend(relativeTime)；workspace_id null 守卫；vitest |
| task-05 | 全量回归 + 端到端实证 | W5 | P0 | task-04 | 全部 FR | pytest+ruff+mypy / vitest+tsc+lint 全绿；本地后端起服跑真实 `sillyspec status` 验证 CLI 上报 200 落库（对照上一会话 404 基线） |

## 关键路径
task-01 → task-02 → task-03 → task-04 → task-05（严格串行：模型→接口→类型→面板→回归，无并行面）。

## 全局验收标准
1. `uv run pytest tests/ app/modules/platform_sync/tests/ -q` 全绿（新用例 ≥12：鉴权 4 + 幂等 2 + 批量/去重 1 + 隔离 1 + 422 2 + GET 3）；ruff/mypy 零报错。
2. `pnpm gen:types:check` 无漂移；vitest/tsc/lint 全绿；agent-log-card 组件测试覆盖三态与复制回调。
3. 端到端：本地起 backend（迁移后），在配好 local.yaml platform 段的仓库跑 `sillyspec status`，后端日志收到 POST /api/agent-logs 200，`platform_agent_logs` 表出现该 workspace 行，面板可见。
