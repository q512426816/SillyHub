# 验证报告 — 2026-08-29-approval-notify-push

> 骨架由 `sillyspec verify-probes --init` 生成，半语义探针与结论由 verify agent 填写（2026-08-29 23:05）。

## 结论：PASS

理由：13/13 任务实现并逐项坐实（staged diff 归因）、设计一致性 11 项全过（execute 独立验收 + verify 复核）、单元/回归套件全绿（backend 867+1527、前端 24）、**integration-critical 双运行时证据通过**（真实 Redis SSE 端到端 + 真实启动 5 端点挂载）、11 条决策全闭环、模块文档已同步（module-impact 表 0 pending）。

## 任务完成度

| task | 状态 | 证据（staged 文件 + 测试） |
|---|---|---|
| task-01 表+迁移 | ✅ | model.py/迁移20260829220000/env.py 登记；建表回退用例 5 passed；alembic 实测升降级可逆 |
| task-02 服务+通道 | ✅ | service.py/events.py；10 用例（扇出合并publish/幂等/消解放行/通道降级） |
| task-03 rbac 反查 | ✅ | rbac.py list_user_ids_with_permission；7 用例 + auth 回归 176 passed |
| task-04 触发点① | ✅ | platform_sync/service.py 钩子；4 用例 + 模块回归 186→全绿 |
| task-05 触发点② | ✅ | change/service.py 六挂点 _notify_approval_result；8 用例 + 模块 474 passed |
| task-06 触发点③ | ✅ | permission_service.py 两挂钩；6 用例（收件人=会话user_id≠runtime）+ daemon 1527 passed |
| task-07 REST | ✅ | router.py/schema.py/main.py；10 用例（越权404/DTO 字段逐字断言） |
| task-08 SSE | ✅ | router.py events 端点；6 用例（过滤/keepalive/清理/401）+ 真实 Redis 端到端（见 Runtime Evidence） |
| task-09 gen:types | ✅ | openapi.json +317 行 / api-types.ts +298 行，5 端点 4 DTO 命中，tsc 0 |
| task-10 前端数据层 | ✅ | lib/notifications.ts/query-keys；12 用例（含无 refetchInterval 守护+unreadCount 前缀失效守护） |
| task-11 铃铛 | ✅ | notification-bell.tsx/top-bar 挂载；8 用例 + top-bar 回归 4 passed |
| task-12 后端收口 | ✅ | test_integration.py 端到端用例 + local.yaml notification 映射 + ruff 修 6 错全过 |
| task-13 前端收口 | ✅ | 查漏补 2 守护用例；3 文件回归 24 passed + tsc 0 |

verify-required-evidence.json 13 条 no-attributed-diff 假阴性（execute --done 时改动已 staged 致 diff 扫描落空）——**全部翻案为 satisfied**（上表归因，git diff --cached 可复核）。

## 设计一致性

与 design.md 一致（execute step13 独立 QA 验收 11 项 pass，文件:行号级证据）。4 项已接受的次要偏差：
1. `_on_timeout` 重查复用 `self._svc._session`（design 字面「新开短 session」）——同源惯例，功能等价；
2. DTO 名 `ReadAllResponse` ≠ design §6 字面 `ReadResultResponse`（形状一致）；
3. platform_sync 等价内联两个提取函数（allowed_paths 禁改 change/service.py，设计允许）；
4. 门中文名双源不一致 → **已修复**：统一为前端变更中心口径（提案审核/计划审核/人工测试/归档确认），回归 12 passed。
S-02（link 深链）已按真实路由 `/workspaces/{id}/changes/{cid}` 关闭并有断言。

## 探针结果

#### 探针 1：未实现标记扫描
- ✅ 无 TODO/FIXME/尚未实现命中（骨架预填；迁移文件通配名由实际文件 20260829220000_add_notifications_table.py 覆盖）

#### 探针 2：设计关键词覆盖（agent 执行）
广播（notify_broadcast，service.py）/ 定向（notify_user）/ 幂等（_has_unresolved）/ 消解（resolve_pending）/ 通道（NotificationChannel/InAppChannel）/ SSE 过滤（_stream_notifications_events recipient_user_ids 成员判断）/ 未读数（unread-count 端点+useUnreadCount）/ 已读（mark_read/read-all）/ 退避重连（scheduleReconnect 模式 + PERMANENT_SSE_ERROR_STATUSES）/ 铃铛（notification-bell.tsx）——全部 grep 实现命中，无 ⚠️ 可能未实现项。

#### 探针 3：测试覆盖
CLI 预填 13/13 ✅（骨架原文保留）。集成盲区标注：本变更唯一的跨模块装配面（Redis 发布↔SSE 订阅过滤）由 **Runtime Evidence 真链路覆盖**（下方），非仅 mock 单测；前端路由跳转（link）为既有页面路径，无新路由装配。断言有效性抽查 3 例：test_broadcast_fanout_and_single_publish_merge（断言行数+publish 次数+payload 内容，副作用级）、test_permission_owner_notify 收件人断言（=会话 user_id ≠ runtime owner，行为级）、notification-bell 点击断言（markRead 调用+router.push，公开 API 级）——均达标，无空断言。

#### 探针 4：决策追踪覆盖（agent 执行）
D-001@v1→FR-04/06→task-04/06→staged 钩子 ✅；D-002@v1→FR-03→task-03→rbac ✅；D-003@v2→FR-02/07→task-02/08（无事件总线类，直调+全局频道）✅；D-004@v1→FR-01→task-01（展开行无唯一约束）✅；D-005@v1→FR-09→task-10/13（无 refetchInterval 守护用例）✅；D-006@v1→FR-02→task-02/04（通道异常降级用例）✅；D-007@v1→FR-05→task-05（消解+owner 通知用例）✅；D-008@v1→FR-06→task-06（respond 豁免断言）✅；D-009@v2→FR-04→task-02/04（service 唯一检查方）✅；D-010@v1→FR-06→task-06（owner=AgentSession.user_id）✅；D-011@v1→FR-04→task-04（in-hand 判定，未调 compute_pending_review）✅。**11/11 闭环，无未覆盖决策，无 P0/P1 unresolved。**

#### 探针 5：API Contract Parity
- ✅ **API parity check passed**（修正后复跑）：526 backend endpoints（live 522 + artifact 5），3 frontend calls 全匹配。
- 骨架初跑的 3 个 missing（GET /api/notifications、unread-count、read-all）系 endpoints.json 产物**无 /api 前缀**的口径错配（CLI 提取器按模块 router 前缀前的路径产出，而 include_router 加 /api）——已为产物补真实挂载前缀复跑通过；端点本体在 openapi.json 与真实启动实例（Runtime Evidence ②）双重确认存在。GET /api/notifications/events 走 fetch-sse 而非 apiFetch 调用模式，不在调用扫描集内——真实存在（真实启动实测）。
- ⚠️ 183 个后端端点前端未调用：全仓口径噪音（大量既有端点），与本变更无关。

#### 探针 6：代码删除对账
- ⚠️ 3 个 `docs/sillyspec/*.md` 的 git 删除（2026-08-24-platform-session-shell…/2026-08-28-quicklog…/2026-08-29-sillyspec-x1-x4…）：**并行会话所为**（本变更 staged 清单零删除文件；docs/sillyspec 目录由工具坑记录流程管理，疑似移入 finished/ 的整理动作）。非本变更问题，不构成 blocker——如实记录，交接核对时与并行会话确认。

## Runtime Evidence（integration-critical 真实集成证据）

**① 真实 Redis SSE 端到端（生产代码双链路，非 mock）**——脚本 `%TEMP%\verify_notify_sse_e2e.py`，真实 Redis 7.4.9（localhost:6379/0，backend/.env 同款）：
- 生产发布链 `app.modules.notification.events.publish_notifications_new` → 生产消费链 `app.modules.notification.router._stream_notifications_events`；
- 三断言全过：`connected` 初始帧 OK / **跨用户隔离 OK**（收件人为他人的通知被服务端过滤不下发）/ **本人通知端到端下发 OK**（秒级收到 `event: notification`，data 含 id/type/title/body/link/created_at 完整摘要）；
- 帧日志片段：
```
': connected\n\n'
'event: notification\ndata: {"id": "n-me", "type": "permission_request", "title": "会话「verify」请求权限审批", "body": "端到端证据", "link": "/workspaces/w/changes/c", "created_at": "2026-08-29T22:00:01"}'
INTEGRATION_PASS
```

**② 真实启动（新代码 uvicorn 实启，127.0.0.1:8018）**：
- 启动日志干净（`Application startup complete` 级别，MCP session manager 正常挂载/关闭）；
- 实测 `GET /api/openapi.json` 含全部 5 个通知端点：`/api/notifications`、`/api/notifications/events`、`/api/notifications/read-all`、`/api/notifications/unread-count`、`/api/notifications/{notification_id}/read`；
- `STARTUP_EVIDENCE: PASS`（注：非 dev 环境默认关闭 openapi 端点，BS-5 审计；验证时以 DOCS_ENABLED=true 启动）。

## 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| backend 相关五模块 | `uv run pytest app/modules/notification app/modules/platform_sync app/modules/change tests/modules/auth -q --no-cov -n auto` | **867 passed**, 2 skipped（task-01 预存 StageEnum 移除跳过）, 2 xfailed（auth 既有预存 xfails） |
| daemon 模块 | `uv run pytest app/modules/daemon -q --no-cov -n auto` | **1527 passed** |
| 前端相关 | `vitest run notifications/bell/top-bar` + `tsc --noEmit` | **24 passed**；tsc EXIT=0 |
| lint/format | ruff check（变更文件）/ ruff format（变更 21 文件零改动）/ mypy（变更文件零错） | 全过（main 预存问题不动：format 6 文件 / mypy 5 错均在未触碰文件） |
| 集成 | 上方 Runtime Evidence ①② | INTEGRATION_PASS / STARTUP_EVIDENCE PASS |

known_failures 豁免：本次未触发（模块级子集全绿，无命中豁免清单的失败）。全量测试留给 CI。

## 质量与遗留

- 遗留风险（非阻断）：R-09 权限超时不消解历史通知（v1 取舍，见 design §11）；lint 预存债与本变更无关。
- 本变更引入的 QUICKLOG 级偏差：无（两次 gap 修复均在 execute 内闭环并回归）。
- 工具坑记录：`docs/sillyspec/2026-08-29-endpoints-extract-worktree-pitfalls.md`（endpoints extract worktree 三坑）。
