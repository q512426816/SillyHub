---
author: qinyi
created_at: 2026-08-02 18:09:30
scale: large
risk_level: contract-required
---

# 设计文档 — AgentProfile 配置层（daemon → agent → workspace）

> v2：经 Design Grill 独立审查修正 2 个 P0（system_prompt 注入点 / allowed_roots 机制）+ 6 个 P1，见 decisions D-012~D-017。

## 1. 背景与目标

当前架构中，daemon（执行算力）经 `WorkspaceMemberRuntime`（per workspace×user 绑定）直接服务 workspace，**缺少一个独立、可复用、可管理的「智能体配置/人格」实体**。现状"人格"是每次 dispatch 时临时拼装的 `spec_bundle`（CLAUDE.md），用完即弃，无法保存、复用、版本管理（代码已埋 `AgentRun.profile_version`/`spec_strategy` 字段但未落地）。

本变更引入 **AgentProfile（智能体档案）** 配置层，作为现有架构的**增强层而非替代层**：不改 daemon-entity-binding、不动 WorkspaceMemberRuntime 绑定、不引入运行时实例。全程向后兼容（PPM 已上线零回归）、不存密钥、不破坏现有绑定。

前置评审：两组多代理分析 + 代码级地基核实（`memory/agent-profile-layer-decision.md`）。前置 P0 僵尸 bug 已于 `ql-20260712-001` 修复，不阻塞。

## Non-Goals（不做什么，详见 proposal.md）

- 不改 daemon-entity-binding / WorkspaceMemberRuntime 绑定结构（runtime_id 134 文件引用）
- 不引入 AgentInstance 运行时实体（避免与 AgentSession 重叠）
- 不做 N:N 活引用式跨工作区共享（用 visibility 受限共享 + 复制）
- agent 层不存任何密钥（API Key / MCP 凭证）
- 不重写 build_spec_bundle 渲染管线（仅 daemon 消费侧 prepend CLAUDE.md）
- v1 不做 ToolPolicy 能力白名单 ∩ workspace policy 叠加（D-016，仅引用 tool_policy_id）
- 不做 MCP 跨 workspace 数据串隔离（留后续安全项）
- 不做模板市场 / 跨工作区配额计费 / agent 执行统计（留后续）

## 2. 总体方案（方案 A：全人设 profile）

AgentProfile 管「模型 + 系统提示词 + MCP 引用集 + 技能引用集 + 工具策略引用」；`spec_bundle` 只管 spec 文档上下文（CLAUDE.md 的 spec 部分）。档案的系统提示词经 claim payload 注入 daemon，**daemon 写 CLAUDE.md 时 prepend 到顶部**（见 §7，D-012）。`build_spec_bundle` 函数**零改动**。

## 3. 数据模型

### 3.1 新表 `agent_profiles`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| name | str | 档案名（visibility+owner/workspace 内唯一） |
| owner_user_id | UUID FK users | 创建者（private 级鉴权） |
| workspace_id | UUID FK workspaces nullable | workspace 级归属；private/platform 为 null |
| visibility | enum | `private` / `workspace` / `platform` |
| provider | str | 供应商偏好（claude/codex/…），作 target_provider |
| model | str nullable | 模型名 |
| system_prompt | text nullable | 系统提示词（agent 人格） |
| tool_policy_id | UUID FK tool_policies nullable | **v1 仅引用不叠加**（D-016） |
| mcp_refs | JSON | 勾选的 MCP server name 列表（引用） |
| skill_refs | JSON | 勾选的技能 ref 列表（引用 user 技能池） |
| allowed_roots_overlay | JSON nullable | 能力白名单可写目录（**只能收紧**） |
| version | int | 版本号，每次编辑 +1 |
| is_system_default | bool | 平台预置默认档案标记（只读） |
| created_at / updated_at | datetime | 审计 |

### 3.2 `AgentRun` 加列（nullable，向后兼容）
- `agent_profile_id` UUID FK agent_profiles nullable
- `agent_profile_snapshot` JSON nullable（run 落地时快照 profile 内容 + version）

### 3.3 `Workspace` 加列
- `default_agent_profile_id` UUID FK agent_profiles nullable（软约束兜底用；与现有 default_agent provider 字符串并存，profile 优先）

### 3.4 不新增绑定表
三级共享由 visibility + workspace_id + owner_user_id 表达，**不建 agent↔workspace 关联表**。

## 4. 配置三层（修正：backend 算交集下推，D-013）

> Grill C-02/C-06 修正：原"daemon 端叠加 agent overlay"不可行（frozenAllowedRoots spawn 时冻结、PolicyEngine 按 lease 隔离）。

| 维度 | 含义 | 执行点 |
|---|---|---|
| daemon allowed_roots | 机器物理沙箱上限 | `DaemonInstance.allowed_roots`（不动） |
| workspace root_path | **cwd（claude 工作目录）**，非 write 守卫 | `placement.py` metadata.root_path（不动） |
| **agent allowed_roots_overlay** | 能力白名单（**只能收紧**） | backend 算交集后下推 |

**生效机制**：backend dispatch 时算 `effective_allowed_roots = daemon.allowed_roots ∩ agent.allowed_roots_overlay`（agent overlay 为空则 = daemon 原值）→ 写进 claim payload → daemon `frozenAllowedRoots`（`task-runner.ts:581` / `session-manager.ts:1119`）采用下推值。agent 层**永不放宽**（backend 服务端校验拒绝超集）。workspace root_path 作为 cwd 独立维度，不混入 allowed_roots。

## 5. 数据流 — dispatch 链路（修正：provider 顺序，D-014）

> Grill C-03 修正：binding 是 daemon 选择的唯一真相源，不能"先按 provider 筛 daemon"。

```
run 派发（start_run / start_stage_dispatch / start_scan_dispatch）
  │
  ├─ 解析 agent_profile_id（软约束兜底，见 §8）→ 加载 profile
  │
  ├─ placement._resolve_dispatch_runtime（顺序不变）：
  │   workspace×user → MemberBindingResolver → binding.daemon_id（唯一真相源）
  │   → 校验在线 → _query_runtime_by_daemon_and_provider(did, target_provider)
  │     其中 target_provider = profile.provider（优先）?? workspace.default_agent
  │   → borrow_resolver 按 target_provider 借 lender（顺序不变）
  │
  ├─ backend 算 effective_allowed_roots（§4）+ 快照 profile（含 version）
  │   → 写入 AgentRun.agent_profile_snapshot + lease.metadata
  │
  └─ context.build_claim_payload 透传 profile 字段（mcp_refs/skill_refs/system_prompt/
    effective_allowed_roots，camelCase+snake_case 双写）→ daemon claim → 消费（§7/§9）
```

**关键不变量**：profile 为空时 target_provider 回退 workspace.default_agent，dispatch 路径与今天一致（不引入新 DB 查询，C-07 附条件 pass）。

## 6. 生命周期契约表

本变更不改变 lease/agent_run 状态机，仅新增 profile 维度透传：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch 带 profile | backend AgentService | placement | agent_profile_id（可空） | 无（profile 快照写入 AgentRun） |
| lease claim | daemon | backend | claim payload 含 profile 字段（mcp_refs/skill_refs/system_prompt/effective_allowed_roots） | 无 |
| lease execute（batch） | daemon task-runner | claude/codex | 消费 profile：写 CLAUDE.md prepend prompt + MCP 子集 + 技能子集 + frozenAllowedRoots | 无 |
| lease execute（interactive） | daemon session-manager | claude/codex | 同上（interactive 路径，C-12 修正） | 无 |
| lease complete | daemon | backend | 同现有 | AgentRun 终态（不动） |

## 7. system_prompt 注入（spike 修正：backend 构造 claudeMd 时 prepend，D-012@v2）

> Grill C-01/C-05 + plan-review P1-1/P1-2 修正。spike 核实（types.ts:276 / daemon.ts:3347,3452,3507）：`claudeMd`（写入 `{workDir}/.claude/CLAUDE.md 的内容）由 **backend 生成**（render_bundle_to_claude_md），经 `build_claim_payload`（context.py，claim 响应兜底）+ `get_execution_context`（service.py，daemon fetch **优先**）两条路下发 daemon。batch 和 interactive 都消费 execPayload.claudeMd（interactive 在 daemon.ts:3452 分流前已构造）。原 v1 说"daemon 端写 CLAUDE.md prepend"错误——interactive 路径无 CLAUDE.md 写入点。

- profile.system_prompt 在 **backend `get_execution_context` 构造 claudeMd 响应时 prepend 到内容顶部**（render_bundle_to_claude_md 产出之后、execution-context 响应组装层加一步 prepend）。batch + interactive 两路径自然覆盖（都 fetch claudeMd）。
- `build_spec_bundle` / `render_bundle_to_claude_md` 函数**零改动**（prepend 在响应组装层，非渲染管线）。
- daemon 端**不动 CLAUDE.md**（claudeMd 已含 profile prompt，daemon 照常写盘 `.claude/CLAUDE.md`）。
- profile 无 system_prompt 时 claudeMd 与今天一致。
- daemon task-09/10 不再处理 system_prompt，只处理 MCP 子集 + 技能子集 + frozenAllowedRoots（简化）。

## 8. 软约束兜底链（不硬阻断）

run 派发时 agent_profile_id 解析顺序：
1. run 显式指定 → 用它
2. 否则 → workspace.default_agent_profile_id
3. 否则 → 平台默认档案（按 workspace.default_agent 的 provider 选「Claude Code 默认」或「Codex 默认」）
4. 全无 → target_provider 回退 workspace.default_agent，走原 dispatch 路径（不阻断，仅无在线 daemon 时报 NoOnlineDaemonError）

## 9. MCP / 技能引用透传（修正：子集过滤层 + whitelist 来源 + type 校验，D-017）

> Grill C-04/C-15 修正。

- profile.mcp_refs + skill_refs 经 claim payload 透传 daemon。
- **MCP**：daemon 端 `mcp-config.ts` mergeMcpConfigs 加第三层过滤——`(workspace .mcp.json ∪ 平台默认) ∩ mcp.whitelist ∩ profile.mcp_refs`（改 mergeMcpConfigs signature 接 mcp_refs 入参）。`McpServerConfig` 加 `type` 字段，仅允许 `stdio`（防未来 SSE/HTTP SSRF）。mcp.whitelist 由 daemon 经 `/api/platform-settings/mcp-whitelist` 拉取（与 fetchPlatformMcpConfig 同源）。
- **技能**：daemon 只 link profile.skill_refs 子集（替代全量 link）。
- 凭证仍由 daemon 本地持有，**不进 claim payload 明文**。

## 10. 安全边界（红线）

1. **agent 层严禁存密钥**：AgentProfile 与 claim payload 明文中不得出现 API Key / MCP 凭证。凭证留 `LlmProvider(user_id)` 与 daemon 本地。
2. allowed_roots backend 算交集下推，agent 只能收紧（§4）。
3. MCP 仅 stdio + 过 whitelist（§9）。
4. MCP 调用跨 workspace 数据串隔离 = 后续项（Non-Goals）。

## 11. 文件变更清单（File Changes）

**新增**：
- backend/migrations/versions/20260802_agent_profile.py
- backend/app/modules/agent/profile/__init__.py
- backend/app/modules/agent/profile/model.py
- backend/app/modules/agent/profile/router.py
- backend/app/modules/agent/profile/seed.py
- backend/app/modules/agent/profile/service.py
- backend/app/modules/agent/tests/test_dispatch_profile.py
- backend/app/modules/agent/tests/test_orchestrator.py
- backend/app/modules/agent/tests/test_placement_target_provider.py
- backend/app/modules/agent/tests/test_profile_router.py
- backend/app/modules/agent/tests/test_profile_seed.py
- backend/app/modules/agent/tests/test_profile_service.py
- backend/app/modules/daemon/tests/test_lease_context.py
- frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx
- frontend/src/components/agent-profile-form.tsx
- frontend/src/components/agent-profile-select.tsx
- frontend/src/components/__tests__/agent-profile-form.test.tsx
- frontend/src/lib/agent-profiles.ts
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts
- sillyhub-daemon/tests/interactive/session-manager-profile.test.ts
- sillyhub-daemon/tests/interactive/session-manager.partial-bucket.test.ts
- sillyhub-daemon/tests/interactive/session-manager.partial-dedup.test.ts
- sillyhub-daemon/tests/mcp-config.test.ts
- sillyhub-daemon/tests/policy/filesystem-policy.test.ts
- sillyhub-daemon/tests/task-runner.test.ts

**修改**：
- ROADMAP.md
- backend/app/main.py
- backend/app/modules/agent/mission_schema.py
- backend/app/modules/agent/model.py
- backend/app/modules/agent/orchestrator.py
- backend/app/modules/agent/placement.py
- backend/app/modules/agent/router.py
- backend/app/modules/agent/schema.py
- backend/app/modules/agent/service.py
- backend/app/modules/agent/tests/test_router.py
- backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py
- backend/app/modules/daemon/lease/context.py
- backend/app/modules/workspace/model.py
- backend/conftest.py
- backend/openapi.json
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
- frontend/src/lib/agent.ts
- frontend/src/lib/api-types.ts
- sillyhub-daemon/src/daemon.ts
- sillyhub-daemon/src/hub-client.ts
- sillyhub-daemon/src/interactive/claude-sdk-driver.ts
- sillyhub-daemon/src/interactive/session-manager.ts
- sillyhub-daemon/src/interactive/types.ts
- sillyhub-daemon/src/mcp-config.ts
- sillyhub-daemon/src/task-runner.ts
- sillyhub-daemon/src/types.ts
- sillyhub-daemon/tests/interactive/session-manager.test.ts

## 12. 风险登记（Risk）

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 与活跃变更迁移链撞车 | 中 | 实测当前 head=`202607311500`（custom-skill-per-user 已入 main），llm-provider 无独立迁移；新迁移 down_revision 接 `202607311500`；execute 前 `alembic heads` 确认单 head（C-10） |
| 跨 agent/workspace/daemon + 前端回归面大 | 高 | profile_id 全 nullable，null 走原路径零回归；null 路径不得引入新 DB 查询（C-07 测试断言）；module 级 verify |
| daemon-entity-binding migration 待部署验证 | 中 | 本变更加法不动现有列；部署前确认 head 已 apply |
| MCP 透传攻击面 | 中 | 仅 stdio + whitelist + type 校验 |
| profile vs spec_bundle 人格混淆 | 中 | §7 prepend 规则明确；前端强调档案=人格、spec=任务 |
| interactive 路径遗漏 | 中 | task-08 拆 batch + interactive 双路径（C-12） |

## 13. 自审（Self-Review）

- ✅ 不改 daemon-entity-binding / WorkspaceMemberRuntime（runtime_id 134 文件引用）
- ✅ 不引入 AgentInstance 运行时
- ✅ agent 层不存密钥（红线）
- ✅ 向后兼容（profile_id nullable，null 路径零查询增量，C-07）
- ✅ 软约束不硬阻断
- ✅ 命名 AgentProfile
- ✅ **system_prompt 注入机制已落地**（prepend CLAUDE.md，D-012，不再悬空）
- ✅ **allowed_roots 机制已修正**（backend 算交集下推，D-013）
- ✅ **provider-aware 顺序已纠正**（target_provider 不反向选 daemon，D-014）
- ✅ **interactive 路径已覆盖**（task-08 拆双路径，C-12）
- ✅ **claim payload 透传已有任务归属**（context.py，C-13）
- ⚠️ 待 plan 细化：profile_snapshot JSON schema、mergeMcpConfigs 新 signature、prepend 在 daemon 写 CLAUDE.md 的具体注入点行号、codex driver 是否需要额外处理
- ⚠️ scale = large，走完整 plan → execute → verify

## 14. 决策引用索引（D-001~D-017 全覆盖）

| 决策 | 覆盖章节 | 状态 |
|---|---|---|
| D-001@v1 内容范围=大脑+挑工具 | §2 §3.1 | accepted |
| D-002@v1 一次做透 | §9 §11 | accepted |
| D-003@v1 命名 AgentProfile | §3.1 | accepted |
| D-004@v1 禁存密钥 | §10 | accepted |
| D-005@v1 软约束兜底 | §8 | accepted |
| D-006@v1 三层交集（部分） | §4（机制→D-013，ToolPolicy→D-016） | 部分修订 |
| D-007@v1 | — | superseded by D-009（非当前） |
| D-008@v1 方案 A 全人设 | §2 | accepted |
| D-009@v1 三级 visibility | §3.1 | accepted |
| D-010@v1 两默认档案 | §3 §8 | accepted |
| D-011@v1 表单三组 | §11 | accepted |
| D-012@v1 system_prompt prepend CLAUDE.md | §7 | accepted |
| D-013@v1 allowed_roots backend 算交集下推 | §4 | accepted |
| D-014@v1 target_provider 不反向选 daemon | §5 | accepted |
| D-015@v1 seed 迁移首次+启动 idempotent | §11 | accepted |
| D-016@v1 ToolPolicy v1 仅引用不叠加 | §3.1 Non-Goals | accepted |
| D-017@v1 MCP 子集层+whitelist+type | §9 | accepted |

## 15. 完整文件清单（execute 实际改动，apply 校验用）

新增：
- backend/migrations/versions/20260802_agent_profile.py
- backend/app/modules/agent/profile/__init__.py
- backend/app/modules/agent/profile/model.py
- backend/app/modules/agent/profile/router.py
- backend/app/modules/agent/profile/seed.py
- backend/app/modules/agent/profile/service.py
- backend/app/modules/agent/tests/test_dispatch_profile.py
- backend/app/modules/agent/tests/test_orchestrator.py
- backend/app/modules/agent/tests/test_placement_target_provider.py
- backend/app/modules/agent/tests/test_profile_router.py
- backend/app/modules/agent/tests/test_profile_seed.py
- backend/app/modules/agent/tests/test_profile_service.py
- backend/app/modules/daemon/tests/test_lease_context.py
- frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx
- frontend/src/components/agent-profile-form.tsx
- frontend/src/components/agent-profile-select.tsx
- frontend/src/components/__tests__/agent-profile-form.test.tsx
- frontend/src/lib/agent-profiles.ts
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts
- sillyhub-daemon/tests/interactive/session-manager-profile.test.ts
- sillyhub-daemon/tests/interactive/session-manager.partial-bucket.test.ts
- sillyhub-daemon/tests/interactive/session-manager.partial-dedup.test.ts
- sillyhub-daemon/tests/mcp-config.test.ts
- sillyhub-daemon/tests/policy/filesystem-policy.test.ts
- sillyhub-daemon/tests/task-runner.test.ts

修改：
- ROADMAP.md
- backend/app/main.py
- backend/app/modules/agent/mission_schema.py
- backend/app/modules/agent/model.py
- backend/app/modules/agent/orchestrator.py
- backend/app/modules/agent/placement.py
- backend/app/modules/agent/router.py
- backend/app/modules/agent/schema.py
- backend/app/modules/agent/service.py
- backend/app/modules/agent/tests/test_router.py
- backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py
- backend/app/modules/daemon/lease/context.py
- backend/app/modules/workspace/model.py
- backend/conftest.py
- backend/openapi.json
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
- frontend/src/lib/agent.ts
- frontend/src/lib/api-types.ts
- sillyhub-daemon/src/daemon.ts
- sillyhub-daemon/src/hub-client.ts
- sillyhub-daemon/src/interactive/claude-sdk-driver.ts
- sillyhub-daemon/src/interactive/session-manager.ts
- sillyhub-daemon/src/interactive/types.ts
- sillyhub-daemon/src/mcp-config.ts
- sillyhub-daemon/src/task-runner.ts
- sillyhub-daemon/src/types.ts
- sillyhub-daemon/tests/interactive/session-manager.test.ts
