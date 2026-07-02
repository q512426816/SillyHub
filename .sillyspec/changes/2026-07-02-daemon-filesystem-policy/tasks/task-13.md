---
id: task-13
title: daemon ws-client 监听 POLICY_UPDATE
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-02, task-06, task-11]
blocks: [task-22]
allowed_paths:
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-13

> goal: ws-client 监听 POLICY_UPDATE 消息，立即更新 PolicyCache（D-004 sub-second）。

## implementation
- `ws-client.ts:337` `_handleMessage` 新增 POLICY_UPDATE 分支 → 回调 `onPolicyUpdate(rid, roots, version)`
- `daemon.ts` 注册 onPolicyUpdate → `policyCache.set(rid, roots)`（version 去重：收旧 version 忽略，R-07）
- interactive session 下次 tool 调用实时读新值

## 验收标准
- backend push POLICY_UPDATE → daemon 立即更新 PolicyCache（sub-second）
- 旧 version 消息忽略
- WS 断线重连后靠心跳兜底 reloadAll

## 验证
- `cd sillyhub-daemon && pnpm test ws-client`

## constraints
- version 去重防乱序（R-07）
- 不改现有 ws-client 消息处理
- 心跳兜底保留（WS push 是优化非唯一路径）
