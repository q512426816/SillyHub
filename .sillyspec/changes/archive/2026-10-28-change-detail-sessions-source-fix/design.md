---
author: flow-machine-draft
created_at: 2026-10-27T20:44:07.964Z
---
# 设计记录（Design Record）— 2026-10-28-change-detail-sessions-source-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

核查结论（云端生产库直接取证）：`2026-10-26-mobile-four-page-layout-fix` 在库层只挂 1 个会话（ee002255，真执行该变更的会话，首条输入即手机截图附件），全库各变更挂 2-3 会话均正常——**关联没乱，乱的是显示**。桌面变更详情页 `page.tsx` 把 `listWorkspaceAgentSessions(workspaceId)`（工作区全量会话）塞给概览侧栏「会话」区（slice(0,3)）与审批卡「绑定会话」（sessions[0]），与该变更零关联；叠加首条输入为附件时标题显示 `[附件:<uuid>` 前 30 字，形成「乱七八糟」观感。移动端 `mobile-change-detail.tsx` 数据源本就正确，不动。

修复分两端：① 前端 `page.tsx` 数据源换成既有 `listChangeSessions(workspaceId, changeId)`（change_session_links 真实关联，与后端审批注入 `_notify_bound_session` 同源），侧栏状态列改中文标签；② 后端新增共享标题剥离 helper，change/agent 两处窗口查询消费，daemon 侧在读展示时消费（存量 title_fallback 列不重算、零迁移）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增纯函数 `session_display_title(content: str | None) -> str | None`（`backend/app/modules/session_attachment/service.py`，与附件标记行格式权威源同文件）：剥 `[附件:<uuid>|<kind>|<name>]` 行→取首个非空行前 30 字；纯附件回退首个附件 name；空输入返回 None。
- `change/router.py::_fetch_session_titles`：SQL substr 1,64 → 1,512（附件标记行每条约 60 字符，64 字内可能全是标记导致剥离后无文本；512 字节远小于 TOAST 均值 33KB，性能口径可接受），Python 侧消费 helper。
- `agent/router.py` 会话列表标题提取：同款同步。
- `daemon/router/session_crud.py`：title_fallback **读展示**时过 helper；持久化值与自愈回写不动（零迁移）。
- 前端 `workspaces/[id]/changes/[cid]/page.tsx`：`listWorkspaceAgentSessions` → `listChangeSessions`；`change-overview-side.tsx` 状态列 `s.status` → 中文标签映射（本地 `SESSION_STATUS_LABELS`，项目惯例各组件本地拷贝）。
- 无 schema/DTO 改动——`pnpm gen:types` 不适用。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：标题取「最早一条 user_input」由窗口函数 ROW_NUMBER(timestamp asc, id asc) 保证，与到达顺序无关；change_session_links 由三个既有写入口幂等落行，本变更不改写入侧。listChangeSessions 按 last_active_at 倒序、上限 _CHANGE_SESSIONS_MAX 不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：纯读端点 + 前端数据源替换，无新写入面。daemon 读侧 helper 是纯函数无状态；title_fallback 列读写不新增（读展示清洗，自愈回写逻辑不动）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：listChangeSessions 失败时页面沿既有 `.catch(() => [])` 降级为空列表（「暂无会话」空态），与原实现同级安全；boundSession 为 null 时审批卡显示既有虚线空态，不阻断审批动作。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：listChangeSessions 带显式 workspaceId+changeId 路径参数；既有端点按 change_id JOIN links 取数、鉴权走 CHANGE_READ（成员资格校验），change_id 为 UUID 不可猜测——归属校验属 2026-07-09 既有端点行为（评审 P3 指出查询本身不带 workspace_id 过滤，非本变更引入）；相比原「工作区全量」反而收窄了作用域，不会串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：substr 64→512 放宽后单行拉回字节量增大（数百会话列表请求时放大），但 512B×N 远小于原 TOAST 全文口径，且仅标题子查询路径。评审 P1（已修复）：daemon 自愈回写 healed 原样超 title_fallback 列宽 String(64) 会使 PG 列表 500——回写截 [:64] 对齐列宽，防回归测试钉死（写回值长度断言双方言可判）。已放弃方案：① SQL 侧正则剥离（PG regexp_replace 与 SQLite 方言分叉，违反双方言约束）；② 重算存量 title_fallback 列（需迁移+回填，把小修复撑大，读侧清洗可达同显示效果）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/session_attachment/service.py | 新增共享 helper session_display_title |
| 修改 | backend/app/modules/change/router.py | _fetch_session_titles substr 512 + 消费 helper |
| 修改 | backend/app/modules/agent/router.py | 标题提取同步消费 helper |
| 修改 | backend/app/modules/daemon/router/session_crud.py | title_fallback 读展示过 helper |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 数据源换 listChangeSessions |
| 修改 | frontend/src/components/changes/detail/change-overview-side.tsx | 状态列中文标签 |
| 修改 | backend/app/modules/session_attachment/tests/test_capability.py | helper 单测 |
| 修改 | backend/app/modules/change/tests/test_change_sessions_cap.py | 附件标题断言 |
| 修改 | frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx | 数据源/中文标签断言 |
