---
author: qinyi
created_at: 2026-08-02 18:09:30
---

# 需求规格 — AgentProfile 配置层（v2，含 Grill 修正）

## 功能需求

### FR-01 档案 CRUD
创建/读取/编辑/删除/复制 AgentProfile。字段：name、provider、model、system_prompt、tool_policy_id、mcp_refs、skill_refs、allowed_roots_overlay、version、visibility。

### FR-02 三级可见范围
visibility ∈ {private（仅 owner_user_id）/ workspace（本工作区成员）/ platform（需 admin）}。private 校验 owner_user_id；workspace 级要求 actor 是 member；platform 级仅 admin 可建/改。

### FR-03 档案版本号
每次编辑 version+1；AgentRun 落地时快照 profile 内容 + version。

### FR-04 软约束兜底链
run 派发 agent_profile_id 解析：run 显式 → workspace.default_agent_profile_id → 平台默认（按 provider）→ 原路径（target_provider 回退 workspace.default_agent）。全无时不阻断。

### FR-05 平台预置默认档案（seed 策略，D-015）
迁移首次 seed 两个 is_system_default=true 只读档案（Claude Code 默认 provider=claude / Codex 默认 provider=codex）；启动时 idempotent 补种（按 is_system_default=true + name 去重，存在则跳过），保证重启可重建。

### FR-06 provider-aware（target_provider，D-014）
profile.provider 作 target_provider（优先于 workspace.default_agent），影响 `_query_runtime_by_daemon_and_provider` 的 runtime 匹配 + borrow_resolver lender 选择。**不反向选 daemon**（binding 仍是 daemon 选择的唯一真相源）。

### FR-07 AgentRun 绑定档案
AgentRun 加 agent_profile_id（nullable FK）+ agent_profile_snapshot（JSON nullable）。

### FR-08 allowed_roots backend 算交集下推（D-013）
backend dispatch 算 `effective = daemon.allowed_roots ∩ agent.allowed_roots_overlay`（overlay 空则原值）→ 写 claim payload → daemon frozenAllowedRoots 采用下推值。agent 只能收紧（服务端校验拒绝超集），永不放宽。workspace root_path 单列 cwd 维度。**v1 ToolPolicy 仅引用不叠加**（D-016）。

### FR-09 agent 层禁存密钥
AgentProfile 与 claim payload 明文不得出现 API Key / MCP 凭证。凭证留 LlmProvider(user_id) 与 daemon 本地。

### FR-10 MCP 子集透传（D-017）
daemon `mcp-config.ts` mergeMcpConfigs 加第三层过滤：`(workspace .mcp.json ∪ 平台默认) ∩ mcp.whitelist ∩ profile.mcp_refs`；whitelist 经 `/api/platform-settings/mcp-whitelist` 拉（与 fetchPlatformMcpConfig 同源）；`McpServerConfig` 加 `type` 字段仅允许 `stdio`。

### FR-11 技能引用透传
profile.skill_refs 经 claim payload 透传；daemon 只 link 勾选子集（替代全量 link）。

### FR-12 system_prompt 注入（prepend CLAUDE.md，D-012）
profile.system_prompt 经 claim payload 透传；daemon 写 CLAUDE.md 时 prepend 到顶部（batch: task-runner.ts；interactive: session-manager.ts）。claude/codex 通用；build_spec_bundle 函数零改动；profile 无 prompt 时 CLAUDE.md 与今天一致。

### FR-13 前端档案管理页
列表 + 三组表单（①身份 ②大脑 ③工具能力）。遵循前端设计系统（CLAUDE.md 规则19）。

### FR-14 前端选档案组件
发起任务/对话入口「选档案」下拉（含「不指定」）。类型经 `pnpm gen:types` 生成。

### FR-15 向后兼容（null 零查询增量，C-07）
profile_id 全 nullable；未绑档案的 run/lease/session 行为零变化；**null 路径不得引入新 DB 查询**（测试显式断言查询数不变，保护 PPM 已上线路径）。

## 非功能需求

### NFR-01 兼容性
不破坏 daemon-entity-binding / WorkspaceMemberRuntime / build_spec_bundle；新表加法，不动现有列。

### NFR-02 迁移安全（C-10）
当前 alembic head = `202607311500`（custom-skill-per-user，已入 main；llm-provider 无独立迁移）；新迁移 down_revision 接 `202607311500`；execute 前 `alembic heads` 确认单 head。

### NFR-03 测试
local.yaml module 级 verify：agent / workspace / daemon / frontend 子模块通过；agent 模块 deselect 2 个预存失败测试；**null 路径查询数断言**。

## Non-Goals 补充（D-016）
- v1 agent 仅引用 tool_policy_id，**不做** ToolPolicy 能力白名单 ∩ workspace policy 叠加（留后续）
- 不做 MCP 跨 workspace 数据串隔离（留后续安全项）

## 决策覆盖矩阵（D-001~D-017 当前版本全覆盖）

| 决策 ID | 覆盖位置 | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 档案内容=大脑+挑工具 |
| D-002@v1 | tasks 范围 | 一次做透（配置层+透传），影响 task 广度 |
| D-003@v1 | 全局命名 | AgentProfile（不与 AgentRun 撞） |
| D-004@v1 | FR-09 | 禁存密钥 |
| D-005@v1 | FR-04 | 软约束兜底 |
| D-006@v1 | FR-08（部分） | 三层交集概念；allowed_roots 机制→D-013 细化、ToolPolicy→D-016 修订 |
| D-007@v1 | — | **superseded by D-009**（非当前版本） |
| D-008@v1 | design §2 | 方案 A 全人设 profile |
| D-009@v1 | FR-02 | 三级 visibility |
| D-010@v1 | FR-05 | 两默认档案 |
| D-011@v1 | FR-13 | 表单三组 |
| D-012@v1 | FR-12 | system_prompt prepend CLAUDE.md |
| D-013@v1 | FR-08 | allowed_roots backend 算交集下推 |
| D-014@v1 | FR-06 | target_provider 不反向选 daemon |
| D-015@v1 | FR-05 | seed 迁移首次+启动 idempotent |
| D-016@v1 | Non-Goals | ToolPolicy v1 仅引用不叠加 |
| D-017@v1 | FR-10 | MCP 子集层+whitelist+type 校验 |

**剩余风险**：D-002（一次做透）使实现跨 3 后端模块 + 前端 + daemon 双路径，周期较长，需 plan 合理分 Wave 控制回归面（见 design §12）。无未覆盖的当前版本决策。
