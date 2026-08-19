---
author: qinyi
created_at: 2026-08-19 09:42:00
scale: large
---

# 需求：跨工作区团队执行 + 项目维度会话

## FR-01 项目维度 mission 创建

用户（PPM 项目经理或超管）可在 PPM 项目下发起 team mission：
- `POST /api/projects/{project_id}/missions`，body 含 objective、scope_workspace_ids（必填 ≥1 去重）、anchor_workspace_id（可选，缺省 type=backend 优先否则 scope 第一个）、worker_preset、main_agent_config、budget_usd。
- 校验：scope ⊆ ppm_project_workspace(project_id)；anchor ∈ scope；违者 422。
- scope 内各 ws 至少一条带 daemon_id 的 member binding（预检；缺的返回清单，允许仍创建）。
- 鉴权：PPM 项目经理（复用 ppm _require_project_manager）或超管；否则 403。
- mode 强制 team；change_id 恒 None（D-008）。
- `GET /api/projects/{project_id}/missions` 列表（同鉴权），返回 MissionResponse + project 维度字段。

## FR-02 跨工作区 worker 派发

- `dispatch_worker`（链路A mcp_tools + 链路B mcp_gateway + daemon mcp-server.ts schema）payload 新增可选 `target_workspace_id`。
- 缺省 = anchor（零回归，现有调用不变）。
- 服务端校验 target ∈ mission scope，否则 400 `mission_target_out_of_scope`（R-02）。
- 有效目标 = `target_workspace_id or anchor`，worktree 自建（.worktrees/<run8>/ 落目标 ws root）、provider/model（目标 ws default_agent/default_model）、placement 全按目标 ws 路由。
- 代表 binding（D-001@v2）：仅 worker target≠anchor 派发，caller 传 representative 旗标；分支序=本人 binding → 旗标开则 resolve_representative_binding（owner 在线优先→该 ws 任意在线 binding 按 daemon 最近心跳）→ NoOnlineDaemonError；旗标关维持现状 borrow（验收 9）。
- target 无可用 binding → worker run failed + error_code=no_binding_for_workspace，mission 不崩。
- AgentRun 落 target_workspace_id 列。

## FR-03 按工作区分组收敛

- converge 的 merge 与 cleanup_mission 均按 (target_workspace_id or anchor, worktree_branch) 分组：每组 resolve Workspace → delegate.git_merge / git_worktree_remove（RPC 按 ws→daemon 自动路由）。
- 冲突按组独立：A 仓冲突不挡 B 仓合并；needs_manual 报告按工作区分组（D-011）。

## FR-04 兼容与零回归

- 5 个 MCP 工具 URL 不动；`_get_mission` 校验放宽为 anchor 匹配或 ws ∈ scope（scope NULL 按 [workspace_id]，P2-2），双通道同款。
- 存量单 ws mission：创建/主 agent 派发/worker dispatch/converge/MCP 工具/借用兜底全链路行为不变。
- MissionCreateRequest 新增字段全部可选缺省单 ws 行为；MissionResponse/MissionWorkerRunResponse 新增字段向后兼容。

## FR-05 鉴权与治理

- 鉴权锚 = anchor（URL 路径 ws）：daemon apiKey/JWT/shmcp_ 对 anchor 有权限即可驱动 mission 工具；target 侧由服务端 scope 校验闭合（D-006）。
- workspace 级 AgentProfile 归属校验放宽为 ∈ {anchor} ∪ scope（P2-1）。
- scope 创建时冻结，运行中不可变（D-007）。

## FR-06 主 agent 上下文

- render_orchestrator_prompt 注入：项目名 + scope 各 ws 清单（id/name/type/description/绑定机器在线状态）+ dispatch_worker 的 target_workspace_id 用法说明。
- 主 agent 派发维持现状（本人 binding → borrow，D-004@v2）。

## FR-07 前端项目团队入口

- 新页面 `/projects/{id}/missions`：发起表单（anchor 单选 + scope 多选带 type 徽标与在线状态 + 复用 MissionConsole 表单逻辑）+ mission 列表/详情（worker 行含目标工作区徽标列）。
- `pnpm gen:types` 同 change 内重新生成并提交 api-types.ts + openapi.json（FR-04 契约）。

## 验收对照

design §10 验收要点 1-10 逐条对应 FR-04（1）、FR-01（2）、FR-02（3/4/9）、FR-03（5）、FR-06（6）、FR-07（7/10）、FR-05+链路B（8）。
