---
author: qinyi
created_at: 2026-09-13 00:55:00
plan_level: full
---

# 实现计划（Plan）— 2026-09-13-session-group-ux-fixes

## Spike 前置验证

无需 Spike——三模块根因均已源码级闭环（预会话固定键 `__pre__`、mouse-only 拖拽监听、workspace_id 直配过滤），技术路线经 Design Grill 独立审查两轮 pass，无技术不确定性。

## Wave 1（并行，无依赖）— 三模块源侧改造

- task-01
- task-02
- task-03

Wave 出口：三模块独立测试绿；task-03 产出 `visible_workspace_ids` API 契约（provides）。

## Wave 2（依赖 Wave 1 的 task-03）— 类型管线与前端消费

- task-04

Wave 出口：前端类型与后端契约同步；跨工作区群列表显示断言绿。

## Wave 3（依赖 Wave 1-2 全部）— 验证与收口

- task-05

Wave 出口：verify 阶段接管（integration-critical 真实证据门控）。

## 依赖关系图

```
task-01 ──┐
task-02 ──┼──→ task-05
task-03 ──→ task-04 ──┘
```

## 共享文件与冲突规避

- Wave 1 三任务 allowed_paths 零交集（turn-state 系 / input-bar+group-panel / backend group 系），可安全并行。
- task-04 独占 Wave 2（api-types.ts 与两列表过滤），无并行冲突。
- 跨 Wave 无共享文件。
