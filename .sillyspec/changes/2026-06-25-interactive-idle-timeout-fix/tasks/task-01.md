---
id: task-01
title: daemon session-manager idle 自动回收默认禁用
priority: P0
wave: W1
depends_on: []
blocks: [task-04]
requirement_ids: [FR-1, FR-2]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-01: daemon session-manager idle 自动回收默认禁用

> 来源：design.md Phase 1（D-001@v1）/ plan.md Wave1 task-01。
> 本质：idle 定时器默认不启动，session 不再因假性空闲被杀；env `SESSION_IDLE_TIMEOUT_SEC>0` 留逃生口。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | `DEFAULT_IDLE_TIMEOUT_SEC` 1800→0；`startIdleMonitor` 增 `>0` 守卫 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-1 | idle 默认禁用，长 turn 不误杀 | `_idleTimer` 默认不启动 |
| FR-2 | env 逃生口保留 | `SESSION_IDLE_TIMEOUT_SEC>0` 仍可启用 |

## 实现要求

1. `DEFAULT_IDLE_TIMEOUT_SEC`（182）：`1800` → `0`
2. `startIdleMonitor()`（1188）：在 `if (this._idleTimer) return;` 后增 `if (this._idleTimeoutSec <= 0) return;`
3. env 解析（259-265）保留不变：`>0` 启用、`0/负/非法` 兜底禁用
4. `_scanIdle`/`_onIdleExpire` 逻辑保留，定时器不启动则永不触发
5. 不删 idle 相关字段/方法（逃生口需要）

## 边界处理

- env 未设 / `0` / 负值 / 非法值 → 禁用（定时器 null）
- env 显式 `>0` → 启用（旧行为）
- 已存在的 idle 配置 opts.idleTimeoutSec（测试注入）不受影响

## 验收标准

| 条件 | 预期 |
|---|---|
| 默认配置启动 daemon | `_idleTimer` 为 null |
| env=1800 启动 | `_idleTimer` 启动 |
| pnpm test | 现有 idle 测试不回归（env 路径） |
