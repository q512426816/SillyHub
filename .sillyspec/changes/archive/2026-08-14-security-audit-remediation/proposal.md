---
author: qinyi
created_at: 2026-08-15 00:32:00
---

# 提案（Proposal）— security-audit-remediation

## 一句话

闭合 2026-08-14 多代理安全审查确认的 5 个高危（daemon WS 无鉴权 / file IDOR / platform_sync 裸 JWT 全局桶+审批伪造 / claim_lease 越权取明文 key / sync_documents 路径穿越）+ 7 项配套中危。

## 动机

- daemon WS 持 daemon_local_id 即可挤掉真连接、伪造 rpc_result（H-1）。
- 文件中心任意登录用户可下载/软删他人文件（H-2）。
- 任意 JWT 可伪造 approval 阻断/放行他人 execute（H-3）。
- 认领他人 lease 可获明文 LLM API key（H-4）。
- `startswith` 前缀判断可兄弟目录逃逸写穿 workspace root（H-5）。

## 方案概要

方案 A 最小侵入逐点修复：owner 断言（统一 404）、`relative_to` 路径校验、scope 收紧（workspace-scoped 权限）、query token 回退删除、master key 经 backend 代理不出进程。详见 design.md。

## 不在范围内（Non-Goals）

- LiteLLM per-user virtual key 体系（后续 change）
- SSRF DNS pin / tar filter / git args 白名单（后续 quick）
- 全部性能类发现（另立性能 change）
- daemon mTLS / token 轮换、JWT jti 吊销、token expires_at（低危缓办）

## 验收口径

每个修复点：另一用户访问目标资源 → 404/403/4001 的失败测试先行；本用户正常路径回归不破。
