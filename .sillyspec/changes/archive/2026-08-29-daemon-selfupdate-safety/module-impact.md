---
author: qinyi
created_at: 2026-08-29 15:22:10
---
# 模块影响分析（Module Impact）— daemon SELF_UPDATE 安全层增强

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon:daemon | 修改 | tryUpdate 编排器（所有权/推迟/终检/disk_change 直启）、SELF_UPDATE case 改造、磁盘探测循环、pending 状态持有、心跳组装注入 |
| sillyhub-daemon:client | 修改 | hub-client heartbeat 追加可选 pendingUpdate 参数（不破坏 3 参） |
| sillyhub-daemon:protocol | 不变 | 无新消息类型（心跳 body 字段在 hub-client 层） |
| sillyhub-daemon:cli | 修改 | status 命令追加 pending-update 展示行 |
| sillyhub-daemon:config | 修改 | self_reload_check_interval_sec（默认 600/0=关） |
| sillyhub-daemon:preflight | 修改 | 目标版本回传等价接口（不动 boolean 返回）+ preflight.test 同步 |
| backend:daemon | 修改+新增 | DaemonInstance.pending_update JSON nullable 列+迁移；heartbeat upsert（保留 since/无字段清除）；/machines 与 /runtimes/page 透出 |
| frontend:components-daemon | 修改 | MachineCard 三状态横幅+升级按钮禁用 |
| frontend:lib-daemon | 修改 | DaemonMachineRead 手写接口补 pending_update |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/202608291500_add_daemon_pending_update.py | 新增迁移文件，task-02 创建（versions 目录属 backend:migrations 模块） |
| backend/openapi.json、sillyhub-daemon/src/api-types.ts、frontend/src/lib/api-types.ts | 生成物，task-08 收口再生成，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/sillyhub-daemon.md`（daemon/client/cli/config/preflight） | 更新自更新安全层语义（编排器/探测/pending）说明 | done |
| `modules/backend.md`（daemon 模块） | 更新心跳 upsert 与机器视图透出说明 | done |
| `modules/frontend.md`（components-daemon/lib-daemon） | 更新机器卡三状态说明 | done |
| `_module-map.yaml` | 无变化（未增删模块；新迁移文件落既有 versions 目录） | skipped |
