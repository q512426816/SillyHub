---
author: qinyi
created_at: 2026-08-23 03:58:12
---

# 决策台账（2026-08-23-sessions-workspace-hub）

## D-101@v1 预会话态渲染载体 = SessionPanel 同构空态
- type: architecture
- status: accepted
- source: 用户原话（方案选择问）："我想要的就是点击新建后直接到会话界面，和正常聊天界面一样，不要独立页面"
- question: 预会话态用独立组件复刻视觉，还是 SessionPanel 本体支持无会话空态？
- answer: SessionPanel 支持 `sessionId=null` 渲染同构空态；复用 dialog 模式既有"输入→createSession→SSE 接管"链路，SSE/队列/轮询 effect 按 sessionId 驱动加 null 守卫，不新造状态机分支。
- normalized_requirement: 新建后右侧必须是正常会话界面本身（同组件同布局），不得出现独立新建页面/表单页。
- impacts: session-panel.tsx 预会话分支+守卫清单；sessions-portal 双态接线；否决独立 PreSessionPanel 组件方案。
- evidence: explore 会话 AskUserQuestion 方案选择；session-panel.tsx dialog idle 态 createSession 链路先例。
- priority: P0

## D-102@v1 首句创建时机 = 发送动作触发 createSession
- type: behavior
- status: accepted
- source: explore 会话评估（后端 `SessionCreateRequest.prompt min_length=1`，backend/app/modules/daemon/schema.py:86）
- question: 如何在不改后端的前提下实现"先进会话页面再创建"？
- answer: 预会话态输入第一句点发送时才调 createSession（首句即 prompt，天然满足后端非空约束）；成功后 session_id 就位状态机原地接管；不发言离开不残留空会话。
- normalized_requirement: 零后端协议改动实现"先入页面后创建"；无空会话垃圾。
- impacts: session-panel 首句发送链路；R-02 失败保留输入。
- evidence: 后端 schema 约束 + ql-20260822-010 前置评估曾否决"空 prompt 创建"方案。
- priority: P0

## D-103@v1 左侧数据 = 一次拉取客户端分组
- type: implementation
- status: accepted
- source: explore 会话（数据层方案对比）
- question: 工作区分组数据怎么取——逐组请求还是全量客户端分组？
- answer: `listAgentSessions` 一次拉取 limit=500，客户端按 workspace_id 分组渲染；组内条目超 50 截断+「显示全部」兜底（R-03）。
- normalized_requirement: 不新增服务端聚合端点（Non-Goal），个人数据量下分组视图一次拉齐。
- impacts: session-list-panel 数据层；全局虚拟滚动退役（R-04）。
- evidence: 现有 useInfiniteQuery PAGE_SIZE=50 机制；工作区/机器两级分组下单组条目量评估。
- priority: P1

## D-104@v1 预会话上下文行完全锁定不可改
- type: product
- status: accepted
- source: 用户原话（AskUserQuestion）："完全锁定"
- question: 预会话态顶部上下文行（工作区·机器·智能体）可否中途修改？
- answer: 完全锁定不可改；要换机器/引擎在进入前解决（筛选 tab 上下文或两步浮层选择），创建后本就不可换（D-004@v2 一致）。
- normalized_requirement: 预会话态无任何配置编辑入口；上下文仅展示。
- impacts: 预会话 UI；进入前的选择载体（D-107 浮层/tab）。
- evidence: explore 会话 AskUserQuestion。
- priority: P1

## D-105@v1 非工作区分组保留新建
- type: product
- status: accepted
- source: 用户原话（AskUserQuestion）："也允许新建"
- question: 「非工作区」分组（历史未绑工作区会话）要不要新建入口？
- answer: 保留组头「＋」；机器上下文走 D-005 三级回退（无工作区绑定可依）；预会话上下文行工作区显示"不指定（非工作区）"。
- normalized_requirement: 临时自由会话场景不丢。
- impacts: 组头交互；preContext.workspaceId=null 路径。
- evidence: explore 会话 AskUserQuestion。
- priority: P1

## D-106@v1 变更范围入口保持独立
- type: product
- status: accepted
- source: 用户原话（AskUserQuestion）："变更入口独立（推荐）"
- question: 变更会话（/workspaces/[id]/changes/[cid]/sessions）并入全局树还是保持独立？
- answer: 保持独立页面（预会话上下文行加显变更名）；bindWorkspaceId/bindChangeId 锁定语义由 preContext 继承。
- normalized_requirement: 变更会话仍是"围绕该变更"的特殊上下文页，不混入全局工作区树。
- impacts: 三入口收敛方式（FR-06）。
- evidence: explore 会话 AskUserQuestion。
- priority: P2

## D-107@v1 两层筛选 tab + 全部态两步浮层新建
- type: product
- status: accepted
- source: 用户原话（v2 修改意见）："顶部还要有两层tab 机器层级 > 智能体层级（并且有个按钮可以直接展示全部机器和智能体的全部会话…这样情况下新建要先选择机器和智能体，然后也是直接进入正常会话页面），下面再是目前的 工作区树 会话列表"
- question: 机器/智能体维度如何进入列表与新建流？
- answer: 左侧顶部两层筛选 tab（机器>智能体，含「全部」清空）纯视图过滤工作区树；筛选态（机器+智能体均已选）点组头「＋」直接带 tab 上下文进预会话；全部态点「＋」先弹两步轻选择浮层（在线机器→智能体）再直进预会话。上下文优先级：tab 筛选 > 工作区绑定在线机器 > D-005 回退。
- normalized_requirement: 机器/引擎选择不回到表单形态；全部态新建两步即达。
- impacts: session-list-panel 筛选条；pre-session-picker.tsx；上下文解析链。
- evidence: v2 原型确认（AskUserQuestion"确认设计"）。
- priority: P0

## D-108@v2 创建人 chip 动机修正（信息完备预留，非当前区分度）
- type: definition
- status: accepted
- supersedes: D-108@v1
- source: design-grill（X-09）
- question: D-108@v1 声称"共享守护进程多人场景可区分"是否成立？
- answer: 不成立——列表 SQL 强制按创建人隔离（session/service.py:2453 user_id == 当前用户），全部消费路径（含 scope 入口复用全局端点）只返回本人会话，owner_name 恒为本人。chip 保留为信息完备项（当前恒显"我"），字段与渲染为未来会话共享场景预留。
- normalized_requirement: 列表条目显示创建人；当前数据模型下为本人隔离视图，不宣称多人区分度。
- impacts: FR-05 表述、SessionListPanel chip（不变）、后端 owner_name 字段（不变）。
- evidence: session/service.py:2453；schema.py:31-32 注释自证列表 user 隔离；审查报告 X-09。
- priority: P2

## D-108@v1 创建人 chip（后端补 owner_name）
- type: product
- status: superseded（by D-108@v2，动机修正；实现路径不变）
- source: 用户原话（v2 修改意见）："会话列表 再附加个创建人信息"
- question: 创建人显示数据从哪来？
- answer: 后端列表端点 SQL join users 补 `owner_name: str | null`（旧数据 null 兜底"—"）；前端经 gen:types 消费为条目 chip。
- normalized_requirement: 列表条目可见创建人；共享守护进程多人场景可区分。
- impacts: backend daemon 模块列表查询 + DTO + gen:types + SessionListPanel。
- evidence: v2 原型确认。
- priority: P1

## D-109@v1 NewSessionForm 三入口统一退役
- type: architecture
- status: accepted
- source: 方案推演（预会话态替代配置表单）
- question: 聊天优先版表单（ql-20260822-010）与预会话态并存还是替代？
- answer: 全量退役（组件+测试），bind 语义由 preContext 继承；避免两套新建心智并存。
- normalized_requirement: 三入口新建仅一条路径（预会话态）。
- impacts: 文件删除清单；测试迁移（R-06）。
- evidence: design §5 Wave4。
- priority: P1
