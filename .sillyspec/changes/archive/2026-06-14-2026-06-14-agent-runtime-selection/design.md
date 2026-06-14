---
author: qinyi
created_at: 2026-06-14 21:48:37
---

# Design — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 阶段：brainstorm / step 10（写设计文档并自审）
> 关联前置：`2026-06-14-unified-agent-execution`（daemon 成为唯一 agent 执行路径）

---

## 1. 背景

前置变更 `unified-agent-execution` 删除了 SERVER 子进程路径，daemon 成为 agent 执行的唯一后端。但该变更只解决了"在哪执行"，留下两个产品缺口：

**缺口 1 — 没有"默认 agent"概念。**
后端三个分发入口 `placement.dispatch_to_daemon` 的调用方都不传 `provider`：
- `AgentService.start_run`（task 执行，`agent/service.py`）
- `AgentService.start_stage_dispatch`（stage 执行，被 `change/dispatch.py` 的 `dispatch()` / `SillySpecStageDispatchService.dispatch_next_step()` 调用）
- `AgentService.start_scan_dispatch`（scan 执行）

`placement._get_online_runtime(user_id, provider=None)`（`placement.py:285`）在 `provider` 为空时按 `ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1` 随机选最近心跳的 runtime。若 daemon 同时注册了 claude / codex / hermes，**谁被选中不可预测**。

**缺口 2 — 用户无法选择 agent。**
- 前端 `runtimes/page.tsx` 仅做监控 + QuickChat，QuickChat 有 provider 下拉但仅限聊天。
- task / stage / scan 触发时没有任何 agent 选择 UI。

**后果：** 多 provider 环境下执行结果不可复现，用户无法定向使用某个 agent。

## 2. 设计目标

1. **工作空间级默认 agent**：Workspace 可设 `default_agent`（provider 名），新建/现有 workspace 都能配置。
2. **每次分发优先指定 provider，找不到则回退**：provider 解析优先级 `显式 provider > workspace.default_agent > None`；指定 provider 无在线 runtime 时回退到任意在线 runtime 并告警，**不静默失败**。
3. **前端可选 agent**：workspace 设置页选默认 agent；task / 手动 stage dispatch / scan 触发时带 agent 下拉，默认值取 workspace.default_agent，允许临时覆盖。
4. **daemon 零改动**：复用已有的多 runtime 注册与 provider 传播链路。

## 3. 非目标

- ❌ 不做跨 workspace 的全局默认 agent（全局设置留待后续）。
- ❌ 不做 per-task / per-change 级别的持久 agent 偏好（只在 workspace 级别持久化）。
- ❌ 不改 daemon 端（`_registeredRuntimes` Map、`_build_claim_payload` provider 传播、execution-context provider 字段均已就绪）。
- ❌ 不改 `decide_backend`（它只判"有无在线 runtime"，与 provider 解耦；见 6.2）。
- ❌ 不引入 provider 权限/配额/路由策略。
- ❌ 不做 agent_type 与 provider 的耦合映射（`start_run` 的 `agent_type="claude_code"` 是执行风格标记，与 provider 正交，保持解耦）。

## 4. 拆分判断

本变更是一个**聚焦的单点能力**（provider 选择），不与 unified-agent-execution 的"执行路径"混在一起。理由：
- 前置变更已归档、daemon-only 路径稳定，provider 选择是建立在它之上的**配置层**能力，独立成变更便于回滚与验证。
- 不拆成多个变更：模型迁移 / placement 回退 / 三入口接入 / 前端是同一条逻辑链，拆开会留下中间态（如迁移加了列但没人用）。整体作为一个变更、分 Phase 实施。

## 5. 总体方案

### 数据流
```
用户触发（task / 手动 stage dispatch / scan）
  │  显式 provider（可选）
  ▼
AgentService.start_{run,stage_dispatch,scan_dispatch}
  │  解析 provider：显式 > workspace.default_agent > None
  ▼
placement.dispatch_to_daemon(provider=resolved)
  │
  ▼
_get_online_runtime(user_id, provider)
  ├─ provider 严格匹配命中 → 锁定该 runtime_id（provider 锁定到 lease.metadata）
  ├─ provider 给定但无在线 → 回退任意在线 runtime + log.warning
  └─ provider=None → ORDER BY last_heartbeat（现状不变）
  ▼
daemon poll → claim lease → _build_claim_payload 从 lease.metadata 读 provider → 执行
```

### Phase 划分
- **Phase 1（后端核心）**：模型迁移 + placement 回退 + 三入口 provider 解析。完成后多 provider 环境可通过设 workspace.default_agent 或 API 显式传 provider 正确路由。
- **Phase 2（后端 API）**：AgentRunCreate / stage 手动 dispatch / scan-generate 的 request schema 增可选 provider；WorkspaceCreate/Update/Read 增 default_agent。
- **Phase 3（前端）**：workspaces.ts 类型 + updateWorkspace；workspace 设置页默认 agent 下拉；task / stage / scan 触发加 agent 下拉。

## 6. 文件变更清单

### 6.1 后端

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/model.py` | `Workspace` 模型增 `default_agent: Mapped[str \| None]`（VARCHAR，nullable） |
| 新增 | `backend/app/migrations/versions/202606141200_add_workspace_default_agent.py` | Alembic：`ADD COLUMN default_agent VARCHAR NULL`（无默认值，向后安全） |
| 修改 | `backend/app/modules/workspace/schema.py` | `WorkspaceCreate` / `WorkspaceUpdate` / `WorkspaceRead` 增 `default_agent: str \| None` |
| 修改 | `backend/app/modules/agent/placement.py` | `_get_online_runtime`：provider 严格优先，无在线则回退任意在线 runtime + `log.warning("placement_provider_fallback")` |
| 修改 | `backend/app/modules/agent/service.py` | `start_run` / `start_stage_dispatch` / `start_scan_dispatch` 增 `provider` 参数；分发前按优先级解析（显式 > workspace.default_agent > None）；透传 `dispatch_to_daemon(provider=resolved)` |
| 修改 | `backend/app/modules/agent/schema.py` | `AgentRunCreate` 增 `provider: str \| None = None` |
| 修改 | `backend/app/modules/agent/router.py` | `create_agent_run` 把 `data.provider` 透传给 `start_run(..., provider=...)` |
| 修改 | `backend/app/modules/change/dispatch.py` | `dispatch()` 与 `dispatch_next_step()` 增可选 `provider` 参数，透传给 `start_stage_dispatch`；手动 dispatch HTTP 入口的 request 增 `provider`（自动调度链路不传 = 用 workspace.default_agent） |
| 修改 | scan-generate 链路（`workspace` 模块 scan-generate service / `start_scan_dispatch` 入口的 request schema） | request 增可选 `provider`（⚠️ plan 阶段确认 request schema 字段名与确切注入点） |

### 6.2 前端

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/workspaces.ts` | `Workspace` 接口增 `default_agent: string \| null`；新增 `updateWorkspace(id, {default_agent})`（PATCH `/api/workspaces/{id}`） |
| 修改 | `frontend/src/lib/daemon.ts` | 复用已有 `PROVIDER_META` / `listDaemonRuntimes`（无改动，仅作为下拉数据源） |
| 新增 | `frontend/src/components/AgentProviderSelect.tsx`（或就近内联） | provider 下拉共享组件，选项 = `listDaemonRuntimes()` 的 distinct provider，复用 `PROVIDER_META` 渲染 label/icon |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（或设置子页） | "默认 Agent"下拉 + 保存（调 `updateWorkspace`） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/**` | task 触发按钮加 agent 下拉，默认 `workspace.default_agent` |
| 修改 | stage 手动 dispatch 触发 UI（change 详情 / dispatch 入口） | 手动重跑 stage 时加 agent 下拉 |
| 修改 | scan 触发 UI（scan-docs / scan-generate 入口） | 加 agent 下拉 |

### 6.3 daemon
**无改动**（D7）。链路已通：
- `sillyhub-daemon/src/daemon.ts`：`_registeredRuntimes = Map<provider, runtimeId>` 支持多 runtime；poll 轮询所有 runtime_id；执行用 `execCtx?.provider ?? execPayload.provider`。
- `backend/app/modules/daemon/service.py`：`_build_claim_payload`（L349-350）从 `lease.metadata` 读 `provider` 写入 claim payload。
- `agent/router.py`：`get_execution_context`（L214）从 lease.metadata 读 `provider` 返回。

## 7. 接口定义

### 7.1 后端 service 签名（关键变更）
```python
# placement.py —— _get_online_runtime 行为变更（签名不变）
async def _get_online_runtime(self, user_id, *, provider=None) -> dict | None:
    # provider 给定：先严格匹配；无在线则回退任意在线 + warn
    # provider=None：维持现状（ORDER BY last_heartbeat）

# agent/service.py —— 三入口增 provider（显式覆盖）
async def start_run(self, workspace_id, user_id, *, task_id, lease_id,
                    agent_type="claude_code", idempotency_key=None,
                    preferred_backend=None, provider=None) -> AgentRun: ...
async def start_stage_dispatch(self, *, workspace_id, change_id, user_id,
                               stage, prompt_template, requires_worktree,
                               read_only, provider=None) -> AgentRun: ...
async def start_scan_dispatch(self, *, ..., provider=None) -> AgentRun: ...
```

provider 解析（三入口共用，service 内部）：
```python
resolved = provider or workspace.default_agent or None
await self._placement.dispatch_to_daemon(run.id, user_id, provider=resolved, ...)
```

### 7.2 API 契约
- `POST /api/workspaces/{id}/agent/runs`：body 增 `provider: string?`（可选）。
- `PATCH /api/workspaces/{id}`：body 增 `default_agent: string?`（`exclude_unset=True`，省略=不改；显式传 null=清空默认）。
- `GET /api/workspaces/{id}`：response 增 `default_agent: string | null`。
- stage 手动 dispatch 入口、scan-generate 入口：body 增 `provider: string?`（可选）。

## 8. 数据模型

`workspaces` 表新增列：
| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `default_agent` | VARCHAR | NULL | provider 名（如 `claude`/`codex`/`hermes`）；NULL 表示未设默认 |

无外键（provider 是动态注册的 runtime 属性，不存在独立 provider 表）。无索引（点查 by workspace id）。

`daemon_task_leases.metadata` JSON：`provider` 字段已存在（`placement.py:189`），无需改 schema，仅保证三入口解析后写入。

## 9. 兼容策略

项目未正式上线、数据可清空（CLAUDE.md 规则 7），但仍保证平滑：

- **未配置 default_agent 时行为不变**：`default_agent=NULL` → provider 解析得 None → `_get_online_runtime` 走现状（ORDER BY last_heartbeat）。现有 workspace 无需迁移数据。
- **provider 回退不破坏执行**：指定 provider 无在线 runtime 时回退到任意在线 runtime（而非失败），保证"想用 codex 但 codex 离线"时任务仍能跑，仅告警。
- **不改的 API / 表结构**：`decide_backend`、daemon 表、lease 表结构、execution-context 响应结构均不变；`agent_type` 字段语义不变。
- **前端旧调用兼容**：所有新增 body 字段可选；现有 task/stage/scan 触发不传 provider 时用 workspace.default_agent，无默认则维持现状。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 回退逻辑掩盖配置错误：用户设了 codex 默认但 codex 长期离线，每次都回退却不察觉 | P1 | 回退时 `log.warning("placement_provider_fallback", wanted, actual)`；前端下拉标注 offline provider；可选：lease.metadata 记 `provider_fallback_from`，execution/日志面板展示 |
| R-02 | 多 runtime 同 provider：daemon 注册两个 "claude" runtime，`_get_online_runtime` 选哪个 | P2 | 维持现状 ORDER BY last_heartbeat（最近的胜出）；文档说明 provider 维度而非 runtime 维度。不在本变更做 runtime 级指定（非目标） |
| R-03 | stage 自动调度链路漏传 provider 导致仍随机 | P1 | provider 解析下沉到 `start_stage_dispatch` 内部（读 workspace.default_agent），而非依赖调用方传参；自动调度链路无需改动即自动生效 |
| R-04 | 前端下拉数据滞后：listDaemonRuntimes 缓存导致新注册 provider 不出现 | P2 | 触发面板打开时即时拉取（不缓存或短 TTL）；下拉含"使用默认"选项兜底 |
| R-05 | scan-generate 链路 provider 注入点未确认 | P2 | ⚠️ plan 阶段确认 scan dispatch 的 request schema 字段名与 service 注入点，可能涉及 workspace scan-generate service |
| R-06 | default_agent 指向已下线的 provider 名（拼写错误） | P2 | 前端下拉只列在线 runtime 的 provider，限制输入；后端不做硬校验（容忍未知 provider，回退兜底） |

## 11. 自审

| 检查项 | 结果 |
|---|---|
| **需求覆盖** | ✅ 目标 1（workspace 默认 agent）→ §6.1 模型+schema+前端设置页；目标 2（优先指定+回退）→ §6.1 placement + 三入口；目标 3（前端可选）→ §6.2 下拉组件。三目标全覆盖。 |
| **约束一致性** | ✅ 文档驱动（先 design.md 后代码）；模块映射命中 agent/workspace/change/frontend_lib/frontend_app；迁移命名 `202606141200_...` 符合 `YYYYMMDDHHMI_` 约定；AppError/structlog 风格沿用。 |
| **真实性** | ✅ 文件路径/类名/方法名均来自真实代码（placement.py `_get_online_runtime` L285、service.py 三入口、daemon.ts `_registeredRuntimes`、router.py `update_workspace` L289、schema.py `AgentRunCreate`）。scan-generate 注入点标注 ⚠️ 存疑（R-05）。 |
| **YAGNI** | ✅ 不做全局默认、per-task 偏好、provider 权限、runtime 级指定。daemon 零改动。 |
| **验收标准** | ⚠️ design 阶段不写具体 AC，留给 requirements.md（step 11）。但已隐含可测点：设 default_agent=claude→分发命中 claude；codex 离线→回退+告警；前端下拉默认联动。 |
| **非目标清晰** | ✅ §3 明确列出 6 项不做。 |
| **兼容策略** | ✅ §9 给出回退路径：NULL 行为不变、provider 回退不失败、字段全可选。 |
| **风险识别** | ✅ R-01~R-06，含 1 个存疑（R-05 scan 注入点）。 |

**自审结论：** 设计通过，可进入 step 11。R-05（scan-generate provider 注入点）在 plan 阶段需先确认再实现，不阻塞 brainstorm 推进。
