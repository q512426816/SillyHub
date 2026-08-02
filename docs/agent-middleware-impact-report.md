# "Agent 中间层"方案技术影响评估报告

> **审计人**: code_auditor
> **日期**: 2026-08-02
> **范围**: multi-agent-platform 全栈（backend FastAPI + sillyhub-daemon Node + frontend Next.js）
> **目标**: 分析 daemon/workspace/agent 的绑定关系，评估插入"agent 配置实体"中间层的代码级影响

---

## 一、"agent"在代码中的含义

### 1.1 当前语义总览

| 术语 | 文件名:行 | 实际语义 |
|---|---|---|
| `AgentRun` | `model.py:26` | 一次 AI 执行记录（如"某 workspace 某 task 下跑了一次 claude_code"） |
| `AgentSession` | `model.py:422` | 一个交互式会话（跨多个 AgentRun turn 的 1:N 容器） |
| `AgentMission` | `model.py:540` | 多 agent 协同的聚合根（多个 AgentRun 的父容器） |
| `agent_type` | `model.py:84` | 执行器类型字符串（`"claude_code"`），本质是 adapter ID |
| `provider` | `model.py:85` | LLM 供应商字符串（`"claude"`, `"codex"`） |
| `model` | `model.py:89` | 模型名（如 `"claude-sonnet-4-20250514"`） |

### 1.2 AgentRun 的精确语义

`AgentRun`（`model.py:26-316`）是**执行记录**而非配置实体。它的核心绑定：

- `task_id` → `tasks` 表（`model.py:68-75`）：对 task 的执行
- `lease_id` → `worktree_leases` 表（`model.py:76-82`）：执行所在的工作树租约
- `change_id` → `changes` 表（`model.py:177-184`）：关联的变更
- `agent_session_id` → `agent_sessions` 表（`model.py:207-214`）：所属交互会话
- `mission_id` → `agent_missions` 表（`model.py:281-288`）：所属的 multi-agent 任务
- `agent_type`：字符串 `"claude_code"`（`model.py:84`）—— 无外键、无配置表
- `provider`：字符串（`model.py:85`）—— nullable
- `model`：字符串（`model.py:89`）—— nullable

**关键发现**：`agent_type`、`provider`、`model` 三个配置字段在 AgentRun 中是**内联字符串**，没有对应的配置表。这意味着"智能体配置"在系统里不存在独立实体——每次执行时从 workspace 或调用方参数临时拼凑。

### 1.3 和用户说的"智能体"的异同

| 维度 | 代码中的 agent（AgentRun） | 用户认知的"智能体" |
|---|---|---|
| 是配置还是实例 | 实例（一次执行） | 配置+实例（一个可复用的角色定义） |
| 生命周期 | 一次执行（pending→completed） | 持久存在（可被多次调用） |
| 可复用性 | 不可复用（一次性执行） | 高度可复用（同一个 agent 跑多次） |
| 包含内容 | agent_type + provider + model（3 个字符串） | system_prompt + tool_set + model + provider + 权限 + 行为约束 |
| 绑定关系 | 直接绑 task/lease/workspace | 抽象绑"能干什么"，不直接绑具体任务 |

**结论**：当前系统根本没有"智能体配置"这个概念。`AgentRun` 是执行痕迹（trace），不是被配置的实体。插入中间层需要新增一个"Agent 配置实体"（建议命名为 `AgentProfile` 或 `AgentConfig`）。

---

## 二、daemon 和 workspace 之间的绑定链路

### 2.1 完整调用链（从请求到 daemon 执行）

```
用户请求（前端 POST /api/workspaces/{wsId}/agent/runs）
↓
AgentService.start_run()                    service.py:361-525
  ↓
  (1) 校验 task、lease                       service.py:397-415
  ↓
  (2) 解析 provider/model：
       provider ← caller || workspace.default_agent    service.py:425
       model    ← caller || workspace.default_model    service.py:426
  ↓
  (3) 创建 AgentRun 记录（status=pending）   service.py:440-456
  ↓
  (4) 创建 AgentRunWorkspace M:N 关联       service.py:462-475
  ↓
  (5) RunPlacementService.decide_backend()  placement.py:254-307
       ↓
       _resolve_decide_runtime()            placement.py:1138-1234
         ↓
         MemberBindingResolver
           .resolve_member_binding_or_none()      member_runtimes/resolver.py
           → 读 workspace_member_runtimes 表
           → 取 daemon_id                       member_runtimes/model.py:68-75
         ↓
         _query_daemon_online_by_id()        placement.py:1096-1111
           → SELECT daemon_instances WHERE id=:id AND status='online'
         ↓
         _query_runtime_by_daemon_and_provider()  placement.py:1113-1125
           → SELECT daemon_runtimes WHERE daemon_instance_id=:did AND provider=:provider
         ↓
         返回 runtime dict {id, user_id, provider, status, daemon_instance_id}
  ↓
  (6) dispatch_to_daemon()                  placement.py:313-532
       ↓
       _resolve_dispatch_runtime()          placement.py:949-1067
         （同样解析 member binding → daemon → runtime）
       ↓
       INSERT INTO daemon_task_leases        placement.py:465-483
         (id, agent_run_id, runtime_id, status='pending', kind='interactive', metadata)
       ↓
       INSERT INTO agent_sessions            placement.py:486-503
         (id, user_id, runtime_id, lease_id, provider, status='pending')
       ↓
       UPDATE agent_runs SET agent_session_id = :sid   placement.py:505-508
       ↓
       _send_ws_wakeup()                    placement.py:1311-1368
         → WebSocket 通知 daemon "有新 lease"
  ↓
daemon 侧：
  claim_lease → 读 metadata → 拉 execution-context → start_lease
  → SessionManager.create → Claude SDK query()
```

### 2.2 绑定链路的多层结构

```
Workspace (workspaces 表)
  └── WorkspaceMemberRuntime (workspace_member_runtimes 表)  ← 每成员每工作区一行
        ├─ daemon_id → DaemonInstance (daemon_instances 表)  ← 守护进程实体
        │    └── DaemonRuntime (daemon_runtimes 表)           ← provider 运行时
        │         ├─ provider = "claude"  → Claude API
        │         ├─ provider = "codex"   → Codex API
        │         └─ ...
        ├─ runtime_id → DaemonRuntime (已退化，保持兼容)
        ├─ root_path: 成员本地项目路径
        └─ shared: bool — 是否允许借用（业务/管理人员借用开发人员的 daemon）
  └── default_agent: str      ← 工作区默认 provider（如 "claude"，workspace 级兜底）
  └── default_model: str      ← 工作区默认模型
```

### 2.3 当前"选 daemon"逻辑（placement.py）

路由决策入口 `_resolve_dispatch_runtime()`（`placement.py:949-1067`）：

```
Step 0: workspace_id is None → 直接抛 NoOnlineDaemonError

Step 1: 查 WorkspaceMemberRuntime
  - 有 binding:
    → binding.daemon_id is None → 抛 "未绑定守护进程，请重绑"
    → daemon_id 有值:
      → 校验 daemon 在线 + 属于 user
        → daemon 离线 → 借用兜底（business borrow）
        → daemon 在线:
          → 按 provider 匹配 DaemonRuntime
            → 匹配到 → 返回 runtime dict
            → 未匹配 → 抛 "daemon 已启用 {enabled}，未启用 {provider}"
  - 无 binding:
    → 借用兜底
    → 兜底也失败 → 抛 "工作区未绑定守护进程"
```

**关键观察**：当前 "选 daemon" 逻辑完全基于 `provider` 字符串 + `daemon_id`。选择的是"哪台机器上的哪个运行时（claude/codex）"，而不是"哪个 agent 配置"。

---

## 三、插入"agent 配置实体"中间层的改动范围

### 3.1 需要新增的表

```sql
-- 提案表名（建议 AgentProfile，避免和 AgentRun/AgentSession 混淆）
CREATE TABLE agent_profiles (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,            -- 用户可读名称，如 "默认编码助手"
    description TEXT,
    agent_type VARCHAR(30) NOT NULL,       -- "claude_code" | "codex" | ...
    provider VARCHAR(64) NOT NULL,         -- "claude" | "codex" | ...
    model VARCHAR(128),                    -- 默认模型
    system_prompt TEXT,                    -- 系统提示词
    tool_policy_id UUID REFERENCES tool_policies(id),
    config JSON,                           -- 扩展配置（temperature, max_tokens, ...）
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX ix_agent_profiles_workspace ON agent_profiles(workspace_id);
```

### 3.2 需要修改的现有表/模型

| 表名 | 文件:行 | 当前字段 | 改动 |
|---|---|---|---|
| `agent_runs` | `model.py:84-92` | `agent_type VARCHAR(30)`, `provider VARCHAR(64)`, `model VARCHAR(128)` | 新增 `agent_profile_id UUID FK→agent_profiles(id)`；保留旧字段兼容 |
| `agent_sessions` | `model.py:492-493` | `provider VARCHAR(30)` | 新增 `agent_profile_id UUID FK` |
| `agent_missions` | `model.py:596-599` | `main_agent_config JSON`, `worker_preset JSON` | worker_preset 条目新增 `agent_profile_id` 替代 inline agent_type |
| `workspaces` | 需确认 | `default_agent VARCHAR`, `default_model VARCHAR` | 新增 `default_agent_profile_id UUID FK` |
| `workspace_member_runtimes` | `model.py:21` | 无 | 可选新增 `agent_profile_id`（成员级 agent 配置覆盖） |

### 3.3 需要修改的 API / 路由

| API | 当前参数 | 改动 |
|---|---|---|
| `POST /api/workspaces/{wsId}/agent/runs` | `agent_type`, `provider`, `model` | 新增 `agent_profile_id`（二选一：传 profile_id 或 inline 三个字段） |
| `POST /api/workspaces/{wsId}/missions` | `main_agent_config`, `worker_preset[]` | worker_preset 条目新增 `agent_profile_id` |
| `GET /api/agent/runs/{id}` | - | 响应新增 `agent_profile_id` 和 `agent_profile: {name, ...}` |
| `POST /api/workspaces/{wsId}/agent-profiles` | 新增 | CRUD agent 配置 |
| `GET /api/workspaces/{wsId}/agent-profiles` | 新增 | 列出可用 agent |
| `PUT /api/workspaces/config` | `default_agent`, `default_model` | 新增 `default_agent_profile_id` |

### 3.4 需要修改的后端服务模块

| 文件 | 函数/位置 | 改动 |
|---|---|---|
| `service.py:361-525` | `start_run()` | 解析 agent_profile_id → 读 provider/model/agent_type |
| `service.py:1023-1229` | `start_stage_dispatch()` | 同上 |
| `service.py:1277-1540` | `start_scan_dispatch()` | 同上 |
| `placement.py:949-1067` | `_resolve_dispatch_runtime()` | provider 解析来源从 workspace.default_agent 改为 agent_profile.provider |
| `execution.py:145-268` | `dispatch_worker()` | worker dispatch 读 agent_profile 配置 |
| `execution.py:74-94` | `worker_tool_config()` | tool_config 从 agent_profile.tool_policy 派生 |
| `finalizer.py:77-100` | `FinalizerService.__init__()` | 收敛时读 agent_profile 配置 |
| `context_builder.py` | `build_spec_bundle()` | prompt 构造时可注入 agent_profile.system_prompt |

---

## 四、命名冲突分析

### 4.1 现存 "Agent" 前缀模型一览

```
AgentRun           — 一次执行记录
AgentRunLog        — 执行日志行
AgentSession       — 交互会话
AgentMission       — 多 agent 协同任务
AgentArtifact      — worker 产出物
AgentRunDependency — worker 间依赖关系
AgentRunWorkspace  — run↔workspace M:N
```

### 4.2 冲突评估

| 候选名称 | 冲突程度 | 分析 |
|---|---|---|
| `Agent` | **高** | 和 bus 词汇完全重叠，Python `agent` 模块名已使用，会导致 import 歧义 |
| `AgentConfig` | **中** | 清晰但和 AgentRun/AgentSession 的 config JSON 字段混淆 |
| `AgentProfile` | **低** | 不与现有表名冲突，语义明确（"一个智能体的配置档案"） |
| `AgentBlueprint` | **低** | 同 AgentProfile |
| `AgentTemplate` | **低** | 适合场景：工作区有预设模板供成员一键创建 agent |

### 4.3 推荐命名方案

- **实体名**：`AgentProfile`（用户视角：一个可复用、可命名的 AI 助手配置）
- **表名**：`agent_profiles`
- **Python 类**：`AgentProfile`（`app.modules.agent.profile_model.py`）
- **路由前缀**：`/api/workspaces/{id}/agent-profiles`
- **前端接口**：`AgentProfile`（`frontend/src/lib/agent-profile.ts`）

与现有 AgentRun 的区分：
- `AgentProfile` = "模板/配置"（WHAT）
- `AgentRun` = "一次执行"（WHEN）
- `AgentSession` = "交互通道"（HOW）

---

## 五、dispatch_worker 和 placement 策略改造分析

### 5.1 当前逻辑（placement.py）

当前 `_resolve_dispatch_runtime()`（`placement.py:949-1067`）的决策链：

```
输入: (workspace_id, user_id, provider)
输出: runtime dict {id, user_id, provider, status, daemon_instance_id}

决策维度：
  1. 哪个成员（workspace_id + user_id → WorkspaceMemberRuntime）
  2. 哪个 daemon（binding.daemon_id → daemon_instances）
  3. 哪个 provider runtime（daemon + provider → daemon_runtimes）
```

"选 agent" 这一步不存在——`agent_type` 在 `dispatch_to_daemon()` 被写入 lease.metadata（`placement.py:386-429`），但**不作为路由决策依据**。

### 5.2 改造后逻辑（target）

```
输入: (workspace_id, user_id, agent_profile_id)
输出: runtime dict

新增决策维度：
  0. 哪个 agent 配置（agent_profile_id → AgentProfile 行）
     → 包含: agent_type, provider, model, system_prompt, tool_policy_id
  
  1. agent_profile.provider 决定要匹配什么 provider
  2. agent_profile.agent_type 决定 daemon 上需要什么样的 adapter
  
  后续不变：
  3. 按 member binding 找 daemon
  4. 按 provider 在 daemon 上找 runtime
```

### 5.3 具体改造点（文件:行 + 伪 diff）

**placement.py:949-1067 — `_resolve_dispatch_runtime()`**

```diff
- async def _resolve_dispatch_runtime(self, *, workspace_id, user_id, provider):
+ async def _resolve_dispatch_runtime(self, *, workspace_id, user_id, provider, agent_profile_id=None):
+     # 新增 Step 0：如果传了 agent_profile_id，读 AgentProfile 行
+     if agent_profile_id is not None:
+         profile = await self._session.get(AgentProfile, agent_profile_id)
+         if profile is None:
+             raise AgentRunError(f"AgentProfile {agent_profile_id} not found")
+         # provider 从 agent profile 权威取（盖过 caller override）
+         provider = profile.provider
+         agent_type = profile.agent_type
+     # 后续解析逻辑不变...
```

**placement.py:313-532 — `dispatch_to_daemon()`**

```diff
  async def dispatch_to_daemon(self, agent_run_id, user_id, *, ...):
+     # 如果调用方传了 agent_profile_id，读配置填入 metadata
+     if agent_profile_id:
+         profile = await self._session.get(AgentProfile, agent_profile_id)
+         metadata["agent_profile_id"] = str(agent_profile_id)
+         metadata["system_prompt"] = profile.system_prompt
+         metadata["tool_policy_id"] = str(profile.tool_policy_id) if profile.tool_policy_id else None
```

**execution.py:145-268 — `MissionExecutionService.dispatch_worker()`**

当前 `dispatch_worker()` 从 `run.role` 决定 `read_only` 和 tool_config（`execution.py:74-94`）。改造后：

```diff
  async def dispatch_worker(self, run, *, workspace_id, user_id, read_only):
+     # 如果 run 有关联的 agent_profile_id，读 agent_profile
+     # tool_config 从 agent_profile.tool_policy 派生而非硬编码
+     if run.agent_profile_id:
+         profile = await self._session.get(AgentProfile, run.agent_profile_id)
+         tool_config = profile.derive_tool_config(read_only)
```

**execution.py:74-94 — `worker_tool_config()`**

当前是硬编码白名单（`execution.py:84-94`）。改造后应变为：

```diff
- def worker_tool_config(read_only: bool) -> dict[str, object]:
-     if read_only:
-         return {"mode": "plan", "allowed_tools": ["Read", "Glob", "Grep"], "max_turns": 25}
-     return {"mode": "acceptEdits", "allowed_tools": [...], "max_turns": 30}
+ def worker_tool_config(read_only: bool, profile: AgentProfile | None = None) -> dict:
+     if profile and profile.tool_policy:
+         return profile.tool_policy.to_config(read_only)
+     # fallback to hardcoded defaults
```

### 5.4 daemon 侧影响

daemon 当前从 lease metadata 中读取 provider/model（`types.ts:278-285 LeaseCtx.provider/model`）。如果 system_prompt 和 tool_policy 被写入 lease metadata，daemon 侧也需要消费：

- `types.ts:252-388` — `LeaseCtx` 需新增可选字段：
  ```typescript
  agentProfileId?: string;
  systemPrompt?: string;    // 额外的 system prompt（追加到 CLAUDE.md 之后）
  ```

- `daemon.ts`（未读取，但根据 types.ts 推断）— `SessionManager.create()` 需要能注入额外的 system prompt。

---

## 六、前端影响范围

### 6.1 直接受影响的文件

| 文件 | 行 | 影响 |
|---|---|---|
| `frontend/src/lib/agent.ts:10-52` | `AgentRun` interface | 新增 `agent_profile_id` 字段 |
| `frontend/src/lib/agent.ts:83-92` | `CreateAgentRunInput` | 新增 `agent_profile_id`，`agent_type`/`provider`/`model` 变为可选 |
| `frontend/src/lib/agent.ts:225-271` | `Mission` / `WorkerPresetItem` / `MainAgentConfig` | 都要支持 `agent_profile_id` 引用 |
| `frontend/src/lib/agent.ts:288` | `createMission()` | 入参变 |

### 6.2 受影响最大的页面/组件

| 页面/组件 | 改动说明 |
|---|---|
| **Agent 运行创建页**（Run creation dialog） | 从"选 provider + 填 model"变为"选 agent profile"（下拉列表） |
| **Mission 创建页** | 从"填 agent_type + model"变为"选 agent profile" |
| **Workspace 设置页** | 新增"Agent 配置管理"tab（CRUD agent profiles） |
| **Agent Run 详情页** | 展示当前 run 使用的 agent profile 名称和配置 |
| **Agent Session 面板** | 展示 session 关联的 agent profile |
| **Agent 团队页**（Mission 列表/详情） | worker 展示从 "role: arch" 变为 "agent: 默认编码助手 (role: arch)" |

### 6.3 前端需要新增的 API 调用文件

```
frontend/src/lib/agent-profile.ts（新建）
  - listAgentProfiles(workspaceId)
  - createAgentProfile(workspaceId, input)
  - updateAgentProfile(profileId, input)
  - deleteAgentProfile(profileId)
```

---

## 七、风险与建议

### 7.1 高风险点

1. **`AgentRun` 的 `agent_type`/`provider`/`model` 三字段不能直接删除**
   - 原因：历史 run 数据无 agent_profile 外键，去列会导致历史数据不可读
   - 建议：新增 `agent_profile_id` 列，保留旧三列，AgentProfile 创建时同步写入

2. **`AgentSession` 的 provider 是 NOT NULL**
   - `model.py:492`: `provider VARCHAR(30) NOT NULL`
   - 引入 AgentProfile 后，create_session 路径需要从 profile 读 provider
   - 影响：`placement.py:486-503`（AgentSession INSERT）、`service.py:1413-1426`、daemon session 模块

3. **借用（borrow）路径的 provider 解析**
   - `placement.py:1006-1016`：无 binding 时 borrow，provider 走 `_resolve_borrowed_or_own_runtime` → 这个 helper 内部也需要支持 agent_profile
   - 风险：borrow 场景 provider 匹配失败会静默降级，引入 agent_profile 后更复杂

### 7.2 中风险点

4. **Mission worker_preset 和 AgentProfile 的关系**
   - `model.py:587-592`：`worker_preset` 是 `list[dict]` JSON，每条含 `{agent_type, model, objective, role}`
   - 如果 agent_type 改为 agent_profile_id，前端必须保证 profile 存在
   - 建议：worker_preset 新增 `agent_profile_id` 可选字段，fallback 到 inline agent_type

5. **daemon 的 LeaseCtx 类型膨胀**
   - `types.ts:252-388` 已有 20+ 可选字段，新增 `systemPrompt`/`agentProfileId` 增加复杂度
   - 建议：将 agent 配置相关字段收进子对象 `agent_profile: {id, system_prompt, tool_policy}`

### 7.3 低风险点

6. **前端向后兼容**
   - 当前 `CreateAgentRunInput` 不传 agent_profile_id 时应与旧路径完全一致
   - 建议：AgentService 侧做 fallback：有 profile_id 读 profile；无则用旧三字段

7. **命名一致性**
   - 确保整个栈（backend model → API schema → frontend interface → daemon type）使用统一名称
   - 建议：全栈统一 `agent_profile_id` / `AgentProfile` / `agent_profiles`

---

## 八、结构化摘要

### 发现

1. 当前系统**没有"agent 配置"实体**——`agent_type`、`provider`、`model` 是内联字符串，散落在 AgentRun、AgentSession、Workspace 等多个表中。
2. 绑定链路是 `Workspace → WorkspaceMemberRuntime → DaemonInstance → DaemonRuntime`，由 `placement.py:_resolve_dispatch_runtime()` 统一路由。
3. `AgentRun` 是执行痕迹（一次 run），不是可复用的配置——用户认知中的"智能体"在代码里没有对应实体。
4. 插入中间层的核心改动点是 `placement.py`（路由决策）、`service.py`（run 创建）、`model.py`（多个表加 FK），以及前端所有 agent 相关页面。

### 结论

- 插入"agent 配置实体"中间层在**架构上是合理的**（填充了当前缺失的配置层），但改动面较广
- 最大风险在于 **provider 解析链的变化**——当前 4 条 dispatch 路径（start_run、start_stage_dispatch、start_scan_dispatch、dispatch_worker）都需要改造 provider 解析逻辑
- **不建议一次性删除**旧的 `agent_type`/`provider`/`model` 列——需要双写过渡期（新 run 同时写 agent_profile_id 和旧三列）
- 推荐实体名 `AgentProfile`（避免与 AgentRun/AgentSession 混淆）

### 产出文件路径

- `.claude/worktrees/agent-middleware-impact-report.md`（本报告）

### 风险

| 等级 | 风险项 | 涉及文件 |
|---|---|---|
| 高 | agent_type/provider/model 列删除导致历史数据不可读 | `model.py:84-92` |
| 高 | borrow 路径 provider 解析更复杂 | `placement.py:1006-1016` |
| 中 | worker_preset JSON schema 变更需前后端同步 | `model.py:587`, `agent.ts:255-260` |
| 中 | daemon LeaseCtx 类型膨胀 | `types.ts:252-388` |
| 低 | 前端向后兼容（不传 profile_id 时的 fallback） | `agent.ts:83-92` |
