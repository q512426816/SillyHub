---
id: task-14
title: 实现 Agent Adapter 接口与首个 Adapter
phase: V4
priority: P1
status: draft
owner: qinyi
estimated_hours: 40
affected_components:
  - platform-api
  - agent-runtime
allowed_paths:
  - agent-runtime/
  - backend/app/modules/agent/
  - frontend/src/app/(dashboard)/agents/
depends_on:
  - task-10
  - task-11
  - task-13
blocks:
  - task-15
  - task-16
---

## 1. 目标

定义统一 AgentAdapter 接口，先实现 ClaudeCodeAdapter 端到端：从任务上下文构造 → 启动 Claude Code 子进程 → 工具调用过 Tool Gateway → 收集 diff/log/cost → 写 artifact/audit → 释放 lease。

**V4 只接一个 Adapter（Claude Code）**。Codex / Cursor 留到 V4.1 / V4.2 再接。

## 2. 输入

- `requirements.md` FR-010
- `references/06-agent-adapter-design.md`
- `references/16-rbac.md` §4
- `references/17-db-schema.md` §5
- spike 03 必须先 PASS

## 3. 产出清单

### 3.1 接口

```python
class AgentAdapter(Protocol):
    name: str
    capabilities: list[str]

    async def prepare(self, ctx: AgentContext) -> PreparedSession: ...
    async def run(self, session: PreparedSession) -> AsyncIterator[AgentEvent]: ...
    async def cancel(self, run_id: UUID) -> None: ...
    async def collect_artifacts(self, run_id: UUID) -> list[Artifact]: ...
```

### 3.2 AgentContext

```python
@dataclass
class AgentContext:
    workspace_id: UUID
    change_id: UUID
    task_id: UUID
    run_id: UUID
    owner_user_id: UUID
    affected_components: list[ComponentRef]
    scan_docs: dict[component_key, list[ScanDocRef]]
    documents: dict[doc_type, str]      # requirements/design/plan/...
    allowed_paths: list[str]
    denied_paths: list[str]
    git_identity_id: UUID
    tool_permissions: set[Permission]
    cost_limit_usd: float
    timeout_seconds: int
    worktree_path: Path
    home_path: Path
```

### 3.3 ClaudeCodeAdapter 实现要点

```text
prepare:
  1. 申请 worktree lease（task-10）
  2. 构造 system prompt：项目背景 + 任务上下文 + 边界
  3. 写入 .claude/settings.json（允许工具白名单）
  4. 生成 askpass.sh
run:
  subprocess: claude -p <prompt> --output-format stream-json
              --permission-mode default
              --allowed-tools Read,Write,Edit,Bash
              --add-dir <worktree.repo>
              --max-turns 30
              cwd=worktree.repo
              env=隔离 env（task-10 exec_env）
  for event in stream:
    yield AgentEvent(...)
    if tool_call: 转发到 ToolGateway 校验后再写
cancel:
  发 SIGTERM；30s 后 SIGKILL
collect_artifacts:
  git diff + log + 测试报告
```

**Claude Code 的工具调用必须重定向到本平台 Tool Gateway**：

- 用 `--mcp-config` 注入自定义 MCP server（platform-tool-gateway），让 Claude 的 Read/Write/Bash 走我们的 Gateway
- 或：用 `--permission-prompt-tool` 让 Claude 每次工具调用阻塞等待平台批准

### 3.4 数据表

按 17-db-schema.md §5 建：

- agent_runs
- tool_calls
- artifacts

### 3.5 后端模块

```text
agent-runtime/
├─ adapters/
│  ├─ base.py
│  ├─ claude_code.py
│  ├─ codex.py            # V4.1 占位
│  └─ cursor.py           # V4.2 占位
├─ context_builder.py
├─ artifact_collector.py
├─ tool_proxy/            # MCP server / permission-prompt-tool 实现
│  ├─ mcp_server.py
│  └─ gateway_client.py
└─ tests/

backend/app/modules/agent/
├─ router.py
├─ service.py
├─ schema.py
├─ model.py
└─ tests/
```

### 3.6 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/agent-runs` | `task:run_agent` | 启动 run |
| GET | `/api/agent-runs/{run_id}` | owner / admin | 详情 |
| GET | `/api/agent-runs/{run_id}/events` | owner / admin | SSE 流，实时事件 |
| POST | `/api/agent-runs/{run_id}/cancel` | owner / admin | 取消 |
| GET | `/api/agent-runs/{run_id}/artifacts` | owner / admin | 产物列表 |

### 3.7 前端 Agent 控制台

`frontend/src/app/(dashboard)/agents/page.tsx`：

- Run 列表：task / agent_type / status / cost / 起止时间
- Run 详情：
  - 上下文 panel：affected_components / allowed_paths / cost_limit
  - 事件流：实时显示 tool_call / stdout / error（SSE）
  - 工具调用表：tool_name / params / result / approval 状态
  - Diff 视图（artifact）
  - "取消"按钮

### 3.8 成本与限额

```yaml
default_limits:
  cost_usd_per_run: 5.0
  tokens_per_run: 200000
  duration_minutes: 30
  max_turns: 30
```

run 超限自动 cancel + 通知 owner。

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | spike 03 PASS | 前置 |
| AC-02 | 启动一个简单任务（创建一个 hello.py） | run 成功，artifact 含该文件 |
| AC-03 | Claude 尝试写 denied_path | Tool Gateway 拒绝，事件入审计 |
| AC-04 | Claude 调用 bash 删除文件 | Tool Gateway 风险分级 → 转人工 |
| AC-05 | cost > limit | 自动 cancel + 通知 |
| AC-06 | 取消 run | 30s 内子进程退出 |
| AC-07 | run 结束 worktree 释放 | lease.status=released |
| AC-08 | Agent 权限 = Owner ∩ template | 单测验证 |
| AC-09 | tool_calls 全量入库 | DB 行 |
| AC-10 | artifact diff 在前端可看 | 截图 |
| AC-11 | 故障：Claude 进程崩溃 | run 标 failed，lease 24h 内可重试 |
| AC-12 | 单测 + 集成 | ≥ 80% |
| AC-13 | 红队：试图越权访问其他 workspace | 拒绝 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Claude Code 工具调用不走 MCP 直接绕过 | 越权 | V4 同时跑 MCP + 容器隔离；V4 之前先用 `--permission-prompt-tool` 拦截 |
| stream-json 解析错位 | 事件丢失 | line-buffered，缓冲 partial，broken 行单独 warning |
| 进程僵尸 | 资源泄漏 | wait timeout + 强 kill；定期扫子进程 |
| Claude 把 PAT 复读到 stdout | 凭据泄漏 | stdout 脱敏过滤 |
| 大 diff 阻塞 UI | UX 差 | artifact 按 chunk 流式返回 |
| cost 估算与 provider 实际偏差 | 超支 | 取 provider 真实 usage 字段，启动前预扣 |

## 6. 完成定义

- [ ] 13 个 AC 通过
- [ ] spike 03 PASS
- [ ] 红队测试
- [ ] `verification.md` 追加 task-14 记录
- [ ] PR 合并
