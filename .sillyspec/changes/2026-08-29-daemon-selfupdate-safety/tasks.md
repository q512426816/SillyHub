---
author: qinyi
created_at: 2026-08-29 14:43:52
---
# 任务清单（Tasks）

> 骨架只列任务名。plan 阶段会把展开后的清单写回本文件。

- [ ] task-01: daemon 忙判定查询口（sessionManager.hasRunningTurn / taskRunner.hasActiveLease 可选化）
- [ ] task-02: daemon tryUpdate 编排器（单入口/所有权占位与释放/推迟 30s 复查/stop 前终检/disk_change 直启分流）+ SELF_UPDATE case 改造
- [ ] task-03: daemon 磁盘旁路探测循环（读文件提取 BUILD_ID/配置项/失败≠变化）+ config self_reload_check_interval_sec
- [ ] task-04: daemon pending-update.json（原子写/清除）+ status 命令展示 + 启动清残留
- [ ] task-05: daemon 心跳携带 pending_update（hub-client body 扩展）
- [ ] task-06: backend daemon_instances.pending_update 列 + alembic 迁移
- [ ] task-07: backend 心跳 upsert（无字段=清除/同内容保留 since）+ machines 与 runtimes/page 透出
- [ ] task-08: 前端 lib/daemon.ts DaemonMachineRead 补字段 + MachineCard 三状态横幅与按钮禁用（对照原型）
- [ ] task-09: 三端 gen:types 收口 + 集成回归（忙→推迟→空闲→升级/下载窗口插任务终检/磁盘替换直启/pending 可见性闭环）
