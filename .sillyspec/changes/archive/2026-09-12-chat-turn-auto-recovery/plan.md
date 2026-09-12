---
author: qinyi
created_at: 2026-09-12 11:10:00
change: 2026-09-12-chat-turn-auto-recovery
plan_level: full
---

# 实现计划（Plan）— 聊天轮上游故障自动恢复

> 依据 design.md v3（Grill 两轮定稿，D-001~D-011 含 4 条 @v2）。
> 规模 multi-wave：daemon 2 任务 + backend 3 任务 + frontend 1 任务 + 收尾，全部单仓（main）。

## Wave 结构与依赖

```
W1 信号与数据层（三任务并行：daemon 两任务目录零重叠，backend 数据层独立）
  ├─ task-01 daemon classifier 泛化+resetAt+wire 映射
  ├─ task-02 daemon pi 静默中断检测
  └─ task-03 backend 协议/数据层（ModelErrorDTO.reset_at + origin 列 migration + 列表 DTO origin + gen:types）
W2 恢复核心（backend）
  └─ task-04 maybe_auto_recover_failed_turn 三分支判定序 + close 钩子接线（依赖 task-03）
W3 派发链（backend）
  └─ task-05 scheduled_send origin/G10/透传 + inject 加参转发 + _handle_busy_turn origin（依赖 task-03、task-04）
W4 前端（frontend）
  └─ task-06 定时数据上提 + 错误卡三分支 + 徽标（依赖 task-03 的 api-types 契约）
W5 收尾集成验证
  └─ task-07 三类中断端到端 + 链上限/开关回归 + 模块文档（依赖全部）
```

串行执行顺序：W1（内部三任务可并行）→ W2 → W3 → W4 → W5。

## Wave 1：信号与数据层

- task-01
- task-02
- task-03

## Wave 2：恢复核心（backend）

- task-04

## Wave 3：派发链（backend）

- task-05

## Wave 4：前端提示与徽标

- task-06

## Wave 5：收尾集成验证

- task-07

## 验收对照

- FR-1.1~1.4 ↔ task-01；FR-2.1~2.3 ↔ task-02；FR-3.2/3.5 G0 守卫与分支 ↔ task-04；
- FR-3.1/3.3/3.4（判定序含 auth 并入/G5G6）↔ task-04；FR-3.6/3.7 + FR-4 ↔ task-03/task-05；
- FR-5.0~5.2 ↔ task-06；NFR-1~4 ↔ task-01/02 回归 + task-04 开关 + task-07 全链；
- 生命周期契约表 8 事件 ↔ task-04（入队/排期）+ task-05（派发/G10/忙轮）+ task-06（取消面）；
- R-01~R-09 ↔ 紧链/quota 链（task-04）、G10/origin 透传（task-05）、双信号（task-06）。

## 风险与对策（执行期）

- daemon 改动需重新 pnpm bundle + 部署镜像才在生产生效（execute 完成后提醒，不阻塞代码合并）。
- gen:types 前置健康检查（CLAUDE.md 规则 21：pnpm exec tsc --version 先行）。
- W1 内 task-01/02 并行时 daemon 测试树零重叠（model-error vs interactive），无写冲突。
