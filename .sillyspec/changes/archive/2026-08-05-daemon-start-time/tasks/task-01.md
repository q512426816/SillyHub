---
id: task-01
title: cli.ts inject process start time into Daemon and propagate startedAt on register/heartbeat
title_zh: cli.ts 入口取进程启动时间注入 Daemon 并在 register/heartbeat 上报 started_at
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on:
  - task-02
blocks: []
requirement_ids:
  - FR-01
decision_ids:
  - D-001@v1
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/daemon.ts
provides: {}
expects_from:
  task-02:
    - contract: RegisterBody
      needs:
        - started_at
    - contract: HeartbeatBody
      needs:
        - started_at
goal: >
  daemon 进程在 cli.ts 入口尽早取启动时间（processStartTime = Date.now()），作为
  构造参数注入 Daemon，使 register/heartbeat 调 hub-client 时上报恒定的 started_at。
implementation:
  - cli.ts 在 new Daemon()（约 :757）之前取 const processStartTime = Date.now()（进程入口尽早取，可在 :513 echo 启动信息附近或紧贴 :757 之前）
  - cli.ts 将启动时间作为构造参数传入 new Daemon(config, client, taskRunner, { ..., startedAt: processStartTime })（扩展现有 DaemonOptions 对象）
  - daemon.ts 构造函数（:740）接收参数并存储 private readonly _startedAt: number
  - daemon.ts _registerDaemon（:1008 this._client.register 调用）传 startedAt: this._startedAt
  - daemon.ts heartbeat（:1877 this._client.heartbeat 调用）传 startedAt: this._startedAt
acceptance:
  - cli.ts 入口取 processStartTime 并注入 new Daemon() 构造参数
  - daemon.ts 持有 _startedAt field（构造接收，运行期恒定）
  - register（_registerDaemon）调 hub-client 时传 startedAt
  - heartbeat 调 hub-client 时传 startedAt
  - tsc 编译通过（pnpm exec tsc --noEmit）
  - daemon.ts:1808 _fire() circuit-breaker 局部变量 startedAt 不被误改（仅 survived_ms 计算，与进程启动无关）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - 若 daemon/cli 存在相关 vitest，则 cd sillyhub-daemon && pnpm test
constraints:
  - processStartTime 必须在进程入口（cli.ts）尽早取，不在 daemon.ts 内部循环中取
  - _startedAt 在进程生命周期内恒定不变；daemon 重启取新值（新进程合理）
  - 不动 daemon 生命周期 / lease / session / state_transition（仅 register/heartbeat body 加只读字段）
  - ESM import 保持 .js 后缀
  - daemon.ts:1808 circuit-breaker 局部 startedAt 是无关变量，禁止误改
---
