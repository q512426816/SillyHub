---
author: qinyi
created_at: 2026-07-04 17:29:25
---

# Requirements — daemon 版本可见 + 远程升级入口

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员（platform admin） | 拥有 RUNTIME_ADMIN 权限，在 runtimes 管理页查看 daemon 版本、触发升级 |
| daemon 客户端 | 跑在用户机器上的 sillyhub-daemon 进程，register/heartbeat 上报版本，接收 self_update 指令 |
| 普通用户 | 在 workspace 相关页面间接看到 daemon 状态（非本变更主要交互对象） |

## 功能需求

### FR-01: daemon register 上报版本
覆盖决策：D-001@V1, D-002@V1, D-008@V1
Given daemon 启动并以 release 构建（DAEMON_VERSION=语义版本，BUILD_ID=git SHA）
When daemon 调 POST /api/daemon/register
Then 请求体含 `daemon_version`（语义版本）+ `daemon_build_id`（SHA）

Given daemon 为 dev 构建（BUILD_ID="dev"）
When register
Then 请求体含 `daemon_version`，`daemon_build_id="dev"`

### FR-02: daemon heartbeat 上报版本
覆盖决策：D-001@V1, D-002@V1, D-008@V1
Given daemon 已注册且在线
When daemon 周期性调 heartbeat（HTTP 或 WS）
Then payload 含 `daemon_version` + `daemon_build_id`

### FR-03: backend 持久化 daemon 版本
覆盖决策：D-003@V1
Given backend 收到带 daemon_version/daemon_build_id 的 register/heartbeat
When service 处理 upsert daemon_instances
Then daemon_instances.version = 语义版本，daemon_instances.build_id = SHA 被写入

Given 收到旧 daemon 不带版本字段的请求
When upsert
Then version/build_id 保持 NULL（不报错）

### FR-04: backend DTO 返回 daemon 版本
覆盖决策：D-005@V1
Given daemon_instances 已存 version/build_id
When 前端调 GET /api/daemon/runtimes/page 或 GET /api/daemon/instances
Then 响应每项含 daemon_version/daemon_build_id（runtime 行）或 version/build_id（instance 行）

### FR-05: GET /api/daemon/version 返回 latest 双字段
覆盖决策：D-004@V1, D-009@V1
When 前端调 GET /api/daemon/version
Then 响应含 `latest_version`（语义版本）+ `latest_build_id`（SHA），保留旧 latest/minRequired/downloadUrl

Given 部署 bundle 提取失败
Then latest_version/latest_build_id = "unknown"

Given self-update 端点 POST /runtimes/{id}/self-update
Then 经 WS 推送的 version 仍是 SHA（get_daemon_latest_version 不变），preflight 比对正常

### FR-06: 前端展示 daemon 版本 + 徽标
覆盖决策：D-005@V1
Given 管理员打开 runtimes 管理页
When runtime 列表渲染
Then 每个 runtime 行显示其 daemon 版本号 + SHA 短码 + 徽标

Given runtime.daemon_build_id == latest.latest_build_id（且非 dev/unknown）
Then 显示「最新」徽标

Given runtime.daemon_build_id != latest.latest_build_id（且两者均有效）
Then 显示「可升级」徽标

Given runtime.daemon_build_id 为 NULL
Then 显示「未知」徽标

### FR-07: 前端升级按钮调 self-update
覆盖决策：D-005@V1, D-006@V1, D-007@V1
Given runtime 行显示「可升级」或「未知」，且 runtime 在线
When 管理员点击「升级到最新版」
Then 前端调 POST /api/daemon/runtimes/{runtime_id}/self-update，成功后 toast「升级指令已下发，daemon 重启后版本将自动更新」

Given self-update 端点返回 DaemonRuntimeOffline
Then toast 错误提示

### FR-08: 前端 offline 禁用升级按钮
覆盖决策：D-006@V1
Given runtime 离线
Then 升级按钮禁用（disabled），不可点击

### FR-09: 兼容旧 daemon
覆盖决策：D-008@V1
Given 已部署的旧 daemon（不上报版本字段）
When 它 register/heartbeat
Then backend 不报错（字段 Optional），version/build_id 存 NULL，前端显示「未知」

## 非功能需求

- **兼容性**：字段全 Optional，不扩大 WS breaking；GET /version 旧字段保留；self-update 契约不变（D-009@V1）。
- **可回退**：migration downgrade 删 build_id 列；前端版本区域缺失时降级显示「未知」不崩。
- **可测试**：每个 FR 有 GWT 行为规格，三子项目单测覆盖。
- **跨平台**：daemon 字段读取跨 Windows/Linux/macOS 一致（CLAUDE.md 规则 12）。
- **i18n**：UI 中文（CLAUDE.md 规则 11）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@V1 | FR-01, FR-02 | 双字段上报（语义+SHA） |
| D-002@V1 | FR-01, FR-02 | register + heartbeat 都带 |
| D-003@V1 | FR-03 | 复用 version 列 + 新增 build_id 列 |
| D-004@V1 | FR-05 | 扩展 GET /version 双字段 |
| D-005@V1 | FR-04, FR-06, FR-07 | 升级入口放 runtimes 页 runtime 行 |
| D-006@V1 | FR-07, FR-08 | 异步 toast + offline 禁用，不做实时进度 |
| D-007@V1 | FR-07 | 复用 runtime_id 维度端点 |
| D-008@V1 | FR-01, FR-02, FR-09 | 字段 Optional，旧 daemon 兼容 |
| D-009@V1 | FR-05 | latest 来源拆分，self-update 契约不破坏 |
