---
schema_version: 1
doc_type: module-card
module_id: backend
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# backend

## 定位
FastAPI 后端服务，负责提供 RESTful API、业务逻辑、数据持久化和 Agent 运行时协调。不负责前端渲染、任务编排细节（由 Agent/Workflow 模块负责）、Git 命令原生执行（由 git_gateway 模块封装）。

## 契约摘要

### 核心能力

- **HTTP API 服务**：21 个路由模块，统一挂载在 `/api` 前缀下，包括认证、工作区、变更、任务、Agent、Git 网关、知识库、发布、事件等
- **数据库访问**：PostgreSQL + SQLModel 异步 ORM，带审计钩子、软删除、租户隔离
- **认证授权**：JWT access/refresh token 双 token 机制，RBAC 权限模型，支持工作区级角色
- **Agent 协调**：AgentService 管理运行生命周期，ExecutionCoordinatorService 支持检查点、恢复、kill、审批
- **工作区扫描**：WorkspaceScanner 扫描 .sillyspec 目录结构，支持 scan_generate（一键扫描+生成）
- **安全控制**：工具网关（ToolGatewayService）对敏感命令进行策略校验，凭据加密存储

### 主要路由模块

- `/api/auth` - 登录/刷新/登出/me
- `/api/workspaces` - 工作区 CRUD、扫描（scan/rescan/scan_generate）、拓扑、关系
- `/api/workspaces/{workspace_id}/changes` - 变更文档管理
- `/api/workspaces/{workspace_id}/tasks` - 任务管理
- `/api/agent` - Agent 运行启停、日志获取、kill
- `/api/daemon` - 本地 daemon runtime 注册、心跳、禁用/启用、离线标记和 lease 生命周期
- `/api/git` - Git 身份凭证管理和访问校验
- `/api/tool_gateway` - 工具调用网关（文件读写、shell、测试、HTTP）
- `/api/releases` - 发布流程和审批
- `/api/incidents` - 事件管理和 Postmortem
- `/api/runtime` - 运行时进度、用户输入、产物读取
- `/api/knowledge` - 知识库/quicklog 读取
- `/api/scan-docs` - 扫描文档管理
- `/api/settings` - 平台设置和用户管理
- `/api/worktree` - Git worktree 租约管理
- `/api/archive` - 归档已验证完成的变更
- `/api/spec-workspace` - 规范工作空间管理

## 关键逻辑

### 应用启动流程

```
lifespan() -> configure_logging()
            -> init_telemetry()
            -> bootstrap_admin_and_seed_rbac()
            -> yield (serve requests)
            -> dispose_engine()
            -> close_redis()
```

### 认证依赖链

```
Bearer Token -> decode_access_token() -> TokenPayload
                                    -> get_current_user() -> User
                                                        -> require_permission() -> check RBAC
```

### Agent 运行协调

```
AgentService.start_run() -> ExecutionCoordinatorService.start_sillyspec_run()
                          -> _run_sillyspec_background()
                          -> stream_run_logs()
                          -> kill()/resume()/approve()
```

### 工作区扫描

```
WorkspaceService.scan_generate() -> 调用 Agent 启动扫描
                                -> WorkspaceScanner.scan(root)
                                -> 扫描 .sillyspec/ 目录结构
                                -> 生成 ScanResult
```

### 工具调用网关

```
ToolGatewayService.execute()
  -> _dispatch(tool_type)
  -> _handle_file_read/_handle_shell_exec/_handle_run_tests 等
  -> 执行并返回结果
```

### 变更流转

```
ChangeService.transition() -> 状态机校验 -> 更新 stage
                          -> 可选触发 AgentService.start_stage_dispatch()
```

## 注意事项

- **数据库迁移**：使用 Alembic，迁移文件在 `backend/migrations/versions/`
- **审计日志**：`audit_hooks.py` 自动记录 insert/update/delete，需配合 `get_session()` 注入 audit_user_id
- **凭据加密**：`CredentialCipher` 使用 PyNaCl secret box，master key 从环境 `MASTER_KEY` 或文件加载
- **租户隔离**：Workspace/Change/Task 模型都有 `workspace_id` 字段，查询时需注意过滤
- **软删除**：部分模型（如 Workspace）有 `deleted_at` 字段，查询时需排除
- **Git worktree 租约**：`WorktreeLease` 模型记录租约，过期需自动释放（WorktreeService.gc_expired_leases）
- **Agent 流式日志**：通过 SSE 或 stream_run_logs() 获取
- **Daemon runtime 状态**：`/api/daemon/runtimes` 刷新时会执行 stale heartbeat 清理；`disabled` 状态用于手动禁用 placement，heartbeat、重新注册、offline 上报和 stale cleanup 都不得自动改回 online
- **CORS 配置**：`CORSMiddleware` 允许所有方法和头，expose `x-request-id`
- **健康检查**：`/api/health` 检查 DB 连接，`/api/version` 返回 commit sha
- **配置**：通过 `app.core.config.get_settings()` 获取 Settings 单例
- **Redis**：通过 `app.core.redis.get_redis()` 获取 Redis 客户端
- **错误处理**：使用 `AppError`（app.core.errors）统一错误处理

## 变更索引

- ql-20260604-001-progress | 移除 progress.json fallback，改用 SQLite sillyspec.db
- ql-20260605-005-f2b8 | 修复 Agent Run metadata 持久化 + 参考 Multica 细化 token 采集（on_log 独立 session、modelUsage 解析）
- ql-20260611-001-c7a3 | Quick Chat 多轮对话：prev_run_id → session_id 查询 → resume_session_id 传入 daemon
- ql-20260616-002-b8e5 | 修复 Bootstrap dispatch 链路 3 处缺陷：`spec_workspace/bootstrap.py` dispatch_to_daemon 加 root_path/spec_root/runtime_root（让 _determine_run_type 走 scan 分支，避免 execution-context 400）；provider 'claude_code' → 'claude'（daemon 12-provider 注册表只认 'claude'）；加 prompt 引导 claude 按 CLAUDE.md 跑 sillyspec scan（不传 prompt 则 daemon spawn 用空串喂 stdin，claude 不读 CLAUDE.md）
- ql-20260618-007-d9c0 | Daemon runtime 状态语义：刷新列表清理 stale online runtime；新增 disable/enable/offline 操作；disabled 不会被 heartbeat 或重新注册自动恢复为 online。

## 人工备注

<!-- MANUAL_NOTES_START -->

- 2026-06-17: Agent runtime selection now snapshots both `provider` and `model` per `AgentRun`.
  `Workspace.default_model` is the fallback when a run request omits `model`; task, stage,
  scan-generate, quick-chat, and change-writer execute dispatch paths pass model through lease
  metadata and execution-context.
- 2026-06-18: Daemon runtime lifecycle uses `online` / `offline` / `maintenance` / `disabled`.
  Placement should only choose `online`; `disabled` is a manual operator decision and is preserved
  across heartbeat, re-register, graceful offline, and stale cleanup until explicitly enabled.

<!-- MANUAL_NOTES_END -->
