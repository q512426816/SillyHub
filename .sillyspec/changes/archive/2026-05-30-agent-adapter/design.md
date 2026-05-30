---
author: qinyi
created_at: 2026-05-30T18:50:30
---

# Design: Agent Adapter 补全

## 架构决策

### AD-1: 进程生命周期管理策略

**决策**：在 `AgentService` 中维护 `dict[UUID, asyncio.subprocess.Process]` 类属性作为进程注册表。

**理由**：
- 当前为单机部署，无需分布式注册表
- 类属性而非全局变量，方便测试注入 mock
- 服务重启时注册表清空，running 状态的 run 在恢复时可标记为 failed

**Trade-off**：
- ✅ 实现简单，零外部依赖
- ✅ 测试友好
- ❌ 不支持多进程/多节点部署（YAGNI — 当前不需要）

### AD-2: Kill 信号策略

**决策**：SIGTERM → 等待 5s → SIGKILL（如果进程未退出）。

**理由**：遵循 Unix 进程管理最佳实践，给 Agent 优雅退出的机会。

### AD-3: Diff 收集时机

**决策**：在 `_execute_run_background` 的第 4 步（更新 run record）之后、第 6 步（审计日志）之前收集 diff。

**理由**：此时进程已结束，文件变更已落盘，且尚未写入审计日志，diff 信息可一并记录。

### AD-4: 前端 SSE 连接策略

**决策**：使用原生 EventSource API 直接连接后端 `/stream` 端点。

**理由**：
- 后端已有完整的 SSE 端点实现（含 keepalive、done 事件）
- 无需引入 WebSocket 库
- EventSource 自动重连

## 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|---|---|
| `backend/app/modules/agent/diff_collector.py` | git diff 收集 + 脱敏 |
| `backend/app/modules/agent/tests/test_kill.py` | kill 全流程测试 |
| `backend/app/modules/agent/tests/test_diff_collector.py` | diff 收集测试 |
| `backend/app/modules/agent/tests/test_adapter_isolation.py` | allowed_paths + 脱敏测试 |
| `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | Agent Run 列表页 |
| `frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx` | Agent Run 详情页 |
| `frontend/src/components/agent/AgentRunCard.tsx` | Run 卡片组件 |
| `frontend/src/components/agent/AgentLogStream.tsx` | SSE 日志流组件 |
| `frontend/src/lib/api/agent.ts` | Agent API 客户端 |

### 修改文件

| 文件路径 | 变更说明 |
|---|---|
| `backend/app/modules/agent/service.py` | 新增 `_proc_registry` + `kill_run()` + diff 收集调用 |
| `backend/app/modules/agent/router.py` | 新增 `POST /runs/{run_id}/kill` 端点 |
| `backend/app/modules/agent/schema.py` | 新增 `AgentKillResponse` |
| `backend/app/modules/agent/adapters/claude_code.py` | `_exec_stream` 返回时注册/注销进程 |

## 数据模型

### 现有表变更

无表结构变更。`AgentRun` 表已有 `status` 字段支持 `killed` 值，`diff_summary` 字段已存在。

### 新增 Dataclass

```python
# agent/diff_collector.py
@dataclass
class DiffResult:
    stat_summary: str        # git diff --stat 输出
    full_diff: str           # git diff 输出（截断）
    files_changed: int       # 变更文件数
    insertions: int          # 新增行数
    deletions: int           # 删除行数
```

### 进程注册表

```python
# agent/service.py
class AgentService:
    _proc_registry: dict[uuid.UUID, asyncio.subprocess.Process] = {}
```

## API 设计

### 新增端点

```
POST /api/workspaces/{workspace_id}/agent/runs/{run_id}/kill
  → 200: AgentKillResponse { id, status: "killed" }
  → 404: AgentRunNotFound
  → 409: AgentRunNotRunning (run 已完成)
```

### 现有端点（无变更）

```
POST   /api/workspaces/{ws_id}/agent/runs               → 创建并执行 run
GET    /api/workspaces/{ws_id}/agent/runs                → 列表
GET    /api/workspaces/{ws_id}/agent/runs/{run_id}       → 详情
GET    /api/workspaces/{ws_id}/agent/runs/{run_id}/logs  → 日志列表
GET    /api/workspaces/{ws_id}/agent/runs/{run_id}/stream → SSE 流
```

## 兼容策略

- 进程注册表为类属性，不依赖持久化存储，重启后自动清空
- `_execute_run_background` 新增 diff 收集步骤，不影响现有调用链
- kill 端点为新增路由，不修改现有端点签名
- 前端为纯新增页面，不影响现有功能

## 风险登记

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 子进程不响应 SIGTERM | 中 | 低 | 5s 后 SIGKILL 兜底 |
| 服务重启导致进程注册表丢失 | 低 | 中 | 启动时扫描 running 状态的 run 并标记为 failed |
| git diff 在非 git 目录执行 | 低 | 低 | diff_collector 检查 .git 存在性，不存在返回空结果 |
| SSE 连接积压 | 低 | 中 | 已有 keepalive 机制（30s），前端连接断开自动重连 |

## 自审

- **是否有过度设计？** 否。进程注册表是最简方案，diff_collector 是单一职责模块。
- **是否有遗漏？** 考虑了服务重启场景（stale running 状态），将在 service 启动时添加清理逻辑。
- **是否与现有代码风格一致？** 是。遵循 feature-slice 模式（model/service/router/schema），使用 structlog 日志，AppError 异常层次。
