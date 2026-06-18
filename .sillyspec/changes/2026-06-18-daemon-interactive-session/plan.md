---
plan_level: full
author: qinyi
created_at: 2026-06-18 15:30:00
---

# 实现计划 — 交互式会话管控（spawn + resume 回退）

## 回退锚点

spike-01 未获得 Claude 两轮 `result` 或 Codex 同 thread 两次 turn 完成的端到端证据，因此不再实现跨 turn 长驻子进程。采用 D-002@v2：AgentSession 与 interactive lease 保持长生命周期；每个 turn 创建独立 AgentRun 并新 spawn，后续 turn 通过 agent 内部 session/thread id resume。

## Wave 1 — 数据契约（无依赖）

- [ ] task-01: 数据模型迁移：agent_sessions、lease.kind、agent_runs.agent_session_id 与 Alembic（覆盖：FR-01, FR-09 / D-001@v1, D-002@v2, D-005@v1）

## Wave 2 — 协议与 turn 调度契约（依赖 Wave 1）

- [ ] task-02: 对齐 daemon/backend session、interrupt、end、permission 消息契约；inject 语义改为“请求创建下一 turn”而非写入长驻 stdin（覆盖：FR-02, FR-04, FR-05, FR-07 / D-002@v2, NFR-05）

## Wave 3 — 每 turn spawn + resume 核心链路（依赖 Wave 2）

- [ ] task-03: daemon session 元数据与 turn runner：首 turn 普通 spawn，后续 turn 使用 Claude `--resume` / Codex thread resume，每 turn 结束即释放进程（覆盖：FR-01, FR-02, FR-04, FR-05, FR-09 / D-002@v2）
- [ ] task-04: backend session REST/service/placement：create 与 inject 各创建 AgentRun 并 dispatch；interrupt 仅终止 currentRun；end 统一结束 session/lease（覆盖：FR-01, FR-02, FR-04, FR-05 / D-002@v2, D-005@v1）
- [ ] task-07: manual_approval 与 permission_request/response 按当前 turn 往返，默认自动批准行为不变（覆盖：FR-07）

## Wave 4 — 多 Run SSE 聚合与审批暂停（依赖 Wave 3）

- [ ] task-05: session SSE 聚合：按 agent_session_id 汇总多个 AgentRunLog/Redis 事件，单连接跨 turn 回放与续流（覆盖：FR-03 / D-002@v2, D-005@v1）
- [ ] task-08: Claude/Codex 当前 turn 的 control_request 暂停、远程批准/拒绝和进程退出收敛（覆盖：FR-07）

## Wave 5 — 生命周期联调与前端基础面板（依赖 Wave 4）

- [ ] task-06: spawn + resume 端到端联调、并发 inject 防重、30 分钟空闲回收及 end_session 单一收口（覆盖：FR-01, FR-02, FR-04, FR-05, FR-06 / D-004@v1）
- [ ] task-10: 会话面板：session SSE、追问创建下一 turn、打断当前 turn、结束 session（覆盖：FR-10）

## Wave 6 — 元数据恢复与历史/审批 UI（依赖 Wave 5）

- [ ] task-09: 持久化 session 元数据；daemon 重启时收敛 in-flight run，下一 turn 通过 resume 新 spawn，不恢复旧进程（覆盖：FR-08 / D-002@v2, D-003@v1）
- [ ] task-11: 会话列表、跨 AgentRun 历史回看与 permission 审批弹窗（覆盖：FR-07, FR-10 / D-005@v1）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 模块依赖 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型迁移 | W1 | P0 | — | FR-01,FR-09 / D-001@v1,D-002@v2,D-005@v1 | backend |
| task-02 | 协议与 turn 调度契约 | W2 | P0 | task-01 | FR-02,FR-04,FR-05,FR-07 / D-002@v2 | daemon ↔ backend |
| task-03 | daemon turn runner | W3 | P0 | task-02 | FR-01,FR-02,FR-04,FR-05,FR-09 / D-002@v2 | daemon → backend |
| task-04 | backend session 编排 | W3 | P0 | task-01,task-02 | FR-01,FR-02,FR-04,FR-05 / D-002@v2,D-005@v1 | backend |
| task-07 | turn 级 permission 消息 | W3 | P1 | task-02 | FR-07 | daemon ↔ backend |
| task-05 | 多 Run session SSE 聚合 | W4 | P0 | task-04 | FR-03 / D-002@v2,D-005@v1 | backend → frontend |
| task-08 | turn 级审批暂停 | W4 | P1 | task-03,task-07 | FR-07 | daemon ↔ backend |
| task-06 | 生命周期联调与空闲回收 | W5 | P0 | task-03,task-04,task-05 | FR-01,FR-02,FR-04,FR-05,FR-06 / D-004@v1 | daemon ↔ backend |
| task-10 | 前端会话基础面板 | W5 | P1 | task-04,task-05 | FR-10 | frontend → backend |
| task-09 | session 元数据恢复 | W6 | P1 | task-03,task-06 | FR-08 / D-002@v2,D-003@v1 | daemon → backend |
| task-11 | 历史与审批 UI | W6 | P2 | task-08,task-10 | FR-07,FR-10 / D-005@v1 | frontend → backend |

## 关键路径

`task-01 → task-02 → task-04 → task-05 → task-06 → task-09`

## 全局验收标准

- [ ] 首 turn 生成 AgentRun；追问为同一 AgentSession 生成新的 AgentRun，且两个 turn 使用不同进程。
- [ ] 第二 turn 使用首 turn 返回的 Claude session id 或 Codex thread id resume，上下文连续。
- [ ] 任一时刻同一 AgentSession 最多一个 running AgentRun；并发 inject 返回明确冲突，不重复 spawn。
- [ ] interrupt 只结束 currentRun，session 仍 active；end 才完成 interactive lease 并结束 session。
- [ ] 一个 session SSE 连接可按顺序回放并实时接收多个 AgentRunLog，事件携带 run_id/turn 标识且可断点续流。
- [ ] manual_approval=false 行为不变；true 时审批只绑定当前 turn，请求在 turn 结束时清理。
- [ ] daemon 重启不尝试恢复旧进程；in-flight run 明确失败收敛，后续 inject 可 resume 新 turn。
- [ ] batch lease 与现有 workspace AgentRun 行为不变。
- [ ] daemon `pnpm typecheck`、`pnpm test`，backend `uv run pytest`，frontend `pnpm build` 通过。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01 | AgentRun.session_id 语义不变，新增 agent_session_id FK |
| D-002@v2 | task-01,task-02,task-03,task-04,task-05,task-09 | 每 turn 独立 spawn + resume，多 Run SSE 聚合 |
| D-003@v1 | task-09 | 重启时收敛 currentRun，保留可 resume 的 session 元数据 |
| D-004@v1 | task-06 | 30 分钟空闲 session 统一结束 |
| D-005@v1 | task-01,task-04,task-05,task-11 | session/lease/run 三元关系与跨 Run 日志回看 |

## execute 协作点

- task-03 与 task-07 同改 daemon WS/协议边界：task-03 负责 turn 生命周期，task-07 只负责 permission 上下行。
- task-04 建立 `end_session` 与 currentRun 规则，task-05 只补 session 级发布/订阅，task-06 做最终收口。
- task-03 建立 sessionStore 元数据模型，task-06 增加 idle 字段，task-08 增加 pending permission，task-09 增加持久化；按 Wave 顺序增强。
