---
id: task-10
title: 同步前端 INTEGRATIONS 文档
priority: P2
estimated_hours: 0.5
depends_on: [task-06]
blocks: []
allowed_paths:
  - .sillyspec/docs/frontend/scan/INTEGRATIONS.md
---

# task-10: 同步前端 INTEGRATIONS 文档

## 修改文件
- `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`

## 实现要求
1. 增加 `AgentRunStreamClient` 相关 API 集成说明
2. 记录 `after` 参数和 `log_id` 字段
3. 记录断线重连和回填机制

## 接口定义
N/A（文档任务）

## 边界处理
- 保持现有文档格式
- 不删除现有内容，只增加
- 更新日期标记

## 非目标
- 不修改后端文档
- 不重写整个文档
- 不修改 PROJECT.md

## 参考
- INTEGRATIONS.md 记录前端 API 集成模式
- design.md 决策 1-5 定义了 AgentRunStreamClient 接口和重连策略
- plan.md Wave 4 task-10 依赖 task-06（Workspace 详情页集成完成）

## TDD 步骤
1. 读取当前 INTEGRATIONS.md
2. 在 SSE 认证章节之后，增加 Agent SSE Stream 集成章节
3. 记录 AgentRunStreamClient 类的接口和生命周期
4. 记录 after 参数在 stream/logs 端点中的用途
5. 记录 log_id 去重机制
6. 记录断线重连策略（指数退避 + HTTP backfill）
7. 更新 agent.ts 模块描述
8. 验证格式与现有内容一致

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | AgentRunStreamClient 说明 | 包含 connect/disconnect/onMessage/onDone 文档 |
| AC-02 | SSE 端点 | 包含 after 参数和 log_id 字段说明 |
| AC-03 | 重连机制 | 包含重连策略和回填说明 |
