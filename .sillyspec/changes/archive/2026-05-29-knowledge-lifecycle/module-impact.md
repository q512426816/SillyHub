---
author: qinyi
created_at: 2026-05-30 23:20:00
---

# 模块影响分析

## 变更：2026-05-29-knowledge-lifecycle

> brainstorm-only 变更，代码已在 main 中实现。module-map.yaml 不存在，仅基于声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| knowledge | 数据结构变更 | backend/app/modules/knowledge/model.py | Knowledge metadata 模型定义 |
| knowledge | 逻辑变更 | backend/app/modules/knowledge/service.py, schema.py | Candidate 提交服务 |
| knowledge | 逻辑变更 | backend/app/modules/knowledge/service.py, tests/ | 审核和成熟度状态机 |
| knowledge | 接口变更 | backend/app/modules/knowledge/router.py | Knowledge API |
| knowledge | 新增 | backend/app/modules/knowledge/embedding.py | 向量索引后置接口 |
| frontend | 接口变更 | frontend/src/lib/knowledge.ts, knowledge/ | Workspace Knowledge 前端 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| knowledge.md | 不存在，brainstorm-only 不新建 | ⏭ 跳过 |
