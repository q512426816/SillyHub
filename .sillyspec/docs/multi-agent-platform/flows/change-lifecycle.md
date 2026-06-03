---
author: qinyi
created_at: 2026-06-03T09:50:00
---

# change-lifecycle

## 目标
管理 SillySpec 变更从提议到归档的完整生命周期。

## 参与模块
- **change**: 变更主实体和文档管理
- **task**: 变更下的任务追踪
- **workflow**: 变更审批和审核流程
- **change_writer**: Agent 驱动的代码写入
- **agent**: 执行自动化任务的 Agent
- **release**: 变更完成后的发布管理

## 流程摘要
```text
用户创建变更 (propose)
  → brainstorm: 需求分析 + 技术方案
  → plan: 拆解为 Wave + Task
  → execute: Agent 按计划写代码
    → task 状态: pending → in_progress → completed
  → verify: 验证实现一致性
  → archive: 归档变更，更新模块文档
```

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| brainstorm 输出不完整 | 标记 blocked，等待用户补充 |
| execute 任务失败 | 标记 failed，保留已完成的任务 |
| verify 不通过 | 回到 execute 修复 |
