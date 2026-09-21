## FR-cli-001 团队能力归属会话（mission 绑定发起会话）
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 Claude 引擎普通会话已存在 同一会话已有未收敛未取消的活跃 mission；When 用户触发团队（任意路径） 再次触发预建；Then 创建的 AgentMission.session_id = 该会话；主控 run = 会话当轮 AgentRun（回填 mission_id + role='o
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-01
最近确认：c06c79341

## FR-cli-002 工具常驻注入（Claude 普通会话；分身/Codex 排除）
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given provider='claude' 且 stage ∈ {空, 'orchestrator'} 的交互会话 provider='codex' 会话，或 stag；When daemon 认领 lease 并创建会话 会话创建；Then 注入 5 个团队 MCP 工具（dispatch_worker/get_worker_result/list_workers/converge_mission/
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-02
最近确认：c06c79341

## FR-cli-003 触发四路等价
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Claude 会话输入区；When 用户点「派团队」按钮（弹层配置范围/预算/分身后发送）、或输入 /team 前缀指令、或自然语言要求派团队（含 AskUser 确认变体）；Then 三路最终统一：显式路径走 POST /daemon/sessions/{id}/team-mission 预建（scope 冻结、objective 可空落占位
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-03
最近确认：c06c79341

## FR-cli-004 MCP 工具会话定位与收敛语义
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 转发 backend 主控调用 converge_mission converge_mission 被调用
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-04
最近确认：c06c79341

## FR-cli-005 会话结束与团队任务并存
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话有 running 分身；When 用户结束会话；Then 分身任务不受影响（独立 lease 存活）；mission 不被取消；派生状态与 patrol 巡检继续推进；重开会话可继续查看任务块与结果
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-05
最近确认：c06c79341

## FR-cli-006 独立团队入口删除（范围精确）
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 部署完成；When 访问 /workspaces/[id]/missions 或 /projects/[id]/missions，或查看侧边菜单；Then 路由 404、菜单无「Agent 团队」项；mission-console 组件与 create/list 前后端入口清零；GET /missions/{id}
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-06
最近确认：c06c79341

## FR-cli-007 会话内团队 UI
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Claude 会话面板 团队运行中 Codex 会话；When 存在团队任务 用户在输入框发送追问 查看输入区；Then 消息流内嵌 TeamTaskBlock（概要行：状态/N 分身成功失败/花费；展开：主控+分身行、日志/产物入口、取消按钮）；活跃时 5s 轮询刷新；进度视图分
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-07
最近确认：c06c79341

## FR-cli-008 状态机矩阵与存量兼容
变更：2026-08-22-team-session-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given derive_status 判据矩阵（§5 Phase 1 表格） awaiting_input 持续超时（默认 30 分钟）；When 任意主控轮×分身×converge×cancel×session_id NULL 组合 patrol 巡检；Then 派生状态与矩阵一致；session_id 为 NULL 的存量 external/bootstrap mission 永不进入 awaiting_input（保
全文：.sillyspec/changes/archive/2026-08-22-team-session-unify/requirements.md#FR-08
最近确认：c06c79341

## FR-cli-009 PiRpcDriver 交互式驱动
变更：2026-09-04-provider-pi-onboarding
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given pi ≥0.81.1 已安装并被 detector 探测 会话进行中收到 inject 用户打断 / 会话恢复 / 子进程非正常退出；When 创建 provider='pi' 的交互式会话 agent streaming / 非 streaming interrupt / resume / crash；Then spawn `pi --mode rpc --session-dir <daemon 隔离>` 长驻进程，JSONL 双向（LF 严格分帧，禁 readline
全文：.sillyspec/changes/archive/2026-09-04-provider-pi-onboarding/requirements.md#FR-01
最近确认：5a50be1c4

## FR-cli-010 事件归一化
变更：2026-09-04-provider-pi-onboarding
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given rpc 下行事件流；When 经 PiEventNormalizer；Then text_delta→text（逐 delta 直通）、thinking 块→thinking、tool_execution_start/end→tool_us
全文：.sillyspec/changes/archive/2026-09-04-provider-pi-onboarding/requirements.md#FR-02
最近确认：5a50be1c4

## FR-cli-011 能力矩阵如实
变更：2026-09-04-provider-pi-onboarding
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given PI 8 项 caps；When 三端镜像表落值；Then resume/model_select/thinking/multimodal=true（原生实测）；mcp/edit_patch/permission_dia
全文：.sillyspec/changes/archive/2026-09-04-provider-pi-onboarding/requirements.md#FR-03
最近确认：5a50be1c4

## FR-cli-012 注册与可选性
变更：2026-09-04-provider-pi-onboarding
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given providers.ts 加 pi 条目（family=pi_json/capsOf 单源）；Then InteractiveProvider 联合自动扩展；cli.ts drivers 装配加一行；前端引擎白名单两处（sessions/pre-session-p
全文：.sillyspec/changes/archive/2026-09-04-provider-pi-onboarding/requirements.md#FR-04
最近确认：5a50be1c4

## FR-cli-013 验收冒烟
变更：2026-09-04-provider-pi-onboarding
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机 pi 0.81.1 真实环境；When 按 onboarding §8+PI 适配清单跑；Then 创建→工具执行→partial→usage→inject→interrupt→resume 全链路；双轨落库（agent_event 行）；claude/cod
全文：.sillyspec/changes/archive/2026-09-04-provider-pi-onboarding/requirements.md#FR-05
最近确认：5a50be1c4
