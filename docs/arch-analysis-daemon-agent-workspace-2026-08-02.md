# 架构分析：daemon → agent → workspace 三层方案

> 分析日期：2026-08-02
> 分析人：architect
> 请求：分析 "daemon → agent → workspace" 三层架构方案的可行性与取舍
> 性质：架构评审报告，非变更规格

---

## 1. 当前架构事实：daemon → workspace 直接绑定

### 1.1 实际数据流（基于代码，非假设）

```
User triggers action (scan/stage/task/chat)
    ↓
backend: AgentRun created
    ↓
backend: placement._resolve_dispatch_runtime()
    ├── reads WorkspaceMemberRuntime(workspace_id, user_id)
    │   ├── daemon_id → DaemonInstance（hostname, os, arch, allowed_roots, status）
    │   └── root_path（用户在宿主机的项目路径）
    ├── checks DaemonInstance.status == "online"
    ├── finds DaemonRuntime（provider = claude | codex | ...）matching target
    └── returns runtime_id for lease creation
    ↓
backend: creates DaemonTaskLease(runtime_id, agent_run_id, kind, metadata)
    ↓
backend: dispatch_to_daemon → WebSocket TASK_AVAILABLE → daemon
    ↓
sillyhub-daemon:
    ├── claimLease → startLease / _startInteractiveSession
    ├── build_claim_payload: cwd = root_path（宿主机路径，优先真实代码目录）
    ├── kind=batch: TaskRunner.runLease(ctx) → spawn agent CLI → collectDiff → completeLease
    └── kind=interactive: SessionManager.create → ClaudeSdkDriver/CodexDriver → onTurnMessage → onTurnResult
```

**关键文件依据**：

| 文件 | 行号 | 关键事实 |
|---|---|---|
| `daemon.ts` | 832-863 | daemon 探测 agent → 单次 register 上报所有 provider |
| `daemon.ts` | 1000-1067 | `_registerDaemon`：per-daemon 注册，backend 返回 per-runtime runtime_id |
| `daemon.ts` | 3292-3569 | `_runLeaseStateMachine`：claim→start→execute(或 interactive)→complete |
| `placement.py` | 949-1000 | `_resolve_dispatch_runtime`：从 WorkspaceMemberRuntime 读 daemon_id → 找 online runtime |
| `member_runtimes/model.py` | 21-119 | `WorkspaceMemberRuntime`：per-member daemon binding（workspace_id, user_id, daemon_id, root_path） |
| `daemon/model.py` | 25-112 | `DaemonInstance`：物理守护进程实体，machine-level 字段 |
| `daemon/model.py` | 114-197 | `DaemonRuntime`：daemon 下的 provider 实体（退化为从属清单） |
| `agent/model.py` | 26-297 | `AgentRun`：单次 agent 执行（含 provider/model/tool_policy_id 等配置字段） |

### 1.2 当前架构的优点

**A1. 简单直接，链路清晰。**
- dispatch 三步走：查 binding → 找 daemon → 找 runtime → 发 lease。没有多余中间层，排查问题能快速定位。
- daemon 是纯执行器：不存业务配置，不管理"谁是谁"，只管接受 lease 并执行。这符合单一职责。

**A2. Per-member daemon binding 已经很好解决了多人协作问题。**
- `WorkspaceMemberRuntime`（2026-07-02-workspace-config-flow）让每个成员绑定自己的 daemon + 本地路径，解决了"不同人不同机器"的异构问题。
- 借用机制（`DaemonBorrowAudit` + `BORROW_SANDBOX_MARKER`）让业务人员可以借开发人员的 daemon 跑只读分析。

**A3. Provider 概念已经是 LLM 的解耦层。**
- `DaemonRuntime.provider`（claude/codex/copilot/...）区分了不同 LLM 供应商。
- `AgentRun.agent_type` + `AgentRun.provider` + `AgentRun.model` 在 run 级记录了具体用了哪个模型。
- `AgentRun.tool_policy_id` 已有关联工具策略的能力。
- MCP tool 注入：daemon 端 `session-manager.ts` 为主 agent（stage='orchestrator'）注入 MCP server 5 tool。

**A4. 配置已经在 lease payload 级别流转。**
- `LeaseCtx.toolConfig` / `LeaseCtx.provider_config` / `LeaseCtx.model` 等字段在 claim→start→execute 全链路透传。
- `buildSpawnEnv` 第 0 层消费 `provider_config` 注入 ANTHROPIC_* 环境变量。
- `applyClaudeSettings` 把 `settings_config` 写进 `$CLAUDE_CONFIG_DIR/settings.json`。

### 1.3 当前架构的缺点

**D1. 没有可复用的"智能体配置"实体。**
- 每次派发任务时，LLM model、tool policy、system prompt 等都是临时拼装的（在 `build_claim_payload` 中按 lease 组装的 metadata）。
- 用户无法"创建一个 agent 配置，然后在多个场景复用"——每次都要重新指定参数。

**D2. Agent 配置和 workspace 绑定死。**
- dispatch 入口是 workspace → member binding → daemon。如果用户想让同一个 daemon 上的 agent 以不同配置服务不同 workspace，当前只能靠 lease 级的参数透传（每次都要带全）。
- 没有"workspace A 用 agent 配置 X（Claude Opus + 安全工具策略），workspace B 用 agent 配置 Y（Claude Sonnet + 快速工具策略）"的机制——除非每次 dispatch 手动指定。

**D3. Skill/MCP tool 管理是 daemon 级别的，不够灵活。**
- `syncSkills` 把平台 skills 同步到 ~/.sillyhub/daemon/skills/，`linkSkillsToWorkdir` 拷到 cwd/.claude/skills/。所有 workspace、所有 agent 共用同一套 skills。
- MCP tool 注入当前只有硬编码的 daemon MCP server 5 tool（仅 orchestrator stage），通用 MCP tool 配置没有持久化入口。

**D4. 借用场景的配置隔离不完整。**
- 借用只做了文件系统沙箱隔离（`borrow-sandboxes/`），没有做 LLM provider 级别的隔离（借用人用的是 lender 的 API key）。
- 虽然 task-09 有 provider_config 透传，但当前借用路径不强制切换 provider/api_key。

---

## 2. 用户提案：三层架构（daemon → agent → workspace）

### 2.1 提案核心

```
daemon（Node 进程，物理执行器）
  └── 1:N agent（智能体配置 + 运行时，中间抽象层）
        └── N:M workspace（工作区，通过 agent 访问 daemon 能力）

约束：
- workspace 不能直接使用 daemon，必须通过 agent
- agent 可独立配置 LLM provider、MCP tool、skill
```

### 2.2 这个方向是否合理？

**部分合理，但需要澄清"agent"到底是什么。**

合理之处：
1. **可复用的 agent 配置实体**这个需求是真实存在的（见 D1/D2）。当前每次 dispatch 都要拼装所有参数，有了 agent 配置实体后可以"选 agent → 发任务"。
2. **agent 级 LLM/tool/skill 配置**让不同场景（快速 chat vs 深度 scan vs 代码生成）用不同配置成为可能，不必每次手动传参。
3. **N:M agent-workspace 关系**让同一个 agent 配置可以跨 workspace 复用（如"代码审查 agent"在所有 workspace 都用同一套 prompt + tool）。

不合理/不清晰之处：
1. **"workspace 不能直接使用 daemon"这个约束在当前架构下是过度设计。** 当前 daemon 本身不感知 workspace（workspace 只存在于 backend 的 binding 表和 lease metadata 中），daemon 只是接受 lease 执行。中间再加一层 agent 拦在 workspace 和 daemon 之间，实际上是 backend dispatch 层的改动，而非 daemon 侧改动。
2. **"daemon 1:N agent"这个关系的物理含义不清晰。** 如果 agent 是配置实体（profile），那 daemon 不需要"1:N"——daemon 只是执行引擎，agent 是 backend 侧的配置。如果 agent 是运行时实例（类似 AgentSession 的长生命周期），那才需要 daemon 管理 N 个 agent 实例的生命周期。

### 2.3 解决了什么问题？

| 问题 | 当前状态 | 三层方案如何解决 |
|---|---|---|
| 无法复用 agent 配置 | lease 级临时拼装 | agent 作为持久化配置实体 |
| 不同 workspace 不同 agent 配置 | 靠 dispatch 参数 | agent 绑定到 workspace |
| LLM provider/tool 无法独立配置 | 散落在各处（run/lease/session） | agent 统一管理 |
| 借用场景配置隔离弱 | 共享 lender 的 daemon+key | agent 级隔离 provider/api_key |

### 2.4 引入了什么新问题？

| 新问题 | 严重度 | 说明 |
|---|---|---|
| **dispatch 复杂度上升** | 🟠 中 | 当前 dispatch 是 workspace→binding→daemon→runtime，引入 agent 后变成 workspace→agent→binding→daemon→runtime，多一次 JOIN/查表 |
| **agent 生命周期管理** | 🟠 中 | 如果 agent 是运行时实例，需要 start/stop/health check/recovery 等全套生命周期，和现有 AgentSession 概念重叠 |
| **N:M 关系的权限模型** | 🟡 低-中 | agent 跨 workspace 共享时，谁有权使用？借用/授权怎么和现有 per-member binding 共存？ |
| **数据迁移成本** | 🟠 中 | 现有 AgentRun/AgentSession/AgentMission 等表需要加 agent_id 外键，旧数据需要回填或给默认值 |
| **概念膨胀** | 🟡 低 | 项目已经有 AgentRun/AgentSession/AgentMission/DaemonRuntime/WorkspaceMemberRuntime 五个相关概念，再加一个"Agent"容易让新人困惑 |
| **ROADMAP 优先级冲突** | 🔴 高 | 当前 ROADMAP 有 P0 级正确性 bug（kill 僵尸、cancel 僵尸）和 P1 级高杠杆项（只读 team），三层架构是大工程，会挤占这些更紧迫的事项 |

---

## 3. "agent"到底应该是什么？

这是整个提案最核心的问题。有三种可能的定位：

### 方案 A：Agent = 配置实体（"Agent Profile"）

```
AgentProfile {
  id: UUID
  owner_user_id: UUID        // 谁创建的
  name: string               // "代码审查助手" / "快速扫描" / "深度重构"
  provider: string           // claude | codex
  model: string              // claude-sonnet-4-20250514 | ...
  system_prompt: string      // 系统提示词
  tool_policy_id: UUID|null  // 工具策略
  mcp_servers: JSON          // MCP server 配置列表
  skills: JSON               // 启用的 skill 列表
  default_params: JSON       // temperature/max_tokens 等
}
```

- **性质**：纯数据，存储在 backend DB 中。类似"运行时 profile"或"agent 模板"。
- **和 daemon 的关系**：无直接关系。dispatch 时 backend 按 agent profile 组装 lease payload，daemon 无感知。
- **和 workspace 的关系**：N:M。一个 agent profile 可以关联多个 workspace（"这个 workspace 可用这些 agent"），一个 workspace 可以有多个 agent profile。
- **优点**：实现成本最低，不改变 daemon 代码，不引入新的运行时概念。
- **缺点**：无法表达"agent 实例的状态"（如正在运行的 agent 会话）。

### 方案 B：Agent = 运行时实例（"Agent Instance"）

```
AgentInstance {
  id: UUID
  profile_id: UUID           // 引用 AgentProfile
  daemon_instance_id: UUID   // 运行在哪个 daemon 上
  status: string             // online | offline | busy
  session_id: UUID|null      // 关联的 AgentSession（如果正在执行）
  ...
}
```

- **性质**：有生命周期的运行时实体，绑定到特定 daemon。
- **和 daemon 的关系**：1:N。daemon 管理和监控其下的 agent 实例。
- **和 workspace 的关系**：N:M。workspace 通过 agent 实例获得执行能力。
- **优点**：可以独立启停、监控、限流、计费。
- **缺点**：和现有 AgentSession 概念高度重叠（AgentSession 已经是"一个 agent 实例的交互会话"）。引入 AgentInstance 会导致概念重复。

### 方案 C：Agent = AgentRun 的配置源（推荐起步方案）

**不新建"Agent"实体，而是增强现有 AgentRun 的配置能力。**

```
现有 AgentRun 已有字段：
- provider（已存在）
- model（已存在）
- tool_policy_id（已存在）
- spec_strategy（已存在）

建议新增/增强：
- AgentRun.agent_profile_id: UUID|null  → 指向一个可复用的 AgentProfile 模板
- AgentProfile 表：存储可复用的配置组合（provider + model + system_prompt + tools + skills + mcp_servers）
- dispatch 时：如果 run 指定了 agent_profile_id → 加载 profile 填充默认值 → 仍允许 run 级覆盖
```

- **性质**：最小改动，向后兼容。agent profile 是"默认配置模板"，不是新的运行时概念。
- **优先级**：可以分两个 Phase 做：
  - Phase 1（低投入）：加 `AgentProfile` 表 + CRUD API，前端让用户创建/管理 agent 配置，dispatch 时可选指定 profile。
  - Phase 2（中投入）：agent 执行实例化（观察 Phase 1 使用情况后再决定是否需要）。

---

## 4. 权限隔离和 per-member daemon binding 共存

### 4.1 当前权限模型

```
Workspace
  └── WorkspaceMember (user_id, role: owner|developer|viewer)
        └── WorkspaceMemberRuntime (workspace_id, user_id, daemon_id, root_path, shared)
              └── DaemonInstance (user_id) → DaemonRuntime (provider)
```

- 每个人用自己的 daemon（per-member binding）。
- `shared=true` 允许其他人借用（业务人员借用开发人员的 daemon 做只读分析）。

### 4.2 引入 agent 后的权限模型设计

如果 agent 是配置实体（方案 A），权限隔离比较简单：

```
AgentProfile {
  owner_user_id: UUID     // 谁创建的
  visibility: enum        // private | workspace | platform
  workspace_id: UUID|null // workspace 级共享时指定
}

规则：
1. private agent：只有 owner 可见/可用
2. workspace agent：workspace 内所有 member 可见/可用
3. platform agent：跨 workspace 可用（平台预置 agent）
4. 借用场景：借用人使用自己的 agent profile + 借用 lender 的 daemon 执行
5. agent profile 中的 provider/api_key 按 user 隔离（每个 user 用自己的 API key）
```

**和 per-member daemon binding 共存的规则**：

```
dispatch 决策链：
  workspace → agent profile（选配置）
           → member binding（选 daemon）
           → daemon runtime（选 provider runtime）
           → lease

即：agent profile 决定"用什么配置跑"，member binding 决定"在谁的 daemon 上跑"。
两者是正交维度，不冲突。
```

### 4.3 借用场景的特殊处理

```
当前借用流程：
  借用人 → 选 workspace → 发任务 → backend 找 lender 的 daemon → 创建沙箱 → 执行

引入 agent 后：
  借用人 → 选 workspace → 选 agent profile（或使用默认）→ backend：
    1. agent profile 提供 provider/model/tools/skills 配置
    2. member binding 解析 → 发现借用人无自有 daemon → fallback 到共享 daemon（lender）
    3. provider_config 使用 agent profile 的配置（或借用人的 API key，而非 lender 的）
    4. 沙箱隔离照旧
```

关键改进：agent profile 让借用人可以用自己的 API key + model 偏好，而不是被迫用 lender 的配置。

---

## 5. Provider / MCP / Skill 配置作用域设计

### 5.1 推荐的分层配置模型

```
┌─────────────────────────────────────────────────────┐
│ Platform 级默认（backend config / env）               │
│   default_provider = "claude"                        │
│   default_model = "claude-sonnet-4-20250514"         │
│   platform_mcp_servers = [...]                       │
│   platform_skills = [sillyspec, ...]                 │
├─────────────────────────────────────────────────────┤
│ AgentProfile 级（用户创建的可复用配置）                 │
│   provider, model, system_prompt                     │
│   tool_policy_id（指向 tool_policies 表）              │
│   mcp_servers: [{name, command, args, env}]          │
│   skills: ["sillyspec", "custom-skill-1"]            │
│   params: {temperature, max_tokens, ...}             │
├─────────────────────────────────────────────────────┤
│ AgentRun 级（单次执行的覆盖/追加）                      │
│   可覆盖：model, params, prompt                       │
│   可追加：额外的 mcp_servers, skills                    │
│   不可覆盖：provider（由 agent profile 决定）            │
├─────────────────────────────────────────────────────┤
│ Daemon 级（执行环境限制）                              │
│   allowed_roots（文件系统沙箱）                         │
│   credential（API key）                               │
│   本地 skills 实际可用列表                              │
└─────────────────────────────────────────────────────┘
```

### 5.2 各配置项的具体设计

| 配置项 | 定义层 | 作用 | 和现有机制的关系 |
|---|---|---|---|
| **provider** | AgentProfile | 选择 LLM 供应商 | 替代 dispatch 时传 provider 参数，对应 DaemonRuntime.provider |
| **model** | AgentProfile | 选择模型 | 已存在于 AgentRun.model，可被 run 级覆盖 |
| **system_prompt** | AgentProfile | 系统提示词 | 新字段，当前在 lease payload 中临时拼接 |
| **tool_policy** | AgentProfile | 工具使用策略 | 对应现有 AgentRun.tool_policy_id（已存在但未充分使用） |
| **MCP servers** | AgentProfile | 外部工具服务 | 新能力。daemon 端已有 stdin MCP server（orchestrator），扩展到通用 MCP client |
| **skills** | AgentProfile | 启用的技能 | 对应现有 syncSkills + linkSkillsToWorkdir，但现在是"选哪些"而非"全部" |
| **API key** | Daemon/user 级 | 实际的认证凭证 | 保持现状（credentials.json），不进入 agent profile（安全原因） |

### 5.3 MCP tool 配置的落地方案

当前 daemon 已有 MCP 基础设施：
- stdin MCP server：`daemon.ts` 内置，仅 orchestrator stage 注入 5 tool
- MCP client：存在于 driver 层（Claude SDK 支持 MCP）

扩展到通用 MCP 的路径：
1. `AgentProfile.mcp_servers`：存储 server 定义列表
2. dispatch 时，backend 把 mcp_servers 放入 lease metadata
3. daemon `_startInteractiveSession` / `_runLeaseStateMachine` 解析 mcp_servers，注入到 SDK driver 的 MCP 配置
4. 权限边界：mcp_servers 只允许 stdio 类型（command + args），不允许 HTTP/SSE 类型（防 SSRF）

---

## 6. 结论与建议

### 6.1 方向判断

**方向对，但范围需要大幅收敛。**

用户提出的"agent 抽象"解决了一个真实痛点——缺少可复用的 agent 配置。但**不应该引入新的运行时实例概念**（那会与现有 AgentSession 重叠），也不应该改变 daemon 的职责（daemon 应该保持纯执行器角色）。

### 6.2 推荐方案

**采用方案 C：以 AgentProfile（配置模板）作为起步，不分叉为新的运行时概念。**

具体步骤：

1. **Phase 0（P0 前置，必须先做）**：修两个僵尸 bug（P0-1 interactive kill、P0-2 cancel 造僵尸）。这些是正确性 bug，阻断任何新功能的端到端验证。

2. **Phase 1（低投入，1-2 天）**：新增 `AgentProfile` 表 + CRUD API。
   - 新建表：`agent_profiles(id, owner_user_id, workspace_id|null, name, provider, model, system_prompt, tool_policy_id, mcp_servers, skills, params, visibility)`
   - 前端：agent 配置管理页（创建/编辑/删除/列表）
   - AgentRun 加 `agent_profile_id` 外键（nullable，向后兼容）
   - dispatch 时如果指定了 agent_profile_id，加载 profile 填充默认值

3. **Phase 2（中投入，3-5 天）**：打通配置链路。
   - MCP server 配置从 profile → lease → daemon 的透传
   - Skill 筛选：daemon 端按 profile.skills 选择性 link（而非全量 linkSkillsToWorkdir）
   - 借用场景：借用人可以用自己的 agent profile + lender daemon 执行

4. **Phase 3（观望，视反馈决定）**：如果 agent profile 使用频繁，再考虑：
   - Agent 执行历史/统计
   - Agent 级别的用量配额
   - Agent 模板市场（平台级共享）

### 6.3 优先级

| 优先级 | 事项 | 理由 |
|---|---|---|
| 🔴 P0 | 修 P0-1/P0-2 僵尸 bug | 正确性基础，所有新功能依赖 kill 链路有效 |
| 🟢 P1 | 只读 team mission 用起来 | ROADMAP 既定，低投入高回报 |
| 🟡 P2-1 | AgentProfile 表 + CRUD | 本次分析的核心建议，低风险 |
| 🟡 P2-2 | 打通 MCP/Skill 透传 | 让 agent profile 真正有差异化价值 |
| 🟠 P3 | agent 共享/借用/配额 | 视使用情况决定 |

### 6.4 不应该做的事

1. **不要新建"AgentInstance"运行时表**——和 AgentSession 概念重叠，徒增复杂度。
2. **不要改变 daemon 的纯执行器定位**——daemon 不需要感知 agent 概念，所有配置由 lease payload 透传即可。
3. **不要在 daemon 侧建 agent 生命周期管理**——那是 backend 的职责。daemon 只管理"收到 lease → 执行 → 回传结果"。
4. **不要把 agent 做成 daemon 和 workspace 之间的"强制网关"**——当前 member binding 已经足够好，agent profile 应该是"可选增强"，不是"必经之路"。

### 6.5 风险提示

| 风险 | 缓解措施 |
|---|---|
| AgentProfile 表设计不当导致后续重构 | 先按 minimal schema（仅 provider + model + system_prompt），随需求迭代加字段 |
| MCP tool 配置透传的安全风险 | 限制为 stdio 类型，command 白名单校验 |
| 和现有 WorkspaceMemberRuntime 的交互不清 | dispatch 决策链明确定义：agent profile 决定配置 → member binding 决定执行位置 |
| 用户期望的"agent"和实现的"agent profile"不一致 | 用前端 UI 引导：叫"智能体配置"而非"智能体实例"，强调"模板"语义 |

---

## 附录 A：与现有概念的对照表

| 现有概念 | 表 | 定位 | 和提案"agent"的关系 |
|---|---|---|---|
| **AgentRun** | agent_runs | 单次执行记录 | 提案 agent 的配置来源，run 引用 agent profile |
| **AgentSession** | agent_sessions | 交互式会话（跨 turn） | 提案 agent"运行时实例"的候选实现，但当前已够用 |
| **AgentMission** | agent_missions | 多 agent 编排 | 独立维度，不受影响 |
| **DaemonRuntime** | daemon_runtimes | daemon 上的 provider 实体 | 提案 agent 的物理执行能力（agent 用哪个 provider） |
| **WorkspaceMemberRuntime** | workspace_member_runtimes | per-member daemon 绑定 | 提案 agent 的执行位置（agent 在谁的 daemon 上跑） |
| **AgentArtifact** | agent_artifacts | 结构化产出 | 不受影响 |
| **ToolPolicy** | tool_policies | 工具使用策略 | 被提案 agent 引用（agent 用什么工具策略） |

---

## 附录 B：关键代码引用索引

| 文件 | 关键行号 | 内容 |
|---|---|---|
| `sillyhub-daemon/src/daemon.ts` | 575-770 | Daemon 类构造函数 + DaemonOptions（所有注入点） |
| `sillyhub-daemon/src/daemon.ts` | 832-863 | start()：agent 探测 → register → 三循环 |
| `sillyhub-daemon/src/daemon.ts` | 1000-1067 | _registerDaemon：per-daemon 注册，获取 runtime_id |
| `sillyhub-daemon/src/daemon.ts` | 2759-3151 | _startInteractiveSession：interactive session 创建全流程 |
| `sillyhub-daemon/src/daemon.ts` | 3292-3569 | _runLeaseStateMachine：batch lease 完整生命周期 |
| `sillyhub-daemon/src/workspace.ts` | 105-179 | WorkspaceManager：workspace mirror 管理 |
| `backend/app/modules/daemon/model.py` | 25-112 | DaemonInstance 表定义 |
| `backend/app/modules/daemon/model.py` | 114-197 | DaemonRuntime 表定义 |
| `backend/app/modules/daemon/model.py` | 290-380 | DaemonTaskLease 表定义 |
| `backend/app/modules/agent/model.py` | 26-297 | AgentRun 表定义（含所有配置字段） |
| `backend/app/modules/agent/model.py` | 422-538 | AgentSession 表定义 |
| `backend/app/modules/agent/model.py` | 540-627 | AgentMission 表定义 |
| `backend/app/modules/workspace/member_runtimes/model.py` | 21-119 | WorkspaceMemberRuntime 表定义（per-member binding） |
| `backend/app/modules/daemon/lease/service.py` | 92-631 | LeaseService：lease 生命周期 + claim/start/complete |
| `backend/app/modules/agent/placement.py` | 949-1000 | _resolve_dispatch_runtime：dispatch 决策核心 |
| `backend/app/modules/daemon/session/service.py` | 1-80 | SessionService：会话生命周期 |
| `docs/agent-platform-deep-audit-2026-07-12.md` | 1-305 | 深度审计报告：P0 bug + P1 高杠杆项 |
| `ROADMAP.md` | 1-94 | 项目路线图：已完成里程碑 + 当前活跃 + 技术债 |
