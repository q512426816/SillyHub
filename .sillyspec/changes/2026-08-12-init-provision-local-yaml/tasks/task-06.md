---
id: task-06
title: handleInitLease 增 writeLocalYaml 第4步
title_zh: spec-sync handleInitLease 在 writeDaemonState 与 pullSpecBundle 后加第4步 writeLocalYaml 失败 try catch 返 ok false 对齐现有模型实现严格契约
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-03, task-04]
blocks: [task-07, task-12]
requirement_ids: [FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-003]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: handleInitLease 编排含 writeLocalYaml 第4步
    fields: [handleInitLease 第4步调 writeLocalYaml 成功返 ok true 失败 try catch 返 ok false]
expects_from:
  task-03:
    - contract: writeLocalYaml
      needs: [writeLocalYaml rootPath 与 local 对象与 serverOrigin]
  task-04:
    - contract: claim payload platform_config local_yaml
      needs: [platform_token 与 mcp_token]
goal: >
  在 sillyhub-daemon/src/spec-sync.ts handleInitLease 的 writeDaemonState 与 pullSpecBundle 之后 return ok true 之前加第4步 writeLocalYaml，读 ctx platformConfig local_yaml 与 serverOrigin 调 task-03 的 writeLocalYaml，失败时 try catch 返 ok false 对齐现有逐步 catch 模型实现 D-003 严格契约，覆盖 FR-04 FR-05 FR-06 FR-07。
implementation:
  - 在 handleInitLease spec-sync.ts 903 附近 return ok true 之前插入第4步，仅当 ctx platformConfig local_yaml 存在时执行（向后兼容无 token 的旧 lease）
  - 读 ctx.platformConfig.local_yaml 取 platform_token 与 mcp_token，读 serverOrigin（由 task-07 task-runner 透传入 handleInitLease 入参）
  - 用 try 包裹调 task-03 writeLocalYaml(rootPath, local_yaml, serverOrigin)，成功继续 return ok true
  - catch 写盘错误记 warn 返回 ok false，对齐 writeDaemonState 920 927 与 pullSpecBundle 932 的逐步 catch 范式，不向上抛
  - rootPath 取 ctx.rootPath 或既有 handleInitLease 已用的本地目录变量
acceptance:
  - handleInitLease 第4步 writeLocalYaml 成功时整体返 ok true 含两段写入
  - writeLocalYaml 抛错时第4步 try catch 返 ok false 不向上抛 _runInitLease 据 result ok false 走 finish false lease 标 failed
  - 仅当 ctx.platformConfig.local_yaml 存在时执行第4步 无 local_yaml 的旧 lease 行为不变
  - serverOrigin 来源 task-07 透传 不读 payload server_origin
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts
constraints:
  - 失败语义用 try catch 返 ok false 不用抛错顶层 catch，对齐 handleInitLease 现有逐步 catch 模型 spec-sync.ts 903 970 非 task-runner 顶层 catch
  - 不改前 3 步 writeDaemonState pullSpecBundle postSpecSync 逻辑只加第4步
  - url 用 serverOrigin 不用 payload server_origin 对齐 D-002
  - ctx.platformConfig.local_yaml 缺失时跳过第4步 向后兼容旧 lease 与 mock client
---
