# 07 — Tool Gateway 设计

## 1. 目标

所有 Agent 和自动化执行都必须通过 Tool Gateway。

## 2. 工具分类

| 工具 | 风险 | 控制 |
|---|---:|---|
| file_read | 低 | 路径限制 |
| file_write | 中 | allowed_paths |
| shell_exec | 高 | 命令白名单 |
| git_status | 低 | 记录日志 |
| git_commit | 中 | 分支限制 |
| git_push_branch | 中 | 只能任务分支 |
| git_merge | 高 | 审批 |
| db_execute | 极高 | 默认禁止 |
| deploy_production | 极高 | 多人审批 |
| secret_read | 极高 | 默认禁止 |

## 3. 执行流程

```text
Tool Call
  ↓
权限检查
  ↓
路径检查
  ↓
风险分级
  ↓
审批判断
  ↓
执行
  ↓
日志脱敏
  ↓
审计记录
```
