---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Proposal

## 动机

Local Runner 先解决可用闭环，但平台最终需要可托管的 Server Sandbox Runner，用于无本机 daemon、批量执行、受控企业环境和自动化任务。

该能力必须在 Local Runner 稳定后实现，否则会同时承担执行协议、沙箱隔离、文件快照、密钥边界和审计风险。

## 关键问题

### 1. 云端执行需要强隔离

沙箱至少要按 tenant、user、workspace、task 隔离，不能共享未授权文件和凭据。

### 2. 文件快照需要白名单和黑名单

不能把整个仓库或用户目录无差别送入沙箱，敏感文件必须阻断。

### 3. Claude/Codex HTTP 只能是内部能力

托管执行服务不能直接暴露给用户绕过平台策略。

## 变更范围

- 新增 server-side runner pool。
- 定义沙箱维度和文件快照策略。
- 接入内部 Claude/Codex HTTP 或托管 CLI 执行能力。
- 复用 Local Runner 的 task claim/message/result 协议。
- 强制审计所有沙箱创建、文件注入、命令执行和结果导出。

## 不在范围内（显式清单）

- 不替代 Local Runner。
- 不直接开放 Claude/Codex HTTP 给用户。
- 不跳过 Policy/Workflow/Audit。
- 不存储无限期沙箱文件。

## 成功标准（可验证）

- Server Runner 能执行一个已 ready 的任务。
- 沙箱隔离包含 tenant/user/workspace/task。
- 文件快照按白名单注入，并阻断敏感文件。
- 执行日志、结果、文件导出都有审计。
- 任务协议与 Local Runner 保持一致。
