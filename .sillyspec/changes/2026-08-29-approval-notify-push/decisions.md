---
author: qinyi
created_at: 2026-08-29 14:38:12
---

# 决策台账 — 2026-08-29-approval-notify-push

> 本文件是本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

## D-001@v1

- **type**: scope
- **status**: confirmed
- **source**: brainstorm step3（AskUserQuestion 需求澄清，用户选择「change 门 + daemon 权限审批」）
- **question**: 本次站内通知覆盖哪些审批事件？（项目有三套审批：change 四审核门、daemon 会话权限审批、release 审批投票）
- **answer**: 覆盖 change 四审核门（待办产生 + 通过/驳回/回退结果）+ daemon 权限审批（请求产生 + 超时）；release 投票本次不做，架构预留（未来加触发点即可）。
- **normalized_requirement**: 通知类型枚举含 approval_pending / approval_result / permission_request / permission_timeout 四类；release 模块零改动。
- **impacts**: notification 模块类型枚举、触发点清单（§7.3）、测试范围
- **evidence**: design.md §3 非目标、§7.1 NotificationType、§7.3 触发点
- **priority**: P0
- **锚点**: design.md §7.3
- **模块域**: backend, frontend

## D-002@v1

- **type**: requirement
- **status**: confirmed
- **source**: brainstorm step3（用户选择「有审批权限的全员」）+ 代码核实（permission_service owner-only）
- **question**: 审批待办通知发给谁？
- **answer**: change 门待办广播给工作区内持有 CHANGE_CREATE 权限的全体用户（镜像 has_permission 三段解析：工作区 grant ∪ 平台级 grant ∪ is_platform_admin）；daemon 权限审批为会话 owner 定向（审批本身 owner-only）。
- **normalized_requirement**: 新增 rbac.list_user_ids_with_permission 反查；notify_broadcast/notify_user 两个服务入口。
- **impacts**: auth/rbac.py 新函数、NotificationService 接口形状
- **evidence**: backend/app/modules/auth/rbac.py:107 has_permission 三段语义；backend/app/modules/daemon/permission_service.py owner 校验
- **priority**: P0
- **锚点**: backend/app/modules/auth/rbac.py:has_permission
- **模块域**: backend

## D-003@v1

- **type**: architecture
- **status**: superseded
- **source**: brainstorm step4 方案选择（AskUserQuestion 首选 B）
- **question**: 通知架构分层方案？
- **answer**: 方案 B：新建进程内事件总线 + per-user Redis 频道（multica 完整解耦模式）。
- **normalized_requirement**: （已被 v2 取代）当时拟新建 publish/subscribe 事件总线基建。
- **impacts**: 无（被 D-003@v2 取代，未进入设计文档正文）
- **evidence**: brainstorm step4 落盘记录（进度库）
- **priority**: P1
- **否决理由**: 用户复看后改选（「方案 A 吧」）——优先项目惯例一致与最小改动面，不为本变更首建事件总线。
- **复潮条件**: 项目出现 ≥2 个事件总线消费者（如 IM 推送、审计管道并行订阅审批事件）时重新评估总线化。

## D-003@v2

- **type**: architecture
- **status**: confirmed
- **source**: brainstorm step4 reopen（用户改选，supersedes D-003@v1）
- **question**: 通知架构分层方案（修订后定稿）？
- **answer**: 方案 A：审批触发点直调 NotificationService（best-effort）+ 通知服务内部 NotificationChannel 通道抽象（首个 InAppChannel）+ Redis 全局频道 notifications:new + SSE 服务端按当前用户过滤（照抄 sessions/events 模式）。
- **normalized_requirement**: 不新建事件总线；未来 IM = NotificationService 通道列表新增实现，触发点零改动（multica overlay 模式保留）。
- **impacts**: notification 模块整体结构、daemon/router.py:2867 作为 SSE 模板
- **evidence**: design.md §5 总体方案图、§7.1
- **priority**: P0
- **锚点**: design.md §7.1（NotificationChannel Protocol）
- **模块域**: backend

## D-004@v1

- **type**: data-model
- **status**: confirmed
- **source**: brainstorm step3（用户选择「通知表落库+可插拔通道」）+ step5 设计确认
- **question**: 通知落库模型？
- **answer**: notifications 表按接收人展开行（一行=一接收人一条通知，multica inbox_item 同款），支撑历史/未读数/已读状态；未来 IM 通道复用同一事实源。
- **normalized_requirement**: 表含 recipient_user_id/read_at/ref_type/ref_id/dedupe_key；列表与未读数查询按 recipient 索引。
- **impacts**: notification/model.py、Alembic 迁移
- **evidence**: design.md §8
- **priority**: P0
- **锚点**: design.md §8（数据模型）
- **模块域**: backend

## D-005@v1

- **type**: frontend
- **status**: confirmed
- **source**: brainstorm step3（用户选择「铃铛+下拉面板」）+ 原始需求「不要轮询形式」
- **question**: 前端通知形态与数据获取方式？
- **answer**: 顶栏铃铛+未读徽标+下拉面板（最近 20 条、点击已读+跳转、全部已读）；React Query 首载+窗口聚焦兜底，无 refetchInterval；fetch-sse 订阅 /api/notifications/events 事件驱动 invalidate；401/403/404 停连（对齐 ql-20260829-005）。独立通知中心页为后续扩展预留。
- **normalized_requirement**: lib/notifications.ts 三件套 + notification-bell.tsx + app-shell 挂载；禁 refetchInterval。
- **impacts**: 前端文件清单（design §6）
- **evidence**: design.md §7.4、prototype-notification-bell.html
- **priority**: P0
- **锚点**: design.md §7.4
- **模块域**: frontend

## D-006@v1

- **type**: reliability
- **status**: confirmed
- **source**: brainstorm step5 设计确认（对齐 _maybe_notify_session / publish_sessions_changed 降级惯例）
- **question**: 通知失败对审批主流程的影响？
- **answer**: 全链路 best-effort：落库独立事务（触发点事务已提交后调用），失败仅 log.warning 不抛、不回滚审批/进度；Redis publish 失败同样仅 warning（实时性降级，库内数据不丢）。
- **normalized_requirement**: 触发点钩子 try/except 包裹；NotificationService 方法内独立 commit。
- **impacts**: 三个触发点的接线方式、测试的降级用例
- **evidence**: design.md §7.1、§10 兼容策略
- **priority**: P0
- **锚点**: design.md §10
- **模块域**: backend

## D-007@v1

- **type**: behavior
- **status**: confirmed
- **source**: brainstorm step5 设计确认
- **question**: 审批待办通知与后续审批动作的关系（消解语义）？
- **answer**: 审批动作（四门 + approve/reject）成功后：resolve_pending 把同 ref 未读待办通知批量置已读（消解），随后向 change owner 发审批结果通知（通过/驳回/回退均通知；owner 为 None 跳过）。
- **normalized_requirement**: NotificationService.resolve_pending(ref_type, ref_id, types)；结果通知 ref 指向 change_id。
- **impacts**: change/service.py 四门接线、§9 生命周期契约表「待办消解」行
- **evidence**: design.md §7.3②、§9
- **priority**: P1
- **锚点**: backend/app/modules/change/service.py:_maybe_notify_session（同层接线）
- **模块域**: backend

## D-008@v1

- **type**: behavior
- **status**: confirmed
- **source**: brainstorm step5 设计确认（依据 permission_service owner-only 事实）
- **question**: daemon 权限审批哪些时点通知 owner？
- **answer**: handle_permission_request（canUseTool 与 AskUserQuestion dialog 两种 kind）产生请求 → 通知 owner；_on_timeout 超时失效 → 通知 owner；respond_permission/_respond_dialog（owner 自操作）→ 不通知。
- **normalized_requirement**: 两个挂钩点 + 一个明确豁免；ref_type 区分 session_permission/session_dialog。
- **impacts**: daemon/permission_service.py 接线、测试用例
- **evidence**: design.md §7.3③
- **priority**: P1
- **锚点**: backend/app/modules/daemon/permission_service.py:handle_permission_request
- **模块域**: backend

## D-009@v1

- **type**: correctness
- **status**: superseded
- **source**: brainstorm step6 写设计时对初稿「唯一索引幂等」的修订（驳回重跑场景推演）
- **question**: 待办广播的幂等机制？
- **answer**: 用「未消解存在性检查」：广播前查是否存在同 (ref_type, ref_id, type) 且 read_at IS NULL 的通知行，存在则跳过；不设全局唯一索引——驳回/回退重跑后同门待办再次产生时（旧通知已被 resolve_pending 消解）必须允许再次通知，唯一索引会误拦。dedupe_key 保留为审计/查询列（普通索引）。
- **normalized_requirement**: （已被 v2 细化）方向保留：未消解存在性检查 + 无唯一索引。
- **impacts**: §8 索引设计、§7.3① 触发点逻辑、R-02 风险登记
- **evidence**: design.md §7.3①、§8、§11 R-02
- **priority**: P1
- **否决理由**: Grill X-08 发现 v1 在 §7.1（service 按 ref_type/ref_id/type 查）与 §7.3①（触发点按 dedupe_key 查）两处定义了不同粒度的检查且检查方重复——统一收口到 service。
- **复潮条件**: 无（v2 为收口细化，方向一致）。

## D-009@v2

- **type**: correctness
- **status**: confirmed
- **supersedes**: D-009@v1
- **source**: design-grill（独立审查代理 X-08）
- **question**: 幂等检查由谁执行、键粒度是什么？
- **answer**: **service 内唯一检查方**（触发点不检查）：`notify_broadcast` 内查「同 (ref_type, ref_id, type) 且 read_at IS NULL」存在则跳过；dedupe_key 降为纯审计/追溯列（不参与检查、无独立索引，幂等检查走 ix_notifications_ref）。驳回重跑再通知路径闭合不变（resolve_pending 消解 → 检查放行）。
- **normalized_requirement**: notify_broadcast 签名不变（dedupe_key 必填仅作审计）；触发点①只负责判定 pending 与组装文案。
- **impacts**: design §7.1、§7.3①、§8、R-02
- **evidence**: design.md §7.1 docstring、§8；Grill cross-check X-08
- **priority**: P1
- **锚点**: design.md §7.1（notify_broadcast 幂等段）
- **模块域**: backend

## D-010@v1

- **type**: definition
- **status**: confirmed
- **source**: design-grill（独立审查代理 X-10，关闭自审存疑 S-01）
- **question**: daemon 权限通知的「会话 owner」取哪个口径？
- **answer**: **`AgentSession.user_id`**。respond 鉴权同源按 AgentSession.user_id（session/service.py:825-852），且 runtime owner ≠ session creator 是明文支持场景（:861-864）；若按 runtime（daemon_runtimes.user_id）口径会通知到无权响应的人（respond 404）。`_on_timeout` 只收请求 id，需重查会话取 owner（新开短 session）。
- **normalized_requirement**: 触发点③两处挂钩均以 AgentSession.user_id 为收件人；测试断言通知收件人=会话创建者。
- **impacts**: design §7.3③、§9 生命周期契约表
- **evidence**: backend/app/modules/daemon/session/service.py:825-852、:861-864；permission_service.py:887
- **priority**: P1
- **锚点**: backend/app/modules/daemon/session/service.py:825
- **模块域**: backend

## D-011@v1

- **type**: feasibility
- **status**: confirmed
- **source**: design-grill（独立审查代理 X-06）
- **question**: 触发点①（待办产生）的 pending 判定数据源？
- **answer**: 用 **in-hand `latest_progress`（本次刚提交到 PG 的 body）** 判定：复用 `_project_current_stage`/`_extract_current_stage`/`_extract_completed_stages` + `StageProjectionService._map` 既有先例（change/service.py:1882-1943，权威源=PG platform_change_progress）。**不重读 `compute_pending_review`**——它读服务器 sillyspec.db 镜像文件，与进度推送是两条通道，钩子时点可能滞后导致漏发/迟发。`_map` 单值返回 → 同一时刻至多一门 pending，无需多门循环（X-07 一并修正）。
- **normalized_requirement**: platform_sync 钩子内用与 _project_current_stage 相同的提取逻辑（提取函数复用或等价内联）从 body 判 pending，禁止调用 compute_pending_review。
- **impacts**: design §7.3①、§5 架构图、测试（断言以推送 body 为准）
- **evidence**: backend/app/modules/change/service.py:1882-1943（_resolve_pending_change_keys/_project_current_stage 先例）、backend/app/modules/change/projection.py:150-169（镜像 db 读取）、:175-210（_map 单值）
- **priority**: P1
- **锚点**: backend/app/modules/change/service.py:1882
- **模块域**: backend
