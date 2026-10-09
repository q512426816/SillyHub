---
author: qinyi
created_at: 2026-10-09 11:56:30
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-09-tombstone-conflict-root-fix

## Wave 1（并行，无依赖；跨仓正交）

- task-01
- task-05

## Wave 2（依赖 Wave 1 的指令通道契约）

- task-02
- task-03

## Wave 3（依赖 Wave 1/2 的端点与 type 透传）

- task-04

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend tombstone_cleanup 指令通道（端点+WS+action 枚举+openapi/api-types 重生成） | W1 | P0 | — | FR-03, D-001@v1, D-002@v1 | machines.py 端点+ws_hub.send+model.py action 联合类型+请求 schema+测试 |
| task-02 | backend delete_change 收敛环自动下发 | W2 | P0 | task-01 | FR-03, D-001@v1 | 主事务终 commit 后 fire-and-forget 下发（service.py:349/423 双 commit 取 423 后），失败仅日志；绑定机器查询+测试 |
| task-03 | daemon tombstone_cleanup 执行器 | W2 | P0 | task-01 | FR-03, D-001@v1, D-002@v1 | daemon.ts WS 分发+sillyspec-manager.ts runTombstoneCleanup（根解析+隔离区移动+doctor 归档+回执幂等）+测试 |
| task-04 | frontend 冲突行墓碑形态三态渲染 | W3 | P1 | task-01, task-05 | FR-02, D-001@v1, D-002@v1 | 双源 join（注册表纯墓碑谓词：platform_deleted 非空且差集为空）+收敛按钮+回显+测试 |
| task-05 | sillyspec 仓 CLI 归因记账 | W1 | P0 | — | FR-01, D-001@v1, D-002@v1 | 纯墓碑归因落盘+幂等合并+全绿清理（kind 无关谓词）+type 透传+测试矩阵 |

## 关键路径

task-01 → task-03 → task-04（指令通道 → 执行器 → 前端按钮回显链）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 收敛只做目录移动（同盘 rename 原子性），**不硬删**；隔离区路径 `<根>/.sillyspec/.runtime/tombstone-quarantine/<name>-<yyyymmdd-HHmmss>/`（同步树外、不进 git）；**不移入 changes/archive/**（墓碑守卫对归档区前缀同样拒收，会二次撞墙）。
- 清理判定式：`conflicting_paths` 为空 **且** `platform_deleted` 非空（kind 无关——覆盖 `kind:'tombstone'`、现行 `kind:'spec-tree'` 纯墓碑与存量旧格式）；混合形态（conflicting_paths 非空）永不清理。
- 前端墓碑判定谓词：`details_json.platform_deleted` 非空 **且** `conflicting_paths ∖ platform_deleted` 为空（注册表 conflicting_paths 是 server_versions ∪ platform_deleted 并集）；混合行走现有版本冲突渲染，不隐藏其裁决入口。
- 收敛闭环走既有全绿关闭路径，**心跳落槽不新增关闭逻辑**（两个不选理由：结果槽无 workspace_id；spec_conflicts 开放行是 workspace+stage 聚合单行，整行关闭会误伤行内其他真冲突）。
- delete_change 的 WS 下发时点钉死在主事务最终 commit 之后（service.py:349/423 双 commit 结构取 423 终 commit 后）。
- fire-and-forget 失败仅记日志，不阻塞删除流程；旧 daemon 静默忽略新 WS 消息（150s 回显超时兜底）。
- ②数据源=注册表直读（`listSpecConflicts` 带 status=open 过滤），**不改 daemon 心跳摘要 schema**。
- 兼容三态：无墓碑时全链路行为与现状一致；旧 CLI 存量记录被清理判定收编；执行器幂等（目录不在=state=success）。

## 全局验收标准

1. 各任务单测通过（backend pytest / daemon vitest / frontend vitest / sillyspec node:test）
2. 集成冒烟：task-01+03 联动（端点→WS→执行器→回执落槽）；task-04 依赖 api-types 重生成后再 tsc
3. brownfield：未删除变更/无墓碑时端到端行为与现状一致（前端渲染、指令通道零触发）
4. gen:types 产物随变更提交（backend/openapi.json + 两端 api-types.ts），不留类型债

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04, task-05 | FR-01~03 全场景（范围三件全做+隔离区形态） |
| D-002@v1 | task-01, task-03, task-04, task-05 | 方案 A：注册表直读+指令通道复用（FR-02/03 验收；task-05=①归因记账属方案 A 范围件） |
