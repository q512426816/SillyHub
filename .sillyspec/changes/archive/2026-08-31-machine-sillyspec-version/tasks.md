---
author: qinyi
created_at: 2026-08-31 08:20:00
---
# 任务清单（Tasks）

- [x] task-01: backend 协议与 WS 通道——protocol.py `DAEMON_MSG_SILLYSPEC_UPDATE` + ws_hub.send_sillyspec_update + backend 契约测试（test_protocol_session_contract.py EXPECTED map；TS 镜像测试归 task-05）
- [x] task-02: backend DB 与落库——model.py 3 新列 + alembic 迁移 + register/heartbeat DTO 字段 + RuntimeService register 直接落值/心跳非 None 覆盖 + update 无键清除（D-002@v1）
- [x] task-03: backend 端点与读视图——POST /machines/{id}/sillyspec-update（归属校验+504）+ `_build_machine_read` 显式组装 + `MachineSillySpecUpdateRead` 嵌套类型 + DaemonMachineRead 字段（depends_on: task-01, task-02）
- [x] task-04: daemon sillyspec-manager 模块——探测（probeLocal/probeLatest 10min 缓存）/升级执行（复用 preflight 导出 runCmd/installSillySpec）/状态机（in-flight 门/deferred 30s 复查/终态 10min 窗口）+ 单测
- [x] task-05: daemon 接线——config `sillyspec_update_interval_sec`（+config.test.ts 键表 29→30）+ protocol.ts SILLYSPEC_UPDATE（+TS 契约镜像测试与 MSG 计数 21→22）+ `_sillyspecLoop` 第四循环 + hub-client register/heartbeat 可选参 + daemon.ts 心跳/注册透传 + `_handleMessage` case + 心跳 body 键存在性单测（depends_on: task-04）
- [x] task-06: 前端 API 层——gen:types 再生（api-types.ts + openapi.json）+ lib/daemon.ts `triggerMachineSillySpecUpdate`（depends_on: task-03）
- [x] task-07: 前端机器卡 UI——徽标三形态（semver 本地比较）+「升级 sillyspec」按钮 5 态 + sillyspec_update 横幅四态 + page handler 传参 + 组件测试（depends_on: task-06）
- [x] task-08: 回归收口——daemon 相关套件 + backend daemon 模块测试 + frontend machine-card 测试全绿；tsc/ruff/mypy/format 0 错（depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07）
- [x] ql-20260831-007-0fd4 sillyhub-daemon 官方隔离参数 SILLYHUB_DAEMON_DIR：daemon 全部本地状态可重定向，集成测试不再劫持 USERPROFILE
