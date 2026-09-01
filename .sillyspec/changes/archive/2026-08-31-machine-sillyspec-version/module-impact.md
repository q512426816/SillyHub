---
author: qinyi
created_at: 2026-08-31 08:22:14
---
# 模块影响分析（Module Impact）— 机器列表 sillyspec 版本显示与远程升级

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon（根图） | 修改 | 新增 sillyspec-manager 模块（探测/状态机/升级执行）；protocol.ts 新消息 SILLYSPEC_UPDATE；daemon.ts 第四循环 + 心跳/注册字段 + WS case；hub-client.ts 可选参；preflight.ts 导出复用；config.ts 新字段。细粒度模块卡：protocol / daemon / preflight / config / client |
| backend（根图） | 修改 | daemon 模块：model 3 新列 + alembic 迁移 + register/heartbeat DTO 与落库 + sillyspec-update 端点 + _build_machine_read 组装 + DaemonMachineRead/MachineSillySpecUpdateRead；migrations 模块：新迁移文件 |
| frontend（根图） | 修改 | components-daemon（machine-card 徽标/按钮/横幅）、lib-daemon（triggerMachineSillySpecUpdate + api-types 再生）、app-pages（runtimes 页 handler）。对照原型 prototype-machine-sillyspec.html |
| 三模块间契约 | 依赖变更 | WS 字面量 daemon:sillyspec_update 双侧逐字对齐；heartbeat/register body 新字段（register 无条件写 / 心跳非 None 覆盖 / update 无键清除，D-002@v1）；DaemonMachineRead 3 新字段经 gen:types 流入前端 |

## 未匹配文件

无

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/sillyhub-daemon/modules/protocol.md` | 更新 protocol 模块卡（+SILLYSPEC_UPDATE 消息与 payload） | done |
| `docs/sillyhub-daemon/modules/daemon.md` | 更新 daemon 模块卡（+_sillyspecLoop 第四循环/心跳注册透传/WS case） | done |
| `docs/sillyhub-daemon/modules/preflight.md` | 更新 preflight 模块卡（runCmd/installSillySpec 导出复用说明） | done |
| `docs/sillyhub-daemon/modules/config.md` | 更新 config 模块卡（+sillyspec_update_interval_sec 字段） | done |
| `docs/sillyhub-daemon/modules/client.md` | 更新 client 模块卡（register/heartbeat 可选 sillyspec 参数） | done |
| `docs/sillyhub-daemon/modules/sillyspec-manager.md` | 新增 sillyspec-manager 模块卡（探测/状态机/自动循环） | done |
| `docs/backend/modules/daemon.md` | 更新 backend daemon 模块卡（3 列/端点/DTO/落库语义 D-002@v1） | done |
| `docs/backend/modules/migrations.md` | 更新 migrations 模块卡（+20260831 sillyspec_fields 迁移） | done |
| `docs/frontend/modules/components-daemon.md` | 更新前端 daemon 组件卡（machine-card 徽标/按钮/横幅） | done |
| `docs/frontend/modules/lib-daemon.md` | 更新前端 lib-daemon 卡（+triggerMachineSillySpecUpdate、api-types 3 新字段） | done |
| `docs/frontend/modules/app-pages.md` | 更新前端页面卡（runtimes 页 handler，若该页归属其他卡以实际为准） | done |
| `_module-map.yaml`（各项目） | sillyhub-daemon map +sillyspec-manager 路径；其余无变化 | done |
