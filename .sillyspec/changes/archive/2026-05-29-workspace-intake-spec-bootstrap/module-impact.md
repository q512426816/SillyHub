---
author: qinyi
created_at: 2026-05-30 23:35:00
---

# 模块影响分析

## 变更：2026-05-29-workspace-intake-spec-bootstrap

> brainstorm-only 变更，代码已在 main 中实现。module-map.yaml 不存在，仅基于声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| workspace | 数据结构变更 | backend/app/modules/workspace/schema.py, service.py | Workspace 创建 schema 增加 spec_strategy |
| spec_workspace | 新增 | backend/app/modules/spec_workspace/bootstrap.py, service.py, validator.py, router.py, schema.py | SpecWorkspace bootstrap/import/sync/validator/API |
| spec_workspace | 新增 | backend/app/modules/spec_workspace/tests/ | 契约测试和错误诊断 |
| frontend | 接口变更 | frontend/src/lib/spec-workspaces.ts, components/workspace-scan-dialog.tsx | 前端接入流程 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| （均不存在） | brainstorm-only 不新建 | ⏭ 跳过 |
