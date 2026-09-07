---
author: qinyi
created_at: 2026-09-04 23:05:00
---
# 模块影响分析（Module Impact）— 变更中心平台同步处理区（冲突裁决 + ghost 清理）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon-protocol/ws_hub | 修改 | 两条 Server→Daemon MSG 常量（daemon:sillyspec_resolve / daemon:sillyspec_ghost_cleanup）+ 两个 fire-and-forget 发送方法（照 send_sillyspec_update 先例走 send_to_runtime） |
| backend:daemon-router | 修改+新增 | 两个管理端点（sillyspec-resolve / sillyspec-ghost-cleanup：RuntimeAdminUser + _get_owned_instance 越权 404 + change 白名单 + 504）+ 心跳 DTO DaemonHeartbeatSillySpecCommandResult + 机器视图 MachineSillySpecCommandResultRead |
| backend:daemon-model/migrations | 修改+新增 | daemon_instances 加 sillyspec_command_result JSON nullable 列 + 迁移 20260904223000（仅 ADD COLUMN） |
| backend:daemon-runtime-service | 修改 | heartbeat_daemon 新参数两态落库（对象直写/缺键置 NULL，语义同 sillyspec_status）+ register 恒清 |
| backend:daemon-tests | 新增 | test_sillyspec_platform_commands.py（权限三态/白名单/504/两态落库/register 恒清/机器视图透出） |
| sillyhub-daemon:protocol | 修改 | 两条 MSG 常量 + SillySpecResolvePayload + 心跳结果类型 SillySpecCommandResult（七字段宽松可选） |
| sillyhub-daemon:daemon-core | 修改 | _handleWsMessage 两个机器级直连 case + in-flight 串行 guard（忙记 failed，覆盖 npm 升级链）+ _sendHeartbeatOnce 携带结果 |
| sillyhub-daemon:sillyspec-manager | 修改 | runResolve / runGhostCleanup（execFile 120s 默认、数组参数不经 shell）+ _lastCommandResult 10min 终态窗（过期停发键） |
| sillyhub-daemon:config | 修改 | 新配置键 sillyspec_command_timeout_sec 默认 120（config.test.ts 键表断言需同步） |
| sillyhub-daemon:tests | 修改+新增 | sillyspec-platform-command.test.ts 新增 + config.test.ts / protocol-session-contract.test.ts / daemon-heartbeat-sillyspec.test.ts 三处既有断言适配 |
| frontend:lib-daemon | 修改 | triggerMachineSillySpecResolve / triggerMachineSillySpecGhostCleanup（api-types 生成类型） |
| frontend:changes-page | 修改 | 桌面 + 移动两镜像页「解析警告」卡后挂 platform-sync-section |
| frontend:changes-components | 新增 | platform-sync-section.tsx + use-machine-sync-action-access.ts 权限 hook + 组件测试 |
| frontend:workspace-components | 修改 | changes-overview-card.tsx 冲突/ghost 区 CLI 指引改跳转变更中心（测试两处 CLI 断言适配） |
| docs（.sillyspec modules） | 修改 | backend.md / sillyhub-daemon.md / frontend.md 变更索引条目 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-08 跑 pnpm gen:types 再生成，不手改 |
| .sillyspec/.runtime/stage-reviews/*、rescue-20260904-platform-takeover/ | 流程运行时产物（审查证据/事故备份），不入模块映射 |

## 关联任务

task-01/03/05（W1 三端契约基础）、task-02/06（W2 同文件串行：端点/执行器）、task-04/07/08（W3 测试与类型）、task-09/10（W4 前端 UI）、task-11（W5 模块文档）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （首版于 plan Wave 校验步生成；execute/verify 阶段更新，archive 终审） | — | — |
