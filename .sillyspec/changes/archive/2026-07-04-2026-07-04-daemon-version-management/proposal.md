---
author: qinyi
created_at: 2026-07-04 17:29:25
---

# Proposal — daemon 版本可见 + 远程升级入口

## 动机

服务器（backend + 前端管理页）当前**看不到**已连接客户端 daemon 的版本号，管理员也**无法从服务器触发**客户端 daemon 升级。daemon 版本管理完全不可见，运维只能 SSH 到每台客户端手动升级，与「平台集中管理 daemon 实体」的目标（2026-07-03-daemon-entity-binding 引入 daemon_instances）不符。

## 关键问题

1. **版本盲区**：daemon register/heartbeat payload 不含自身版本（`hub-client.ts:37-47`/`85-90`），`daemon_instances.version` 列已建但恒 NULL（service 从不写入），前端 DTO 不返回——管理员不知道哪些客户端跑旧版本。
2. **升级入口缺失**：远程升级后端链路（`POST /runtimes/{id}/self-update` + WS `daemon:self_update` + preflight 自更新）已实现并存活于 main（commit `0aa1dcce`/`423359c6`），但**前端无触发按钮**——OpenAPI 生成了 `trigger_daemon_self_update` 类型却无组件调用，「后端通了、前端没接出门」。
3. **需求散落未立项**：远程升级功能当时直接 commit 未走 SillySpec（changes/ 无目录），难以追溯；版本展示则从未实现。本变更将其正式立项补齐。

## 变更范围

- daemon 上报语义版本（DAEMON_VERSION）+ 构建标识（BUILD_ID）到 register/heartbeat
- backend 接收并持久化（复用 daemon_instances.version + 新增 build_id 列），DTO 返回
- 扩展 GET /api/daemon/version 返回 latest_version + latest_build_id（不破坏 self-update 契约）
- 前端 runtimes 页展示 daemon 版本 + 「升级到最新版」按钮（调已有 self-update 端点）

## 不在范围内（显式清单）

- 不做升级实时进度反馈（WS 推送升级各阶段事件）—— YAGNI
- 不新增 POST /daemon-instances/{id}/self-update 端点 —— 复用 runtime 维度
- 不做强制升级 / minRequired 门槛拦截 / 灰度策略
- 不做版本审计历史表
- 不改 daemon 启动 preflight 自更新逻辑（已存在，本变更仅复用）
- 不改 self-update 端点响应字段名（latest_version 实为 SHA 的命名误导，R-07）

## 成功标准（可验证）

- daemon 注册/心跳后，backend `daemon_instances.version` + `build_id` 非 NULL（release 构建）
- 前端 runtimes 页每个 runtime 行显示其 daemon 版本号 + SHA 短码 + 徽标
- 版本与 latest 比对正确显示「最新 / 可升级 / 未知」徽标
- 点击「升级到最新版」调 `POST /runtimes/{id}/self-update`，toast 提示，daemon offline 时按钮禁用
- 旧 daemon（不上报版本）注册不报错（422），前端显示「未知」
- self-update 后端链路行为不变（get_daemon_latest_version 仍返回 SHA，preflight 比对正常）
- 三子项目测试全绿，零回归
