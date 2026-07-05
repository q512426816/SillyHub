---
author: qinyi
created_at: 2026-07-03 11:25:00
change: 2026-07-03-daemon-entity-binding
stage: plan
---

# Plan — 守护进程实体化绑定

- **plan_level**: full
- **概述**: 5 Wave / 16 task / 跨 backend + frontend + sillyhub-daemon。核心路径 = 数据模型 → 注册通信 → 派发 → 前端 → 兼容部署（task-16 为关联缺陷纳入，P2 可拆独立 quick）。
- **依据**: `design.md`（15 节）+ `decisions.md`（D-001~008 全 accepted，无未决）。

## Wave 分组与任务

### Wave 1 · 数据模型（backend 基础）
- [x] task-01: 新建 `daemon_instances` 表 + `DaemonInstance` model + alembic 迁移（id=本地 uuid 上报、user_id、hostname、server_url、os/arch/version、allowed_roots、capabilities、status、last_heartbeat_at；唯一 (user_id, server_url, daemon_local_id)）
- [x] task-02: `daemon_runtimes` 改造（加 `daemon_instance_id` FK CASCADE + 移除 os/arch/allowed_roots/capabilities + 移除 display_alias + 加 idx_daemon_runtimes_instance）
- [x] task-03: `workspace_member_runtimes` 加 `daemon_id` 列（FK daemon_instances RESTRICT nullable + ix_wmr_daemon 索引）

### Wave 2 · 注册与通信（daemon + backend）
- [x] task-04: daemon config 按 server_url 隔离文件（`config-<server_hash>.json` + 旧 config.json 迁移 daemon_local_id）——可与 W1 并行
- [x] task-05: 注册流程（daemon `_registerOne`→`_registerDaemon` + hub-client register body 带 daemon_local_id+providers + backend `register_runtime`→`register_daemon` upsert daemon_instances+各 runtime + 删除 stale runtime）
- [x] task-06: WS Hub per-daemon（`_connections` 键 runtime_id→daemon_instance_id；connect/disconnect/send_to_runtime/notify_task_available/send_wakeup/send_heartbeat_ack/send_session_control/send_permission_response/send_self_update/send_rpc/is_connected/connected_* 全方法签名改 daemon_id；ws 握手端点带 daemon_local_id；payload 内保留 runtime_id 标识 provider 会话）
- [x] task-07: 心跳 per-daemon（daemon 单条心跳带 daemon_local_id+各 provider 状态；backend 更新 daemon_instances.last_heartbeat_at+各 runtime.status；stale 判定改以 daemon_instances 心跳为准，联动 runtime offline）

### Wave 3 · 派发（backend）
- [x] task-08: placement `_resolve_dispatch_runtime` + `_resolve_decide_runtime` 改造（读 binding.daemon_id → daemon_instances 在线校验 → 该 daemon 的 daemon_runtimes 找 provider==default_agent 命中→返回 runtime；未命中→NoOnlineDaemonError 含 default_agent+已启用 provider 列表，D-008 不 fallback；provider 单次覆盖经发起参数）
- [x] task-09: `MemberBindingResolver` 返回 daemon_id（覆盖 agent/service.py + spec_workspace/router.py 两调用方；PUT /my-binding 写 daemon_id）

### Wave 4 · 前端（frontend）
- [x] task-10: `workspace-daemon-switcher` 选 daemon（下拉 daemon_instances + provider 徽标 + upsertMyBinding 传 daemon_id）
- [x] task-11: `workspace-binding.ts` MemberBindingView 加 daemon_id + 详情页 default_agent 独立选择器（从该 daemon 已启用 provider 选）
- [x] task-12: agent 页单次 provider 覆盖（发起 agent run 时 provider 参数覆盖 default_agent）

### Wave 5 · 兼容与部署
- [x] task-13: alembic 迁移完善（建表+加列+移除列+索引）+ 可选 cleanup 脚本（清空 daemon_runtimes/workspace_member_runtimes 旧数据，D-007 重置）
- [x] task-14: 部署文档（WS breaking 同步升级 + 旧 config.json 迁移 + 回退路径）
- [x] task-15: 测试补全（backend daemon/runtime/workspace/agent placement + daemon_instance 注册/心跳/WS 握手 + daemon config 隔离/单 WS + frontend switcher/default_agent）
- [x] task-16: daemon-client runtime 进度读取适配（`runtime/service.py:_resolver_for` daemon-client 时 root 强制走 spec_root 忽略 strategy + mode 跟随同步目录布局；核实/补 daemon-client spec sync 把 `.runtime/sillyspec.db` 真实内容同步到 `/data/spec-workspaces/<id>/.runtime/`。**与主线解耦，P2 可拆为独立 quick**，详见 design §16）

## 任务总表

| task | 优先级 | 依赖 | 覆盖决策 |
|---|---|---|---|
| task-01 | P0 | — | D-001 D-002 |
| task-02 | P0 | task-01 | D-002 |
| task-03 | P0 | task-01 | D-004 |
| task-04 | P1 | —（可并行 W1） | D-001 |
| task-05 | P0 | task-01,02,04 | D-001 D-006 |
| task-06 | P0 | task-01 | D-006 |
| task-07 | P1 | task-05,06 | D-006 |
| task-08 | P0 | task-02,03 | D-005 D-008 |
| task-09 | P0 | task-03 | D-004 D-005 |
| task-10 | P1 | task-08,09 | —（FR-09） |
| task-11 | P1 | task-09 | —（FR-09） |
| task-12 | P2 | task-08 | D-005 |
| task-13 | P1 | task-01,02,03 | D-003 D-007 |
| task-14 | P2 | task-06 | D-007 |
| task-15 | P0 | 全部 | NFR-02~04 |
| task-16 | P2 | task-09（binding 稳定后） | 关联缺陷（design §16） |

## 关键路径

task-01 → task-02 → task-05 → task-06 → task-08 → task-10 → task-15

（task-04 与 W1 并行；task-03 与 task-02 并行；task-09 与 task-08 并行；前端 W4 整体等 W3 接口稳定。）

## 调用点搜索（纳入范围）

- `MemberBindingResolver` / `resolve_member_binding`：调用方 `agent/service.py`（agent run）+ `spec_workspace/router.py`（scan/init）—— task-08/09 统一适配（grep 确认共享 resolver，自动覆盖）。
- `_resolve_dispatch_runtime` / `_resolve_decide_runtime`：定义 `agent/placement.py:606/805` —— task-08。
- `DaemonWsHub` 全方法（runtime_id 键）：定义 `daemon/ws_hub.py`，调用方 placement + daemon service —— task-06。
- daemon 侧 `_wsClients` / `_registerOne`：`sillyhub-daemon/src/daemon.ts` —— task-05/06。

## 全局验收标准

1. daemon 启动注册后 `daemon_instances` 有 1 行、`daemon_runtimes` 有 N 行（N=探测 provider 数），均挂同一 daemon_instance_id。
2. **身份稳定**：换 hostname 重启 daemon → `daemon_instances.id` 不变（复用 daemon_local_id），workspace 绑定不断。
3. **多实例隔离**：同机连不同后端两 daemon → 两条 daemon_instances（不同 server_url + daemon_local_id）。
4. workspace per-member 绑 daemon_id 后，dispatch 按 default_agent 在该 daemon 解析 runtime；default_agent 不匹配时报错（D-008，含已启用 provider 列表）。
5. WS Hub 连接数 = 在线 daemon 实体数（不再 × provider）。
6. lease.runtime_id 仍正确记录执行 provider（D-003 不变）；change-write 端点保持 runtime_id。
7. **兼容性（brownfield）**：旧 daemon 连新 backend 握手失败（按 D-007 文档同步升级）；数据重置后用户重绑守护进程；回退路径 = backend+daemon 回旧版 + 恢复 daemon_runtimes 备份。
8. backend/daemon/frontend 三端测试全通过（task-15）。

## 决策覆盖矩阵

| 决策 | 覆盖 task | 验收点 |
|---|---|---|
| D-001 daemon 身份+config 隔离 | task-01,04,05 | 验收 1/2/3 |
| D-002 runtime 退化从属 | task-02 | 验收 1 |
| D-003 lease/change_write 引用保留 | task-13（迁移保留 FK） | 验收 6 |
| D-004 workspace 加 daemon_id | task-03,09 | 验收 4 |
| D-005 provider=default_agent | task-08,12 | 验收 4 |
| D-006 per-daemon 注册/WS/心跳 | task-05,06,07 | 验收 1/5 |
| D-007 breaking+重置 | task-13,14 | 验收 7 |
| D-008 不匹配报错 | task-08 | 验收 4 |

## FR 覆盖矩阵

| FR | 覆盖 task |
|---|---|
| FR-01 daemon 身份+config 隔离 | task-01,04,05 |
| FR-02 runtime 退化从属 | task-02 |
| FR-03 lease/change_write 引用保留 | task-13（迁移保留 FK） |
| FR-04 workspace 加 daemon_id | task-03,09 |
| FR-05 provider=default_agent | task-08,12 |
| FR-06 per-daemon 通道 | task-05,06,07 |
| FR-07 breaking+重置 | task-13,14 |
| FR-08 不匹配报错 | task-08 |
| FR-09 前端 switcher+default_agent 选择器 | task-10,11 |
| FR-10 scan/init 共享 resolver 覆盖 | task-09 |

## 自检

- [x] 每个 task 编号（task-01~16，task-16 为关联缺陷纳入 P2 可拆）
- [x] Wave 下 checkbox（`- [ ] task-XX:` 格式）
- [x] Wave 分组 + 依赖标注
- [x] 任务总表（优先级+依赖，无估时列）
- [x] 关键路径标注
- [x] 全局验收（含 brownfield 兼容性条款）
- [x] 决策覆盖矩阵覆盖 D-001~008 全部当前版本
- [x] 无 P0/P1 unresolved blocker（Design Grill 5 个 X 全 immediately_answered）
- [x] 无实现细节（无函数签名/代码示例）
- [x] plan 文件清单与 design §14 一致
- [x] 调用点搜索纳入任务范围（MemberBindingResolver / WsHub / _resolve_dispatch_runtime）
