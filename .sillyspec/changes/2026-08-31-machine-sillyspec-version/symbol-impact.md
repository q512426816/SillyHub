---
author: qinyi
created_at: 2026-08-31 08:45:12
---
# 符号影响面报告（Symbol Impact）— 2026-08-31-machine-sillyspec-version

- task-01: 无签名级变更（新增常量 DAEMON_MSG_SILLYSPEC_UPDATE + 新增方法 ws_hub.send_sillyspec_update，纯增量，无既有调用点受影响；backend 契约测试 EXPECTED map 为数据表追加）。
- task-02: 服务层签名增参——RuntimeService.register_daemon / heartbeat_daemon 加 sillyspec_version/sillyspec_latest_version/sillyspec_update 可选参数（默认 None 不改变既有调用行为）；受影响调用点：backend/app/modules/daemon/router.py:399（register handler）、router.py:453（heartbeat handler 直调）、service.py:165/199（facade 转发）——全部在本 task allowed_paths（router.py/service.py/runtime/service.py）内。DTO 字段为可选增量（Pydantic default None），既有请求体不受影响。
- task-03: 无签名级变更（新增端点函数；_build_machine_read 内部组装扩展、签名不变；DaemonMachineRead/MachineSillySpecUpdateRead 为响应模型可选字段增量）。调用点 router.py:929/:982 均在 allowed_paths 内。
- task-04: preflight.ts runCmd/installSillySpec 从模块私有改 export（签名不变、行为不变，纯可见性增量）；新模块 sillyspec-manager.ts 无既有调用点。isOutdated 如需导出同口径。
- task-05: hub-client.register()/heartbeat() 追加末位可选参数（undefined 时请求体逐字段不变）——受影响调用点 sillyhub-daemon/src/daemon.ts:2374（register）、:3671（heartbeat）均在 allowed_paths；既有测试（daemon-heartbeat-pending.test.ts / daemon-multi-runtime.test.ts 等 mock 断言 body 键集合）不传新参不受影响。protocol.ts MsgType 联合扩展 + config DaemonConfig 新字段（default 3600，config.test.ts 键表更新在 allowed_paths）。daemon.ts _handleMessage 新增 case（switch 增量）。
- task-06: api-types.ts 再生（gen:types 产物，字段可选增量）；lib/daemon.ts 新增函数 triggerMachineSillySpecUpdate（纯新增）。无既有签名变更。
- task-07: MachineCardProps 追加可选属性 onUpgradeSillySpec?/upgradingSillySpec?（对齐既有 upgrading?: boolean 可选先例，不破坏 machine-card.test.tsx / machine-card-pending.test.tsx 既有构造）；受影响调用点 frontend/src/app/(dashboard)/runtimes/page.tsx（传参）在 allowed_paths。横幅用独立 data 属性不复用 pending 定位器（既有测试定位器不受影响）。
- task-08: 无签名级变更（仅运行测试与最小测试修补）。
