---
id: task-12
title: handleInitLease 编排测试（含失败语义）
title_zh: 扩展 test_init_lease 测 handleInitLease 写 local yaml 成功与失败两路径 验证 url 用 serverOrigin 严格契约 ok false 不上抛
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
wave: W4
depends_on: [task-06, task-07]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003]
allowed_paths:
  - sillyhub-daemon/tests/test_init_lease.test.ts
expects_from:
  task-06:
    - contract: handleInitLease 第4步 writeLocalYaml
      needs: [成功 ok:true, 失败 ok:false]
provides: []
goal: >
  扩展 sillyhub-daemon/tests/test_init_lease.test.ts 新增 handleInitLease 编排用例，覆盖写 local.yaml 成功（platform+mcp 两段 token 与 url 正确）与写失败（writeLocalYaml 抛错→第4步 try/catch 返 ok:false）两条路径，验证 url 用 task-runner 透传的 serverOrigin 不用 payload.server_origin，对齐 design §5.4 §6 与 D-003 严格契约「写盘失败=init 失败」，消费 task-06 提供的 writeLocalYaml 第4步契约，不改既有 init lease 断言（扩展非重写）。
implementation:
  - 新增用例「写 local.yaml 成功→ok:true」：lease payload 含 platform_config.local_yaml={platform_token:'shpsync_x',mcp_token:'shmcp_y'}，传 serverOrigin='https://hub.example.com'，断言 result.ok===true 且落盘 local.yaml platform 段 url=serverOrigin 与 token=shpsync_x、mcp 段 url=serverOrigin+'/mcp' 与 token=shmcp_y
  - 新增用例「writeLocalYaml 失败→ok:false」：vi.mock('../src/local-yaml-writer.js') 令 writeLocalYaml 抛 Error('write boom')，断言 handleInitLease 返回 result.ok===false 且 result.error 匹配 local_yaml_write_failed 或 write 语义，验证失败被第4步 try/catch 转成 ok:false 不上抛顶层 catch（D-003）
  - 新增用例「url 用 serverOrigin 非 payload.server_origin」：serverOrigin 传 'https://from-runner.example.com'，payload.platform_config.server_origin 传 'https://from-backend.example.com'，断言落盘 platform 段 url=前者证明 daemon 用 task-runner 透传 serverOrigin（design §5.4 D-002）
  - 既有 ws-init-ok/ws-init-5xx 等用例因新增第4步 writeLocalYaml 调用若需补 local_yaml 字段则补 payload 不改其断言，mock writeLocalYaml 默认走真实写盘到 tmp rootPath 后清理
acceptance:
  - 成功路径两段写入：落盘 local.yaml platform 段 url=serverOrigin token=shpsync_x，mcp 段 url=serverOrigin+'/mcp' token=shmcp_y
  - 失败路径 ok:false 语义（非抛错非顶层 catch），result.error 含 write 失败原因（D-003）
  - url 来源验证：platform 段 url=task-runner 透传 serverOrigin 不等于 payload.platform_config.server_origin（D-002）
  - 既有 init lease 测试断言零改动（扩展新用例非重写），既有 ws-init-* 用例仍全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts
constraints:
  - 失败语义测 ok:false 不测抛错顶层 catch（D-003：写盘失败=init 失败，handleInitLease 逐步 try/catch 模型，非上抛）
  - mock writeLocalYaml 失败用 vi.mock 或 payload 注入，不破坏既有断言
  - 扩展非重写：既有 handleInitLease/writeDaemonState/TaskRunner.runLease init 分支用例断言不改，仅新增用例或补 payload 字段
  - 仅改测试文件，不改 spec-sync.ts/local-yaml-writer.ts 源码（源码改动属 task-06）；依赖 task-06 writeLocalYaml 第4步契约与 task-07 既有测试骨架
---
