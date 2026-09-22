---
author: qinyi
created_at: 2026-09-23 04:16:05
plan_level: full
---

# 实现计划（Plan）— 变更事件通道

## Spike 前置验证
无——方案确定性高：鉴权（require_platform_sync_write/_read + _read_args）/SQLModel 复合唯一约束/alembic 建表/pytest conftest/前端自取数卡五范式全部有 quicklog-entries 与 agent-logs 逐字同构先例（backend/app/modules/platform_sync/），CLI 推送契约直接读 watcher.js:608-640 实证；Design Grill 独立审查 review-2026-09-23-041326 pass/pass。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03

## Wave 4（依赖前序 Wave）
- task-04
- task-05

## Wave 5（依赖前序 Wave）
- task-06

## Wave 6（依赖前序 Wave）
- task-07

## Wave 7（依赖前序 Wave）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端模型层：PlatformChangeEventORM + alembic 迁移 + conftest 建表 | W1 | P0 | — | FR-02/03, D-002/D-003/D-004 | model.py 新 ORM（12 列 + uq (workspace_id, change_name, dedup_key) + ix (workspace_id, change_name, ts)）；迁移 20260923040000 接 head 20260920220000；tests/conftest.py 建表清单扩建 |
| task-02 | 后端 schema + service：ChangeEventPushRequest/ChangeEventItem + append_events/list_events | W2 | P0 | task-01 | FR-01/02/03/04, D-002/D-003/D-005/D-007 | 宽松接收（extra=ignore、id/rule/severity 可选、provisional 恒 True、批量 ≤200、detail 截 2000）；dedup_key 生成 + 跳过计数；5000 上限同事务修剪；list since 严格大于 + (ts, id) 稳定正序 |
| task-03 | 后端 router 两端点 | W3 | P0 | task-02 | FR-01/04, D-001 | POST /changes/{name}/events（_write_auth + workspace None 403 防御）+ GET（_read_auth + _read_args scope 翻译）；放参数路由区（/changes/{name}/progress 同区之后，不新增字面量段） |
| task-04 | 后端 pytest 五组 | W4 | P0 | task-02, task-03 | FR-01~04 验证 | test_change_events.py：收（200+落库+accepted/deduplicated）/取（正序/since 增量/limit）/去重（同键重推跳过）/鉴权（401/403/200 矩阵）/上限（>5000 修剪最旧） |
| task-05 | 前端类型同步 gen:types | W4 | P0 | task-02 | FR-05 前置 | 先确认 node_modules 健康（CLAUDE.md 规则 21）；api-types.ts + openapi.json 生成提交 |
| task-06 | 前端观测事件折叠卡 + 详情页挂载 | W5 | P0 | task-05 | FR-05/06/07, D-004/D-006 | ChangeEventsCard（useQuery 30s 轮询/失败静默隐藏/缺省收起/warning 默认展开+角标计数/warning 行琥珀高亮/provisional 徽标 Tooltip「旁路观测信号，非流程真相」）；lib/changes.ts listChangeEvents；详情页 aside 挂载 |
| task-07 | 前端 vitest 四组 | W6 | P0 | task-06 | FR-05/06 验证 | change-events-card.test.tsx：渲染（时间线行）/告警高亮（severity=warning 琥珀）/空态/角标计数 |
| task-08 | 端到端验收 | W7 | P0 | 全部 | 全部 FR | dev 后端起服（迁移后）curl 模拟 watcher 推 5 条（2 warning）→ GET 正序去重核对 → 面板渲染核对；模块级 pytest/vitest/tsc/mypy 全绿 |

## 关键路径
task-01 → task-02 → task-03 → task-04 → task-05 → task-06 → task-07 → task-08（模型→接口→路由→测试→类型→组件→组件测试→端到端；task-04 执行顺序遵循 CLAUDE.md TDD：写实现前先写测试用例，与 task-02/03 交错推进）。

## 并行变更隔离
主仓工作树存在并行会话在途修改（backend/app/modules/daemon/、scan_docs 等）。本变更文件面仅 platform_sync 模块 + frontend changes 详情域 + 迁移目录，零交集；commit 时用显式 pathspec（git commit -- <本变更文件清单>）隔离，不裹挟并行 WIP。

## 全局硬约束
- **红线（FR-07 / D-004@v1）**：平台对 provisional 事件只展示不消费——全链路（schema/service/router/前端组件）禁止触发通知、写 progress、影响审批门控或做任何流程状态判定；provisional 落库恒 True。
- **单写者纪律**：workspace_id 只从 shpsync_ token 派生（写端点），body 不含也不信 workspace 字段；写通道仅 shpsync_（shk_live_/JWT 凭据有效也 403）。
- **类型不手写（CLAUDE.md 规则 21）**：前端事件类型必须 gen:types 生成，产物随提交。
- **测试边界（CLAUDE.md 规则 0）**：只跑本变更相关测试面，全量留 CI。
- **提交隔离**：commit 用显式 pathspec 只含本变更文件清单，不裹挟并行会话在途 WIP。
- 覆盖面：FR-01~FR-07 全部由 task-01~08 落地（任务总表逐行映射）。

## 全局验收标准
1. `cd backend && uv run pytest app/modules/platform_sync/tests/test_change_events.py -q` 全绿（五组 ≥13 用例）；ruff check + ruff format --check + mypy app 零报错。
2. `pnpm gen:types` 产物无漂移；`pnpm test -- change-events-card`（四组）+ `pnpm typecheck` 全绿（相关面过滤，全量留 CI）。
3. 端到端：本地起 backend，curl 推 5 条（含 2 severity=warning）→ GET 按时间正序且去重（重放同批 deduplicated=5）→ 面板折叠区显示 warning 琥珀高亮行 + provisional 徽标 + 角标计数 2。
4. 红线自查：grep 事件落库/读取链路无通知/审批/门控调用（零业务消费）。
