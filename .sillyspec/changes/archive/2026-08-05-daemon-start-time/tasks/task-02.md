---
id: task-02
title: hub-client register/heartbeat report started_at
title_zh: hub-client 上报 started_at 字段
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
provides:
  - contract: RegisterBody
    fields: [started_at]
  - contract: HeartbeatBody
    fields: [started_at]
goal: >
  给 hub-client 的 register/heartbeat 上报体加 started_at 字段，供 Daemon 上报进程启动时间（ISO 8601）。
implementation:
  - RegisterBody 接口加 started_at 字段（可空字符串，参考现有 daemon_version/daemon_build_id 写法）
  - HeartbeatBody 接口加 started_at 字段（同上可空字符串）
  - register 方法 params 加可选 startedAt（数值或空），方法体内 null 时填 null、否则转 ISO 字符串赋给 body
  - heartbeat 方法签名加可选 startedAt 参数，body 内同上规则填 ISO 字符串或 null
  - 保持现有 ESM 相对 import 带 .js 后缀的约定不变
acceptance:
  - RegisterBody 与 HeartbeatBody 均含 started_at 字段
  - register 与 heartbeat 方法接受 startedAt 参数并按规则填 ISO 字符串（null 时填 null）
  - sillyhub-daemon tsc 编译通过（pnpm exec tsc --noEmit）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - 若存在 hub-client 相关 vitest 测试则补跑 pnpm test
constraints:
  - started_at 必须可空（null 兼容旧 daemon 不上报路径）
  - 不改 register/heartbeat 的 HTTP 路径与其他既有字段
  - ESM import 保持 .js 后缀约定
  - 本 task 不修改 cli.ts/daemon.ts（属 task-01 范围）
---
