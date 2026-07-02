---
author: WhaleFall
created_at: 2026-07-02T15:02:00
change: 2026-07-02-daemon-filesystem-policy
---

# Proposal: 重构 Daemon Runtime 文件系统权限控制（Filesystem Policy Engine）

## 问题
当前 Daemon Runtime 的文件写权限（`allowed_roots`，由 2026-06-29 变更引入）存在三类问题：
1. **权限校验散落**：3 套独立层（backend `DaemonRuntime.allowed_roots` / backend `tool_policy.allowed_paths` / daemon `write-guard`）互不通信；4 条 Tool 注入路径各异（Claude batch/interactive、Codex interactive 有，**Codex batch 完全无沙箱**）。
2. **大量写入口绕过**：write-guard 仅正则解析 Bash 写命令；PowerShell/CMD 全放行；Python/Node 脚本内部 `open()`/`fs.write`（孙进程系统调用）用户态无法拦截。
3. **daemon 取并集**：`daemon.ts:1682` 把所有 runtime 的 allowed_roots 取并集塞进全局 config，claude/codex runtime 的可写目录混在一起，丢失 per-runtime 隔离；配置传播靠 15s 心跳轮询，"立即生效"有延迟。

## 方案
daemon 内新增统一 `src/policy/` 模块（Filesystem Policy Engine）作为平台唯一可信权限中心：
- **PolicyEngine**（canWrite/canRead/canCreate/canDelete/canRename）统一校验所有 Tool 层写入口。
- **PolicyCache** = `Map<runtime_id, RuntimePolicy>`，按 runtime（=agent 种类/provider）隔离，不再取并集。
- **path-utils**：normalize→resolve→realpath（防 `..`/symlink/junction/UNC）+ 大小写归一。
- **shell-paths**：Bash + PowerShell + CMD 命令写路径提取。
- **audit-sink**：全量 ALLOW+DENY 批量回传 backend。
- **热更新**：WS push `POLICY_UPDATE` sub-second + 心跳兜底；interactive 立即生效，在跑 batch 跑完再生效，新起 batch 用新配置。
- **Codex batch 沙箱**：复用 Codex 带内审批协议（`item/fileChange/requestApproval`），batch 路径不再自动 accept，改由 PolicyEngine 决策 accept/decline。
- backend 新增 `PolicyAuditLog` 表 + audit 端点 + WS push；frontend 新增审计页（给平台用户查看写行为）。

## 影响模块
`daemon`（sillyhub-daemon/src 主战场 + backend daemon 模块）、`frontend_app`（新增审计页）、`agent`（runtime_id 透传已存在）。

## Non-Goals
- 不做 OS 级进程沙箱（D-001）：Python/Node 脚本内部 `open()`/`fs.write` 不硬拦，靠 prompt + audit 追溯。
- 不防 8.3 短名绕过（D-005）：需 Windows 原生 API，后续独立变更。
- 不改 backend `DaemonRuntime` 模型（D-002）：allowed_roots 已 per-runtime。
- 不杀在跑 batch 任务（D-003）：跑完再生效。
- 不限制读（canRead 默认全允许，仅预留接口）。
- 不收敛 `tool_gateway.tool_policy.allowed_paths`（不同概念，本次不动）。
- canRead 不记 audit（D-008），仅写类决策记。

## 决策
8 个决策（D-001~D-008）见 `decisions.md`，design.md §11 追踪覆盖关系。核心：务实方案 / 按 runtime 隔离 / batch 跑完再生效 / WS push 热更新 / realpath 规范化 / audit 全量回传 / homedir 严格按 admin 配置 / canRead 不记 audit。

详见 `design.md`。
