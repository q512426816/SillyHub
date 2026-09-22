---
author: qinyi
created_at: 2026-09-07 23:24:31
plan_level: full
---

# 实现计划（Plan）— 会话置顶/重命名 + 定时发送

> Wave 结构经独立计划审查（plan-review-2026-09-07-231841）修订：合并原 task-02+03（共享 4 个后端文件）、共享文件任务串行化、依赖对全部跨 Wave（同 Wave 强制并行契约）。

## Spike 前置验证

无（方案 B 全部基于既有代码先例：archive 端点模板、sweeper 协程模式、inject_session_as_service 签名均已在 Grill 阶段逐行核验；无新技术栈/未验证集成）。

## Wave 1（基础：模型与迁移）
- task-01

## Wave 2（置顶/重命名/排序，依赖 Wave 1）
- task-02

## Wave 3（定时消息 CRUD，依赖 Wave 2——与 task-02 共享 schema/router/service 文件须串行）
- task-03

## Wave 4（sweeper 与前端类型/API，依赖 Wave 2/3；两任务文件正交可并行）
- task-04
- task-05

## Wave 5（后端测试与前端 UI，依赖 Wave 4；三任务文件正交可并行）
- task-06
- task-07
- task-08

## Wave 6（前端测试，依赖 Wave 5）
- task-09

## Wave 7（全局回归，依赖全部）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 模型与迁移：pinned_at 列+索引、AgentSessionScheduledMessage 新表 | W1 | P0 | — | FR-01, FR-04, FR-07 | agent/model.py + alembic 迁移（列/索引/新表，命名照惯例） |
| task-02 | pin/unpin/rename 服务+三端点+SSE + 列表排序 pinned 优先 + AgentSessionRead.pinned_at | W2 | P0 | task-01 | FR-01, FR-02, FR-03, FR-06, FR-07 | SessionService 三方法（照 archive 模板）+ router 三 PATCH（204）+ order_by 前置 (pinned_at IS NULL) ASC（多置顶按最近活跃，D-002）；顺手修正 list_agent_sessions 的 q 参数过时注释（title 已是持久列，ISS-06） |
| task-03 | 定时消息 CRUD（schema+service+三端点） | W3 | P0 | task-02 | FR-04 | POST（校验未来时间/内容/终态）+ GET 列表 + DELETE 取消（非 pending 409）；与 task-02 共享 schema/router/service/session-service 四文件故串行 |
| task-04 | scheduled_send sweeper 单趟四分支+常驻循环+lifespan 注册 | W4 | P0 | task-03 | FR-05, D-001@v1, D-003@v1 | 新文件 scheduled_send.py + main.py 三段关停契约；四分支含 queue_full |
| task-05 | gen:types 同步 api-types+openapi.json + 前端六个 API 函数 | W4 | P0 | task-02, task-03 | FR-01~FR-05 | 先验 node_modules 健康；lib/daemon.ts 六函数（与 task-04 文件正交） |
| task-06 | backend 测试三文件 | W5 | P0 | task-02, task-03, task-04 | FR-01~FR-06 | pin/rename + scheduled CRUD + sweeper 四分支（含 queue_full） |
| task-07 | 会话树置顶/重命名 UI + sessions-portal 接线 | W5 | P0 | task-05 | FR-01, FR-02, FR-03, FR-06 | SessionRow hover 按钮 + 行内重命名 + 置顶徽标 + 排组内最前 |
| task-08 | 定时发送 UI（⏰ 按钮+弹窗+hook+列表条双挂载） | W5 | P0 | task-05 | FR-04, FR-05 | 输入栏按钮 + Modal（分钟级+快捷项）+ ScheduledMessagesBar（page/dialog 双点）；与 task-07 文件正交 |
| task-09 | 前端测试 | W6 | P0 | task-07, task-08 | FR-01~FR-05 | session-list-panel 补用例 + scheduled-messages-bar/use-scheduled-messages 新用例 |
| task-10 | 回归验证 | W7 | P0 | task-06, task-07, task-08, task-09 | FR-07 | backend daemon/agent 模块测试 + frontend tsc/lint + 既有测试零回归 |

## 关键路径
task-01 → task-02 → task-03 → task-04 → task-06 → task-10（后端链最长；前端链 task-01→02→03→05→07→09→10 于 task-10 汇合）。

## 全局验收标准
1. backend 新增测试全绿（`uv run pytest app/modules/daemon -q --no-cov -n auto` 命中新文件）+ agent 模块（model 改动）零回归。
2. frontend `pnpm typecheck` 干净、`pnpm lint` 通过、新测试绿、session-list-panel 既有测试零回归。
3. 集成冒烟（integration-critical 定级要求）：起 dev 栈后真实调用 pin→列表序变化、create scheduled（dispatch_at=+2min）→ 到点 sweeper 派发（观察日志 scheduled_send_sweep 派发行/条目 status 翻转）；或以 pytest 集成用例等价覆盖四分支并留证据。
4. （brownfield）无置顶/无定时消息时列表行为与现状一致（排序谓词恒真 + 空表空扫）。
5. gen:types 产物（api-types.ts + openapi.json）随变更提交，无手写类型。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（方案 B：独立表+sweeper） | task-03, task-04 | AC-1（test_scheduled_send_sweeper 四分支） |
| D-002@v1（分组内置顶+多置顶最近活跃；一次性定时） | task-02, task-03, task-07 | AC-1（排序用例）+ AC-2（前端用例） |
| D-003@v1（队列满→failed queue_full） | task-04, task-06 | AC-1（第四分支用例） |
| FR-01/FR-02/FR-03 | task-02, task-07 | AC-1/AC-2 |
| FR-04 | task-03, task-08 | AC-1/AC-2 |
| FR-05 | task-04, task-08 | AC-1/AC-3 |
| FR-06 | task-02 | AC-1（SSE publish 断言） |
| FR-07 | task-01, task-02, task-05, task-10 | AC-4 |
