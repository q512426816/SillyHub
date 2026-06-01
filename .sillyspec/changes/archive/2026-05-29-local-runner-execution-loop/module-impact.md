---
author: qinyi
created_at: 2026-05-30 23:25:00
---

# 模块影响分析

## 变更：2026-05-29-local-runner-execution-loop

> brainstorm-only 变更，代码已在 main 中实现。module-map.yaml 不存在，仅基于声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| runtime | 数据结构变更 / 接口变更 | backend/app/modules/runtime/model.py, router.py | Runtime 数据模型和 API |
| runtime | 逻辑变更 | backend/app/modules/runtime/service.py | Runner task claim 协议 |
| agent | 逻辑变更 | backend/app/modules/agent/service.py | Task claim + 结果收集 + review gate |
| agent | 新增 | backend/app/modules/agent/adapters/ | Claude/Codex backend adapter |
| agent | 接口变更 | backend/app/modules/agent/router.py | AgentRun 日志 SSE |
| worktree | 逻辑变更 | backend/app/modules/worktree/service.py | 隔离执行环境 |
| workflow | 逻辑变更 | backend/app/modules/workflow/service.py | 结果收集和 review gate |
| runner | 新增 | runner/, runner/execenv/, runner/adapters/ | Local daemon CLI + 隔离执行 + adapter |
| frontend | 接口变更 | frontend/src/app/.../agent/ | AgentRun 日志前端 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| （均不存在） | brainstorm-only 不新建 | ⏭ 跳过 |
