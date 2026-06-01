---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Design

## 架构决策

### ADR-01: Server Runner 复用 Runner 协议

Server Sandbox Runner 不重新定义任务生命周期，复用 Local Runner 的 claim/start/messages/complete/fail 协议。

### ADR-02: 沙箱是强边界

沙箱上下文至少包含 `tenant_id`、`user_id`、`workspace_id`、`task_id`。所有文件、环境变量、密钥和网络策略都从该上下文派生。

### ADR-03: 文件快照默认拒绝

只有白名单路径进入沙箱；`.env`、密钥、凭据、token、私有配置默认阻断。

### ADR-04: 内部执行服务不直连用户

Claude/Codex HTTP 或托管 CLI 只能由 Runner service 调用，用户只看到平台任务、日志和结果。

## API 设计

- `POST /api/server-runners/register`
- `POST /api/server-runners/tasks/claim`
- `POST /api/sandboxes`
- `POST /api/sandboxes/{id}/snapshot`
- `GET /api/sandboxes/{id}/artifacts`
- `DELETE /api/sandboxes/{id}`

## 文件变更清单

- `backend/app/modules/runtime/model.py`
- `backend/app/modules/runtime/service.py`
- `backend/app/modules/sandbox/`（新增）
- `backend/app/modules/agent/service.py`
- `backend/app/modules/worktree/service.py`
- `backend/app/modules/tool_gateway/service.py`
- `deploy/runner/`
- `deploy/docker-compose.yml`

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 沙箱泄露敏感文件 | 高危安全事故 | 白名单 + 黑名单 + 审计 |
| Runner 协议分叉 | 两套执行系统 | 复用 Local Runner 协议 |
| 资源泄漏 | 成本上升 | TTL 和 GC |
| 用户绕过平台调用模型服务 | 权限失控 | 内部服务不直接暴露 |
