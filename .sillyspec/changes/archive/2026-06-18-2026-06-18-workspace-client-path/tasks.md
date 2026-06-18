---
author: qinyi
created_at: 2026-06-18 11:36:31
change: 2026-06-18-workspace-client-path
status: tasks
---

# Tasks — Workspace 支持 daemon 客户端路径

任务清单（名称 + 文件路径 + 覆盖的 FR/D）。**细节（Wave 分组、依赖、步骤）在 plan 阶段展开。**

## backend

### task-01: workspaces 路径来源字段
- 文件：`backend/app/modules/workspace/model.py`、`schema.py`、`backend/migrations/versions/2026xxxx_add_workspace_path_source.py`
- 覆盖：FR-01, D-004@v1
- 要点：加 `path_source`(默认 server-local) + `daemon_runtime_id`(FK)；schema validator（daemon-client 时 daemon_runtime_id 必填）

### task-02: daemon-client agent run 强绑路由 + 离线失败
- 文件：`backend/app/modules/agent/placement.py`
- 覆盖：FR-02, D-001@v1
- 要点：`dispatch_to_daemon` 按 `workspace.daemon_runtime_id` 选 runtime（覆盖 user 级），离线抛 `NoOnlineDaemonError` 携 runtime 标识

### task-03: daemon WS RPC 通道 + list-dir 端点
- 文件：`backend/app/modules/daemon/router.py`、`ws_hub.py`、`protocol.py`
- 覆盖：FR-03, FR-04, D-005@v1
- 要点：复用 `ws_hub.send_to_runtime` 实现 RPC 请求/响应（rpc_id correlation）；新增 `POST /runtimes/{id}/list-dir`，超时 504

### task-04: spec bundle/sync 端点
- 文件：`backend/app/modules/spec_workspace/router.py`、`service.py`
- 覆盖：FR-05, D-003@v1, D-006@v1
- 要点：`GET /{ws_id}/bundle`（tar 流，排除 .runtime）、`POST /{ws_id}/sync`（覆盖 spec_root + reparse scan_docs）

### task-05: execution-context daemon-client spec_root 自决
- 文件：`backend/app/modules/agent/router.py`
- 覆盖：FR-05
- 要点：daemon-client 时 spec_root 字段留空（不传 backend 机器路径），透传 workspace_id（现状已有）

### task-06: scan/scan-generate daemon 派发
- 文件：`backend/app/modules/workspace/router.py`、`service.py`
- 覆盖：FR-06, D-003@v1
- 要点：daemon-client 时跳过本地 copytree；scan-generate 改走 `dispatch_to_daemon(stage=scan)` 派给绑定 daemon

## sillyhub-daemon

### task-07: DaemonConfig allowed_roots
- 文件：`sillyhub-daemon/src/config.ts`
- 覆盖：FR-04, D-002@v1
- 要点：`DaemonConfig` 加 `allowed_roots: string[]`（默认 `[homedir]`）

### task-08: list_dir RPC handler
- 文件：`sillyhub-daemon/src/protocol.ts`、`ws-client.ts`、`daemon.ts`、新增 `file-rpc.ts`
- 覆盖：FR-03, FR-04, D-005@v1
- 要点：处理 `RPC` 消息 → `list_dir`（allowed_roots 校验 + readdir/stat）→ 回 `RPC_RESULT`

### task-09: spec bundle 拉取 / sync 回传
- 文件：`sillyhub-daemon/src/task-runner.ts`、`hub-client.ts`
- 覆盖：FR-05, D-006@v1
- 要点：执行前 `getSpecBundle(ws_id)` 解到 `~/.sillyhub/daemon/specs/{ws_id}`；执行后整树打包 `postSpecSync`

## frontend

### task-10: 创建表单路径来源分支
- 文件：`frontend/src/components/workspace-scan-dialog.tsx`、`frontend/src/lib/workspaces.ts`
- 覆盖：FR-01, FR-03
- 要点：路径来源单选；daemon-client 分支（选 daemon + 浏览）；类型加 path_source/daemon_runtime_id

### task-11: 树形目录浏览组件 + listDir api
- 文件：新增 `frontend/src/components/daemon-dir-browser.tsx`、`frontend/src/lib/daemon.ts`
- 覆盖：FR-03, D-005@v1
- 要点：懒加载树形组件；`listOnlineRuntimes()`、`listDir(runtimeId,path)` api client；选定 root_path
