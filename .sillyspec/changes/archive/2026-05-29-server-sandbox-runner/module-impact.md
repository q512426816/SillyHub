---
author: qinyi
created_at: 2026-05-30 23:30:00
---

# 模块影响分析

## 变更：2026-05-29-server-sandbox-runner

> brainstorm-only 变更，代码已在 main 中实现。module-map.yaml 不存在，仅基于声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| runtime | 数据结构变更 | backend/app/modules/runtime/model.py, service.py | Server Runner runtime 类型 |
| sandbox | 新增 | backend/app/modules/sandbox/, snapshot.py, artifact.py | Sandbox 模块、文件快照、Artifact |
| tool_gateway | 调用关系变更 | backend/app/modules/tool_gateway/service.py | 文件快照策略接入 |
| agent | 逻辑变更 | backend/app/modules/agent/service.py | 内部 Claude/Codex 执行接入 |
| audit | 调用关系变更 | backend/app/modules/audit/ | Artifact 和审计 |
| deploy | 配置变更 | deploy/docker-compose.yml, deploy/runner/ | 部署配置 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| （均不存在） | brainstorm-only 不新建 | ⏭ 跳过 |
