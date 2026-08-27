---
author: qinyi
created_at: 2026-08-28 03:12:50
---
# 任务清单（Tasks）

- [x] task-01: 后端绑定基座——ppm_item_session_links 表 + Alembic 迁移 + bind helper + 读取端点（W1）
- [x] task-02: 后端创建/追问/列表通道——schema 新字段 + create_session 绑定与工作区解析 + inject 追问绑定 + 会话列表 ppm 筛选（W2, depends_on: task-01）
- [x] task-03: 后端上下文注入——build_ppm_item_context_preamble 前导 + PPM 附件物化/降级（_can_access + flush-only 事务拆分）（W3, depends_on: task-02）
- [x] task-04: 前端 API 层——gen:types + lib/daemon.ts 参数透传 + listItemSessions（W3, depends_on: task-02）
- [x] task-05: 前端任务/问题侧入口与卡片——pendingPpmItem 挂起位通道 + 发起会话入口 + ppm-item-sessions-card（W4, depends_on: task-03, task-04）
- [x] task-06: 前端 @联想与筛选——mention-sources PPM 分组 + query-keys + popover 渲染 + 会话列表筛选 ppm 选项（W5, depends_on: task-04, task-05 串行）
- [x] task-07: 「发起团队」预选修复——autoTeamIntent/autoTeamOpen 通道 + defaultProjectId 预选 + objective 预填（W1）
