---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-31 — install.ps1 双 BOM 修复（quick ql-20260831-003-3d0a）
- backend/Dockerfile 删构建时 `printf '\357\273\277'` 补 BOM（与源文件 BOM 叠加成双 BOM，dist_router utf-8-sig 只剥一个，残留 `\ufeff` 致用户 `irm | iex` 首行注释被当代码执行报"无法将 Windows 项识别为 cmdlet"），并加"恰好一个 BOM"构建断言（首 3 字节 = EF BB BF 且第 4-6 字节 ≠ EF BB BF，违反即构建失败）；test_daemon_dist fixture 模板改带单 BOM 还原真实镜像状态 + 响应体不以 `\ufeff` 开头回归锚点。BOM 单一来源 = 源文件，详见 daemon.md 编码契约。

## 2026-08-29 — 权限审批 owner 定向通知（变更 2026-08-29-approval-notify-push task-06）
- permission_service：handle_permission_request（canUseTool/dialog 双 kind，WS/HTTP 单点覆盖）在 _publish_session_event 成功后通知会话 owner（=AgentSession.user_id，非 runtime owner，D-010@v1）；_on_timeout 重查会话发 permission_timeout；respond 路径不通知（自操作豁免 D-008@v1）。用例 tests/test_permission_owner_notify.py。

## 2026-08-30 — 风险审查高置信缺陷修复批（quick ql-20260830-001-2e52）
- sweep（session_offline_sweep_once）补重派失败自愈链：每轮捞「failed worker + 末次 run=daemon_interrupted + 原 runtime 回在线 + 宽限窗内」重 fire（审计⑤，NoOnlineDaemonError 返回 None 后此前永不再被选中）；usage 端点 GET /sessions/{id}/usage 权限闸门对齐 TaskRunAgentUser + 软删 deleted_at 404（审计⑥）；SessionService 激活分支（_activate_tool_report_session）与 handle_plan_response 补归档禁写守卫（审计④-1/④-7，4d64cb28 声称的激活分支覆盖缺口收口）。

## 2026-08-30 — 剩余中置信缺陷修复批（quick ql-20260830-002-f0d2）
- R8 reopen_session 补归档禁写守卫（_ensure_session_workspace_writable，复活会话句柄同样 409）。

## 2026-08-29 — 权限通知补会话深链（quick 修复）

- `_notify_session_owner` 的 link 由 None 改为 `/sessions?session={session_id}`（sessions-portal.tsx:134 深链参数）：点击铃铛通知直达对应会话的提问/权限卡片，覆盖 permission_request 与 permission_timeout 两类（ql 条目见 QUICKLOG，关联变更 2026-08-29-approval-notify-push）。

## 2026-08-30 — 权限/提问通知 body 去重（quick 样式优化）

- `_notify_session_owner` 文案：提问（dialog）body 放提问预览（`_dialog_preview`，与前端 resolvePendingTitle 同口径读 questions[]，兼容顶层 question，60 字截断）；canUseTool body=「请求使用工具：{tool_name}」；超时 body=None——不再与 title 逐字重复。

## 2026-08-31 — 机器 sillyspec 版本显示与远程升级（2026-08-31-machine-sillyspec-version）

- daemon_instances 加 sillyspec 三列（version/latest/update，迁移 20260831150000）；register/heartbeat DTO 与服务层落 D-002@v1 双通道语义（register 直写含 None / 心跳 version+latest 非 None 覆盖 / sillyspec_update 无键清除、upsert 盖 since、error 截断 200）。
- protocol.py `DAEMON_MSG_SILLYSPEC_UPDATE` + ws_hub.send_sillyspec_update；router 增 POST /machines/{id}/sillyspec-update（归属 404 + 离线 504 + {"sent":true}）；机器视图 _build_machine_read 显式组装三字段 + MachineSillySpecUpdateRead 嵌套（就近 MachinePendingUpdateRead）。

## 2026-09-04 — 派发失败收链 _row 未绑定修复（quick 修复）

- ql-20260904-003-8e4a | _inject_into_session 派发失败收链 _row 未绑定 UnboundLocalError 修复（24h 审计 H1）
- de664fb69 在 not control_ok 分支引用仅在非切换分支赋值的 `_row`：切换轮 hub 直推失败与 runtime 解析失败（daemon_id=None）两条路径抛 UnboundLocalError（500 替代 504、run 永久残留 running）。修复为 `_row: DaemonControlCommand | None = None` 预初始化 + 判空后取消；回归用例 test_control_command_dispatch.py::TestInjectDispatchFailureConvergence 两例。
