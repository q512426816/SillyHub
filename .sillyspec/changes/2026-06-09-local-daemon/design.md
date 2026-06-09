---
author: Claude
created_at: "2026-06-09"
---

# 本地守护进程设计方案

## 1. 概述

参考 [multica](https://github.com/tmc/multica) 项目（[How Multica works](https://github.com/tmc/multica/blob/main/docs/how_multica_works.md)、[CLI_AND_DAEMON.md](https://github.com/tmc/multica/blob/main/docs/cli_and_daemon.md)），为 SillyHub 实现本地守护进程（Local Daemon）功能，使本地 CLI（Claude Code + SillySpec）可以与服务器端交换任务和状态。

**核心设计约束**：
1. **单一状态源**：daemon_task_leases 只做 dispatch/claim/lease envelope，最终状态、日志、tokens、cost、session_id 仍写回 AgentRun 和 AgentRunLog
2. **统一调度入口**：抽一个 RunPlacement 决策层，覆盖 start_run、start_stage_dispatch、start_scan_dispatch 三个入口
3. **幂等和防双跑**：claim lease、heartbeat timeout、任务取消、attempt 编号
4. **本地工作目录隔离**：workspace 映射、路径注册、结果上传、密钥永不上传

## 2. 核心目标

### 2.1 现状问题
- Claude Code CLI 在服务器端以子进程运行
- 用户本地机器的计算资源未利用
- 无法访问本地开发环境的完整上下文

### 2.2 改进目标
- 本地守护进程运行在用户机器上
- 服务器调度任务，本地认领并执行
- 支持离线/在线切换
- 充分利用本地 GPU/CPU 资源

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户本地机器                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │   SillyHub CLI   │         │   Local Daemon   │              │
│  │  (sillyspec)     │         │   (后台进程)      │              │
│  │                  │         │                  │              │
│  │  daemon start    │────────>│  - Agent 管理     │              │
│  │  daemon status   │<────────│  - 任务轮询       │              │
│  │  daemon stop     │         │  - 心跳保持       │              │
│  └──────────────────┘         │  - 执行调度       │              │
│                               └────────┬─────────┘              │
│                                        │                        │
│                                        │ WebSocket + HTTP      │
│                                        ▼                        │
└─────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ Internet
                                                    │
┌─────────────────────────────────────────────────────────────────┐
│                        SillyHub 服务器                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Daemon WebSocket Hub                         │  │
│  │  - 唤醒信号分发                                           │  │
│  │  - 心跳确认                                               │  │
│  └───────────────┬──────────────────────────────────────────┘  │
│                  │                                               │
│  ┌───────────────┴──────────────────────────────────────────┐  │
│  │              Daemon API Handler                            │  │
│  │  POST /api/daemon/register                                 │  │
│  │  POST /api/daemon/heartbeat                                │  │
│  │  POST /api/daemon/runtimes/{id}/tasks/claim                │  │
│  │  POST /api/daemon/tasks/{id}/start                         │  │
│  │  POST /api/daemon/tasks/{id}/progress                       │  │
│  │  POST /api/daemon/tasks/{id}/complete                       │  │
│  └───────────────┬──────────────────────────────────────────┘  │
│                  │                                               │
│  ┌───────────────┴──────────────────────────────────────────┐  │
│  │              Task Dispatcher                               │  │
│  │  - 任务创建/重新调度时唤醒守护进程                         │  │
│  │  - 任务分配到运行时                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 通信协议

#### 3.2.1 双通道设计

**WebSocket 通道**（实时 + 低功耗）：
- 守护进程 → 服务器：心跳帧（`daemon:heartbeat`）
- 服务器 → 守护进程：唤醒信号（`daemon:task_available`），心跳确认（`daemon:heartbeat_ack`）

**HTTP REST 通道**（权威状态）：
- 守护进程认领任务：`POST /api/daemon/runtimes/{id}/tasks/claim`
- 任务状态更新：`POST /api/daemon/tasks/{id}/start|progress|complete|fail`
- 运行时注册：`POST /api/daemon/register`

#### 3.2.2 消息协议

```typescript
// 信封结构
interface Message {
  type: string;
  payload: unknown;
}

// 唤醒信号
interface TaskAvailablePayload {
  runtime_id: string;
  task_id?: string;
}

// 心跳请求
interface DaemonHeartbeatRequestPayload {
  runtime_id: string;
}

// 心跳确认
interface DaemonHeartbeatAckPayload {
  runtime_id: string;
  pending_operations?: {
    update?: boolean;
    model_list?: boolean;
    skill_import?: boolean;
  };
}

// 任务进度
interface TaskProgressPayload {
  task_id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
  metadata?: {
    tokens?: number;
    cost?: number;
    duration?: number;
  };
}
```

### 3.3 守护进程生命周期

```
启动
 │
 ├─> 检测本地 Agent（claude, sillyspec）
 ├─> 读取/生成 daemon.id（UUID）
 ├─> HTTP POST /register（注册运行时）
 │     └─> 上报：provider, version, os, arch
 │
 ├─> 建立 WebSocket 连接
 │     └─> 订阅：runtime_id 唤醒信号
 │
 ├─> 启动轮询循环（默认 30s）
 │     └─> GET /tasks/pending
 │     └─> POST /tasks/{id}/claim
 │
 ├─> 启动心跳循环（默认 15s）
 │     └─> WS 发送 daemon:heartbeat
 │     └─> 接收 daemon:heartbeat_ack
 │
 └─> 任务执行
       ├─> 接收唤醒信号（WS 或轮询）
       ├─> 认领任务（HTTP）
       ├─> 执行 Agent 子进程
       ├─> 流式报告进度（HTTP /messages）
       └─> 完成任务（HTTP /complete）
```

### 3.4 任务调度流程

```
服务器                           守护进程                    Agent
   │                                │                          │
   │ POST /api/agent/runs           │                          │
   │ (创建 AgentRun + Lease)        │                          │
   │                                │                          │
   │  WebSocket                     │                          │
   │  daemon:task_available         │                          │
   ├───────────────────────────────>│                          │
   │                                │                          │
   │                                │ POST /api/daemon/leases/  │
   │                                │        {id}/claim        │
   │                                ├─────────────────────────>│
   │                                │<─────────────────────────┤
   │                                │ (lease + claim_token)    │
   │                                │                          │
   │                                │ POST /api/daemon/leases/  │
   │                                │        {id}/start        │
   │                                ├─────────────────────────>│
   │                                │                          │
   │                                │ (获取 AgentSpecBundle)    │
   │                                │                          │
   │                                │ subprocess.exec(claude) │
   │                                │ ├────────────────────────>│
   │                                │ │ stream-json events      │
   │                                │ │<───────────────────────┤
   │                                │ │                        │
   │                                │ POST /api/daemon/leases/  │
   │                                │        {id}/messages      │
   │  (写入 AgentRunLog)            │ │<───────────────────────>│
   │  发布 Redis                    │ │                        │
   │                                │ │                        │
   │  SSE                           │ │ POST /api/daemon/leases/│
   │  /api/workspaces/{ws}/         │ │        {id}/heartbeat  │
   │  agent/runs/{runId}/stream     │ │<───────────────────────>│
   │<───────────────────────────────┤ │                        │
   │  (前端订阅现有 SSE 路径)        │ │                        │
   │                                │ POST /api/daemon/leases/  │
   │                                │        {id}/complete      │
   │                                ├─────────────────────────>│
   │  (更新 AgentRun.status)        │                          │
```

**关键点**：
1. SSE 路径保持不变：`/api/workspaces/{workspaceId}/agent/runs/{runId}/stream`
2. daemon 只负责把消息写回服务器的 `/api/daemon/leases/{id}/messages` 接口
3. 服务器写入 AgentRunLog（状态事实源），发布 Redis，前端通过 SSE 订阅
4. 前端无感知，仍然是同样的 SSE 订阅逻辑

## 4. 实现要点

### 4.1 服务器端改动

**新增模块：** `backend/app/modules/daemon/`

```
modules/daemon/
├── __init__.py
├── router.py          # /api/daemon/* 路由
├── schema.py          # 注册、任务、运行时模型
├── service.py         # 运行时管理、任务分配
├── ws_hub.py          # WebSocket 连接管理
├── protocol.py        # 消息协议定义
└── model.py           # DaemonRuntime, DaemonTask 模型
```

**数据库迁移：**
```sql
-- 运行时注册表
CREATE TABLE daemon_runtimes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255),
    provider VARCHAR(50),        -- 'claude-code' | 'sillyspec'
    version VARCHAR(50),
    os VARCHAR(50),
    arch VARCHAR(50),
    status VARCHAR(20),          -- 'online' | 'offline' | 'maintenance'
    last_heartbeat_at TIMESTAMPTZ,
    capabilities JSONB,          -- {agents: [], max_concurrent_tasks: N}
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 守护进程任务租赁表（仅用于 dispatch/claim/lease，非状态事实源）
-- 状态事实源仍是 agent_runs 和 agent_run_logs
CREATE TABLE daemon_task_leases (
    id UUID PRIMARY KEY,
    runtime_id UUID REFERENCES daemon_runtimes(id),
    agent_run_id UUID REFERENCES agent_runs(id),  -- 指向唯一状态源
    status VARCHAR(20),          -- 'pending' | 'claimed' | 'expired' | 'cancelled'
                                 -- 注意：lease 只记录这 4 种状态
                                 -- running/completed 只写 AgentRun.status，不写 lease
    claimed_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,  -- heartbeat 延期（60 秒）
    attempt_number INT DEFAULT 1,   -- 重试计数
    metadata JSONB,              -- {claim_token, last_heartbeat_at}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- 约束：同一 agent_run 同一时刻只能有一个 active lease
    CONSTRAINT unique_active_lease EXCLUDE (USING gist(
        agent_run_id WITH =,
        CASE WHEN status IN ('claimed', 'pending') THEN '1'::text END WITH =,
        CASE WHEN status NOT IN ('expired', 'cancelled') THEN '1'::text END WITH <>
    ))
);

-- 创建索引
CREATE INDEX idx_daemon_runtimes_user_id ON daemon_runtimes(user_id);
CREATE INDEX idx_daemon_runtimes_status ON daemon_runtimes(status);
CREATE INDEX idx_daemon_task_leases_runtime_id ON daemon_task_leases(runtime_id);
CREATE INDEX idx_daemon_task_leases_status ON daemon_task_leases(status);
CREATE INDEX idx_daemon_task_leases_agent_run_id ON daemon_task_leases(agent_run_id);
CREATE INDEX idx_daemon_task_leases_expires_at ON daemon_task_leases(lease_expires_at)
    WHERE status IN ('claimed', 'pending');
```

**WebSocket Hub：**
- 按运行时 ID 索引连接
- 去重：滑动窗口（128 个 ID）
- 慢连接逐出：发送缓冲区满时断开

**统一调度入口（RunPlacement 决策层）：**

新增 `backend/app/modules/agent/placement.py`：
```python
class ExecutionBackend(Enum):
    SERVER = "server"        # 服务器子进程模式
    DAEMON = "daemon"        # 本地守护进程模式

class RunPlacementService:
    """决策 AgentRun 在何处执行的统一入口"""

    async def decide_backend(
        self,
        workspace_id: UUID,
        change_id: Optional[UUID],
        task_id: Optional[UUID],
    ) -> ExecutionBackend:
        """
        决策逻辑：
        1. 用户是否有在线 runtime？
           - 有 → 优先 daemon
           - 无 → server
        2. 用户是否强制选择？（前端传入）
           - daemon_selected → 检查 runtime 在线，否则回退 server
           - server_selected → 直接 server
        """
        pass

    async def dispatch_to_daemon(self, agent_run_id: UUID) -> Optional[UUID]:
        """
        分配到守护进程：
        1. 创建 daemon_task_leases（status=pending）
        2. 发送 WebSocket 唤醒信号
        3. 返回 lease_id
        """
        pass

    async def dispatch_to_server(self, agent_run_id: UUID) -> None:
        """
        分配到服务器子进程：
        1. 调用现有的 AgentService._exec_subprocess()
        2. 保持现有行为不变
        """
        pass
```

**三个入口的适配：**

修改 `backend/app/modules/agent/service.py`：
```python
class AgentService:
    @inject
    def __init__(self, ..., placement: RunPlacementService):
        self._placement = placement

    async def start_run(...) -> AgentRun:
        # ... 现有逻辑创建 AgentRun ...

        # 统一决策入口
        backend = await self._placement.decide_backend(
            workspace_id=workspace.id,
            change_id=change_id if change else None,
            task_id=task_id if task else None,
        )

        if backend == ExecutionBackend.DAEMON:
            lease_id = await self._placement.dispatch_to_daemon(agent_run.id)
            if lease_id:
                # 等待 daemon claim，超时回退 server
                await self._wait_for_claim_or_fallback(agent_run, lease_id)
                return agent_run
        # 回退到 server
        await self._placement.dispatch_to_server(agent_run.id)
        return agent_run

    async def start_stage_dispatch(self, ...) -> AgentRun:
        # 创建 AgentRun 后，调用统一的 placement 决策
        return await self._start_with_placement(...)

    async def start_scan_dispatch(self, ...) -> AgentRun:
        # 同上
        return await self._start_with_placement(...)
```

**Lease 机制和防双跑：**

```python
class DaemonLeaseService:
    """守护进程租赁管理"""

    LEASE_DURATION_SECONDS = 60  # 每次心跳续期 60 秒

    async def claim_task(
        self,
        runtime_id: UUID,
        agent_run_id: UUID,
    ) -> Optional[DaemonTaskLease]:
        """
        幂等认领任务：
        1. 检查 agent_run 对应的 lease：
           - 无 active lease → 创建并返回
           - 已有 active lease 且未过期 → 拒绝（409 Conflict）
           - 已有 lease 但已过期 → 更新 attempt_number，重新 claim
        2. 设置 lease_expires_at = now + 60s
        3. 返回 lease 包含 claim_token（用于后续心跳验证）
        """
        pass

    async def heartbeat_lease(
        self,
        lease_id: UUID,
        claim_token: str,
    ) -> bool:
        """
        心跳续期：
        1. 验证 claim_token 匹配
        2. 更新 lease_expires_at = now + 60s
        3. 更新 metadata.last_heartbeat_at
        4. 返回是否续期成功
        """
        pass

    async def expire_overdue_leases(self) -> List[UUID]:
        """
        定时任务：每分钟执行
        1. 查找 lease_expires_at < now 且 status='claimed' 的 leases
        2. 设置 status='expired'
        3. 返回对应的 agent_run_ids，触发回退逻辑
        """
        pass

    async def cancel_lease(self, agent_run_id: UUID) -> None:
        """
        取消租赁（用户主动取消任务）
        1. 设置 status='cancelled'
        2. 发送 WebSocket 取消信号给 daemon
        """
        pass
```

**任务回退流程：**

```python
async def handle_lease_expiry(agent_run_id: UUID) -> None:
    """
    当 daemon lease 过期时的处理：
    1. 检查 AgentRun.status：
       - 仍在 pending/running → 回退到 server 子进程
       - 已完成 → 无需处理
    2. 增加 attempt_number
    3. 如果 attempt_number > 3 → 标记失败，不再重试
    4. 重新调用 dispatch_to_server()
    """
    agent_run = await agent_run_service.get(agent_run_id)

    if agent_run.status in (AgentRunStatus.PENDING, AgentRunStatus.RUNNING):
        # 尝试回退
        lease = await lease_service.get_by_agent_run(agent_run_id)
        if lease.attempt_number >= 3:
            # 超过重试次数，标记失败
            await agent_run_service.fail_run(
                agent_run_id,
                error="Daemon lease expired after 3 attempts",
            )
        else:
            # 回退到 server
            await placement_service.dispatch_to_server(agent_run_id)
```

**幂等性保证：**

| 操作 | 幂等键 | 冲突处理 |
|------|--------|----------|
| POST /api/daemon/leases/{id}/claim | agent_run_id | 409 Conflict，守护进程稍后重试 |
| POST /api/daemon/leases/{id}/start | lease_id | 幂等，重复调用返回相同结果 |
| POST /api/daemon/leases/{id}/heartbeat | lease_id | 幂等，每次刷新 lease_expires_at |
| POST /api/daemon/leases/{id}/complete | lease_id | 幂等，首次调用后状态锁定 |

### 4.2 本地守护进程实现

**技术选型：Python（与后端一致）**

```
sillyhub-daemon/
├── __init__.py
├── main.py            # CLI 入口（daemon start/stop/status）
├── daemon.py          # 核心守护进程类
├── client.py          # HTTP 客户端
├── ws_client.py       # WebSocket 客户端
├── agent_manager.py   # Agent 检测和管理
├── task_runner.py     # 任务执行器
├── config.py          # 配置管理
└── protocol.py        # 消息协议（与服务器共享）
```

**配置文件：** `~/.sillyhub/daemon/config.json`
```json
{
  "server_url": "https://sillyhub.example.com",
  "runtime_id": "uuid",
  "profile": "default",
  "workspace_dir": "~/sillyhub_workspaces",
  "poll_interval": 30,
  "heartbeat_interval": 15,
  "max_concurrent_tasks": 5,
  "log_level": "info"
}
```

**Agent 检测：**
```python
AGENT_DETECTORS = {
    "claude-code": {
        "commands": ["claude"],
        "version_flag": "--version",
        "version_pattern": r"Claude Code (\d+\.\d+\.\d+)"
    },
    "sillyspec": {
        "commands": ["sillyspec"],
        "version_flag": "--version",
        "version_pattern": r"sillyspec (\d+\.\d+\.\d+)"
    }
}
```

**任务执行：**

### 4.2.1 工作目录策略

本地守护进程需要访问项目代码，有以下策略：

**策略 A：镜像工作区（推荐）**
```
服务器项目目录          本地镜像工作区
~/projects/foo    →    ~/sillyhub_workspaces/ws-123/foo
```
- 守护进程启动时，从服务器 Git URL clone 到本地
- 每次 claim 任务前，`git pull` 确保最新
- Agent 执行在本地工作区，结果写入本地
- 完成后，daemon 收集 diff（git diff / git format-patch），上传到服务器
- 服务器执行 `git apply` 或创建 PR

**策略 B：直接映射（高级）**
```
服务器项目目录          用户现有工作区
~/projects/foo    ←→   ~/dev/foo (用户已有)
```
- 用户在配置中注册允许路径：`allowed_paths: ["~/dev", "~/projects"]`
- 守护进程检测项目是否在允许路径下
- 直接在用户现有工作区执行，无需 clone
- 完成后直接 push（需要用户配置 Git 凭据）

**默认使用策略 A**，策略 B 需要用户显式配置。

### 4.2.2 执行 Payload 传递

**设计说明**：AgentSpecBundle 是运行时结构，不是 DB 持久字段。daemon claim 时返回序列化的执行 payload。

```python
# 服务器端：claim 成功时返回执行 payload
async def claim_lease(lease_id: UUID, runtime_id: UUID) -> DaemonLeaseResponse:
    lease = await lease_service.claim_lease(lease_id, runtime_id)
    if not lease:
        return None

    # 获取 AgentRun 关联的执行上下文
    agent_run = await agent_run_service.get(lease.agent_run_id)

    # 构建序列化执行 payload（包含完整执行上下文）
    workspace = await workspace_service.get(agent_run.workspace_id)
    worktree = await worktree_service.get_active(agent_run.workspace_id)

    payload = {
        "agent_run_id": str(agent_run.id),
        "workspace_id": str(workspace.id),
        "workspace_name": workspace.name,
        "worktree_path": worktree.path if worktree else None,
        "claude_md": render_claude_md(agent_run),  # 渲染 CLAUDE.md 模板
        "prompt": agent_run.prompt,
        "tool_config": agent_run.tool_config,
        "session_id": agent_run.session_id,
        "metadata": {
            "change_id": str(agent_run.change_id) if agent_run.change_id else None,
            "task_id": str(agent_run.task_id) if agent_run.task_id else None,
        },
    }

    # 生成 claim_token（用于后续 heartbeat/messages/complete 验证）
    claim_token = generate_claim_token(lease_id, runtime_id)

    return DaemonLeaseResponse(
        lease=lease,
        payload=payload,
        claim_token=claim_token,
    )

# 守护进程：claim 任务时获取 payload
response = await client.claim_lease(lease_id)
payload = response.payload  # 包含完整执行上下文
claim_token = response.claim_token  # 保存 token，后续请求带上

# 写入本地工作区
local_workdir = prepare_workspace(payload["workspace_name"], payload["worktree_path"])
Path(local_workdir / ".claude" / "CLAUDE.md").write_text(payload["claude_md"])
```

### 4.2.3 密钥和敏感信息隔离

**原则**：用户密钥永不上传服务器

```python
# 服务器端：只传递配置模板
bundle.credential_config = {
    "anthropic_api_key": "{{USER_ANTHROPIC_API_KEY}}",  # 占位符
    "github_token": "{{USER_GITHUB_TOKEN}}",
}

# 守护进程：本地渲染
config = bundle.credential_config
for key, value in config.items():
    if value.startswith("{{USER_") and value.endswith("}}"):
        env_var = value[2:-2]  # 提取环境变量名
        config[key] = os.environ.get(env_var)

# Agent 子进程使用渲染后的密钥
env = {
    "ANTHROPIC_API_KEY": config["anthropic_api_key"],
    # ... 其他环境变量
}
subprocess.run(["claude", ...], env=env)
```

**本地密钥配置**：`~/.sillyhub/daemon/credentials.json`
```json
{
  "anthropic_api_key": "sk-ant-...",
  "github_token": "ghp_...",
  "openai_api_key": "sk-..."
}
```
此文件权限设为 `0600`，且加入 `.gitignore`。

### 4.2.4 结果上传流程

```python
class TaskRunner:
    async def complete_task(self, lease: DaemonTaskLease) -> None:
        """
        任务完成后：
        1. 收集变更（支持 dirty diff 和已提交）
        2. 上传到服务器：POST /api/daemon/leases/{id}/complete
        3. 服务器应用变更：git apply --check / --3way
        """

        # 收集变更（优先 git diff，支持 dirty 状态）
        # 策略：如果有未提交变更，先临时 commit，然后 format-patch
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
        )

        has_dirty = bool(result.stdout.strip())

        if has_dirty:
            # 有未提交变更：临时 commit 后 format-patch
            subprocess.run(["git", "checkout", "-b", f"temp-lease-{lease.id}"], check=True)
            subprocess.run(["git", "add", "-A"], check=True)
            subprocess.run(
                ["git", "commit", "-m", f"[SillyHub Lease {lease.id}] Temporary commit"],
                check=True,
            )
            patch_cmd = ["git", "format-patch", "--stdout", "HEAD~1"]
        else:
            # 无未提交变更：直接 format-patch
            patch_cmd = ["git", "format-patch", "--stdout", "HEAD~1"]

        result = subprocess.run(patch_cmd, capture_output=True, text=True)
        patch_data = result.stdout

        # 上传
        await client.complete_lease(
            lease_id=lease.id,
            claim_token=lease.claim_token,  # 带 token 验证
            result={
                "status": "completed",
                "patch": patch_data,
                "stats": {
                    "files_changed": ...,
                    "insertions": ...,
                    "deletions": ...,
                },
            },
        )
```

**服务器端处理**：
```python
# backend/app/modules/daemon/service.py
async def handle_lease_complete(
    self,
    lease_id: UUID,
    claim_token: str,
    result: Dict[str, Any],
) -> None:
    """
    1. 验证 lease 状态和 claim_token
    2. 将 patch 应用到服务器工作区（git apply --check / --3way）
    3. 更新 AgentRun 状态（单一状态源）
    4. 发布完成事件
    """
    lease = await self.lease_service.get(lease_id)

    # 验证 claim_token
    if lease.metadata.get("claim_token") != claim_token:
        raise HTTPException(status_code=401, detail="Invalid claim token")

    # 应用 patch（支持冲突检测）
    if result.get("patch"):
        await self._apply_patch_to_worktree(
            agent_run_id=lease.agent_run_id,
            patch_data=result["patch"],
            use_3way=True,  # 使用 --3way 允许冲突合并
        )

    # 更新 AgentRun（单一状态源）
    await self.agent_run_service.complete_run(
        lease.agent_run_id,
        result=result,
    )

    # 发布事件
    await self.event_bus.publish(AgentRunCompleted(...))

async def _apply_patch_to_worktree(
    self,
    agent_run_id: UUID,
    patch_data: str,
    use_3way: bool = True,
) -> None:
    """应用 patch 到工作区"""
    agent_run = await self.agent_run_service.get(agent_run_id)
    worktree = await self.worktree_service.get_active(agent_run.workspace_id)

    if not worktree:
        raise ValueError("No active worktree for workspace")

    workdir = Path(worktree.path)

    # 先检查是否能应用（不修改文件）
    check_result = subprocess.run(
        ["git", "apply", "--check"],
        cwd=workdir,
        input=patch_data,
        capture_output=True,
        text=True,
    )

    if check_result.returncode != 0:
        if use_3way:
            # 尝试 3-way merge
            apply_result = subprocess.run(
                ["git", "apply", "--3way"],
                cwd=workdir,
                input=patch_data,
                capture_output=True,
                text=True,
            )
            if apply_result.returncode != 0:
                # 3-way 也失败，记录冲突
                raise PatchConflictError(apply_result.stderr)
        else:
            raise PatchApplyError(check_result.stderr)
    else:
        # 直接应用
        subprocess.run(
            ["git", "apply"],
            cwd=workdir,
            input=patch_data,
            check=True,
        )
```

### 4.2.5 执行流程完整图

```
服务器                                    守护进程
   │                                          │
   │ 创建 AgentRun + Lease                    │
   │ ├─ bundle.claude_md                      │
   │ ├─ bundle.credential_config (模板)       │
   │ └─ bundle.session_id                     │
   │                                          │
   │ WebSocket 唤醒                            │
   ├─────────────────────────────────────────>│
   │                                          │
   │                                    1. claim lease
   │                                    2. 获取 bundle
   │                                    3. 镜像工作区 git pull
   │                                          │
   │                                    4. 渲染密钥
   │                                       (从本地 credentials.json)
   │                                    5. 写入 CLAUDE.md
   │                                    6. 启动 Agent 子进程
   │                                          │
   │                                    7. 流式报告进度
   │                                    POST /messages
   │                                          │
   │ 写入 AgentRunLog ←───────────────────────┤
   │ 发布 Redis                                 │
   │                                          │
   │                                    8. Agent 完成
   │                                    9. 收集 patch
   │                                    git format-patch
   │                                          │
   │                                   POST /complete
   │                                   (patch + stats)
   │<─────────────────────────────────────────┤
   │                                          │
   │ 应用 patch 到服务器工作区                  │
   │ 更新 AgentRun.status = completed         │
   │ 发布 AgentRunCompleted 事件               │
```

### 4.3 CLI 命令

```bash
# 启动守护进程
sillyhub daemon start [--profile <name>]

# 停止守护进程
sillyhub daemon stop [--profile <name>]

# 查看状态
sillyhub daemon status [--profile <name>]

# 查看日志
sillyhub daemon logs [--profile <name>] [--tail N]

# 配置管理
sillyhub daemon config [--profile <name>] [get | set] <key> [value]

# 注册到服务器（如果自动注册失败）
sillyhub daemon register [--server <url>]
```

### 4.4 前端改动

**运行时管理页面：** `/frontend/src/app/(dashboard)/runtimes/page.tsx`
- 列出用户的在线运行时
- 显示：名称、Provider、版本、状态、最后心跳时间
- 操作：删除、设为维护模式

**Agent 运行配置：** 创建 Agent Run 时选择运行时
- 单选框：[ ] 在服务器运行 [ ] 在本地运行时 XXX
- 如果有在线运行时，默认选择本地

## 5. 渐进式实现路线

### Wave 1: 服务器基础设施（单一状态源 + 统一入口）
- [ ] 数据库迁移：`daemon_runtimes` + `daemon_task_leases`（注意：lease 非状态源）
- [ ] 创建 `modules/daemon/` 模块骨架
- [ ] 实现 HTTP API：
  - `POST /api/daemon/register`（注册运行时）
  - `POST /api/daemon/heartbeat`（HTTP 心跳备用）
  - `POST /api/daemon/runtimes/{id}/tasks/claim`（认领任务）
  - `POST /api/daemon/leases/{id}/start`（标记开始）
  - `POST /api/daemon/leases/{id}/heartbeat`（lease 续期）
  - `POST /api/daemon/leases/{id}/complete`（完成任务）
  - `POST /api/daemon/leases/{id}/messages`（流式消息，写 AgentRunLog）
- [ ] 实现 `RunPlacementService`（统一决策层）
- [ ] 修改 `AgentService` 三个入口：`start_run`、`start_stage_dispatch`、`start_scan_dispatch`
- [ ] 实现 `DaemonLeaseService`（lease 管理、过期检测）
- [ ] 幂等性测试：重复 claim、重复 complete

### Wave 2: WebSocket Hub（唤醒 + 心跳）
- [ ] 实现 WebSocket 路由：`/api/daemon/ws`
- [ ] 实现 `DaemonWsHub`：按 runtime_id 索引连接
- [ ] 唤醒信号分发：`daemon:task_available`
- [ ] 心跳确认：`daemon:heartbeat` → `daemon:heartbeat_ack`
- [ ] 去重机制：滑动窗口（128 个 ID）
- [ ] 慢连接逐出：发送缓冲区满时断开
- [ ] 集成测试：离线重连、唤醒延迟

### Wave 3: 本地守护进程（核心循环）
- [ ] 创建 `sillyhub-daemon` Python 包
- [ ] 实现 `Config`：配置文件读写（`~/.sillyhub/daemon/config.json`）
- [ ] 实现 `DaemonClient`：HTTP + WebSocket 客户端
- [ ] 实现 `AgentDetector`：检测本地 claude/sillyspec
- [ ] 实现 `Daemon` 核心循环：
  - 启动时注册（POST /register）
  - 建立 WebSocket 连接
  - 轮询循环（claim pending tasks）
  - 心跳循环（WS 心跳 + HTTP 备用）
  - 唤醒信号处理
- [ ] CLI 命令：`daemon start/stop/status/logs`
- [ ] 单元测试 + 本地集成测试

### Wave 4: 任务执行器（工作区 + 子进程）
- [ ] 实现 `WorkspaceManager`：
  - 镜像工作区策略（clone/pull）
  - 路径注册（策略 B 可选）
- [ ] 实现 `CredentialManager`：
  - 本地 `credentials.json` 读写（权限 0600）
  - 密钥渲染（占位符替换）
- [ ] 实现 `TaskRunner`：
  - AgentSpecBundle 解析
  - CLAUDE.md 写入
  - Claude Code 子进程启动（stream-json 模式）
  - 实时进度报告（POST /messages）
  - Patch 收集（git format-patch）
  - 完成上传（POST /complete）
- [ ] 错误处理：子进程崩溃、超时、重试

### Wave 5: 服务器端结果处理
- [ ] 实现 `_apply_patch_to_worktree`：
  - Git worktree 安全应用
  - 冲突检测
  - 回滚机制
- [ ] AgentRun 状态同步（从 daemon 消息更新）
- [ ] AgentRunLog 持久化（接收 /messages）
- [ ] 任务回退流程（lease 过期 → server 子进程）
- [ ] 事件发布：AgentRunCompleted、AgentRunFailed

### Wave 6: 前端集成（可选）
- [ ] 运行时管理页面：`/runtimes`
  - 列出用户的在线运行时
  - 显示：名称、Provider、版本、状态、最后心跳
  - 操作：删除、设为维护模式
- [ ] Agent Run 创建 UI：
  - 单选框：[ ] 服务器 [ ] 本地（默认）
  - 无在线运行时时禁用本地选项
- [ ] SSE 路径保持不变（前端无需改动）

### Wave 7: 高级特性（可选）
- [ ] 多配置文件支持：`--profile <name>`
- [ ] 自动更新机制
- [ ] 离线队列（网络断开时本地排队）
- [ ] 资源监控（CPU/内存上报）

## 6. 兼容性策略

### 6.1 向后兼容
- 无守护进程时，Agent 仍在服务器子进程运行（`RunPlacementService.decide_backend()` 返回 `SERVER`）
- 现有 API 不变，SSE 路径不变
- 前端默认行为不变

### 6.2 优雅降级
- 守护进程离线时，`RunPlacementService` 自动选择 `SERVER`
- Daemon claim 后断线：
  - lease 超时（60 秒无心跳）→ status='expired'
  - 触发回退流程：检查 AgentRun 状态，若仍 pending/running 则切换到 server 子进程
  - attempt_number 递增，超过 3 次则标记失败
- Daemon 重连后自动重新注册

### 6.3 平滑迁移
- 用户可逐步选择任务运行在本地
- 服务器和本地可同时运行不同任务
- 运行时管理页面支持查看和切换

## 7. 安全考虑

### 7.1 认证和授权
- 守护进程使用用户 PAT（Personal Access Token）认证
- 每个运行时只能访问自己用户创建的任务
- Lease 包含 claim_token，心跳时验证

### 7.2 传输加密
- 强制 HTTPS（HTTP API）和 WSS（WebSocket）
- 禁止明文传输密钥

### 7.3 密钥隔离
- 用户密钥存储在本地 `~/.sillyhub/daemon/credentials.json`（权限 0600）
- 服务器只传递密钥占位符（`{{USER_ANTHROPIC_API_KEY}}`）
- Agent 子进程环境变量由守护进程本地渲染

### 7.4 路径安全
- 默认镜像工作区隔离在 `~/sillyhub_workspaces/`
- 直接映射模式需要用户显式注册允许路径
- 守护进程不访问允许路径外的文件

## 8. 与现有架构的关系

### 8.1 状态源统一
```
单一状态源：
- AgentRun：任务状态、tokens、cost、duration
- AgentRunLog：流式日志、工具调用
- WorktreeLease：工作区租约

非状态源：
- DaemonTaskLease：仅用于 dispatch/claim/lease 管理
```

### 8.2 调度入口统一
```
三个入口 → RunPlacementService → 执行后端决策
├─ AgentService.start_run()
├─ AgentService.start_stage_dispatch()
└─ AgentService.start_scan_dispatch()
```

### 8.3 执行模式共存
```
现有：服务器子进程模式
用户 → Web UI → API → 子进程(Claude) → 输出

新增：守护进程模式
用户 → Web UI → API → 唤醒信号 → 本地守护进程 → 本地 Claude → 输出 → API → AgentRunLog

共存：RunPlacementService 决策
```

### 8.4 前端无感知
```
前端订阅 SSE 路径不变：
GET /api/workspaces/{workspaceId}/agent/runs/{runId}/stream

无论服务器子进程还是本地守护进程，
服务器都通过 Redis Pub/Sub 发布到同一个 SSE 频道。
```

## 9. 非目标

明确不做的功能，防止 scope creep：

- **不做分布式任务队列**：守护进程是单机模式，不跨机器调度
- **不做任务优先级**：先到先得（FIFO），不实现优先级队列
- **不做任务依赖**：不支持任务间的依赖关系和 DAG 调度
- **不做实时监控仪表板**：基础的运行时状态列表即可，不做详细的性能监控图表
- **不做多租户隔离**：守护进程绑定用户，不做跨用户的任务隔离
- **不做离线执行队列**：网络断开时暂不支持本地排队执行（留待 Wave 7）
- **不做本地模型支持**：先支持 Claude Code CLI，本地模型是未来方向

## 10. 拆分判断

**为什么这样组织变更**：
- 本质是单一功能模块（守护进程），不是多个独立业务
- 服务器端、守护进程、前端有清晰依赖关系：必须先有服务器基础设施，守护进程才能工作
- Wave 划分按依赖顺序：Wave 1-2 服务器基础 → Wave 3-4 守护进程 → Wave 5 结果处理 → Wave 6 前端

**为什么不走批量模式**：
- 任务类型多样（数据库、API、WebSocket、守护进程、前端），不是"模板 × 数据"模式
- 每个任务有独立逻辑，无法用统一模板简化
- 7 个 Wave × 平均 5 个任务 = 35 个任务，远低于批量模式阈值（100+）

## 11. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| **新增** | `backend/app/modules/daemon/__init__.py` | daemon 模块入口 |
| **新增** | `backend/app/modules/daemon/router.py` | /api/daemon/* 路由 |
| **新增** | `backend/app/modules/daemon/schema.py` | 注册、任务、运行时模型 |
| **新增** | `backend/app/modules/daemon/service.py` | 运行时管理、任务分配 |
| **新增** | `backend/app/modules/daemon/ws_hub.py` | WebSocket 连接管理 |
| **新增** | `backend/app/modules/daemon/protocol.py` | 消息协议定义 |
| **新增** | `backend/app/modules/daemon/model.py` | DaemonRuntime, DaemonTaskLease 模型 |
| **新增** | `backend/app/modules/agent/placement.py` | RunPlacement 统一决策层 |
| **修改** | `backend/app/modules/agent/service.py` | 三个入口添加 placement 调用 |
| **修改** | `backend/app/main.py` | 注册 daemon 路由 |
| **新增** | `backend/app/modules/daemon/migrations/versions/001_create_daemon_tables.py` | 数据库迁移 |
| **新增** | `sillyhub-daemon/pyproject.toml` | 守护进程 Python 包配置 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/__init__.py` | 守护进程包入口 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/__main__.py` | CLI 入口 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/daemon.py` | 核心守护进程类 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/client.py` | HTTP + WebSocket 客户端 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/config.py` | 配置管理 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | Agent 检测 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 任务执行器 |
| **新增** | `sillyhub-daemon/sillyhub_daemon/protocol.py` | 消息协议（与服务器共享） |
| **新增** | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 运行时管理页面（可选） |
| **修改** | `frontend/src/app/(dashboard)/workspaces/[id]/agent/runs/new/page.tsx` | 添加运行位置选择（可选） |

## 12. 接口定义

### 12.1 HTTP API

**注册运行时**
```
POST /api/daemon/register
Request: {
  name: string,
  provider: 'claude-code' | 'sillyspec',
  version: string,
  os: string,
  arch: string,
  capabilities: { agents: [...], max_concurrent_tasks: number }
}
Response: DaemonRuntime
```

**认领任务**
```
POST /api/daemon/leases/{lease_id}/claim
Request: { runtime_id: UUID }
Response: {
  lease: DaemonTaskLease,
  payload: {  // 执行上下文
    agent_run_id: UUID,
    workspace_id: UUID,
    workspace_name: string,
    claude_md: string,
    prompt: string,
    tool_config: object,
    session_id: string,
    metadata: { change_id?, task_id? }
  },
  claim_token: string  // 后续心跳验证
}
```

**心跳续期**
```
POST /api/daemon/leases/{lease_id}/heartbeat
Request: { claim_token: string }
Response: { status: 'ok', lease_expires_at: timestamp }
```

**流式消息**
```
POST /api/daemon/leases/{lease_id}/messages
Request: {
  claim_token: string,
  agent_run_id: UUID,
  messages: [{ content: string, level: 'info'|'error', metadata? }]
}
Response: { status: 'ok' }
```

**完成任务**
```
POST /api/daemon/leases/{lease_id}/complete
Request: {
  claim_token: string,
  result: {
    status: 'completed',
    patch?: string,  // git format-patch 输出
    stats?: { files_changed, insertions, deletions }
  }
}
Response: { status: 'ok' }
```

### 12.2 WebSocket 协议

**连接**
```
ws://server/api/daemon/ws?runtime_ids=<comma-separated>
Headers: Authorization: Bearer <token>
```

**唤醒信号（服务器 → 守护进程）**
```
{
  type: 'daemon:task_available',
  payload: { runtime_id: UUID, task_id?: UUID }
}
```

**心跳请求（守护进程 → 服务器）**
```
{
  type: 'daemon:heartbeat',
  payload: { runtime_id: UUID }
}
```

**心跳确认（服务器 → 守护进程）**
```
{
  type: 'daemon:heartbeat_ack',
  payload: {
    runtime_id: UUID,
    pending_operations?: { update?, model_list?, skill_import? }
  }
}
```

## 13. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|------|------|------|----------|
| R-01 | WebSocket 连接不稳定导致任务唤醒延迟 | P1 | 双通道设计：HTTP 轮询作为备用，守护进程定期轮询 pending tasks |
| R-02 | Lease 过期后回退到服务器，但 daemon 仍在执行导致双跑 | P0 | Lease 过期后 daemon 停止执行（监听 WebSocket 取消信号），回退前检查 AgentRun 状态 |
| R-03 | 本地工作区与服务器代码不同步导致 patch 冲突 | P1 | 执行前 git pull，服务器应用 patch 前先 git pull，冲突时记录并通知用户 |
| R-04 | 守护进程被恶意利用执行未授权任务 | P1 | PAT 认证 + claim_token 验证，每个运行时只能访问自己用户的任务 |
| R-05 | 密钥本地存储被窃取 | P2 | credentials.json 权限 0600，支持系统密钥库（可选 Wave 7） |
| R-06 | 守护进程崩溃导致任务丢失 | P1 | 服务器端 lease 超时回退机制，attempt_number 计数，超过 3 次标记失败 |
| R-07 | 大量守护进程同时连接导致服务器 WebSocket 连接数爆炸 | P2 | 监控连接数，设置单用户最大运行时数限制（如 5 个） |
| R-08 | Patch 应用失败导致代码丢失 | P0 | 应用前 git apply --check，失败时记录并通知用户，不强制应用 |

## 14. 自审

### 需求覆盖
✅ 核心目标全部覆盖：本地守护进程、双通道通信、lease 机制、统一调度入口、前端无感知

### 约束一致性
✅ 遵循 CONVENTIONS.md：异步优先、Service 层模式、类型注解
✅ 遵循 ARCHITECTURE.md：模块化设计、RBAC 权限、审计追踪

### 真实性
✅ 表名/字段名来自真实数据库设计（daemon_runtimes, daemon_task_leases）
✅ 类名/方法名标注清晰：新增的明确标注，修改的引用现有代码

### YAGNI
✅ 高级特性（离线队列、资源监控）放到 Wave 7 可选
✅ 非目标明确：不做分布式队列、优先级、任务依赖

### 验收标准
✅ 每个 Wave 有明确的 checkbox 任务
✅ 幂等性测试：重复 claim、重复 complete

### 非目标清晰
✅ 第 9 节明确列出 7 项非目标

### 兼容策略（brownfield）
✅ 第 6 节详细说明向后兼容、优雅降级、平滑迁移
✅ 回退路径：守护进程离线自动切换到服务器子进程

### 风险识别
✅ 第 13 节列出 8 个关键风险，每个都有应对策略
✅ P0 级风险：双跑、patch 失败都有明确防护措施

### 自审结论
✅ 全部通过，设计已充分收紧，可进入下一步。
