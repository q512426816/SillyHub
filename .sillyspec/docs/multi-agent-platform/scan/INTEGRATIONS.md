---
author: qinyi
created_at: 2026-06-04T08:56:00+08:00
---

# 外部集成

## 数据库

### PostgreSQL 16 (主数据库)

**集成方式**: SQLAlchemy + AsyncPG

**用途**:
- 持久化所有业务数据（工作区、变更、任务、Agent 运行等）
- 存储用户认证数据（哈希密码、refresh token 黑名单）
- 存储审计日志和事件记录

**连接配置**:
```python
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db
```

**健康检查**: 每 5 秒执行 `pg_isready`
**数据卷**: `pgdata:/var/lib/postgresql/data`

**关键表**:
- users: 用户认证和权限
- workspaces: 工作区元数据
- changes: 变更工作流状态
- agent_runs: Agent 执行记录
- worktrees: Git 工作树租约
- refresh_tokens: 令牌撤销跟踪

## 缓存和消息队列

### Redis 7

**集成方式**: redis-py (同步) + aioredis (异步)

**用途 1 - 会话存储**:
- 存储 refresh token 白名单
- 用户会话缓存（减少数据库查询）

**用途 2 - Pub/Sub（Agent 流式日志）**:
- **Channel**: `agent:run:{run_id}:log`
- **发布者**: Agent I/O 进程（捕获 Claude Code 输出）
- **订阅者**: SSE 端点（/api/agent/runs/{id}/stream）
- **解耦优势**: I/O 进程异步推送，HTTP 连接独立订阅

**用途 3 - 分布式锁**:
- Worktree 租约获取
- Change 状态转换锁

**连接配置**:
```python
REDIS_URL=redis://localhost:6379/0
```

**健康检查**: 每 5 秒执行 `redis-cli ping`
**数据卷**: `redisdata:/data`

## Git 集成

### Git 客户端

**集成方式**: GitPython + 子进程调用

**用途 1 - 工作树管理**:
- `git worktree add`: 创建隔离工作目录
- `git worktree remove`: 清理工作树
- `git worktree list`: 列出活跃工作树

**用途 2 - 身份注入**:
- 修改 `.git/config` 注入 user.name、user.email
- 临时凭证注入（HTTPS token、SSH 密钥）

**用途 3 - 危险操作保护**:
- git reset --hard
- git push --force
- git rebase

**Git Gateway 模块**: 统一封装所有 Git 操作，提供审计日志

## Claude Code CLI

### Agent 执行引擎

**集成方式**: 子进程 + 适配器模式

**启动参数**:
```bash
claude --agent sillyspec-auto \
       --spec-bundle /path/to/spec.tar.gz \
       --output-format json
```

**适配器层**:
- **AgentAdapter**: 基类，定义标准接口
- **ClaudeCodeAdapter**: 实现 Claude Code 特定逻辑
- **GenericCLIAdapter**: 通用 CLI 包装（未来扩展）

**通信协议**:
- **输入**: JSON 规范包（spec_bundle）
- **输出**: JSON 行流（结构化日志）
- **控制**: 信号传递（SIGTERM、SIGKILL）

**工作目录策略**:
- **只读操作**: 直接在原项目目录执行
- **写操作**: 在 Worktree 中执行（隔离环境）

## SillySpec CLI

### 文档驱动开发工具

**集成方式**: 子进程调用

**用途**:
- 初始化 .sillyspec 目录
- 生成标准文档模板
- 执行工作流阶段命令

**命令示例**:
```bash
sillyspec run brainstorm
sillyspec run scan
sillyspec run propose
```

## 外部服务（可选）

### OpenTelemetry

**集成方式**: OTLP Exporter

**用途**: 分布式追踪（未强制启用，通过环境变量配置）

**配置**:
```env
OTEL_ENDPOINT=http://jaeger:4317
```

### Anthropic API (Claude)

**集成方式**: Claude Code CLI 内部集成

**凭证**: 通过 deploy/.env 环境变量注入
```env
ANTHROPIC_API_KEY=sk-ant-xxx
```

## 前后端通信

### REST API

**协议**: HTTP/1.1

**认证**:
- Access Token: Bearer JWT（HTTP Header: `Authorization: Bearer xxx`）
- Refresh Token: Cookie + 轮换机制

**主要端点**:
- `POST /api/v1/auth/login`: 登录
- `POST /api/v1/auth/refresh`: 刷新令牌
- `GET /api/v1/workspaces`: 工作区列表
- `POST /api/v1/workspaces/{id}/agent/runs`: 启动 Agent
- `GET /api/v1/workspaces/{id}/agent/runs/{id}/stream`: SSE 日志流

### SSE (Server-Sent Events)

**用途**: Agent 日志实时推送

**架构**:
```
Agent I/O 进程 → Redis Pub/Sub → SSE 端点 → 浏览器
```

**实现**:
- **后端**: `/api/agent/runs/{id}/stream` (FastAPI StreamingResponse)
- **前端**: EventSource API (agent-stream.ts)

**事件类型**:
- `message`: 结构化日志（JSON）
- `error`: Agent 异常
- `done`: 执行完成

## 前端集成

### TanStack Query (React Query)

**用途**: 数据获取和缓存管理

**集成点**:
- 工作区列表
- 变更详情
- 任务状态
- Agent 运行记录

### Zustand

**用途**: 全局状态管理

**Store**: session.ts
- Access token / Refresh token
- 用户信息
- 登录/登出操作

### XYFlow (@xyflow/react)

**用途**: 模块拓扑可视化

**用途**: 显示项目模块依赖关系图

### UIW React Markdown Preview

**用途**: SillySpec 文档渲染

**用途**: 在前端预览 proposal.md、design.md

## 部署集成

### Docker Compose

**服务编排**:
- 依赖管理（depends_on + healthcheck）
- 环境变量注入（env_file）
- 卷挂载（项目目录、持久化数据）

**卷映射**:
- `/host-projects`: 宿主机项目目录（Agent 扫描用）
- `/data/sillyspec-workspaces`: Worktree 隔离环境
- `/data/spec-workspaces`: Spec 数据存储
- `/app/.claude`: Claude Code 配置持久化

**网络**: 默认桥接网络，服务间通过服务名通信

### 路径重写

**Docker 环境变量映射**:
```env
HOST_PATH_PREFIX=C:/Users/qinyi/IdeaProjects
CONTAINER_PATH_PREFIX=/host-projects
```

**用途**: 将宿主机路径重写为容器挂载路径（Agent 执行时）

## 安全集成

### 密码哈希

**算法**: bcrypt（12 轮）

**库**: passlib[bcrypt]

### 令牌签名

**算法**: HS256 (HMAC-SHA256)

**库**: python-jose[cryptography]

**密钥**: SECRET_KEY 环境变量（>= 16 字符）

### Git 凭证加密

**算法**: AES-256-GCM

**库**: pynacl (PyNaCl)

**密钥**: SILLYSPEC_MASTER_KEY 环境变量
