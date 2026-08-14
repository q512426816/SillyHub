---
author: qinyi
created_at: 2026-08-14 14:54:22
---

# 决策台账 — 2026-08-14-change-center-conversation-driven

## D-001@v1 去掉前端新建变更表单链路

- type: product
- status: accepted
- source: 用户原话（页面操作新建变更去掉）
- question: 变更创建入口保留表单还是改为会话驱动？
- answer: 去掉表单：列表页按钮、空态 CTA、create-change 页面、后端 create/proxy-create 端点全删；空态引导去会话。
- normalized_requirement: 变更不再由平台表单创建，唯一创建路径 = agent 在会话里跑本地 sillyspec 命令。
- impacts: frontend changes/page.tsx、create-change/page.tsx、lib/changes.ts；backend change_writer 路由删除；相关测试改写。
- evidence: AskUserQuestion 用户选择「agent 用工具创建，平台同步接收」；调研证实表单是唯一创建入口。
- priority: P0

## D-002@v1 工作区独立会话入口（与变更平级）

- type: product
- status: accepted
- source: AskUserQuestion 用户选择
- question: 会话入口放哪？
- answer: workspace 加独立「会话」一级 tab + 新页 /workspaces/[id]/sessions（列表 + 复用 InteractiveSessionPanel）；建会话传 workspace_id 不绑 change。
- normalized_requirement: 会话与变更平级；会话为 workspace 级松耦合，agent 产出的变更独立进变更中心。
- impacts: workspace-tabs.tsx、新 sessions/page.tsx、抽 WorkspaceSessionSection；后端扩展现有 GET /workspaces/{wid}/agent-sessions 加 include_ended 参数（Grill round-1 C-5 修订：不新增双端点）。
- evidence: 调研：AgentSession 已有 workspace_id FK，create_session 已收 workspace_id，无需新创建端点。
- priority: P0

## D-003@v1 变更详情页去执行控制、保留人工审批

- type: product
- status: accepted
- source: AskUserQuestion 用户选择（去执行控制，留人工审批）
- question: 详情页「管事」按钮怎么处理（SillySpec 安全网=人工审批 vs 平台不管控）？
- answer: 删推进/重新派发/运行验证门禁/选智能体档案/团队配置；保留人工审批卡（通过/打回+意见）与只读展示区（进度条/日志/文件/历史/看板）。
- normalized_requirement: 平台不做执行控制；人工审批是平台保留的唯一变更操作。
- impacts: change-stage-actions.tsx 重做、[cid]/page.tsx 删执行控制 handler。
- evidence: 用户在 3 选项中选「去执行控制，留人工审批」。
- priority: P0

## D-004@v1 审批只改状态不派发

- type: product
- status: accepted
- source: AskUserQuestion 用户选择（审批只改状态，回会话继续）
- question: 审批通过后是否自动派发下一阶段 agent（现状行为）？
- answer: 通过/打回只落审批记录+阶段状态，删除审批通过后的自动派发调用；后续执行由会话驱动（后被 D-006@v1 强化为自动注入）。
- normalized_requirement: 平台审批不触发任何 agent 执行。
- impacts: change/service.py review 四方法剥离 dispatch 调用；测试改写。
- evidence: 用户选择「审批只改状态，回会话继续」。
- priority: P0

## D-005@v1 变更自动出现 = daemon 标注 + backend 兜底（方案B）

- type: architecture
- status: accepted
- source: AskUserQuestion 用户选择（方案B daemon 协作式，未采纳推荐 A）
- question: 增量同步触发 reparse 的实现路径？
- answer: daemon spec-sync 增量推送带 change_dirs 标注（精确）；backend apply_ops 无标注时按 ops 路径 changes/ 前缀检测兜底（兼容旧 daemon）。reparse 事务外 best-effort。
- normalized_requirement: agent 会话新建的变更经增量同步自动出现在平台列表，无需手动扫描，新旧 daemon 均可用。
- impacts: spec-sync.ts、spec_workspace/schema.py + service.py、change/service.py reparse 加 scope。
- evidence: 调研证实 apply_ops 不触发 reparse（命门）；platform-interface-map.md 证实平台模式链路A跳过。
- priority: P0

## D-006@v1 审批-会话联动（自动注入绑定会话）

- type: product
- status: accepted
- source: 用户 step5 修订意见（这个还是可以直接联动到会话内吧）
- question: 审批后用户回会话手动传话，还是平台自动联动？
- answer: 平台自动联动：审批点击 = ① 落审批记录/状态 ② injectSession 把审批结果（变更key+阶段+结果+意见）注入绑定会话，agent 直接继续；注入失败降级提示+文案可复制。
- normalized_requirement: 审批结果必须自动送达绑定会话，用户不当传话筒。
- impacts: 审批卡 UI 与 handler（两步调用）；消息格式定义。
- evidence: 用户原话修订；injectSession 为现有 API。
- priority: P0

## D-006@v2 审批-会话联动：后端服务身份注入（supersedes D-006@v1）

- type: architecture
- status: accepted
- source: Design Grill round-1（F-2：inject_session 有会话归属校验 `_get_owned_session_for_update`，前端以用户身份注入在多成员工作区必 403）
- question: 审批结果注入会话由前端用户身份（v1 方案：前端两步调 injectSession）还是后端服务身份执行？
- answer: 后端服务身份：审批四端点加 notify_session 参数，审批落库+投影收敛后由后端注入绑定会话（绕过用户归属校验）；best-effort 不回滚审批；turn 冲突/会话非 active/异常三类降级提示，文案可复制。
- normalized_requirement: 多成员工作区任意审批人都能触发注入；注入失败绝不影响审批已生效。
- impacts: change/service.py review 四方法、审批端点 schema/响应（notified_session/notify_error）、前端审批卡单端点调用；mcp_gateway submit_stage_review 契约同步。
- evidence: Grill 审查 daemon/session/service.py:704 归属校验；daemon/router.py:1919 reopen 不采（复杂化，V1 降级即可）。
- priority: P0
- supersedes: D-006@v1

## D-007@v1 会话绑定 = 创建时自动绑定最近活跃会话（多对多关联表）

- type: architecture
- status: accepted
- source: 用户 step5 修订意见（这个会话应该是绑定好的，不用选择，也不能选择才对）
- question: 审批注入的目标会话怎么确定？
- answer: 变更创建时（reparse 发现新变更）自动绑定该 workspace 最近活跃会话；新表 change_session_links 多对多（AgentSession.change_id 单值 FK 无法承载一会话多变更）；审批卡只读显示绑定会话，无选择 UI；并行双会话绑偏为 V1 已知边界。
- normalized_requirement: 绑定在创建时确定性建立，审批不可选目标。
- impacts: change/model.py 新模型、migration、reparse 绑定逻辑、审批卡展示。
- evidence: 用户确认「绑定会话机制」AskUserQuestion；调研 AgentSession.change_id 单值限制。
- priority: P1
