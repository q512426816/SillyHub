---
author: WhaleFall
created_at: 2026-08-19T14:01:26
---

# 决策台账 — sessions-workspace-selector

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 后端 create_session 补 workspace 归属校验（WORKSPACE_READ 口径，404 同语义）

- type: security
- status: accepted
- source: user（AskUserQuestion 确认"要，顺手补上"）
- question: 后端 create_session 收到 workspace_id 时不校验归属（`session/service.py:709-714` 直接按 ID 读 Workspace 行取 root_path 当 cwd）。/sessions 开放选择器后该缺口显性化，是否本次修复？用什么口径？
- answer: 本次一并修复。校验口径 = `allowed_workspace_ids(user_id, permission=WORKSPACE_READ)`，与前端工作区列表数据源（`workspace/router.py:246-248`）完全一致——前端列得出的后端必放行、列不出的必拒绝。失败返回 404（与不存在同语义，跟随项目 owner-only 惯例如 claim_lease 归属校验，不泄露存在性）。
- normalized_requirement: workspace_id 非空时必须先过 allowed_workspace_ids 校验再落库；无权限/不存在统一 404（新错误码 HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND）；不传 workspace_id 零回归。
- impacts: [design FR-03、Phase C、R-05、后端测试 ×3]
- evidence: `backend/app/modules/daemon/session/service.py:705-714`（现状无校验）；`backend/app/modules/workspace/router.py:246-248`（allowed_workspace_ids 列表口径）；`backend/app/modules/daemon/lease/service.py:186-227`（404 同语义惯例）
- priority: P0

## D-002@v1: 工作区选择器可选，默认「不使用工作区」

- type: ux
- status: accepted
- source: user（AskUserQuestion 确认"可选，默认不选"）
- question: /sessions 的新建会话表单里，工作区选择器是必选还是可选？
- answer: 可选，默认「不使用工作区」。不选 = 保持现状裸会话（通用问答助手）；选了 = 挂项目上下文。提交体不选时不含 workspace_id 字段。
- normalized_requirement: 表单默认 value=null；「不使用工作区（默认）」为下拉首项；不选时 createSession 提交体不得含 workspace_id 键（对齐 daemon.ts undefined 不下发契约）。
- impacts: [design FR-01/FR-04、Phase A/B、兼容策略]
- evidence: `frontend/src/lib/daemon.ts:650-676`（undefined 字段不下发）；用户需求"可选"
- priority: P1

## D-003@v1: 选工作区自动联动绑定机器，不强制锁定

- type: ux
- status: accepted
- source: user（AskUserQuestion 确认"自动选中，可手动换"）
- question: 选了工作区后机器选择器要不要联动？（背景：工作区项目目录只存在于绑定机器上，选其它机器 agent 跑空目录）
- answer: 自动联动 + 允许手动换。选工作区 → 按该工作区 member binding 的 daemon_id（稳定键，非 runtime_id）匹配在线机器自动选中；绑定机器离线/未绑定时不动机器选择，用户自担。不锁定。
- normalized_requirement: 联动匹配键必须是 binding.daemon_id ↔ DaemonMachineRead.id（runtime_id 不稳定禁止用作联动键）；联动只在选中工作区瞬间触发一次，改回「不使用」不回动机器。
- impacts: [design FR-02、Phase B、R-01/R-02]
- evidence: `frontend/src/lib/workspace-binding.ts:37-46`（fetchMyBindings 批量端点）；`frontend/src/components/workspace-config-card.tsx:303-305`（daemon_id 稳定键惯例）；`sillyhub-daemon/src/daemon.ts:3370-3371`（非绑定机器 mkdir 空目录行为）
- priority: P1

## D-004@v1: 实现结构 = 独立选择器组件（方案 B）

- type: architecture
- status: accepted
- source: user（AskUserQuestion 三方案确认 B）
- question: 前端实现结构：A 内联进 NewSessionForm / B 独立 workspace-session-picker 组件 / C 跳转工作区入口？
- answer: 方案 B——新建独立自治组件（自带数据加载），NewSessionForm 只接受控字段 + 联动回调。否决 A（表单组件膨胀至 650+ 行难维护）；否决 C（不满足统一入口内直接选工作区的需求本质，两套会话面板并存问题依旧）。
- normalized_requirement: 选择器必须是独立文件 frontend/src/components/sessions/workspace-session-picker.tsx，自带 useQuery 数据源，不读父层状态；NewSessionForm 通过 props（value/onChange）集成。
- impacts: [design Phase A/B、文件变更清单]
- evidence: 项目组件拆分惯例（sessions/ 目录 SessionListPanel/NewSessionForm/SessionConfigBar 均独立文件）；NewSessionForm 现状 ~450 行
- priority: P1
