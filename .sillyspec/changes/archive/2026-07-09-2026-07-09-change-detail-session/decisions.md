---
author: qinyi
created_at: 2026-07-09T17:22:00+08:00
---

# 决策台账 — 变更详情页内嵌会话

本次变更的决策记录（非长期术语表）。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 会话-变更关联模型 = AgentSession 加列
- type: architecture
- status: accepted
- source: code + user（方案选择）
- question: 会话与变更如何建立关联？加列 vs 复用 AgentRun.change_id 反查 vs 纯前端绑定
- answer: 用户选定方案 A —— 给 AgentSession 加 `change_id` + `workspace_id` 列 + Alembic 迁移
- normalized_requirement: AgentSession 必须持久化 change_id（FK changes.id，nullable）与 workspace_id（FK workspaces.id，nullable，冗余）；存在按 change_id 过滤的会话列表查询；迁移 down 可逆
- impacts: [design §5/§6/§8/§9, R-01, task 迁移/task model/task service/task list-endpoint]
- evidence: agent/model.py:373（AgentSession 现无 change_id）、agent/model.py:166（AgentRun.change_id 仅为调度 run 用）、需求"只看此变更关联的会话"、用户选方案 A
- priority: P0

## D-002@v1: 会话能力边界 = 复用现有 interactive session
- type: boundary
- status: accepted
- source: code
- question: 变更详情会话是完整 agent 会话（可读文档/答疑/经人审执行工具）还是只读问答？
- answer: 复用现有 interactive session 配置（manual_approval=True, ask_user_only=True），不改权限语义；是完整 agent 会话，上下文自动注入
- normalized_requirement: 不新增/不改 session 权限配置；变更会话与 runtimes 页会话走同一 create_session 权限路径
- impacts: [design §3 N-1, §5, §7.2]
- evidence: daemon/router.py:1506-1507（manual_approval/ask_user_only）、session/service.py:326-327、permission_service.py:75/311
- priority: P1

## D-003@v1: 工作目录(cwd) = workspace 本地项目根
- type: boundary
- status: accepted
- source: code
- question: 变更会话的 cwd 取什么？
- answer: 该变更所属 workspace 经 daemon-client 路径解析出的本地项目根目录（复用 lease/context.py 既有 _resolve_* 逻辑），写入 AgentSession.cwd
- normalized_requirement: create_session 在 workspace_id 非空时解析并写入 cwd；dispatch lease_meta 带 workspace_id 让 context.py 解析 root_path
- impacts: [design §5, §7.2, §7.5 resolve cwd, R-02]
- evidence: agent/model.py:437（cwd 字段）、lease/context.py:93/163（root_path=cwd 解析）、session/service.py:378（prepare_interactive_dispatch）
- priority: P1

## D-004@v1: 上下文注入 = 后端按 change 拼前导，注入首条 developer 消息
- type: architecture
- status: accepted
- source: code + design
- question: 变更信息（标题/阶段/工作目录/文档路径/已变更文件）如何注入 agent？
- answer: 后端 build_change_context_preamble(change_id) 拼装前导，作为首条 developer/system 消息注入 SDK；用户输入仍为首条 user 消息
- normalized_requirement: 上下文前导内容=变更标题+当前阶段+工作目录+变更文档路径(design/plan/tasks)+已变更文件清单；由后端统一拼装（前端只传 change_id）
- impacts: [design §5, §7.2, §7.5 inject context, R-03, R-04, task context-builder]
- evidence: InteractiveSessionPanel handleSend 仅传 prompt（interactive-session-panel.tsx:427）、需求"自动给定上下文（工作目录+变更信息）"、用户确认要全部 3 类上下文
- priority: P1

## D-005@v1: 历史会话列表范围 = 该变更下全部会话，跨成员可见
- type: boundary
- status: accepted
- source: design（P1 默认值，design 审查用户未推翻）
- question: 变更详情页的会话列表显示谁的会话？
- answer: 该变更下全部会话（跨工作空间成员），每条显示作者；理由=协作工作空间共享变更上下文
- normalized_requirement: GET /workspaces/{wid}/changes/{cid}/sessions 返回该 change 全部会话（不过滤 user_id），响应含作者信息；权限=workspace 成员
- impacts: [design §7.3, R-05]
- evidence: 需求"只能看到与此变更关联的会话"、现有 list_sessions 用户级（daemon/router.py:1628）、协作工作空间主题
- priority: P1
