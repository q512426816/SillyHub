---
author: qinyi
created_at: 2026-08-29 14:48:30
plan_level: full
---

# 实现计划（Plan）：daemon SELF_UPDATE 安全层增强

## Wave 1（忙判定查询口 ∥ backend 建列，文件正交）
- task-01
- task-02

## Wave 2（磁盘探测+pending 文件+status 展示）
- task-03

## Wave 3（tryUpdate 编排器，汇合 W1/W2 产物）
- task-04

## Wave 4（心跳携带 pending_update）
- task-05

## Wave 5（backend 落库与透出）
- task-06

## Wave 6（前端机器卡展示）
- task-07

## Wave 7（三端类型收口+集成回归）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 忙判定查询口 | W1 | P0 | — | FR-01 | session-manager.ts 加 hasRunningTurn（status==='running'，reconnecting 不算）+ task-runner.ts 加 hasActiveLease（_controllers 非空）；**不动 daemon.ts**（TaskRunnerLike 接口可选化归 task-04 唯一消费者） |
| task-02 | backend pending_update 列+迁移 | W1 | P0 | — | FR-04 | model.py DaemonInstance.pending_update JSON nullable + alembic 迁移（落 backend/migrations/versions/，提交前单 head 检查） |
| task-03 | daemon 磁盘探测+pending 文件+status | W2 | P0 | — | FR-01, FR-03 | daemon.ts 探测循环（读 bundle 正则提取 BUILD_ID，差异出口=注入式 onDiskChange 回调——**不引用 tryUpdate**，接线归 task-04）+ config.ts self_reload_check_interval_sec（默认 600/0=关）+ pending-update.json 原子写模块与启动清残留 + cli.ts status 展示 |
| task-04 | daemon tryUpdate 编排器 | W3 | P0 | task-01, task-03 | FR-01, FR-02, FR-03 | daemon.ts：单入口所有权占位/忙则释放+pending+30s 定时器（离开推迟必清）/空闲按 reason 分流（server_command→现有链+**stop 前终检**；disk_change→直启不下载不查 manifest）/一切非交接路径释放+清 pending；TaskRunnerLike 可选方法+SELF_UPDATE case 改造 fire-and-forget+探测/接线消费 01/03 产物；**preflight.ts 目标版本回传（等价接口不动布尔返回）+ preflight.test.ts 同步** |
| task-05 | daemon 心跳携带 pending_update | W4 | P0 | task-03, task-04 | FR-04 | hub-client.ts heartbeat 追加可选参数（不破坏既有 3 参调用）+ daemon.ts 心跳组装处仅 pending 期注入 |
| task-06 | backend 落库与透出 | W5 | P0 | task-02 | FR-04 | runtime/service.py heartbeat_daemon upsert（有字段同内容保留 since/无字段置 NULL——与兄弟字段反向已注）+ router.py /machines 与 /runtimes/page 透出 |
| task-07 | 前端机器卡展示 | W6 | P1 | task-06 | FR-05 | lib/daemon.ts DaemonMachineRead 补 pending_update + machine-card.tsx 三状态横幅与升级按钮禁用（对照原型） |
| task-08 | 三端 gen:types+集成回归 | W7 | P0 | task-01~task-07 | 全 FR | openapi 再导出→daemon/frontend gen:types；集成四路径：忙→推迟→空闲→升级/下载窗口插任务→终检回推迟/磁盘替换→直启/pending 可见性闭环 |

## 关键路径
task-01/03 → task-04 → task-05 → task-08（backend 线 02→06→07→08 并行汇合）

## 全局验收标准
1. 三端相关单测全绿（仅跑本变更相关，全量留 CI）；tsc/mypy/ruff 0 新增；alembic 单 head
2. integration-critical 集成冒烟：四路径用例（推迟升级/终检回推迟/磁盘直启/可见性闭环）
3. 未触发新链路旧行为不变（SELF_UPDATE 空闲直升级/preflight noop 保活等既有语义回归）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-04 | 忙判定+推迟用例（仅进行中算忙） |
| D-002@v1 | task-04 | 30s 复查无限等+离开推迟清定时器用例 |
| D-003@v2 | task-03, task-04, task-07 | 读文件探测+直启分流+info 横幅 |
| D-004@v1 | task-05, task-06, task-07 | 三端透传链用例 |
| D-005@v1 | task-04 | 所有权释放+respawn 停摆语义用例 |
| D-006@v1 | task-01~08 | 设计整体 |
| FR-01 | task-01, task-03, task-04 | 屏障+终检+pending 记录 |
| FR-02 | task-04 | 所有权生命周期 |
| FR-03 | task-03, task-04 | 探测四条语义+直启分流 |
| FR-04 | task-03, task-05, task-06 | 落库+清除+since |
| FR-05 | task-07 | 三状态横幅 |
