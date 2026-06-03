# 11 — 单服务器部署方案

## 1. 部署目标

平台可以先部署在一台服务器上，支持多人访问。

## 2. 组件

```text
Web UI
API Server
Database
Worktree Storage
Git Credential Manager
Agent Runtime Worker
Tool Gateway
```

## 3. 单服务器安全要求

即使在一台服务器上，也必须隔离：

```text
Git Identity
Git Credential
Worktree
HOME
Git Config
SSH Agent
Agent Run
```

## 4. 目录建议

```text
/opt/sillyspec-platform/
  app/
  config/
  logs/

/data/sillyspec-workspaces/
  {workspace_id}/

/tmp/sillyspec-runs/
  {run_id}/
```

## 5. 启动方式

V1 可使用：

```text
Docker Compose
或 systemd + venv + node process
```

不要求 K8s。

## 6. 后续演进

V4 后，Agent Run 可以迁移到容器隔离：

```text
每个 Agent Run 一个容器
只挂载当前 worktree
只注入当前临时凭据
容器结束即销毁
```
