---
author: qinyi
created_at: 2026-08-29 14:43:52
---
# 任务清单（Tasks）

- [x] task-01: daemon 忙判定查询口（session-manager.hasRunningTurn + task-runner.hasActiveLease，不动 daemon.ts）
- [x] task-02: backend daemon_instances.pending_update 列 + alembic 迁移
- [x] task-03: daemon 磁盘探测（onDiskChange 回调出口）+ pending-update.json（原子写/启动清残留）+ config 配置项 + status 展示
- [x] task-04: daemon tryUpdate 编排器（所有权/推迟 30s/终检/disk_change 直启/TaskRunnerLike 可选化/SELF_UPDATE case 改造/preflight 目标版本回传）（depends_on: task-01, task-03）
- [x] task-05: daemon 心跳携带 pending_update（hub-client 可选参数+组装注入）（depends_on: task-03, task-04）
- [x] task-06: backend 心跳 upsert（保留 since/无字段清除）+ machines 与 runtimes/page 透出（depends_on: task-02）
- [x] task-07: 前端 DaemonMachineRead 补字段 + MachineCard 三状态横幅与按钮禁用（depends_on: task-06）
- [x] task-08: 三端 gen:types 收口 + 集成回归四路径（depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07）
