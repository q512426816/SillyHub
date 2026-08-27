---
author: qinyi
created_at: 2026-08-28 03:28:10
---

# 模块影响分析（Module Impact）— 会话关联 PPM 任务/问题 + 发起团队预选修复

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend ppm | 修改+新增 | common/ 新增 session_binding.py（PpmItemSessionLink 表 + bind/resolve/load helper）与 router.py（GET /api/ppm/item-sessions）；main.py 挂载 ppm_common_router；common/tests 新增 test_session_binding.py；跨 task/problem 两子域的中立落点（对齐 common/crud.py 先例） |
| backend daemon | 修改 | schema.py SessionCreateRequest + ppm_item_kind/ppm_item_id（成对校验 422）、SessionInjectRequest + bind_ppm_item_*；session/context.py 新增 build_ppm_item_context_preamble（【PPM 任务上下文】/【问题上下文】全字段前导）；session/service.py create_session 绑定/工作区解析/附件物化接线（物化在前、前导消费 attachment_lines、事务拆分 flush-only）、inject 追问绑定分支、list_agent_sessions ppm 子查询；router.py 三层透传；新增 test_ppm_session.py + 既有 test_session_service/test_sessions_list_filters/test_change_session/test_page_context_preamble/test_inject_first_turn_briefing 适配 |
| backend file / session_attachment / workspace | 只读复用 | 物化消费 FileService._can_access 口径与 file storage 读取、session attachment storage store_bytes 与 assemble_inject_attachments 组装链、ppm_project_workspace 关联表（ORDER BY workspace_id ASC）；表结构零改动 |
| frontend | 修改+新增 | lib——daemon.ts 透传 + listItemSessions、api-types.ts/openapi.json 重生成（gen:types）、session-mention(-sources).ts PPM 分组、query-keys.ts 缓存键、ppm/task.ts+problem.ts 参数；组件——新增 ppm/ppm-item-sessions-card.tsx，session-panel.tsx（ppmItem/mentionBindOptions/autoTeamOpen 最小接线）、team-trigger-popover.tsx（defaultProjectId 预选）、session-mention-popover.tsx（分组渲染）、session-list-panel.tsx（ppm 筛选）；页面——task-plans/workbench-task-table/problem-drawer 三入口；stores/floating-session + floating-session-host（pendingPpmItem 挂起位 + autoTeamIntent） |
| sillyhub-daemon | 无变化 | 附件走既有 SessionInjectAttachment 协议与 session-attachments 下载端点（D-006 物化保证 id 兼容）；绑定/前导全在 backend 侧完成 |

## 未匹配文件

无——design §6 清单 23 个文件均落在上述模块内（alembic 迁移归 backend ppm 域）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 daemon 模块卡（ppm 绑定字段/前导/物化/筛选条目）与 ppm 子树条目（common/ 新增 session_binding + item-sessions 端点） | done（2026-08-28）：条目追加至 `modules/backend.changelog.md` sidecar（change 2026-08-28-session-ppm-task-binding）；backend.md 正文核对无与本次变更直接冲突的描述（PPM 子树行系子域粗枚举、common/ 本不在列），未改动 |
| `modules/frontend.md` | 更新 frontend 模块卡（ppm-item-sessions-card、mention PPM 分组、floating store 挂起位、team 预选条目） | done（2026-08-28）：条目追加至 `modules/frontend.changelog.md` sidecar（change 2026-08-28-session-ppm-task-binding）；frontend.md 正文核对无与本次变更直接冲突的描述（无 @联想分组穷举式描述），未改动 |
| `_module-map.yaml` | 无变化（未增删模块，仅模块内新增文件） | skipped |
