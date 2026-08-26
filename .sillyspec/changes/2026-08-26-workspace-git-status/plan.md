---
author: qinyi
created_at: 2026-08-26 22:02:15
plan_level: full
change: 2026-08-26-workspace-git-status
---

# 实现计划（Plan）— 工作区 Git 状态徽标

## Spike 前置验证

不需要。数据链路与全部模式已在上一变更（2026-08-25-workspace-git-log）验证；git 命令行为已由 Design Grill 实测裁定（--no-show-stash / --no-renames / porcelain v2 格式 / branch.oid 语义）。

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon git_status 方法 + 平名注册 + 单测 | W1 | P0 | — | FR-02, FR-03, FR-06, D-001@v1 | fetch 15s 局部 execFile（killed/signal 判超时，runCommand :1497 先例）；porcelain v2 解析（detached/无 upstream/branch.oid 截断/'(initial)' empty）；numstat --no-renames 单源；no_remote 靠 git remote 预检；vitest |
| task-02 | backend GET /git-log/status + schema + 集成测试 | W1 | P0 | — | FR-01, FR-05, FR-06, D-002@v1 | 复用四私有方法；GitLogStatusResponse（fetch/dirty 嵌套 + synced_at）；六分支集成测试（mock RPC 按 design §7.2 契约） |
| task-03 | gen:types + useGitLogStatus + git-status-bar 组件 + 两页挂载 + 组件测试 | W2 | P0 | task-01, task-02 | FR-04, FR-07, D-003@v1 | staleTime 60s 共享缓存；full/compact 双形态；sessions-portal actions 槽仅 workspace scope；主题 token 零 hex；双实例单请求断言 |

## 关键路径

task-01/02 → task-03

## 全局验收标准

1. backend pytest（git_log 模块含新 status 用例）/ daemon vitest / frontend vitest 全绿零回归
2. 集成冒烟（integration-critical）：真机 daemon↔backend 打通 status 端点（含 fetch 降级形态与边界形态各至少一例）
3. brownfield：既有端点/schema/组件零改动；gen:types 无其他模块漂移
4. api-types.ts + openapi.json 随变更提交（规则 21）

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | fetch 降级三分支单测 + 集成测试降级用例 |
| D-002@v1 | task-01, task-02 | 平名注册 + 轻端点 + 复用链路集成测试 |
| D-003@v1 | task-03 | 双形态组件测试 + staleTime 双实例单请求断言 |
| FR-01 | task-02 | status 端点六分支集成测试 |
| FR-02 | task-01, task-03 | fetch 降级单测 + 黄条形态 |
| FR-03 | task-01 | numstat 单源单测 |
| FR-04 | task-03 | full/compact 组件测试 |
| FR-05 | task-01, task-02 | 边界形态单测/集成测试 |
| FR-06 | task-01, task-02 | 只读 argv 断言 + 无 DB 写入 |
| FR-07 | task-03 | 主题 grep + 缓存断言 |
