---
author: qinyi
created_at: 2026-08-31 04:10:00
change: 2026-08-31-session-queue-ux
plan_level: full
---

# 实现计划（Plan）— 会话消息排队体验修复与增强

> 任务名唯一真相在 tasks.md；本文 Wave 段纯 ID 引用。设计依据 design.md（FR-01~07 /
> R-01~06 / D-001~010）。**Wave 铁律：同 Wave 内任务 allowed_paths 互不相交**
> （session/service.py 被 task-02/03/04 串行改写，必须分属不同 Wave）。

## Wave 1 — 独立起点（迁移 + 复制组件，文件集不相交可并行）

- task-01
- task-11

依赖说明：task-01 仅迁移文件；task-11 仅前端复制组件三文件；互不相交。

## Wave 2 — 数据模型与入队

- task-02

依赖说明：position 模型字段 + 入队 MAX+1 + 排序键（model.py + session/service.py
入队/查询段）；依赖 task-01 的列概念（代码层可并行，运行时先后）。

## Wave 3 — 派发核心语义

- task-03

依赖说明：dispatch 循环化 + 恢复钩子（session/service.py）；依赖 task-02 的
position 排序键。

## Wave 4 — 三端点与契约

- task-04

依赖说明：reorder/edit/dispatch-now 端点 + DTO + 门面 + 事件（session/service.py
+ daemon/service.py + schema.py + router.py）；依赖 task-03 的循环化 dispatch。

## Wave 5 — 后端测试 + 前端契约层（文件集不相交可并行）

- task-05
- task-06

依赖说明：task-05 backend 测试（tests/）覆盖 Wave 2-4 全部新语义；task-06
lib/daemon.ts + gen:types（需 task-04 的 schema/端点可导入）。

## Wave 6 — 前端队列 UI 组件 + 复制测试（文件集不相交可并行）

- task-07
- task-08
- task-12

依赖说明：task-07 hook 与 task-08 bar 文件不相交（bar 只定义 props，消费方是
panel）；task-12 复制测试消费 task-11（Wave 1 已完成）；均依赖 task-06 类型。

## Wave 7 — 面板接线

- task-09

依赖说明：session-panel 接线消费 task-07 hook 方法与 task-08 bar props、task-06
SSE handler。

## Wave 8 — 队列测试

- task-10

依赖说明：bar/hook/daemon.test/panel 用例，覆盖 Wave 5-7 前端产物。

## Wave 9 — 收尾

- task-13

依赖说明：模块文档同步 + gen:types/openapi.json 提交核对 + 本地 Docker Postgres
迁移应用；全量完成后执行。

## 完成标准（对照 requirements.md A1~A7）

- Wave 2-5：A1/A2（滞留与恢复语义，pytest）；A4/A5/A6 后端语义（pytest）。
- Wave 5-8：A3（SSE 即时刷新）/A4（拖拽落库）/A5（⚡ 前端链路）/A6（编辑 UI）。
- Wave 1/6：A7（三类气泡复制，task-11/12）。
- 全程：daemon 零改动、前端零新依赖、排队上限 5 与串行不变式不动（NG）。
