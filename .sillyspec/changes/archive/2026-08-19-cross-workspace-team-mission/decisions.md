---
author: qinyi
created_at: 2026-08-19 09:25:00
---

# 决策台账（2026-08-19-cross-workspace-team-mission）

## D-001@v2: worker 派发按目标工作区代表 binding（边界精化）
- type: architecture
- status: accepted（supersedes: D-001@v1；Grill B-04 修订）
- source: user + grill
- question: 代表 binding 的精确触发边界（v1 未定义与 borrow 的顺序）
- answer: 仅 worker 的 target≠anchor 派发走代表 binding（caller 传 representative_fallback 旗标）；主 agent（target=anchor）与单 ws 维持现状 borrow 兜底。分支序：本人 binding → 旗标开则代表 binding → 旗标关则 borrow（原链不动）
- normalized_requirement: placement._resolve_dispatch_runtime 增 representative_fallback 参数；旗标关时行为与现状字节级一致
- impacts: [FR-02, §4.2, 验收 9]
- evidence: placement.py:1059-1074（binding-None 无条件 borrow）
- priority: P0

## D-002@v1: 载体 = AgentMission 多工作区化
- type: architecture
- status: accepted
- source: user
- question: 「项目维度发起会话」的载体（AgentSession / AgentMission / 新 ProjectSession）
- answer: mission 多工作区化；项目维度是新创建入口 + 关联字段，不发明新会话实体
- normalized_requirement: 不新增会话表；AgentMission 扩展 anchor/project/scope 字段
- impacts: [FR-01, §4.1]
- evidence: AgentSession 钉死单 runtime 单 lease（model.py:506-542）；AgentMission 是团队协同既有实体
- priority: P0

## D-003@v1: 产物按工作区各自收敛
- type: architecture
- status: accepted
- source: user
- question: 跨工作区 worker commit 如何合并（前端仓/后端仓各自 git 根）
- answer: converge 按 target workspace 分组 merge 回各自 root，冲突按组独立处理
- normalized_requirement: finalizer execute 收敛取 (target_workspace_id, worktree_branch) 分组 git_merge；HostFsDelegate 按 ws 路由 RPC 零改动
- impacts: [FR-03, §4.3]
- evidence: finalizer.py:220-337 现 merge 逻辑单 ws；delegate.py _via_rpc 按 workspace→daemon 路由已就绪
- priority: P0

## D-004@v2: 主 agent 跑 anchor（维持现状 borrow，不走代表 binding）
- type: architecture
- status: accepted（supersedes: D-004@v1；Grill B-04 选项 a，用户确认）
- source: user + grill
- question: orchestrator 主 agent 落哪台机器（v1 的代表 binding 回退与派发公式矛盾）
- answer: 主 agent 派发维持现状链路：本人 binding → borrow 兜底；跨 ws mission 亦然，不走代表 binding。代表 binding 专属 worker 的 target≠anchor 派发（见 D-001@v2）
- normalized_requirement: team_mission_entry 派主 agent 代码路径不改 placement 调用参数
- impacts: [FR-01, §4.2, 验收 9]
- evidence: orchestrator.py:130-261 现派发链路
- priority: P0

## D-009@v1: workspace_id 保持 NOT NULL（anchor 恒必填）
- type: architecture
- status: accepted（Grill B-03，用户确认）
- source: grill
- question: anchor 是否 nullable（project-only mission）
- answer: 不改列约束。nullable 空态不可达（所有创建路径 anchor 恒有值）且全链路断链（MissionResponse 非 Optional / MCP URL / 派发）。不变式改为 scope 校验（⊇ anchor、⊆ 项目关联集）
- normalized_requirement: migration 只加 project_id + scope_workspace_ids 两列，不动 workspace_id
- impacts: [§4.1, migration]
- evidence: mission_schema.py:64（MissionResponse.workspace_id 非 Optional）
- priority: P1

## D-010@v1: 链路B（mcp_gateway）同款对齐
- type: architecture
- status: accepted（Grill B-01，用户确认）
- source: grill
- question: 对外 MCP 通道（shmcp_）是否支持跨 ws
- answer: 对齐：_get_mission 放宽 scope + dispatch_worker 加 target_workspace_id + scope 校验 + converge 兜底路由走代表 binding 旗标逻辑
- normalized_requirement: mcp_gateway/tools.py 与 agent/mcp_tools.py 两通道行为一致；验收 8
- impacts: [§7.2, §8]
- evidence: mcp_gateway/tools.py:152-164/336-467/552-570/762-840
- priority: P1

## D-011@v1: cleanup_mission 按工作区分组
- type: architecture
- status: accepted（Grill B-02，用户确认）
- source: grill
- question: worktree 副本清理是否也要分组（v1 只分组了 merge）
- answer: 是——git_worktree_remove 按 run.target_workspace_id resolve ws，否则 target 机副本永久残留
- normalized_requirement: 验收 5 含副本清理分组断言
- impacts: [§4.3, 验收 5]
- evidence: finalizer.py:348-467
- priority: P1

## D-005@v1: mission 钉 project + URL 兼容扩展
- type: compatibility
- status: accepted
- source: user
- question: API/MCP URL 结构怎么改
- answer: 5 个 MCP 工具 URL 不动；新增 /projects/{pid}/missions 两端点；workspace 路径参数语义 = anchor
- normalized_requirement: _get_mission 校验放宽（anchor 或 ∈ scope）；存量调用零变化
- impacts: [FR-04, §7]
- evidence: mcp_tools.py:355-663 URL 清单
- priority: P0

## D-006@v1: 鉴权锚 = anchor（否决 token 项目化）
- type: architecture
- status: accepted
- source: user
- question: shmcp_ token 绑定单 ws，跨 ws dispatch 如何鉴权
- answer: 用户否决「token 项目化」（项目↔工作区 M:N，token 无法承载）。重推：主 agent MCP 注入用 daemon apiKey → require_permission(anchor)；target 派发由服务端 scope 校验闭合，凭证绑哪个 ws 不是安全边界
- normalized_requirement: 不改 McpToken 模型；dispatch_worker 服务端校验 target ∈ scope（400 mission_target_out_of_scope）
- impacts: [FR-05, §7.2, R-03]
- evidence: cli.ts:684-739（apiKey 注入）/ mcp-server.ts:25-63 / auth_deps.py:99 / rbac.py:107
- priority: P0

## D-007@v1: 方案 A（anchor + scope JSON）
- type: architecture
- status: accepted
- source: user
- question: mission 多工作区关系的数据模型（JSON 快照 vs 中间表 vs 新实体）
- answer: workspace_id 改 nullable（anchor 语义）+ project_id FK + scope_workspace_ids JSON 列
- normalized_requirement: 单 migration；scope 创建时冻结不可变；⊇ anchor；⊆ 项目关联集
- impacts: [§4.1, R-05, R-07]
- evidence: 用户三选一确认
- priority: P0

## D-008@v1: v1 不挂 change_id
- type: boundary
- status: accepted
- source: code
- question: 项目 mission 是否关联 sillyspec change（既有 mission.change_id）
- answer: 不挂——项目会话与 sillyspec change 解耦，scope 治理锚 PPM 项目（项目经理圈选权）
- normalized_requirement: 项目维度创建 change_id 恒 None；不消费 change 收口链路
- impacts: [§7.1]
- evidence: change 生命周期属变更中心域，与项目团队执行语义不同
- priority: P1
