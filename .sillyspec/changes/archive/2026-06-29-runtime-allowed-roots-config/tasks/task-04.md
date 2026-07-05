---
id: task-04
title: sillyhub-daemon 心跳拉取同步本地 config
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: [task-03]
blocks: [task-05]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-04

> goal: daemon 心跳响应解析 `allowed_roots` → 同步本地 `config.allowed_roots`（合并 homedir 兜底）。

## implementation
- 心跳响应处理（hub-client 或 daemon.ts）：解析 `allowed_roots` 字段
- `~/.sillyhub` 占位展开为 `homedir()/.sillyhub`（daemon 侧 homedir 解析）
- 合并 homedir 兜底（保证 allowed_roots 非空，含 homedir）
- 写 `config.allowed_roots`（运行时覆盖，不落盘或落盘按现有 config 策略）
- list_dir（file-rpc.ts）继续读 config.allowed_roots（不变）

## acceptance
- 心跳响应有 allowed_roots → config.allowed_roots 同步
- `~` 展开 + homedir 合并（非空）
- 旧 backend（响应无 allowed_roots）→ config 不变（向后兼容）
- list_dir 用更新后的 config.allowed_roots

## verify
- `cd sillyhub-daemon && pnpm test`

## constraints
- homedir 始终在 allowed_roots（兜底，非空）
- 向后兼容（响应无字段不崩）
- config 落盘策略沿用现有（不因同步频繁写盘）
