---
author: qinyi
created_at: 2026-05-31T00:20:00
---

# 模块影响分析

## 变更：2026-05-30-execution-coordinator

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| agent | 新增 + 逻辑变更 + 接口变更 | `coordinator.py` (新增), `coordinator_schema.py` (新增), `model.py` (修改), `router.py` (修改), `schema.py` (修改), `service.py` (修改) | 新增 ExecutionCoordinatorService（6 能力点），AgentRun 新增 9 字段，4 个新 API 端点，start_run 集成幂等/指纹/恢复令牌 |
| migrations | 数据结构变更 | `202606150900_add_execution_coordinator_fields.py` (新增), `4d9236aa3abb_merge_heads.py` (新增) | agent_runs 表新增 9 列 + 3 条件索引，alembic heads 合并 |
| tests | 新增 | `tests/modules/agent/test_coordinator.py` (新增), `tests/modules/agent/__init__.py` (新增) | 25 个 Coordinator 测试（6 能力点正向+异常） |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|
| （无） | 所有变更文件均已匹配到模块 |

## 更新结果

（sync-module-docs 步骤完成后回填）

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| `docs/backend/modules/agent.md` | 补充 ExecutionCoordinatorService 描述 + 4 新端点接口 + 数据流 + 设计决策 + 变更索引 | ✅ 已更新 |
