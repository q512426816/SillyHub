---
author: qinyi
created_at: 2026-08-29 14:52:10
---
# 提案书（Proposal）

## 动机

SillyHub 审批流缺乏任何及时感知手段：审批待办产生后，审批人只能靠前端定时轮询（变更审批 30s、权限审批 10s）或主动刷新页面才能发现；审批结果、权限审批超时对发起人同样是被动可见。本变更为审批流建立**站内通知推送**基础设施：通知落库（事实源）+ Redis→SSE 实时推送 + 顶栏铃铛，并预留未来钉钉/企微 IM 推送的通道抽象（参考 multica「收件箱为事实源、IM 为叠加层」模式）。

## 关键问题

1. **待办产生零事件**：change 四审核门的待办是 `latest_progress` 的只读投影，`platform_sync` 进度落库处没有任何事件发布——审批人无从及时得知「有东西待审」，全靠轮询兜底。
2. **无通知基建**：项目没有通知表、未读数、铃铛或任何通知消费端；daemon 权限审批虽有 per-session SSE，但用户没开着审批页就收不到，5 分钟超时静默失效。
3. **轮询不可扩展为 IM 推送**：现有「拉」模式无法演进为未来的钉钉/企微「推」模式——需要先有「通知事实源 + 投递通道」的分层，IM 才能作为叠加通道接入而无需改动审批业务代码。

## 变更范围

- 新增后端 `notification` 模块：`notifications` 表（按接收人展开行）+ `NotificationService`（广播/定向入口、幂等、消解）+ `NotificationChannel` 通道抽象（首个 `InAppChannel`：落库 + Redis 全局频道 `notifications:new`）+ 4 个 REST 端点 + 1 个 SSE 端点（服务端按当前用户过滤，照抄 `sessions/events` 先例）。
- 三处审批触发点接线：① `platform_sync.upsert_progress` 待办产生广播（in-hand body 判定）；② change 四门 + approve/reject 结果通知 owner + 待办消解；③ daemon 权限请求/超时定向通知会话 owner。
- RBAC 广播收件人反查 `list_user_ids_with_permission`（镜像 `has_permission` 三段语义）。
- 前端：`lib/notifications.ts` 数据层（**无 refetchInterval，SSE 事件驱动 invalidate**）+ `notification-bell.tsx` 铃铛下拉面板（三主题）+ `top-bar.tsx` 挂载 + `pnpm gen:types` 类型同步。
- 详见 `design.md` §6 文件变更清单（22+ 文件）。

## 不在范围内（显式清单）

- 不做钉钉/企微 IM 实际推送（仅预留通道抽象，后续独立变更）
- 不做 release 审批投票通知（架构可容纳，未来加触发点）
- 不做独立通知中心页（本次仅铃铛+下拉面板）
- 不做通知偏好/静音/订阅管理
- 不做存量待办回溯补发
- 不做 WebSocket 通道
- 不移除既有审批页轮询兜底与 sessions/events 等 SSE（行为不变）

## 成功标准（可验证）

- agent 推送进度使某审核门待办产生后：工作区内有 CHANGE_CREATE 权限的用户铃铛未读数**秒级**增长（SSE 推送，无轮询间隔）；未在线用户下次打开页面可见通知。
- 审批动作（通过/驳回/回退）后：change owner 收到结果通知，对应待办通知自动置已读。
- daemon 权限请求产生/超时：会话 owner 收到定向通知；owner 自己审批不产生通知。
- 通知链路任何一环失败（Redis 不可用、落库异常）不影响审批主流程（best-effort）。
- 同一待办重复推送进度不重复通知（幂等）；驳回重跑后待办再现会再次通知。
- 现有 API/表结构零破坏；`pnpm gen:types` 与后端 schema 同步；相关测试绿。
