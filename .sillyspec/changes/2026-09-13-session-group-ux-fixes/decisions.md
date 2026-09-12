---
author: qinyi
created_at: 2026-09-12 16:26:20
generated_by: sillyspec-fourpiece-init
change: 2026-09-13-session-group-ux-fixes
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->

## D-001@v1: 预会话草稿键细分，消除跨入口串台
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 输入框草稿跨会话串台的根因与修复口径
- answer: 代码查证：真会话草稿按 sessionId 隔离（sillyhub.sessions.draft.<sid>）且所有 7 个 SessionPanel 宿主均有 key={sessionId} 强制重挂载，rAF 门闩（draftHydratedRef）时序推演在重挂载/非重挂载两路径均正确；唯预会话（sessionId=null）草稿用固定键 __pre__（turn-state.ts:304），跨工作区/跨机器入口共享——用户在不同入口开新会话时上一入口未发送内容必然带入，与用户「a 会话内容带到 b 会话」实测吻合。修复：预会话草稿键按 workspaceId+runtimeId 细分（__pre__:<ws>:<runtime>），真会话逻辑不动仅补测试覆盖。
- normalized_requirement: 预会话草稿键包含入口上下文（workspaceId+runtimeId），不同入口的预会话草稿互不可见；真会话草稿隔离行为零回归
- impacts: [FR-1, task-01]
- evidence: frontend/src/components/daemon/session-panel/turn-state.ts:304-328；session-panel-page.tsx:408-422；七宿主 key 契约核验（sessions-portal/floating-session-host/runtime-session-helpers/member-panel/worker-session-overlay/m 两页面）

## D-002@v1: 拖拽手柄改 Pointer Events 统一鼠标/触摸
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 移动端输入框高度拖拽手柄无响应的修复方案
- answer: 根因：handleHeightDragStart 只绑 onMouseDown + window mousemove/mouseup，触摸屏不触发。修复采用 Pointer Events（onPointerDown + pointermove/pointerup + setPointerCapture），一套代码覆盖鼠标/触摸/触控笔；项目内已有成功先例（panel-resizer.tsx:112-159、floating-session-host.tsx:755-794）。session-input-bar.tsx 与 group-chat-panel.tsx 两处同款副本同步修改。
- normalized_requirement: 移动端触摸拖拽手柄可实时调节输入框高度（44-480px 钳制）+ 双击恢复默认 + 持久化；桌面鼠标行为零回归
- impacts: [FR-2, task-02]
- evidence: session-input-bar.tsx:501-526,651；group-chat-panel.tsx:1688-1711,2771；panel-resizer.tsx:112-159 先例

## D-003@v1: 群聊跨工作区可见性——后端返回可见工作区集合
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 群关联项目 A（项目 A 关联工作区 D/F）时群聊应在 D/F 都可见的实现层选型
- answer: 选后端方案：list_groups 响应组装时为每个群计算 visible_workspace_ids（直接 workspace_id + project 经 PpmProjectWorkspace 关联的全部 workspace_id，批量查询无 N+1），GroupChatListItemRead 加字段；前端各消费点（桌面 session-list-panel / 移动 mobile-session-list / 悬浮宿主如有群分区）过滤改为 includes 判定。理由：单一数据源、全部消费点免费获益、避免每个消费点各自拉项目-工作区映射造成数据不一致与重复查询。可见性口径：仅放宽列表展示（用户须是群成员才看得到，现有 member 过滤不动），打开群后的访问控制仍走群成员校验，权限语义零变化。
- normalized_requirement: 群列表项携带 visible_workspace_ids；workspace scope 过滤改为该集合包含判定；非群成员在关联工作区仍不可见（成员过滤前置）
- impacts: [FR-3, task-03, task-04, task-05]
- evidence: backend/app/modules/agent/model.py:1339-1387（AgentGroupChat.workspace_id/project_id）；workspace/model.py:181（PpmProjectWorkspace M:N）；session-list-panel.tsx:964-970 与 mobile-session-list.tsx:250-256 现过滤；用户原话「在工作区 d 或者 f 都能看到这个群聊才对」

## D-004@v1: 整体方案选 A——后端可见集合 + 预会话键细分 + Pointer Events
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 三项修复整体方案取舍（A 后端可见集合 / B 纯前端判定 / C 草稿系统全面重构）
- answer: 用户选定方案 A。理由要点：单一数据源、全部消费点免费获益、改动聚焦（backend 2 + frontend 5 文件）；否决 B（逻辑复制 3 处、映射独立加载有时序窗口）；否决 C（真会话串台未证实，为未证实问题重构违反 YAGNI）。
- normalized_requirement: 问题 3 走后端 visible_workspace_ids（D-003 展开）；问题 1 限预会话键细分 + 真会话测试覆盖（D-001 展开）；问题 2 Pointer Events（D-002 展开）
- impacts: [FR-1, FR-2, FR-3, task-01..05]
- evidence: 用户 AskUserQuestion 轮次明确选择「方案 A：后端方案（推荐）」

## D-002@v2: 拖拽不使用 setPointerCapture（Grill 修正）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-002@v1
- source: code
- question: Pointer Events 迁移中是否用 setPointerCapture 保证拖出元素收事件
- answer: 不用。panel-resizer.tsx:11-13 真实先例明文因 jsdom 无实现而不用 setPointerCapture，window 级 pointermove/pointerup 监听已保证拖出元素收事件；测试走 fireEvent(window) 同路径（explorer-page.test.tsx 补坐标方案）。@v1 表述中「+ setPointerCapture」为 brainstorm 期误引，以本版为准。
- normalized_requirement: 同 @v1（触摸可拖/双击/钳制/持久化/鼠标零回归）+ 不引入 setPointerCapture
- impacts: [FR-2, task-02]
- evidence: frontend/src/components/ui/panel-resizer.tsx:5-20 注释实证；Grill 审查两轮（首轮 gap→修正→复检 pass）
