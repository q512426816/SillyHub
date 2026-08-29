---
author: qinyi
created_at: 2026-08-29 14:43:52
---
# 提案书（Proposal）

## 动机

daemon 的 SELF_UPDATE 自更新链路缺少安全层：升级指令到达即 stop，会打断进行中的轮次与任务；bundle 被外部工具替换/降级时 daemon 无感知；升级被推迟（如果推迟）时状态无处可见。源自 2026-08-29 multica self_reload 机制调研的四项缺口（对照证据：multica auto_update.go / self_reload_test.go；本项目 daemon.ts:3997-4031 现链路）。

## 关键问题

1. **升级打断进行中工作**：现有链路 stop() 直接执行——在跑轮次被标 failed(daemon_stopped)、batch 子进程被杀；且下载与 stop 之间存在竞态窗口（新任务恰在窗口内启动）。
2. **磁盘版本变更无感知**：外部部署工具换 bundle、降级、SELF_UPDATE 指令丢失三类场景 daemon 永不自新；若探测方式选错（--version 输出 semver 与 BUILD_ID 不同源）会恒误报。
3. **推迟/进行中状态不可见**：运维无从知道「为什么还没升级」；平台机器页无展示。
4. **更新生命周期无仲裁**：多入口可双写；失败路径无状态释放语义；respawn 失败时进程停摆语义含糊。

## 变更范围

- **daemon（sillyhub-daemon）**：tryUpdate 单入口编排器（所有权占位/仅进行中算忙/30s 复查无限等/stop 前终检/disk_change 独立直启路径）；磁盘旁路探测（读 bundle 提取 BUILD_ID，默认 600s 可配 0 关，失败≠变化）；pending-update.json + status 命令展示 + 心跳携带 pending_update；config 新增 self_reload_check_interval_sec。
- **backend**：daemon_instances 加 pending_update JSON nullable 列（迁移）；心跳接收 upsert（无字段=清除，同内容保留 since）；/machines 与 /runtimes/page 透出。
- **frontend**：MachineCard 三状态横幅（server_command=warning 等空闲/disk_change=info 程序文件变更）+「升级 daemon」按钮禁用；lib/daemon.ts 手写接口补字段。
- **配套**：三端 gen:types 收口。

## 不在范围内（显式清单）

- 不做进程内热重载、pending-restart 状态机/drain hook、新版本健康门控/自动回退、GitHub release 轮询、宿主管理器豁免（见 design 非目标六项）
- 不改下载替换原子性（preflight 现有 tmp+rename）
- 前端仅机器卡横幅与按钮禁用（不新增页面/路由）

## 成功标准（可验证）

- daemon 在跑轮次/任务期间收到 SELF_UPDATE：不打断、进入等待空闲（30s 复查），空闲后自动完成升级且挂起的空闲会话恢复可用
- 下载窗口内新启动任务：stop 前终检发现，回推迟路径不打断（毫秒级窗口集成用例锁定）
- 外部替换 bundle（含降级）：10 分钟内磁盘探测发现并（空闲时）重启到盘上版本；探测失败/半写文件不触发
- pending 期间：`sillyhub-daemon status` 显示原因与版本对比；平台机器页横幅可见；升级完成后本地文件清除、平台横幅 30-60s 内消失
- 更新失败（下载失败/noop）：所有权释放，下一条指令可再触发；respawn 失败进程保活停摆且 backend 45s 判 offline 可见
- 三端相关测试全绿、tsc/mypy/ruff 0 新增错误、alembic 单 head
