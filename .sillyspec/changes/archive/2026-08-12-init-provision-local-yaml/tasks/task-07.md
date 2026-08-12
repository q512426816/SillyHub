---
id: task-07
title: task-runner 透传 local_yaml 与 serverOrigin 到 handleInitLease
title_zh: task-runner _runInitLease 构造 initParams 时把 platformConfig local_yaml 与 config server_url 算的 serverOrigin 透传给 handleInitLease 入参
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-06]
blocks: [task-12]
requirement_ids: [FR-06]
decision_ids: [D-002]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
provides:
  - contract: initParams 含 local_yaml 与 serverOrigin
    fields: [initParams 透传 platformConfig local_yaml 与 serverOrigin 给 handleInitLease]
expects_from:
  task-06:
    - contract: handleInitLease 入参
      needs: [local_yaml 与 serverOrigin 两字段]
goal: >
  在 sillyhub-daemon/src/task-runner.ts _runInitLease 构造 initParams 时，把 ctx.platformConfig.local_yaml 透传给 handleInitLease，serverOrigin 继续用 this config server_url 去尾斜杠 已有 task-runner.ts 861，覆盖 FR-06 与 D-002，为 task-06 第4步 writeLocalYaml 提供 url 来源，不用 payload server_origin。
implementation:
  - 在 _runInitLease 构造 handleInitLease 入参 initParams 处，从 ctx.platformConfig.local_yaml 读出 platform_token 与 mcp_token 透传给 handleInitLease 的 local 参数
  - serverOrigin 继续用 this.config 与可选链 server_url 去尾斜杠 现有 task-runner.ts 861 已算，透传给 handleInitLease 的 serverOrigin 参数
  - local_yaml 缺失时透传 undefined handleInitLease 第4步据此跳过 向后兼容
  - 不改 _runInitLease 既有逻辑只加 local_yaml 与 serverOrigin 两字段的透传
acceptance:
  - platformConfig.local_yaml 从 payload 经 task-runner 透传到 handleInitLease 入参 local 字段
  - serverOrigin 用 task-runner config server_url 去尾斜杠 不用 payload server_origin
  - local_yaml 缺失的旧 lease 透传 undefined 不报错 handleInitLease 第4步跳过
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts
constraints:
  - serverOrigin 用 task-runner config server_url 不用 payload server_origin 因 local.yaml 给本机 sillyspec 用需本机可达地址 对齐 D-02
  - 不改 _runInitLease 既有 initParams 逻辑只加 local_yaml 与 serverOrigin 两字段透传
  - local_yaml 可选缺失透传 undefined 向后兼容旧 lease 与 mock
  - 代码兼容 Windows Linux macOS server_url 去尾斜杠复用既有 _serverOrigin 范式
---
