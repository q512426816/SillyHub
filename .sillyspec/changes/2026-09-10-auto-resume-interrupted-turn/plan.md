---
author: qinyi
created_at: 2026-09-10 09:25:00
change: 2026-09-10-auto-resume-interrupted-turn
plan_level: full
---

# 实现计划（Plan）— daemon 重启后自动续跑被中断的交互轮

> 依据 design.md v2.2（D-001~D-013、11 守卫+SAVEPOINT+队首满员+G10 派发时守卫）。
> 规模 multi-wave：backend 6 Wave 任务 + frontend 1 Wave + 收尾，全部单仓（main）。

## Wave 结构与依赖

```
W1 数据层（migration+model）
  └→ W2 入队（auto_resume.py 守卫+模板 + recovery 接线 + 守卫矩阵测试）
        └→ W3 派发（queue G10+origin 解析+打标传递 + inject 可选参 + 测试）
W4 开关端点（schema DTO + PATCH + 测试）——依赖 W1 保守串行（目录级 allowed 与 W2/W3 有名义重叠，不并行）
W5 前端（gen:types + PATCH 客户端 + config-bar 开关 + hint 注入 + 续跑徽标 + 测试）
  └ 依赖 W4（API 契约）+ W3（metadata 字段进 api-types）
W6 收尾（模块文档 + 全链验证：模拟 daemon 重启→恢复→自动续跑→链上限）
  └ 依赖全部
```

串行执行顺序：W1 → W2 → W3 → W4 → W5 → W6（W4 理论可并行，保守串行省审计面）。

## Wave 1：数据层（backend）

- **task-01** migration 两列 + model 同步
  - `agent_session_queued_messages.origin` TEXT NULL、`agent_runs.metadata` JSON NULL
    （ORM 属性 `metadata_`，照 AgentRunLog 先例）；downgrade 对称。
  - 文件：backend/migrations/versions/<新>、backend/app/modules/agent/model.py

## Wave 2：入队与守卫（backend）

- **task-02** auto_resume.py（新文件）+ recovery 接线 + 守卫矩阵测试
  - `wrap_resume_prompt` 模板常量（design §2.1 逐字）；
    `_maybe_enqueue_auto_resume`：SAVEPOINT（begin_nested）+ G1-G9+满员 +
    position 队首（MIN-1）+ INSERT origin='auto_resume:<rid>'；附件判别复用
    attachment_marker_line 宽松前缀。
  - recovery.py：converge 后、写 reconnecting 前接线；DB 失败 rollback to
    savepoint 不炸主链。
  - 测试：design §6 矩阵中归本任务的 12 行（G1-G9+满员+SAVEPOINT+position，
    含截断检测/pending dialog/网络重入幂等；G10 归 task-03）。

## Wave 3：派发与打标（backend）

- **task-03** queue G10 派发时守卫 + 打标传递 + inject 可选参 + SessionRunRead metadata 出口 + 测试
  - origin 前缀解析（split(':',1)）；G10：source 后有更新 run（created_at desc
    + id tiebreak）→ 静默删行跳过记日志；auto_resume_of 可选参 →
    `AgentRun(metadata_={...})`。
  - 队列 UI 语义：续跑条目 edit/reorder 409（照 TASK_WAKEUP 先例 queue.py:446-451）、
    delete 允许。
  - 测试：G10 正反 + 打标 + 链计数 + 恢复失败收敛 failed 回归 + edit/reorder 409。

## Wave 4：开关端点（backend）

- **task-04** SessionAutoResumeUpdateRequest DTO + PATCH /sessions/{id}/auto-resume
  - 路由照 ctx-window 先例（owner 校验归 service、204）；存储照 control.py
    config merge 先例（dict 复制整体赋值）。
  - 文件：daemon/schema.py、daemon/router/session_crud.py、
    daemon/session/service/session_lifecycle.py（或 service 归属处）。
  - 测试：owner 404 反例 + merge 保留他键 + 204 契约。

## Wave 5：前端（frontend）

- **task-05** gen:types + PATCH 客户端 + SessionConfigBar 开关
  - `pnpm gen:types`（提交 api-types.ts + backend/openapi.json）；
    lib/daemon/ PATCH 客户端 + 手写 SessionRunRead interface 补 metadata 字段；components/sessions/session-config-bar.tsx
    「中断自动续跑」开关（默认开，三态显示）。
  - 测试：开关组件用例（默认开/关/调用 PATCH）。
- **task-06** 失败卡 hint 注入 + 续跑徽标
  - run-error-item：daemon_restarted hint 由父级（turn-timeline/session-panel
    持有 session.config）按开关状态 props 注入两态文案；
    turn-timeline：识别 run metadata_（api-types 字段）auto_resume_of 渲染
    「自动续跑」徽标。
  - 测试：hint 两态 + 徽标渲染 + 无标记零回归。

## Wave 6：收尾

- **task-07** 模块文档 + 全链验证
  - daemon.md（恢复链段+auto_resume）、daemon.changelog.md、
    frontend_lib/changelog、frontend_components.changelog.md；
  - 集成验证（integration-critical 门控证据）：backend 集成测试模拟 daemon 重启
    序列（recover→confirm→D-008 派发→新 run 带标记→二次中断链上限停→confirm 后
    派发前手动重发 G10 命中删行跳过）+ 前端组件链测试；跑受影响模块全量（daemon/session/queue 相关）。

## 验收对照

- requirements FR-01~07 ↔ task-02/03/04/05/06；
- NFR-01（既有零回归）↔ task-02/03 回归测试 + task-07 全量；
- NFR-02（migration 线性/PPM 零涉及）↔ task-01；
- 守卫矩阵 13 行 ↔ task-02/03 测试清单逐行映射。
