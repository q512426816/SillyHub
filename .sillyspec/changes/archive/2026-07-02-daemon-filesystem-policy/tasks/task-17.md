---
id: task-17
title: Codex batch 接入带内审批协议 + PolicyEngine 决策
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-03, task-05, task-11]
blocks: [task-22]
allowed_paths:
  - sillyhub-daemon/src/adapters/json-rpc.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-17

> goal: Codex batch 移除自动 accept，接入 PolicyEngine 决策带内审批（R-06 已解）。

## implementation
- ⚠️ execute 先验证 Codex app-server 审批消息字段格式（`item/fileChange/requestApproval` / `item/commandExecution/requestApproval` payload）+ decline 响应格式
- `json-rpc.ts:49` 移除 `APPROVAL_RESPONSES` 自动 accept
- `json-rpc.ts:344` `parseServerRequest` 改为产出待决策事件（含写路径，经 shell-paths 提取）
- `task-runner.ts` batch 路径处理 server request：调 `policyEngine.canWrite(runtimeId, path)` 决策 accept/decline（decline 附中文理由）
- 命令类审批走 shell-paths 提取写路径后校验

## 验收标准
- Codex batch 写越界 → 带内审批 decline + 中文理由
- Codex batch 写白名单内 → accept
- 命令类审批（commandExecution）经 shell-paths 校验

## 验证
- `cd sillyhub-daemon && pnpm test json-rpc`
- 手动跑 Codex batch 越界写验证 decline

## constraints
- R-06：execute 验证 Codex 审批消息字段格式，不支持的部分降级 audit + 文档标注
- 复用 interactive Codex driver 的审批协议知识（codex-app-server-driver.ts:1131）
- 不影响 interactive Codex 路径
