---
author: qinyi
created_at: 2026-08-11 15:43:48
change: 2026-08-11-change-progress-projection
---

# 决策记录（Decisions）

> 本变更的决策台账（非长期术语表）。长期术语在 archive/scan 时提升到 glossary.md。

## D-001@v1: workspace 归属 = workspace-scoped token 派生（参照 McpToken 模式）
- type: architecture
- status: accepted
- source: user
- question: 平台如何从工具→平台上行请求确定 workspace 归属？（收件箱 `platform_change_progress` 无 workspace_id 列；`ApiKey` 只绑 user_id，User 可属多 workspace；契约 §3 body 不含 workspace_id）
- answer: 参照 mcp_gateway 的 McpToken 模式，新建独立表 `platform_sync_tokens`（workspace_id 硬 FK + token_hash 存 sha256 + created_by FK），签发 `shpsync_` 前缀 token；`require_platform_sync` authenticate 时按 hash 查表派生 (user=created_by, workspace_id)。workspace 走 token 派生，**不进 serializeForSync body**。
- normalized_requirement: `POST /workspaces/{wid}/platform-sync-tokens` 签发；`require_platform_sync` 返回 `tuple[User, workspace_id|None]`；`platform_change_progress` 加 workspace_id 列 + 复合唯一 `(workspace_id, change_name)`
- impacts: FR-01, FR-02; P1, P2, P3; §5/§7/§8.1
- evidence: `mcp_gateway/service.py:66,160-311`（McpToken 签发/authenticate 模式）；`auth/model.py:201-252`（ApiKey 无 workspace 列）；`platform_sync/auth.py:7`（无 workspace 语义）；用户 AskUserQuestion 选「workspace-scoped token」；Grill X1/X2 字段集校准（含 created_by）
- priority: P0

## D-002@v1: 投影 = 实时 read-only join（不双写 changes 表）
- type: architecture
- status: accepted
- source: user
- question: 权威 current_stage 从收件箱投影到变更中心展示，何时触发？
- answer: 每次 list_changes/get_change 在 `enrich_summaries`（list 批量 IN join）/`enrich_with_workspace_ids`（single = 匹配）内实时 read-only join `platform_change_progress`，取权威值覆盖猜值；**不回写 changes 表**（避免双写一致性 + agent 流程也写 changes.current_stage 的冲突）。
- normalized_requirement: change 模块 enrich join（list 批量 IN 禁 N+1，single = 匹配）；不新增 changes 表写入路径
- impacts: FR-04; P4; §5.1/§9
- evidence: 用户 AskUserQuestion 选「实时 join」；change/service.py:1227-1229（enrich_summaries 现状）；Grill X7 enrich 分述（IN vs =）
- priority: P0

## D-003@v1: 冲突以工具上行为准 + 未上行 fallback 现有值
- type: premise
- status: accepted
- source: user
- question: agent 流程写的 current_stage 与工具上行的 current_stage 冲突时谁权威？工具从未上行的 change 怎么办？
- answer: 以工具上行为准（覆盖 agent 写值）；工具从未上行的 change（join 不到）fallback 到 changes 表现有值（reparse 猜值 / agent 写值）。quick-<uuid8> change 不建目录 → join 不命中 → fallback（预期行为）。
- normalized_requirement: join 命中 → 覆盖；join 未命中 → 保留 ChangeSummary 现有 current_stage
- impacts: FR-04, FR-05; P4; §9
- evidence: 用户决策 3「以工具为准」；parser.py:574（猜值来源）；sillyspec progress.js:827（quick 不建目录，Grill X9）
- priority: P0

## D-004@v1: status 字段覆盖 + 枚举映射
- type: premise
- status: superseded
- source: user
- question: status 字段是否也用同步层值覆盖？两套词表怎么对齐？
- answer:（已被 D-004@v2 取代）——初稿假设 sillyspec status = in_progress/completed/blocked，实测错误。
- normalized_requirement:（废弃）
- impacts: FR-06(撤)
- evidence: Grill X3 实测 sillyspec status 仅 active/archived
- priority: P1

## D-005@v1: 新建平台→local.yaml 下发通道（扩展 connect，文本级段替换 writer）
- type: architecture
- status: accepted
- source: user + code
- question: workspace-scoped token 怎么进入工具 local.yaml（平台→local.yaml 下发通道现状不存在）？
- answer: 扩展 `sillyspec platform connect`：connect 时用现有 user 级 shk_live_ token + 本地 root_path 调新端点 `POST /workspaces/resolve-by-root-path` 换发 shpsync_ token，用已就绪的文本级段替换 writer（`sync.js:109 replaceTopLevelSection`，逐字节保留注释）写入 local.yaml platform 段。
- normalized_requirement: 新端点 resolve-by-root-path；connect 扩展换发 + replaceTopLevelSection 写入；mcp 段同源坑本次不顺带修（NG-4）
- impacts: FR-03; P5, P6; §5/§6
- evidence: 用户「平台初始化工作区时把 apikey 等写入 local.yaml」+ 选「方案 A 新表+connect 自动下发」；sync.js:109（writer 已就绪）；workspace/model.py:62（root_path 反查）；用户 AskUserQuestion 选方案 A
- priority: P0

## D-004@v2: 撤销 status 投影（仅投 current_stage）
- type: premise
- status: accepted
- supersedes: D-004@v1
- source: design-grill + user
- question: sillyspec changes.status 实测仅 active/archived 两值（非初稿假设的 in_progress/completed/blocked），D-004@v1「status 覆盖」前提错误，status 投影还有无价值？
- answer: 撤销 status 投影。sillyspec status 仅 active/archived（progress.js:222 / change-registry.js:18,241 / doctor-diagnostics.js:102），archived 已由 current_stage==archive 派生（前端 page.tsx:240 现有逻辑），status 投影无增量。投影层只覆盖 current_stage，status 维持变更中心现有派生。
- normalized_requirement: enrich 只覆盖 current_stage；不读 latest_progress.changes[0].status；status 维持现有派生
- impacts: FR-06(撤); G5; NG-9; design §8.3
- evidence: sillyspec progress.js:222 / change-registry.js:18,241 / doctor-diagnostics.js:102；前端 page.tsx:240；Grill X3；用户 AskUserQuestion 选「撤 D-004」
- priority: P1

## D-006@v1: resolve-by-root-path 权限校验 = 复用 mcp-tokens WORKSPACE_WRITE
- type: risk / compatibility
- status: accepted
- source: design-grill + user
- question: resolve-by-root-path 用 shk_live_（user 级不绑 workspace）+ root_path，任意持有者可猜 root_path 为他人 workspace 签 token，绕过隔离（Grill X4，P0 安全洞）。如何校验？
- answer: 反查到 workspace 后，校验调用者对该 workspace 有 WORKSPACE_WRITE（复用现有 POST /workspaces/{wid}/mcp-tokens 端点权限模型），否则 403；root_path 反查不到 404。
- normalized_requirement: resolve-by-root-path 端点在反查 workspace 后校验 WORKSPACE_WRITE；403/404 路径；签发 token 时 created_by=调用者
- impacts: FR-03; G3; design §7; R-08
- evidence: Grill X4；mcp_gateway/router.py（mcp-tokens WORKSPACE_WRITE）；用户 AskUserQuestion 选「复用 mcp-tokens 权限」
- priority: P0
