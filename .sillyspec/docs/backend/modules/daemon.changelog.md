---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-31 — install.ps1 双 BOM 修复（quick ql-20260831-003-3d0a）
- backend/Dockerfile 删构建时 `printf '\357\273\277'` 补 BOM（与源文件 BOM 叠加成双 BOM，dist_router utf-8-sig 只剥一个，残留 `\ufeff` 致用户 `irm | iex` 首行注释被当代码执行报"无法将 Windows 项识别为 cmdlet"），并加"恰好一个 BOM"构建断言（首 3 字节 = EF BB BF 且第 4-6 字节 ≠ EF BB BF，违反即构建失败）；test_daemon_dist fixture 模板改带单 BOM 还原真实镜像状态 + 响应体不以 `\ufeff` 开头回归锚点。BOM 单一来源 = 源文件，详见 daemon.md 编码契约。

## 2026-08-29 — 权限审批 owner 定向通知（变更 2026-08-29-approval-notify-push task-06）
- permission_service：handle_permission_request（canUseTool/dialog 双 kind，WS/HTTP 单点覆盖）在 _publish_session_event 成功后通知会话 owner（=AgentSession.user_id，非 runtime owner，D-010@v1）；_on_timeout 重查会话发 permission_timeout；respond 路径不通知（自操作豁免 D-008@v1）。用例 `backend/app/modules/daemon/tests/test_permission_owner_notify.py`。

## 2026-08-30 — 风险审查高置信缺陷修复批（quick ql-20260830-001-2e52）
- sweep（session_offline_sweep_once）补重派失败自愈链：每轮捞「failed worker + 末次 run=daemon_interrupted + 原 runtime 回在线 + 宽限窗内」重 fire（审计⑤，NoOnlineDaemonError 返回 None 后此前永不再被选中）；usage 端点 GET /sessions/{id}/usage 权限闸门对齐 TaskRunAgentUser + 软删 deleted_at 404（审计⑥）；SessionService 激活分支（_activate_tool_report_session）与 handle_plan_response 补归档禁写守卫（审计④-1/④-7，4d64cb28 声称的激活分支覆盖缺口收口）。

## 2026-08-30 — 剩余中置信缺陷修复批（quick ql-20260830-002-f0d2）
- R8 reopen_session 补归档禁写守卫（_ensure_session_workspace_writable，复活会话句柄同样 409）。

## 2026-08-29 — 权限通知补会话深链（quick 修复）

- `_notify_session_owner` 的 link 由 None 改为 `/sessions?session={session_id}`（`frontend/src/components/sessions-portal.tsx` 深链参数）：点击铃铛通知直达对应会话的提问/权限卡片，覆盖 permission_request 与 permission_timeout 两类（ql 条目见 QUICKLOG，关联变更 2026-08-29-approval-notify-push）。

## 2026-08-30 — 权限/提问通知 body 去重（quick 样式优化）

- `_notify_session_owner` 文案：提问（dialog）body 放提问预览（`_dialog_preview`，与前端 resolvePendingTitle 同口径读 questions[]，兼容顶层 question，60 字截断）；canUseTool body=「请求使用工具：{tool_name}」；超时 body=None——不再与 title 逐字重复。

## 2026-08-31 — 机器 sillyspec 版本显示与远程升级（2026-08-31-machine-sillyspec-version）

- daemon_instances 加 sillyspec 三列（version/latest/update，迁移 20260831150000）；register/heartbeat DTO 与服务层落 D-002@v1 双通道语义（register 直写含 None / 心跳 version+latest 非 None 覆盖 / sillyspec_update 无键清除、upsert 盖 since、error 截断 200）。
- protocol.py `DAEMON_MSG_SILLYSPEC_UPDATE` + ws_hub.send_sillyspec_update；router 增 POST /machines/{id}/sillyspec-update（归属 404 + 离线 504 + {"sent":true}）；机器视图 _build_machine_read 显式组装三字段 + MachineSillySpecUpdateRead 嵌套（就近 MachinePendingUpdateRead）。

## 2026-09-04 — 派发失败收链 _row 未绑定修复（quick 修复）

- ql-20260904-003-8e4a | _inject_into_session 派发失败收链 _row 未绑定 UnboundLocalError 修复（24h 审计 H1）
- de664fb69 在 not control_ok 分支引用仅在非切换分支赋值的 `_row`：切换轮 hub 直推失败与 runtime 解析失败（daemon_id=None）两条路径抛 UnboundLocalError（500 替代 504、run 永久残留 running）。修复为 `_row: DaemonControlCommand | None = None` 预初始化 + 判空后取消；回归用例 test_control_command_dispatch.py::TestInjectDispatchFailureConvergence 两例。

## 2026-09-04 — sillyspec_update state 取值补 up_to_date（quick ql-20260904-019-b4f4）

- DaemonHeartbeatSillySpecUpdate / MachineSillySpecUpdateRead docstring 补 state 新取值 up_to_date（daemon 手动升级已最新的明确反馈终态）——schema 本就 string 不收紧零行为改动，gen:types 同步 openapi.json/api-types.ts（diff 仅注释文本）。

## 2026-09-24 — 24h 审查修复：fork 锚点 marker 卡死 + 原生 fork 空首句（quick ql-20260924-001）

- submit_commit `_persisted_engine_anchors` 对齐候选排除 override 标记行（log_id 非空 + stale=True 无对应 flat record，双指针卡死丢锚 → fork 截断点偏早丢轮尾）；守护测试 test_override_marker_row_not_stall_anchor_cursor。
- create.py native fork（prompt 空且无附件）dispatch_prompt 归零：lease metadata prompt 与首轮 SESSION_INJECT 均不再携带前导-only 载荷（原行为＝前导被当首轮执行 / 空载荷被 daemon 判「缺少必要字段」回报 run 失败）；对照回归 seed 档种子文本照常下发。
- 2026-10-13-multiturn-changeid-misjudge | 动机：轮级变更归因（2026-10-12-run-level-change-attribution）给聊天轮 run.c
||||||| C:/Users/12532/AppData/Local/Temp/d.base
- 2026-10-13-slim-subagent-false-running | 动机：历史会话里已结束的子代理（Explore/general-purpose 等）永远显示「运行中」——2026-09
| 2026-10-13 | 2026-10-14-ci-red-batch-fix | 动机：main 最新 push（4347239）后 backend-ci / daemon-ci / frontend- |
| 2026-10-15 | 2026-10-15-pseudo-domain-migration | 用户指令：把平台仓存量伪域迁真域。背景：sillyspec 仓 2026-10-15-module-… |
| 2026-10-15 | 2026-10-15-workspace-session-agent-only | 工作区中新建会话不再选机器：机器已由工作区绑定决定，浮层只让用户选智能体类型 |
| 2026-10-16 | 2026-10-16-session-run-status-realtime | 会话列表行首状态目前只靠 daemon 10 秒日志推导活性链（基线），用户触发会话后转圈/完成提示… |
| 2026-10-20 | 2026-10-20-conflict-platform-archive | 冲突对比平台留档快照自足回退 |
| 2026-10-21 | 2026-10-21-provider-set-default-ui | 供应商页复活设为默认入口 |
| 2026-10-21 | 2026-10-21-agent-profile-slim-default | 档案瘦身重定位为人格加技能清单并支持用户默认档案 |
| 2026-10-20 | 2026-10-20-session-status-live-sync | 左侧会话状态标签与右侧实时同步 |
| 2026-10-21 | 2026-10-21-daemon-zombie-turn | 修复 daemon 会话僵尸轮与打断无效 |
| 2026-10-21 | 2026-10-21-session-git-branch | 会话组件底部动态显示当前所在 git 分支 |
| 2026-10-22 | 2026-10-22-turn-trigger-metadata-p2 | 轮触发溯源 Phase 2：定时消息接入与 metadata 戳驱动 |
| 2026-10-22 | 2026-10-22-merge-regression-fixes | 合并回归债收口：grants 闭包与 lease 双流断言 |
| 2026-10-22 | 2026-10-22-sillyspec-probe-db-missing-evict | 已删工作区探针自动淘汰与诊断增强 |
| 2026-10-22 | 2026-10-20-session-awaiting-answer-status | 左侧会话状态补充等待回答问号 |
| 2026-10-22 | 2026-10-22-conversation-live-marquee | 会话页「对话」tab 运行中时只有一行状态条，用户感知不到 agent 正在真实执行；希望在该轮末尾… |
| 2026-10-22 | 2026-10-22-agent-profiles-page-restyle | 智能体档案列表页重设计 |
| 2026-10-23 | 2026-10-22-session-composer-slim | 会话页面底部输入区信息过载：排队消息与纯文本展示露出附件引用 uuid 长串，中断自动续跑是常驻开关… |
| 2026-10-23 | 2026-10-23-live-turn-meta-time | 进行中轮次底部元信息时间显示修复 |
| 2026-10-23 | 2026-10-23-askuser-history-live-sync | AskUser 问答历史实时回显（用户实测 bug 修复） |
| 2026-10-23 | 2026-10-23-file-card-agent-grouping | 文件变更卡按AGENT编辑分组展示并修弹窗说明 |
| 2026-10-23 | 2026-10-23-session-input-clear-fix | 会话输入框发送即清与草稿隔离修复 |
| 2026-10-23 | 2026-10-23-marquee-motion-polish | 跑马灯动效与流光柔化 |
| 2026-10-23 | 2026-10-23-session-network-context | 2026-10-23-session-network-context |
| 2026-10-23 | 2026-10-23-session-first-window-turn-align | 会话重新进入时首屏历史窗口按最近 400 条日志截断，单轮日志超过 400 条时窗口起点落在该轮中段… |
| 2026-10-23 | 2026-10-24-close-run-quota-fallback | 交互轮失败后端从日志兜底识别限额错误 |
| 2026-10-23 | 2026-10-24-pi-edit-patch-synth | pi 会话的文件变更卡弹窗永远显示无补丁(pi-events.ts 设计期把 edit_patch … |
| 2026-10-24 | 2026-10-22-trajectory-context-jump | 轨迹视图两处体验缺口（对照 dsh）：1) processItems 里的 system_event… |
| 2026-10-25 | 2026-10-25-trajectory-source-model | 2026-10-25-trajectory-source-model |
| 2026-10-25 | 2026-10-25-session-git-worktree-root | 会话 git 分支指示项感知 sillyspec 工作树 |
| 2026-10-26 | 2026-10-26-turn-phase-prod-fix | 阶段上报生产断链修复与观测补盲。背景:阶段化进度功能(2026-10-26-session-stag… |
| 2026-10-26 | 2026-10-26-ws-evict-close | 修复WS逐出不关socket致daemon假活不重连 |
| 2026-10-26 | 2026-10-26-ci-red-to-green | 修复四条CI工作流失败转绿 |
| 2026-10-27 | 2026-10-27-mobile-chat-visual-round2 | 用户真机第二轮反馈(截图)：agent 回复仍未占满一行(真凶=PC 阅读限宽 max-w-[cal… |
| 2026-10-27 | 2026-10-27-scheduled-send-attachments | 用户反馈定时消息发送后 agent 收不到附件。排查确认：后端定时消息全链路（schema/落库/到… |
| 2026-10-27 | 2026-10-27-task-wakeup-precision-fix | 修复任务唤醒判据与通知四处缺陷 |
| 2026-10-27 | 2026-10-27-ghost-spec-binding-fix | 失败命令不再生成幽灵变更占位并过滤存量 |
| 2026-10-27 | 2026-10-27-task-wakeup-inject-retry | 后台任务终态唤醒注入经后端中转单发无重试，撞后端短暂不可用窗（部署重建/502/504）即 inte… |
| 2026-10-27 | 2026-10-27-sessions-total-and-status-filter | 会话列表数据统计修正：用户手机/PC 会话页总数被前端拉取上限截断在 500（实际 515），状态筛… |
| 2026-10-27 | 2026-10-27-knowledge-hits-flush-button | 知识遥测断流根因：sillyspec CLI 2026-10-18 把遥测文件迁至 .runtime… |
| 2026-10-27 | 2026-10-28-knowledge-hits-cli-direct | CLI 直报主通道的接收侧（用户拍板方案收尾）：CLI 侧只持有 shpsync_ 平台令牌（wor… |
