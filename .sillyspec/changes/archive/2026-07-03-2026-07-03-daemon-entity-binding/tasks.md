---
author: qinyi
created_at: 2026-07-03 11:14:39
change: 2026-07-03-daemon-entity-binding
stage: brainstorm
---

# Tasks — 守护进程实体化绑定

> 待 plan 阶段展开细化（Wave 分组 + 依赖 + TaskCard）。本文件仅列任务名与 5 Phase 占位。

## Phase 1 · 数据模型（backend）
- task-01 新建 `daemon_instances` 表 + `DaemonInstance` model + alembic 迁移
- task-02 `daemon_runtimes` 改造（加 `daemon_instance_id` + 移除机器级冗余字段 + 索引）
- task-03 `workspace_member_runtimes` 加 `daemon_id` 列

## Phase 2 · 注册与通信（daemon + backend）
- task-04 daemon config 按 server_url 隔离文件（`config-<server_hash>.json` + 旧 config 迁移）
- task-05 注册流程改造（daemon `_registerDaemon` + backend `register_daemon` upsert daemon_instances + 各 runtime）
- task-06 WS Hub per-daemon（`_connections` 键改 daemon_instance_id + 全方法签名 + 握手协议）
- task-07 心跳改 per-daemon（单条心跳 + daemon 级 last_heartbeat + stale 联动）

## Phase 3 · 派发（backend）
- task-08 placement `_resolve_dispatch_runtime` + `_resolve_decide_runtime` 改造（daemon_id + default_agent 解析 + D-008 报错）
- task-09 `MemberBindingResolver` 返回 daemon_id（覆盖 agent + spec_workspace 两调用方）

## Phase 4 · 前端（frontend）
- task-10 `workspace-daemon-switcher` 选 daemon + provider 徽标
- task-11 `workspace-binding` + 详情页 default_agent 独立选择器
- task-12 agent 页单次 provider 覆盖

## Phase 5 · 兼容与部署
- task-13 alembic 迁移完善 + cleanup 脚本（可选重置）
- task-14 部署文档（同步升级 + 回退）
- task-15 测试补全（backend + daemon + frontend）
