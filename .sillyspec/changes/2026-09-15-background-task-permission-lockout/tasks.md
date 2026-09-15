---
author: qinyi
created_at: '2026-09-15 16:27:23'
---

# 任务清单（Tasks）— 2026-09-15-background-task-permission-lockout

- [ ] task-01: daemon 后台锚点——onResult 注册表非空保留 currentRunId + task_notification 注销清空时清锚点 + clearBackgroundTasks 同步清
- [ ] task-02: daemon SessionManager 门面新增 hasLiveBackgroundTasks 只读访问器
- [ ] task-03: daemon 守卫放行——writeChannelGuardDeny 新增 hasBackgroundTaskGrace + deny 文案加 PLATFORM_NO_RUNNING_TURN 前缀
- [ ] task-04: daemon background_task 标记——backgroundTaskFlag 辅助 + 4 处可达 register 注入 + resolver payload 组装
- [ ] task-05: daemon 后台 dialog 有界兜底——backgroundTask=true 时 dialog 也启用 5min fallback
- [ ] task-06: daemon 用量标注——run 收口时注册表非空追加 [USAGE_NOTE] 日志行
- [ ] task-07: backend 协议字段——PermissionRequestPayload.background_task
- [ ] task-08: backend 受理放宽——background_task=true 走 run 直查+归属校验；全部校验失败分支推即时 deny（_deny_respond 带 runtime_id + PLATFORM_PERMISSION_DROPPED）
- [ ] task-09: backend 重启终态化补 error_code/error_detail
- [ ] task-10: daemon 单测（守卫三态/锚点/4 处注入/2 处不可达 cancelled/后台 dialog 兜底/USAGE_NOTE）
- [ ] task-11: backend 单测（受理放宽/即时 deny payload/error_code/既有 fail-soft 断言修订）
