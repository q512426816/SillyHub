---
author: qinyi
created_at: 2026-10-28 01:15:00
plan_level: full
execution_mode: main
---

# 实施计划（Plan）— 2026-10-28-bg-task-status-report

## 复杂度分类

```
plan_level: full
reason: 7 任务卡跨 daemon/backend/frontend 三子项目联动、含新 HTTP 端点+RPC 方法+gen:types 双端义务、Wave 1/2 可并行
estimated_files: 9
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: false
```

## 全局硬约束

- 三端兼容（Windows/Linux/macOS——纯文本解析无平台 API）。
- 幂等双层：daemon 进程 Set + backend (run_id, dedup_key) 唯一索引（重启重扫去重）。
- 旧 daemon 兼容：无终态事件平台维持现状（不误翻不报错）；未知事件 kind 前端按既有惯例忽略。
- gen:types 双端义务（规则 21）：schema 面变化后 frontend 与 sillyhub-daemon 两份 api-types 同变更重生成提交。
- 行号漂移防御：design 锚点以符号定位为准（多 agent 并行常态）。

## FR 映射

FR-01→task-02+task-03、FR-02→task-04、FR-03→task-05、FR-04→task-06、FR-05→task-07（全局）；task-01 为 R-03/R-04 残余定位卡（产出回写 design 清单）。

## Wave 划分

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-04

## Wave 2（依赖前序 Wave）
- task-03
- task-05

## Wave 3（依赖前序 Wave）
- task-06

## Wave 4（依赖前序 Wave）
- task-07

## Review Focus 盲区清单（隐含面）

- task-notification 文本块可能与其他 user 文本混排（非纯块）——解析须容错提取不吞正文；承接 task-02。
- SSE 中途接入只收增量：孤儿终态不渲染新条目只修正计数（design 兼容策略已声明）；承接 task-05/task-06。
- 前端既有 task-notification 文本归一（turn-timeline.tsx:251 剥离）与事件状态翻转是同信号双视图——不得双重渲染；承接 task-05。
- backend 越权校验：伪造上报须拦（runtime owner 校验先例 notify.py:344）；承接 task-04。
- gen:types 断言面：daemon-ci 闸门⑨ fail-closed（历史三连红教训）；承接 task-07。

## 覆盖矩阵（decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~07 全部（事件级上报路线） | 三侧契约测试+平台实测全链路 |
| D-002@v1 | task-06（计数由事件配对推导，非心跳计数兜底） | 代码评审：无心跳 payload 扩展 |
| D-003@v1 | task-05（翻转由事件驱动，非超时猜测） | 代码评审：无超时翻转逻辑 |
