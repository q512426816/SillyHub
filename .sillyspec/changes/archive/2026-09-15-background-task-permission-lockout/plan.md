---
plan_level: full
author: qinyi
created_at: '2026-09-15 16:35:00'
---

# 详细计划（Detailed Plan）— 2026-09-15-background-task-permission-lockout

## 背景与目标

见 design.md（四项生产实锤缺陷：守卫锁死后台任务 / fail-soft 静默丢弃 / 重启终态化
无错误码 / 用量归属误导）。目标 FR-01~FR-04。

## 依赖分析

- 守卫放行（task-03）依赖锚点（task-01）与访问器（task-02）——先有「锚点态」才有
  放行条件可判。
- 标记注入（task-04）依赖 task-02（backgroundTaskFlag 需读注册表）；resolver payload
  与 dialog 兜底（task-04/05）同文件同函数族，串行防冲突。
- backend 受理放宽（task-08）依赖协议字段（task-07）。
- daemon 与 backend 两侧无编译期依赖，可并行开发；协议字段语义以 design.md 接口
  定义为单一真相。
- 集成验证（task-10/11）在各自侧实现完成后收口。

## Wave 分组

### Wave 1：daemon 基础设施（锚点 + 访问器）

- task-01
- task-02

### Wave 2：daemon 守卫放行

- task-03

### Wave 3：daemon 标记注入（provider）

- task-04

### Wave 4：daemon dialog 有界兜底

- task-05

### Wave 5：daemon 用量标注

- task-06

### Wave 6：backend 协议字段

- task-07

### Wave 7：backend 受理放宽 + 即时 deny

- task-08

### Wave 8：backend 重启终态化补码

- task-09

部署顺序敏感（backend 先行），实现顺序即字段→逻辑→清理补码。

### Wave 9：测试收口

- task-10
- task-11

跨任务用例补全 + 既有测试修订（fail-soft 断言）+ 相关面全量跑绿（禁止全量测试套件，
只跑相关文件——CLAUDE.md 规则 0）。

## 每任务完成标准

见 tasks.md 各任务「完成标准」；统一门：相关单测绿 + typecheck/lint 绿（daemon
`pnpm typecheck`、backend `ruff check`+`mypy app`）+ 不引入无关文件变更。

## 风险与回退

- 协议字段全可选：回退=不传即旧行为。
- 守卫新放行条件随注册表空自动失效，无开关需求。
- 既有 fail-soft 测试语义变化集中在 task-11 修订（R-05）。

## 验收（对照 requirements.md）

- FR-01：task-01/02/03 + task-10 用例 1-3
- FR-02：task-04/05/07/08 + task-10 用例 4-6 + task-11 用例 1-3
- FR-03：task-03/08（文案前缀断言）
- FR-04：task-06/09 + task-10 用例 7 + task-11 用例 4
