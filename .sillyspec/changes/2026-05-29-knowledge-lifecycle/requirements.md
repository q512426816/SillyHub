---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| Agent | 从任务产物提取候选知识 |
| Reviewer | 审核 candidate |
| 开发者 | 查询和复用知识 |
| 管理员 | 管理知识权限和过期策略 |

## 功能需求

### FR-01: 创建 candidate

Given AgentRun 产生可沉淀内容
When Agent 提交 candidate
Then candidate 保存为待审核状态，并记录来源 run/task/workspace

### FR-02: Reviewer 确认

Given candidate 待审核
When Reviewer 确认
Then 系统创建或更新 knowledge item，状态为 confirmed

### FR-03: 验证和推广

Given knowledge item 已 confirmed
When Reviewer 标记验证通过
Then 状态进入 verified

Given item 已 verified
When 管理员推广
Then 状态进入 promoted

### FR-04: 废弃

Given 知识不再适用
When Reviewer 标记 deprecated
Then 查询默认不返回该知识，除非显式包含 deprecated

### FR-05: 查询过滤

Given Workspace A 有多条知识
When 用户按 type、status、source 查询
Then 返回匹配的知识列表

## 非功能需求

- 可审计：所有状态变更记录 reviewer 和 reason。
- 可回溯：每条知识都能追溯到 task/run/workspace。
- 安全性：Agent 不能直接写 confirmed/promoted。
