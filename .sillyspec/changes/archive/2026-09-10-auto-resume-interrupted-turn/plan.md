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

- task-01

## Wave 2：入队守卫（backend）

- task-02

## Wave 3：派发打标（backend）

- task-03

## Wave 4：开关端点（backend）

- task-04

## Wave 5：前端开关（frontend）

- task-05

## Wave 6：前端提示与徽标（frontend）

- task-06

## Wave 7：收尾集成验证

- task-07

## 验收对照

- requirements FR-01~07 ↔ task-02/03/04/05/06；
- NFR-01（既有零回归）↔ task-02/03 回归测试 + task-07 全量；
- NFR-02（migration 线性/PPM 零涉及）↔ task-01；
- 守卫矩阵 13 行 ↔ task-02/03 测试清单逐行映射。
