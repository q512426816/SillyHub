---
author: qinyi
created_at: 2026-08-02 18:09:30
---

# 决策记录 — AgentProfile 配置层

## D-001@v1: AgentProfile 内容范围 = 大脑 + 挑工具
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 智能体档案里装什么？轻配置还是完整人设？
- answer: 大脑（LLM 配置 + 系统提示词）+ 挑工具（MCP/技能/工具策略引用子集），引用不搬家。
- normalized_requirement: AgentProfile 含 provider/model/system_prompt/tool_policy_id/mcp_refs/skill_refs；工具技能凭证定义不存于 profile。
- impacts: [design §3, FR-01]

## D-002@v1: 首版范围 = 一次做透
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 第一版做到哪？只配置层还是连透传？
- answer: 第一版连配置层 + MCP/技能引用透传到 daemon 一起做（报告 Phase1+2 合并）。
- impacts: [design §9, tasks]

## D-003@v1: 命名 AgentProfile
- type: term
- priority: P0
- status: accepted
- source: code
- question: 新配置实体叫什么？
- answer: AgentProfile（禁叫 Agent，与 AgentRun/AgentService/AgentSession 撞；与已埋 profile_version 字段自洽）。
- impacts: [全文档]

## D-004@v1: agent 层严禁存密钥
- type: risk
- priority: P0
- status: accepted
- source: code
- question: API Key / MCP 凭证放哪？
- answer: 只持 label/引用；凭证留 LlmProvider(user_id) 与 daemon 本地，永不进 AgentProfile/lease 明文。
- impacts: [design §3 §10, FR-09]

## D-005@v1: 软约束兜底（不硬阻断）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: "workspace 必须经 agent" 是硬约束还是软约束？
- answer: 软约束。兜底链 run 显式 → workspace 默认 → 平台默认（按 provider 选预置）→ 原路径；不阻断，对齐 NoOnlineDaemonError 风格。
- impacts: [design §8, FR-04]

## D-006@v1: 配置三层取交集最严
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: allowed_roots / 策略归哪层？
- answer: daemon=物理 ∩ workspace=业务 ∩ agent=人格（只能收紧）；ToolPolicy 以 workspace 为主、agent 能力白名单为辅取交集。
- impacts: [design §4 §10, FR-08]

## D-007@v1 → 被 D-009@v1 修订（可见范围升级为三级）
- type: boundary
- priority: P1
- status: superseded
- supersedes: (无)
- source: design-grill
- question: 第一版支持哪几级 visibility？
- answer: 原 v1 仅 workspace+platform；用户授权后升级为三级（D-009）。
- impacts: [design §3]

## D-008@v1: 实现方案 = 方案 A（全人设 profile）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 三种落地（A 全人设 / B 取代 spec_bundle / C 只管能力）选哪个？
- answer: 方案 A。profile 管 prompt+模型+工具引用；spec_bundle 只管 spec 上下文不动；build_spec_bundle 零改动。
- impacts: [design §2 §7]

## D-009@v1: 可见范围第一版就做三级（个人/工作区/平台）
- type: boundary
- priority: P1
- status: accepted
- supersedes: D-007@v1
- source: user（"按你的想法来"授权）
- question: 要不要第一版加个人级？
- answer: 加。成本仅枚举值+owner+过滤；与 per-user 技能心智一致；避免第二版改两次 visibility 逻辑。
- normalized_requirement: visibility ∈ {private, workspace, platform}；private 仅 owner_user_id 可见可用。
- impacts: [design §3, FR-02]

## D-010@v1: 平台预置两个默认档案（Claude Code 默认 + Codex 默认）
- type: boundary
- priority: P1
- status: accepted
- source: user（授权）
- question: 平台默认档案预置几个？
- answer: 两个（claude + codex），is_system_default=true 只读；兜底按 workspace.default_agent 的 provider 选对应预置档案。
- impacts: [design §8, FR-05, tasks seed]

## D-011@v1: 前端表单分三组（身份/大脑/工具能力）
- type: boundary
- priority: P2
- status: accepted
- source: design
- question: 档案表单字段如何分组？
- answer: ①身份（名称/可见范围）②大脑（供应商/模型/系统提示词）③工具能力（工具策略/MCP/技能）。系统提示词归大脑组。
- impacts: [prototype-agent-profile.html v2, 前端任务]

---

## Design Grill 修正决策（D-012~D-017，source: design-grill 独立审查）

## D-012@v1: system_prompt 注入 = daemon 写 CLAUDE.md 时 prepend（方案 b2）
- type: feasibility
- priority: P0
- status: superseded
- supersedes: (无)
- source: design-grill（C-01/C-05）
- question: profile.system_prompt 怎么注入？design 原写 buildSpawnEnv/applyClaudeSettings 消费，但两函数不处理 prompt。
- answer:（v1，已废弃）改方案 b2——daemon 端写 CLAUDE.md 时 prepend。**plan-review spike 发现 interactive 路径无 CLAUDE.md 写入点，v1 不可行**，升级 D-012@v2。
- impacts: [已被 D-012@v2 取代]
- evidence: spawn-env.ts:109-167（无 prompt）、interactive/*.ts grep claudeMd 零匹配

## D-012@v2: system_prompt 注入 = backend 构造 claudeMd 时 prepend
- type: feasibility
- priority: P0
- status: accepted
- supersedes: D-012@v1
- source: plan-review spike（P1-1/P1-2）
- question: v1 说 daemon 端 prepend CLAUDE.md，但 spike 发现 interactive 路径无 CLAUDE.md 写入点。
- answer: 改 backend 注入——`get_execution_context` 构造 claudeMd 响应时 prepend profile.system_prompt（fetch 优先，batch+interactive 都覆盖；render_bundle_to_claude_md 产出后、响应组装层加 prepend）。build_spec_bundle/render 函数零改动，daemon 不动 CLAUDE.md。
- normalized_requirement: get_execution_context 组装响应时，若 run 绑定 profile 且 profile.system_prompt 非空，则 prepend 到 claudeMd 顶部；profile 无 prompt 时 claudeMd 与今天一致。
- impacts: [design §7, FR-12, task-06（加 prepend）, task-09/10（去 prepend，仅 MCP/技能/roots）]
- evidence: types.ts:276 claudeMd 字段、daemon.ts:3347/3507 claudeMd 构造、daemon.ts:3452 interactive 分流前已构造 execPayload、api-types.ts:8991 render_bundle_to_claude_md→daemon 写 .claude/CLAUDE.md

## D-018@v1: plan 质量修正（plan-review P1-3/P1-4/P2）
- type: consistency
- priority: P1
- status: accepted
- source: plan-review
- question: plan-review 发现 task 卡片缺 related_tests（P1-3）、task-08 allowed_paths 漏 daemon fetch whitelist 文件（P1-4）、seed.py 路径不一致（P2-1）、mcp-config 行号 127→158（P2-4）、Wave 内链式依赖（P2-6）。
- answer: 全部修正入 plan.md v2——每 task 补 related_tests；task-08 allowed_paths 加 daemon fetch 文件（hub-client.ts）；seed.py 统一到 agent/profile/seed.py；mcp-config 行号订正 158；Wave 内链式依赖显式标注执行顺序。
- impacts: [plan.md v2, task-08/11/13]

## D-013@v1: allowed_roots = backend 算交集下推
- type: feasibility
- priority: P0
- status: accepted
- source: design-grill（C-02/C-06）
- question: 三层取交集在哪执行？原写"daemon 端叠加"但 frozenAllowedRoots spawn 时冻结。
- answer: backend dispatch 算 effective = daemon.allowed_roots ∩ agent.overlay（overlay 空则原值）→ 写 claim payload → daemon frozenAllowedRoots 采用下推值。workspace root_path 单列 cwd 维度（非 write 守卫）。agent 永不放宽。
- impacts: [design §4 §10, FR-08, task-05/06]
- evidence: task-runner.ts:581 frozenAllowedRoots、placement.py:413 root_path=cwd

## D-014@v1: provider-aware = target_provider，不反向选 daemon
- type: feasibility
- priority: P1
- status: accepted
- source: design-grill（C-03）
- question: FR-06 "先按 provider 筛 daemon"可行吗？
- answer: 不可行（binding 是 daemon 选择的唯一真相源）。改为 profile.provider 作 target_provider（优先于 workspace.default_agent），影响 _query_runtime_by_daemon_and_provider 的 runtime 匹配 + borrow_resolver lender 选择，不改 daemon 选择顺序。
- impacts: [design §5, FR-06, task-05]
- evidence: placement.py:949-1067 _resolve_dispatch_runtime

## D-015@v1: seed 默认档案 = 迁移首次 + 启动 idempotent 补种
- type: consistency
- priority: P1
- status: accepted
- source: design-grill（C-11）
- question: FR-05"启动 seed" vs task-01"迁移 seed"矛盾？
- answer: 统一为迁移首次 seed 两默认档案 + 启动时 idempotent 补种（按 is_system_default=true + name 去重，存在则跳过）。重启可重建被误删的默认档案。
- impacts: [FR-05, task-01, 新增 startup hook]

## D-016@v1: ToolPolicy v1 仅引用不叠加（修订 D-006 的 ToolPolicy 部分）
- type: consistency
- priority: P2
- status: accepted
- supersedes: D-006（ToolPolicy 取交集部分）
- source: design-grill（C-14）
- question: D-006 说 ToolPolicy 取交集，但无 FR 无任务。
- answer: v1 agent 仅引用 tool_policy_id（run 用此 policy），不做"agent 能力白名单 ∩ workspace policy"叠加。叠加留后续。D-006 的 allowed_roots 取交集部分（D-013）保留。
- impacts: [design §3.1, FR-08, Non-Goals 补]

## D-017@v1: MCP 子集过滤层 + whitelist 来源 + type 校验
- type: feasibility
- priority: P1
- status: accepted
- source: design-grill（C-04/C-15）
- question: MCP 子集怎么取？whitelist 哪来？stdio 怎么强制？
- answer: (1) mcp-config.ts mergeMcpConfigs 加第三层过滤 (workspace.mcp.json ∪ 平台默认) ∩ mcp.whitelist ∩ profile.mcp_refs，改 signature；(2) daemon 经 /api/platform-settings/mcp-whitelist 拉 whitelist（与 fetchPlatformMcpConfig 同源）；(3) McpServerConfig 加 type 字段仅允许 stdio。
- impacts: [design §9, FR-10, task-07/08]
- evidence: mcp-config.ts:127-191、settings/router.py:215-236
