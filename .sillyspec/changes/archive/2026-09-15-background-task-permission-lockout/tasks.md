---
author: qinyi
created_at: '2026-09-15 16:27:23'
---

# 任务清单（Tasks）— 2026-09-15-background-task-permission-lockout

- [x] task-01: daemon 后台锚点——onResult 注册表非空保留 currentRunId；task_notification 注销后注册表清空时清锚点；clearBackgroundTasks 同步清 (depends_on: 无)
  - target_files: sillyhub-daemon/src/interactive/session-manager/events.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
  - 完成标准：锚点态可复现（result 后 status=active+currentRunId 在）；末任务注销后锚点清；会话终态清；新 inject 切 run 不受影响；单测覆盖三路径
- [x] task-02: SessionManager 门面新增 hasLiveBackgroundTasks(sessionId) 只读访问器 (depends_on: 无)
  - target_files: sillyhub-daemon/src/interactive/session-manager.ts
  - 完成标准:私有 _backgroundTasks 不外泄的前提下 daemon.ts/permission.ts 可查询；空/非空两态单测
- [x] task-03: 守卫放行——writeChannelGuardDeny 新增 hasBackgroundTaskGrace（active+currentRunId+注册表非空）；两处 deny 文案加 PLATFORM_NO_RUNNING_TURN: 前缀 (depends_on: task-01, task-02)
  - target_files: sillyhub-daemon/src/interactive/session-manager/permission.ts
  - 完成标准:三态单测（注册表空 deny/非空放行/currentRunId 无 deny）；前缀断言；主轮普通人审 deny 文案不变
- [x] task-04: background_task 标记——backgroundTaskFlag 辅助 + 4 处可达 register 调用点注入（默认普通审批/AskUserQuestion 拦截/ExitPlanMode/requestPermissionImpl）+ resolver payload 组装写 background_task (depends_on: task-02)
  - target_files: sillyhub-daemon/src/interactive/session-manager/permission.ts, sillyhub-daemon/src/interactive/permission-resolver.ts
  - 完成标准:锚点态 4 处 payload 均带 background_task:true；主轮进行中恒 false；2 处不可达路径（requestUserDialogImpl/buildOnUserDialogCallback）锚点态维持 cancelled（断言现状语义）
- [x] task-05: 后台 dialog 有界兜底——permission-resolver register 中 backgroundTask===true 时 dialog 也启用 5min fallback (depends_on: task-04)
  - target_files: sillyhub-daemon/src/interactive/permission-resolver.ts
  - 完成标准：后台 dialog 5min 兜底 deny 单测；主轮 dialog 仍不设超时（现状断言）
- [x] task-06: 用量标注——daemon.ts run 结果上报处 hasLiveBackgroundTasks 为真时向收口 runId 追加 [USAGE_NOTE] stdout 日志行 (depends_on: task-02)
  - target_files: sillyhub-daemon/src/daemon.ts
  - 完成标准：注册表非空触发/为空不触发两态单测；行格式与 [TASK_*] 协议一致
- [x] task-07: backend 协议字段——PermissionRequestPayload.background_task: bool | None = None (depends_on: 无)
  - target_files: backend/app/modules/daemon/protocol.py
  - 完成标准：字段缺省 None（旧 daemon 兼容）；pydantic 校验单测
- [x] task-08: backend 受理放宽 + 即时 deny——background_task=true 替换 current_run 校验块（run 直查+agent_session_id 归属）；全部校验失败分支推 _deny_respond（runtime_id ack 键 + PLATFORM_PERMISSION_DROPPED: 前缀，best-effort） (depends_on: task-07)
  - target_files: backend/app/modules/daemon/permission_service.py
  - 完成标准：带标记请求 run completed 仍受理；归属不匹配拒+推 deny；各失败分支 mock hub 断言 payload；session-not-found 分支 runtime_id 条件写入（取不到时不带该键）
- [x] task-09: 重启终态化补错误码——_cleanup_stale_runs_impl failed 分支写 error_code=SERVICE_RESTART_INTERRUPTED + error_detail (depends_on: 无)
  - target_files: backend/app/modules/agent/service.py
  - 完成标准：failed 分支断言两字段；completed 恢复分支不写 error_code
- [x] task-10: daemon 单测收口——守卫三态/锚点生命周期/4 处注入+2 处不可达/后台 dialog 兜底/USAGE_NOTE 全用例 + 相关既有测试跑绿 (depends_on: task-01, task-02, task-03, task-04, task-05, task-06)  # Wave 7
  - target_files: NEW:sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts, sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts, sillyhub-daemon/tests/interactive/permission-resolver.test.ts, sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts
  - 完成标准：vitest 相关文件全绿 + pnpm typecheck 绿
- [x] task-11: backend 单测收口——受理放宽/即时 deny payload/error_code 断言 + 既有 fail-soft 测试断言修订（拒收时断言 hub 收到 deny）+ 相关测试跑绿 (depends_on: task-07, task-08, task-09)
  - target_files: backend/app/modules/daemon/tests/test_session_permissions.py, NEW:backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
  - 完成标准：pytest 相关文件全绿 + ruff/mypy 绿
