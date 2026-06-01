---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 配置 Server Runner 池和沙箱策略 |
| 开发者 | 触发托管执行任务 |
| Agent | 在沙箱内执行任务 |
| Auditor | 查看沙箱审计记录 |

## 功能需求

### FR-01: 创建沙箱

Given Task 已 ready
When Server Runner claim task
Then 平台创建绑定 tenant/user/workspace/task 的沙箱

### FR-02: 文件快照

Given Workspace 有允许注入的路径
When 创建沙箱快照
Then 只复制白名单路径
And 阻断敏感文件黑名单

### FR-03: 执行任务

Given 沙箱已准备完成
When Runner 调用内部 Claude/Codex 执行能力
Then 日志通过统一 runner 协议写回 AgentRun

### FR-04: 导出结果

Given 执行完成
When Runner 导出结果
Then 平台保存 diff、test result、artifact
And 写入审计记录

### FR-05: 清理

Given 沙箱超过保留周期
When GC 执行
Then 沙箱文件和临时凭据被清理

## 非功能需求

- 安全性：默认拒绝敏感文件和未知网络出口。
- 可审计：沙箱创建、快照、执行、导出、清理都记录。
- 可回退：Server Runner 可关闭，不影响 Local Runner。
- 兼容性：任务协议与 Local Runner 保持一致。
