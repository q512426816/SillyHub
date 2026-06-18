---
author: qinyi
created_at: 2026-06-18 11:36:31
change: 2026-06-18-workspace-client-path
status: requirements
---

# Requirements — Workspace 支持 daemon 客户端路径

## 角色

| 角色 | 说明 |
|---|---|
| workspace 创建者 | 通过前端表单创建 workspace，选择路径来源（server-local / daemon-client） |
| daemon 客户端 | 运行在用户机器的 sillyhub-daemon，承载客户端代码与文件 RPC |
| backend | FastAPI 服务，spec 真理源、路由分发、bundle/sync 中转 |
| agent run | 在绑定 daemon 上执行，按需借阅服务器 spec |

## 功能需求

### FR-01: workspace 路径来源字段（覆盖 D-004@v1）
Given workspaces 表
When 应用迁移
Then 新增 `path_source VARCHAR(20) NOT NULL DEFAULT 'server-local'` 与 `daemon_runtime_id UUID NULL FK daemon_runtimes.id`

Given 创建 path_source=daemon-client 的 workspace
When 提交 WorkspaceCreate
Then `daemon_runtime_id` 必填，缺失时 validator 拒绝（400）

Given 现有/新 server-local workspace
When 未指定 path_source
Then 默认 `server-local`、`daemon_runtime_id=NULL`，创建流程与现状一致

### FR-02: agent run 强绑 daemon 路由 + 离线失败（覆盖 D-001@v1）
Given path_source=daemon-client 的 workspace 发起 agent run
When dispatch_to_daemon 选 runtime
Then 使用 `workspace.daemon_runtime_id`（覆盖 `_get_online_runtime(user_id)` 的 user 级选择）

Given 绑定 daemon 离线
When dispatch
Then 抛 `NoOnlineDaemonError`，错误携带目标 runtime 标识，前端提示「目标 daemon 离线，请启动」

Given path_source=server-local 的 workspace
When dispatch
Then 维持现有 `_get_online_runtime(user_id)` 行为不变

### FR-03: 前端 daemon 目录树形浏览（覆盖 D-005@v1）
Given 已选在线 daemon
When 用户在创建表单展开目录节点
Then 前端调 `POST /api/daemon/runtimes/{id}/list-dir {path}`，渲染返回的 `{name,type}[]` 子节点（懒加载）

Given daemon 离线或 RPC 超时
When list-dir 调用
Then 前端收到 504 并提示重试

### FR-04: list_dir allowed_roots 白名单（覆盖 D-002@v1）
Given daemon config.allowed_roots 配置
When list_dir 请求 path
Then daemon 校验 path 必须在某 allowed_root 之下；越界返回 error.code=forbidden（前端 403）

Given allowed_roots 未显式配置
When daemon 启动
Then 默认 `[homedir]`，首次 list_dir 受限时前端提示配置位置

### FR-05: spec 按需下发与回传（覆盖 D-003@v1, D-006@v1）
Given daemon-client workspace 的 agent run 准备执行
When daemon task-runner 启动
Then 调 `GET /api/spec-workspaces/{ws_id}/bundle` 拉 tar，解到本地 `~/.sillyhub/daemon/specs/{ws_id}`，以此为 agent spec_root（execution-context 透传 workspace_id，spec_root 字段对 daemon-client 留空）

Given agent 执行完成
When daemon 收尾
Then `POST /api/spec-workspaces/{ws_id}/sync`（整树 tar）→ backend 覆盖服务器 spec_root + reparse scan_docs → 返回 `{ok, reparsed}`

Given spec 列表/内容读取
When 前端查询
Then 始终读服务器 spec_root/scan_docs（真理源在服务器）

### FR-06: daemon-client 扫描派发（覆盖 D-003@v1）
Given 创建 daemon-client workspace
When create 执行
Then 跳过 `_ensure_spec_workspace` 本地 copytree（backend 读不到客户端路径）

Given daemon-client workspace 的 scan/scan-generate/reparse
When 触发
Then 判断 path_source，daemon-client 时 `dispatch_to_daemon(stage=scan)` 派给绑定 daemon，而非 backend 本地 `WorkspaceScanner`；产出经 FR-05 sync 回传

## 非功能需求

- **兼容性**：server-local 全链路零变化；现有 API 仅增字段不改语义
- **可回退**：path_source 默认 server-local，新功能不启用时行为不变
- **可测试**：每个 FR 有 GWT 行为规格；placement/dispatch/spec_workspace 覆盖单测
- **安全**：list_dir 强制 allowed_roots 白名单（D-002）；spec 真理源单一在服务器
- **性能**：bundle tar 流式传输；WS RPC 设超时（R-01）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | workspace 强绑单个 daemon + 离线 fail |
| D-002@v1 | FR-04 | list_dir allowed_roots 白名单 |
| D-003@v1 | FR-05, FR-06 | spec 服务器平台托管 |
| D-004@v1 | FR-01 | 新增 path_source + daemon_runtime_id |
| D-005@v1 | FR-03 | daemon list_dir RPC + 前端树形浏览 |
| D-006@v1 | FR-05 | spec 按需 bundle/sync（不引入同步引擎） |

无未覆盖决策；R-05（server-local 多 daemon 路由隐患）为已知遗留、本次非目标。
